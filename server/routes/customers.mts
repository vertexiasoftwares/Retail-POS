import type { FastifyInstance } from 'fastify';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import type {
  CustomerQuery,
  CustomerCreateRequest,
  CustomerUpdateRequest,
  CustomerCollectRequest,
} from '../../src/types/accounts.js';
import { enforceAuth, ensureOperationId } from '../auth-guard.mjs';

export function registerCustomersRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  sync?: RealtimeSyncServer
): void {
  // POST /api/customers/list
  app.post('/api/customers/list', async (request, reply) => {
    const body = request.body as CustomerQuery | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'customers.read', body.branchId);
    if (!guarded) return;

    try {
      const snapshot = db.accounts.customers(body);
      return snapshot;
    } catch (err: any) {
      return reply.status(400).send({ error: 'CustomerListError', message: err?.message || 'Failed to list customers.', statusCode: 400 });
    }
  });

  // GET /api/customers/detail?branchId=...&customerId=...&page=...
  app.get('/api/customers/detail', async (request, reply) => {
    const query = request.query as { branchId?: string; customerId?: string; page?: string };
    if (!query.branchId || !query.customerId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and customerId are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'customers.read', query.branchId);
    if (!guarded) return;

    try {
      const page = query.page ? Number(query.page) : undefined;
      const detail = db.accounts.customerDetail(query.branchId, query.customerId, page);
      return detail;
    } catch (err: any) {
      return reply.status(400).send({ error: 'CustomerDetailError', message: err?.message || 'Failed to load customer details.', statusCode: 400 });
    }
  });

  // GET /api/customers/receipt?branchId=...&receiptId=...
  app.get('/api/customers/receipt', async (request, reply) => {
    const query = request.query as { branchId?: string; receiptId?: string };
    if (!query.branchId || !query.receiptId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and receiptId are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'customers.read', query.branchId);
    if (!guarded) return;

    try {
      const receipt = db.accounts.receipt(query.branchId, query.receiptId);
      return receipt;
    } catch (err: any) {
      return reply.status(400).send({ error: 'CustomerReceiptError', message: err?.message || 'Failed to load customer receipt.', statusCode: 400 });
    }
  });

  // POST /api/customers/create
  app.post('/api/customers/create', async (request, reply) => {
    const body = request.body as CustomerCreateRequest | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const requiredPermission = body.openingBalancePaisa !== 0 ? 'customers.manage' : 'customers.create';
    const guarded = enforceAuth(request, reply, auth, db, requiredPermission, body.branchId, true);
    if (!guarded) return;

    try {
      const result = db.accounts.createCustomer(ensureOperationId(body, guarded.session.userId));
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'CustomerCreateError', message: err?.message || 'Failed to create customer.', statusCode: 400 });
    }
  });

  // PUT /api/customers/update
  app.put('/api/customers/update', async (request, reply) => {
    const body = request.body as CustomerUpdateRequest | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'customers.manage', body.branchId, true);
    if (!guarded) return;

    try {
      const result = db.accounts.updateCustomer(ensureOperationId(body, guarded.session.userId));
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'CustomerUpdateError', message: err?.message || 'Failed to update customer.', statusCode: 400 });
    }
  });

  // POST /api/customers/collect
  app.post('/api/customers/collect', async (request, reply) => {
    const body = request.body as CustomerCollectRequest | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'customers.collect', body.branchId, true);
    if (!guarded) return;

    // Check cash shift if method is Cash and user does not have cash.manage
    if (body.method === 'Cash' && !guarded.session.permissions.includes('cash.manage')) {
      const ownShift = db.connection.prepare("SELECT 1 FROM cash_shifts WHERE branch_id=? AND cashier_id=? AND status='open'").get(body.branchId, guarded.session.userId);
      if (!ownShift) {
        const shift = db.connection.prepare("SELECT cashier_id FROM cash_shifts WHERE branch_id=? AND status='open'").get(body.branchId) as { cashier_id: string } | undefined;
        if (shift && shift.cashier_id !== guarded.session.userId) {
          return reply.status(403).send({ error: 'Forbidden', message: 'You can only receive cash into your own open shift.', statusCode: 403 });
        }
      }
    }

    try {
      const receipt = db.accounts.collect(ensureOperationId(body, guarded.session.userId));
      sync?.broadcast({
        type: 'cash:updated',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return receipt;
    } catch (err: any) {
      return reply.status(400).send({ error: 'CustomerCollectError', message: err?.message || 'Failed to collect payment.', statusCode: 400 });
    }
  });
}
