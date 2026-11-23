import { enforceAuth } from '../auth-guard.mjs';
export function registerDashboardRoutes(app, db, auth, _sync) {
    // POST /api/dashboard/snapshot
    app.post('/api/dashboard/snapshot', async (request, reply) => {
        const body = request.body;
        if (!body || typeof body !== 'object' || !body.branchId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'dashboard.read', body.branchId);
        if (!guarded)
            return;
        try {
            const snapshot = db.getDashboardSnapshot(body);
            return snapshot;
        }
        catch (err) {
            return reply.status(400).send({ error: 'DashboardError', message: err?.message || 'Failed to load dashboard.', statusCode: 400 });
        }
    });
    // GET /api/dashboard/search?term=...&branchId=...
    app.get('/api/dashboard/search', async (request, reply) => {
        const query = request.query;
        const branchId = query.branchId;
        if (!branchId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'dashboard.read', branchId);
        if (!guarded)
            return;
        try {
            const term = query.term || '';
            const results = db.search(term.slice(0, 100), branchId);
            return results;
        }
        catch (err) {
            return reply.status(400).send({ error: 'SearchError', message: err?.message || 'Search failed.', statusCode: 400 });
        }
    });
}
//# sourceMappingURL=dashboard.mjs.map