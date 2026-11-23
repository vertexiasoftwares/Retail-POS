import type { FastifyInstance } from 'fastify';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import type {
  BranchCreateRequest,
  BranchUpdateRequest,
  BranchActiveRequest,
  TransferQuery,
  TransferDispatchRequest,
  TransferReceiveRequest,
  TransferCancelRequest,
} from '../../src/types/branches.js';
import { enforceAuth, ensureOperationId } from '../auth-guard.mjs';

export function registerBranchesRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  sync?: RealtimeSyncServer
): void {
  // GET /api/branches/list
  app.get('/api/branches/list', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'branches.manage');
    if (!guarded) return;

    try {
      const list = db.branches.list();
      return list;
    } catch (err: any) {
      return reply.status(400).send({ error: 'BranchListError', message: err?.message || 'Failed to list branches.', statusCode: 400 });
    }
  });

  // POST /api/branches/create
  app.post('/api/branches/create', async (request, reply) => {
    const body = request.body as BranchCreateRequest | undefined;
    const guarded = enforceAuth(request, reply, auth, db, 'branches.manage', undefined, true);
    if (!guarded) return;

    try {
      const result = db.branches.create(ensureOperationId(body!, guarded.session.userId));
      sync?.broadcast({
        type: 'branch:created',
        businessId: guarded.session.businessId,
        payload: { branchId: result.branchId },
      });
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'BranchCreateError', message: err?.message || 'Failed to create branch.', statusCode: 400 });
    }
  });

  // PUT /api/branches/update
  app.put('/api/branches/update', async (request, reply) => {
    const body = request.body as BranchUpdateRequest | undefined;
    const guarded = enforceAuth(request, reply, auth, db, 'branches.manage', undefined, true);
    if (!guarded) return;

    try {
      const result = db.branches.update(ensureOperationId(body!, guarded.session.userId));
      sync?.broadcast({
        type: 'branch:updated',
        businessId: guarded.session.businessId,
        payload: { branchId: result.branchId },
      });
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'BranchUpdateError', message: err?.message || 'Failed to update branch.', statusCode: 400 });
    }
  });

  // POST /api/branches/set-active
  app.post('/api/branches/set-active', async (request, reply) => {
    const body = request.body as BranchActiveRequest | undefined;
    const guarded = enforceAuth(request, reply, auth, db, 'branches.manage', undefined, true);
    if (!guarded) return;

    if (!body?.isActive && body?.targetBranchId === guarded.session.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Switch to another branch before archiving the current branch.', statusCode: 400 });
    }

    try {
      const result = db.branches.setActive(ensureOperationId(body!, guarded.session.userId));
      sync?.broadcast({
        type: 'branch:updated',
        businessId: guarded.session.businessId,
        payload: { branchId: result.branchId },
      });
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'BranchActiveError', message: err?.message || 'Failed to change branch active state.', statusCode: 400 });
    }
  });

  // POST /api/transfers/list
  app.post('/api/transfers/list', async (request, reply) => {
    const body = request.body as TransferQuery | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'transfers.read', body.branchId);
    if (!guarded) return;

    try {
      const snapshot = db.transfers.list(body);
      return snapshot;
    } catch (err: any) {
      return reply.status(400).send({ error: 'TransferListError', message: err?.message || 'Failed to list transfers.', statusCode: 400 });
    }
  });

  // GET /api/transfers/detail?branchId=...&id=...
  app.get('/api/transfers/detail', async (request, reply) => {
    const query = request.query as { branchId?: string; id?: string };
    if (!query.branchId || !query.id) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and id are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'transfers.read', query.branchId);
    if (!guarded) return;

    try {
      const record = db.transfers.detail(query.branchId, query.id);
      return record;
    } catch (err: any) {
      return reply.status(400).send({ error: 'TransferDetailError', message: err?.message || 'Failed to load transfer detail.', statusCode: 400 });
    }
  });

  // POST /api/transfers/dispatch
  app.post('/api/transfers/dispatch', async (request, reply) => {
    const body = request.body as TransferDispatchRequest | undefined;
    if (!body || !body.branchId || !body.destinationBranchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and destinationBranchId are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'transfers.dispatch', body.branchId, true);
    if (!guarded) return;

    // Also check destination branch access
    try {
      auth.requireToken(guarded.token, 'transfers.dispatch', body.destinationBranchId);
    } catch (err: any) {
      return reply.status(403).send({ error: 'Forbidden', message: err?.message || 'Access to destination branch denied.', statusCode: 403 });
    }

    try {
      const record = db.transfers.dispatch(ensureOperationId(body, guarded.session.userId));
      sync?.broadcast({
        type: 'transfer:dispatched',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: { transferId: record.id },
      });
      sync?.broadcast({
        type: 'transfer:dispatched',
        branchId: body.destinationBranchId,
        businessId: guarded.session.businessId,
        payload: { transferId: record.id },
      });
      sync?.broadcast({
        type: 'inventory:changed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return record;
    } catch (err: any) {
      return reply.status(400).send({ error: 'TransferDispatchError', message: err?.message || 'Failed to dispatch transfer.', statusCode: 400 });
    }
  });

  // POST /api/transfers/receive
  app.post('/api/transfers/receive', async (request, reply) => {
    const body = request.body as TransferReceiveRequest | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'transfers.receive', body.branchId, true);
    if (!guarded) return;

    try {
      const record = db.transfers.receive(ensureOperationId(body, guarded.session.userId));
      sync?.broadcast({
        type: 'transfer:received',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: { transferId: record.id },
      });
      sync?.broadcast({
        type: 'inventory:changed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return record;
    } catch (err: any) {
      return reply.status(400).send({ error: 'TransferReceiveError', message: err?.message || 'Failed to receive transfer.', statusCode: 400 });
    }
  });

  // POST /api/transfers/cancel
  app.post('/api/transfers/cancel', async (request, reply) => {
    const body = request.body as TransferCancelRequest | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'transfers.cancel', body.branchId, true);
    if (!guarded) return;

    try {
      const record = db.transfers.cancel(ensureOperationId(body, guarded.session.userId));
      sync?.broadcast({
        type: 'transfer:cancelled',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: { transferId: record.id },
      });
      sync?.broadcast({
        type: 'inventory:changed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return record;
    } catch (err: any) {
      return reply.status(400).send({ error: 'TransferCancelError', message: err?.message || 'Failed to cancel transfer.', statusCode: 400 });
    }
  });
}
