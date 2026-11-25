import type { FastifyInstance } from 'fastify';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import type { ManualReturnRequest, ReturnsListQuery, SalesListQuery, SalesReturnRequest } from '../../src/types/desktop-api.js';
import { enforceAuth, ensureOperationId } from '../auth-guard.mjs';

export function registerSalesRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  sync?: RealtimeSyncServer
): void {
  // POST /api/sales/snapshot
  app.post('/api/sales/snapshot', async (request, reply) => {
    const body = request.body as SalesListQuery | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'sales.read', body.branchId);
    if (!guarded) return;

    try {
      const snapshot = db.getSalesSnapshot(body);
      return snapshot;
    } catch (err: any) {
      return reply.status(400).send({ error: 'SalesSnapshotError', message: err?.message || 'Failed to load sales snapshot.', statusCode: 400 });
    }
  });

  // GET /api/sales/detail?branchId=...&saleId=...
  app.get('/api/sales/detail', async (request, reply) => {
    const query = request.query as { branchId?: string; saleId?: string };
    if (!query.branchId || !query.saleId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and saleId are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'sales.read', query.branchId);
    if (!guarded) return;

    try {
      const detail = db.getSalesDetail(query.branchId, query.saleId);
      return detail;
    } catch (err: any) {
      return reply.status(400).send({ error: 'SalesDetailError', message: err?.message || 'Failed to load sale details.', statusCode: 400 });
    }
  });

  // POST /api/sales/return
  app.post('/api/sales/return', async (request, reply) => {
    const body = request.body as SalesReturnRequest | undefined;
    if (!body || !body.branchId || !body.saleId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and saleId are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'sales.return', body.branchId, true);
    if (!guarded) return;

    try {
      const result = db.createSalesReturn(ensureOperationId(body, guarded.session.userId));
      sync?.broadcast({
        type: 'sale:returned',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: {
          returnId: result.returnId,
          returnNumber: result.returnNumber,
          totalPaisa: result.totalPaisa,
        },
      });
      sync?.broadcast({
        type: 'inventory:changed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      sync?.broadcast({
        type: 'cash:updated',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ReturnError', message: err?.message || 'Return could not be processed.', statusCode: 400 });
    }
  });

  // POST /api/sales/export-csv
  app.post('/api/sales/export-csv', async (request, reply) => {
    const body = request.body as SalesListQuery | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'data.export', body.branchId);
    if (!guarded) return;

    try {
      const csv = db.exportSalesCsv(body);
      return { canceled: false, csv, filename: `sales-${body.branchId}.csv` };
    } catch (err: any) {
      return reply.status(400).send({ error: 'ExportSalesCsvError', message: err?.message || 'Failed to export sales CSV.', statusCode: 400 });
    }
  });

  // GET /api/sales/find-by-invoice?branchId=...&invoiceNumber=...
  app.get('/api/sales/find-by-invoice', async (request, reply) => {
    const query = request.query as { branchId?: string; invoiceNumber?: string };
    if (!query.branchId || !query.invoiceNumber) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and invoiceNumber are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'sales.read', query.branchId);
    if (!guarded) return;

    try {
      const detail = db.findSaleByInvoiceNumber(query.branchId, query.invoiceNumber);
      if (detail && !guarded.session.permissions.includes('dashboard.read')) {
        detail.costPaisa = 0;
      }
      return detail;
    } catch (err: any) {
      return reply.status(400).send({ error: 'FindInvoiceError', message: err?.message || 'Failed to find invoice.', statusCode: 400 });
    }
  });

  // POST /api/sales/manual-return
  app.post('/api/sales/manual-return', async (request, reply) => {
    const body = request.body as ManualReturnRequest | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'sales.return', body.branchId, true);
    if (!guarded) return;

    try {
      const result = db.createManualReturn(ensureOperationId(body, guarded.session.userId));
      sync?.broadcast({
        type: 'sale:returned',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: {
          returnId: result.returnId,
          returnNumber: result.returnNumber,
          totalPaisa: result.totalPaisa,
        },
      });
      sync?.broadcast({
        type: 'inventory:changed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      sync?.broadcast({
        type: 'cash:updated',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ManualReturnError', message: err?.message || 'Manual return could not be processed.', statusCode: 400 });
    }
  });

  // POST /api/sales/returns
  app.post('/api/sales/returns', async (request, reply) => {
    const body = request.body as ReturnsListQuery | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'sales.read', body.branchId);
    if (!guarded) return;

    try {
      return db.getReturnsList(body);
    } catch (err: any) {
      return reply.status(400).send({ error: 'ReturnsListError', message: err?.message || 'Failed to load returns.', statusCode: 400 });
    }
  });
}
