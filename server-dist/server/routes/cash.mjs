import { enforceAuth, ensureOperationId } from '../auth-guard.mjs';
export function registerCashRoutes(app, db, auth, sync) {
    // GET /api/cash/snapshot?branchId=...
    app.get('/api/cash/snapshot', async (request, reply) => {
        const query = request.query;
        if (!query.branchId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'shifts.read', query.branchId);
        if (!guarded)
            return;
        try {
            const snapshot = db.cash.snapshot(query.branchId, guarded.session.userId);
            return snapshot;
        }
        catch (err) {
            return reply.status(400).send({ error: 'CashSnapshotError', message: err?.message || 'Failed to load cash snapshot.', statusCode: 400 });
        }
    });
    // POST /api/cash/close-shift
    app.post('/api/cash/close-shift', async (request, reply) => {
        const body = request.body;
        if (!body || !body.branchId || !body.shiftId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'branchId and shiftId are required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'shifts.close', body.branchId, true);
        if (!guarded)
            return;
        // RBAC: If user lacks cash.manage (manager/owner), verify they own the shift
        if (!guarded.session.permissions.includes('cash.manage')) {
            const shift = db.connection.prepare('SELECT cashier_id FROM cash_shifts WHERE id=? AND branch_id=?').get(body.shiftId, body.branchId);
            if (!shift || shift.cashier_id !== guarded.session.userId) {
                return reply.status(403).send({ error: 'Forbidden', message: 'You can only close your own cash shift.', statusCode: 403 });
            }
        }
        try {
            const result = db.cash.close(ensureOperationId(body, guarded.session.userId));
            sync?.broadcast({
                type: 'shift:closed',
                branchId: body.branchId,
                businessId: guarded.session.businessId,
                payload: { shiftId: body.shiftId, cashierId: guarded.session.userId },
            });
            sync?.broadcast({
                type: 'cash:updated',
                branchId: body.branchId,
                businessId: guarded.session.businessId,
            });
            return result;
        }
        catch (err) {
            return reply.status(400).send({ error: 'CloseShiftError', message: err?.message || 'Failed to close cash shift.', statusCode: 400 });
        }
    });
    // POST /api/cash/move
    app.post('/api/cash/move', async (request, reply) => {
        const body = request.body;
        if (!body || !body.branchId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'cash.manage', body.branchId, true);
        if (!guarded)
            return;
        try {
            const result = db.cash.move(ensureOperationId(body, guarded.session.userId));
            sync?.broadcast({
                type: 'cash:updated',
                branchId: body.branchId,
                businessId: guarded.session.businessId,
            });
            return result;
        }
        catch (err) {
            return reply.status(400).send({ error: 'CashMoveError', message: err?.message || 'Failed to move cash.', statusCode: 400 });
        }
    });
}
//# sourceMappingURL=cash.mjs.map