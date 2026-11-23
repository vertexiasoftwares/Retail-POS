import { enforceAuth, ensureOperationId } from '../auth-guard.mjs';
export function registerSalesRoutes(app, db, auth, sync) {
    // POST /api/sales/snapshot
    app.post('/api/sales/snapshot', async (request, reply) => {
        const body = request.body;
        if (!body || !body.branchId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'sales.read', body.branchId);
        if (!guarded)
            return;
        try {
            const snapshot = db.getSalesSnapshot(body);
            return snapshot;
        }
        catch (err) {
            return reply.status(400).send({ error: 'SalesSnapshotError', message: err?.message || 'Failed to load sales snapshot.', statusCode: 400 });
        }
    });
    // GET /api/sales/detail?branchId=...&saleId=...
    app.get('/api/sales/detail', async (request, reply) => {
        const query = request.query;
        if (!query.branchId || !query.saleId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'branchId and saleId are required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'sales.read', query.branchId);
        if (!guarded)
            return;
        try {
            const detail = db.getSalesDetail(query.branchId, query.saleId);
            return detail;
        }
        catch (err) {
            return reply.status(400).send({ error: 'SalesDetailError', message: err?.message || 'Failed to load sale details.', statusCode: 400 });
        }
    });
    // POST /api/sales/return
    app.post('/api/sales/return', async (request, reply) => {
        const body = request.body;
        if (!body || !body.branchId || !body.saleId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'branchId and saleId are required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'sales.return', body.branchId, true);
        if (!guarded)
            return;
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
        }
        catch (err) {
            return reply.status(400).send({ error: 'ReturnError', message: err?.message || 'Return could not be processed.', statusCode: 400 });
        }
    });
    // POST /api/sales/export-csv
    app.post('/api/sales/export-csv', async (request, reply) => {
        const body = request.body;
        if (!body || !body.branchId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'data.export', body.branchId);
        if (!guarded)
            return;
        try {
            const csv = db.exportSalesCsv(body);
            return { canceled: false, csv, filename: `sales-${body.branchId}.csv` };
        }
        catch (err) {
            return reply.status(400).send({ error: 'ExportSalesCsvError', message: err?.message || 'Failed to export sales CSV.', statusCode: 400 });
        }
    });
}
//# sourceMappingURL=sales.mjs.map