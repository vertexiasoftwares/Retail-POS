import type { FastifyInstance } from 'fastify';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import type {
  ExpenseQuery,
  ExpensePostRequest,
  ExpenseReverseRequest,
} from '../../src/types/accounts.js';
import { enforceAuth, ensureOperationId } from '../auth-guard.mjs';

export function registerExpensesRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  sync?: RealtimeSyncServer
): void {
  // POST /api/expenses/list
  app.post('/api/expenses/list', async (request, reply) => {
    const body = request.body as ExpenseQuery | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'expenses.read', body.branchId);
    if (!guarded) return;

    try {
      const snapshot = db.accounts.expenses(body);
      return snapshot;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ExpenseListError', message: err?.message || 'Failed to list expenses.', statusCode: 400 });
    }
  });

  // POST /api/expenses/post
  app.post('/api/expenses/post', async (request, reply) => {
    const body = request.body as ExpensePostRequest | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'expenses.manage', body.branchId, true);
    if (!guarded) return;

    try {
      const result = db.accounts.postExpense(ensureOperationId(body, guarded.session.userId));
      sync?.broadcast({
        type: 'cash:updated',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ExpensePostError', message: err?.message || 'Failed to post expense.', statusCode: 400 });
    }
  });

  // POST /api/expenses/reverse
  app.post('/api/expenses/reverse', async (request, reply) => {
    const body = request.body as ExpenseReverseRequest | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'expenses.manage', body.branchId, true);
    if (!guarded) return;

    try {
      const result = db.accounts.reverseExpense(ensureOperationId(body, guarded.session.userId));
      sync?.broadcast({
        type: 'cash:updated',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ExpenseReverseError', message: err?.message || 'Failed to reverse expense.', statusCode: 400 });
    }
  });
}
