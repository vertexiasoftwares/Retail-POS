import type { FastifyInstance } from 'fastify';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import type {
  PosCompleteSaleRequest,
  PosCartLineInput,
  PosCreateProductInput,
  PosCreateCustomerInput,
} from '../../src/types/desktop-api.js';
import { enforceAuth, ensureOperationId } from '../auth-guard.mjs';

export function registerPosRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  sync?: RealtimeSyncServer
): void {
  // GET /api/pos/bootstrap?branchId=...
  app.get('/api/pos/bootstrap', async (request, reply) => {
    const query = request.query as { branchId?: string };
    const branchId = query.branchId;
    if (!branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'pos.sell', branchId);
    if (!guarded) return;

    try {
      const data = db.getPosBootstrap(branchId);
      return data;
    } catch (err: any) {
      return reply.status(400).send({ error: 'PosError', message: err?.message || 'Failed to load POS data.', statusCode: 400 });
    }
  });

  // POST /api/pos/sale
  app.post('/api/pos/sale', async (request, reply) => {
    const body = request.body as PosCompleteSaleRequest | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'pos.sell', body.branchId, true);
    if (!guarded) return;

    // Additional IPC check: discount permission
    if (body.lines && Array.isArray(body.lines) && body.lines.some(l => l.discountBasisPoints > 0)) {
      if (!guarded.session.permissions.includes('pos.discount')) {
        return reply.status(403).send({ error: 'Forbidden', message: 'You do not have permission to apply discounts.', statusCode: 403 });
      }
    }

    try {
      const scopedBody = ensureOperationId(body, guarded.session.userId);
      const completed = db.completePosSale(scopedBody);
      // Broadcast real-time event to other counter PCs
      sync?.broadcast({
        type: 'sale:completed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: {
          saleId: completed.saleId,
          invoiceNumber: completed.invoiceNumber,
          totalPaisa: completed.totalPaisa,
          paymentMethod: completed.paymentMethod,
        },
      });
      sync?.broadcast({
        type: 'inventory:changed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return completed;
    } catch (err: any) {
      return reply.status(400).send({ error: 'SaleError', message: err?.message || 'Sale could not be completed.', statusCode: 400 });
    }
  });

  // POST /api/pos/hold
  app.post('/api/pos/hold', async (request, reply) => {
    const body = request.body as { branchId: string; customerId: string; lines: PosCartLineInput[] } | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'pos.sell', body.branchId, true);
    if (!guarded) return;

    try {
      const held = db.holdPosSale(body.branchId, body.customerId, body.lines);
      return held;
    } catch (err: any) {
      return reply.status(400).send({ error: 'HoldError', message: err?.message || 'Failed to hold sale.', statusCode: 400 });
    }
  });

  // POST /api/pos/resume-held
  app.post('/api/pos/resume-held', async (request, reply) => {
    const body = request.body as { id: string } | undefined;
    if (!body || !body.id) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Held sale ID is required.', statusCode: 400 });
    }
    // Verify branch of held sale
    const row = db.connection.prepare('SELECT branch_id FROM held_sales WHERE id=?').get(body.id) as { branch_id: string } | undefined;
    if (!row) {
      return reply.status(404).send({ error: 'NotFound', message: 'Held sale is unavailable.', statusCode: 404 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'pos.sell', row.branch_id, true);
    if (!guarded) return;

    try {
      const resumed = db.resumePosSale(body.id);
      return resumed;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ResumeError', message: err?.message || 'Failed to resume held sale.', statusCode: 400 });
    }
  });

  // DELETE /api/pos/held/:id
  app.delete('/api/pos/held/:id', async (request, reply) => {
    const params = request.params as { id: string };
    const id = params.id;
    if (!id) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Held sale ID is required.', statusCode: 400 });
    }
    const row = db.connection.prepare('SELECT branch_id FROM held_sales WHERE id=?').get(id) as { branch_id: string } | undefined;
    if (!row) {
      return reply.status(404).send({ error: 'NotFound', message: 'Held sale is unavailable.', statusCode: 404 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'pos.sell', row.branch_id, true);
    if (!guarded) return;

    try {
      db.deleteHeldPosSale(id);
      return { ok: true };
    } catch (err: any) {
      return reply.status(400).send({ error: 'DeleteError', message: err?.message || 'Failed to delete held sale.', statusCode: 400 });
    }
  });

  // POST /api/pos/open-shift
  app.post('/api/pos/open-shift', async (request, reply) => {
    const body = request.body as { branchId: string; openingCashPaisa: number; operationId?: string } | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'shifts.open', body.branchId, true);
    if (!guarded) return;

    try {
      const scopedBody = ensureOperationId(body, guarded.session.userId);
      const shiftId = db.openPosShift(body.branchId, body.openingCashPaisa, scopedBody.operationId);
      sync?.broadcast({
        type: 'shift:opened',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: { shiftId, cashierId: guarded.session.userId },
      });
      return { shiftId };
    } catch (err: any) {
      return reply.status(400).send({ error: 'ShiftError', message: err?.message || 'Failed to open shift.', statusCode: 400 });
    }
  });

  // POST /api/pos/product
  app.post('/api/pos/product', async (request, reply) => {
    const body = request.body as { branchId: string; input: PosCreateProductInput } | undefined;
    if (!body || !body.branchId || !body.input) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and input are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'products.manage', body.branchId, true);
    if (!guarded) return;

    try {
      const product = db.createPosProduct(body.branchId, body.input);
      sync?.broadcast({
        type: 'product:updated',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: { productId: product.id },
      });
      sync?.broadcast({
        type: 'inventory:changed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return product;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ProductError', message: err?.message || 'Failed to create product.', statusCode: 400 });
    }
  });

  // POST /api/pos/customer
  app.post('/api/pos/customer', async (request, reply) => {
    const body = request.body as PosCreateCustomerInput | undefined;
    if (!body || !body.name) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Customer name is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'customers.create', undefined, true);
    if (!guarded) return;

    try {
      const customer = db.createPosCustomer(body);
      return customer;
    } catch (err: any) {
      return reply.status(400).send({ error: 'CustomerError', message: err?.message || 'Failed to create customer.', statusCode: 400 });
    }
  });
}
