import { enforceAuth, ensureOperationId } from '../auth-guard.mjs';
export function registerRetailRoutes(app, db, auth, sync) {
    // GET /api/retail/snapshot?branchId=...
    app.get('/api/retail/snapshot', async (request, reply) => {
        const query = request.query;
        if (!query.branchId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'retail.read', query.branchId);
        if (!guarded)
            return;
        try {
            const snapshot = db.retail.getSnapshot(query.branchId);
            return snapshot;
        }
        catch (err) {
            return reply.status(400).send({ error: 'RetailSnapshotError', message: err?.message || 'Failed to load retail snapshot.', statusCode: 400 });
        }
    });
    // POST /api/retail/adjust-stock
    app.post('/api/retail/adjust-stock', async (request, reply) => {
        const body = request.body;
        if (!body || !body.branchId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'stock.adjust', body.branchId, true);
        if (!guarded)
            return;
        try {
            const result = db.retail.adjustStock(ensureOperationId(body, guarded.session.userId));
            sync?.broadcast({
                type: 'inventory:changed',
                branchId: body.branchId,
                businessId: guarded.session.businessId,
            });
            return result;
        }
        catch (err) {
            return reply.status(400).send({ error: 'StockAdjustmentError', message: err?.message || 'Failed to adjust stock.', statusCode: 400 });
        }
    });
    // POST /api/retail/receive-purchase
    app.post('/api/retail/receive-purchase', async (request, reply) => {
        const body = request.body;
        if (!body || !body.branchId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'purchases.receive', body.branchId, true);
        if (!guarded)
            return;
        // If paid amount > 0, also require suppliers.pay
        if (body.paidAmountPaisa > 0 && !guarded.session.permissions.includes('suppliers.pay')) {
            return reply.status(403).send({ error: 'Forbidden', message: 'You do not have permission to pay suppliers.', statusCode: 403 });
        }
        try {
            const result = db.retail.receivePurchase(ensureOperationId(body, guarded.session.userId));
            sync?.broadcast({
                type: 'purchase:received',
                branchId: body.branchId,
                businessId: guarded.session.businessId,
                payload: { purchaseId: result.purchaseId, totalPaisa: result.totalPaisa },
            });
            sync?.broadcast({
                type: 'inventory:changed',
                branchId: body.branchId,
                businessId: guarded.session.businessId,
            });
            if (body.paidAmountPaisa > 0 && body.paymentMethod === 'Cash') {
                sync?.broadcast({
                    type: 'cash:updated',
                    branchId: body.branchId,
                    businessId: guarded.session.businessId,
                });
            }
            return result;
        }
        catch (err) {
            return reply.status(400).send({ error: 'ReceivePurchaseError', message: err?.message || 'Failed to receive purchase.', statusCode: 400 });
        }
    });
    // POST /api/retail/pay-supplier
    app.post('/api/retail/pay-supplier', async (request, reply) => {
        const body = request.body;
        if (!body || !body.branchId) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'suppliers.pay', body.branchId, true);
        if (!guarded)
            return;
        try {
            const result = db.retail.paySupplier(ensureOperationId(body, guarded.session.userId));
            if (body.method === 'Cash') {
                sync?.broadcast({
                    type: 'cash:updated',
                    branchId: body.branchId,
                    businessId: guarded.session.businessId,
                });
            }
            return result;
        }
        catch (err) {
            return reply.status(400).send({ error: 'PaySupplierError', message: err?.message || 'Failed to pay supplier.', statusCode: 400 });
        }
    });
    // POST /api/retail/create-supplier
    app.post('/api/retail/create-supplier', async (request, reply) => {
        const body = request.body;
        if (!body || typeof body.branchId !== 'string' || !body.branchId.trim()) {
            return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
        }
        if (typeof body.name !== 'string' || !body.name.trim()) {
            return reply.status(400).send({ error: 'BadRequest', message: 'Supplier name is required.', statusCode: 400 });
        }
        const guarded = enforceAuth(request, reply, auth, db, 'suppliers.pay', body.branchId, true);
        if (!guarded)
            return;
        try {
            const payload = ensureOperationId({ branchId: body.branchId, operationId: body.operationId, ...body }, guarded.session.userId);
            const result = db.retail.createSupplier(payload, typeof body.phone === 'string' ? body.phone : undefined);
            sync?.broadcast({
                type: 'purchase:received', // triggers notifyRetailDataChanged to reload suppliers
                branchId: body.branchId,
                businessId: guarded.session.businessId,
            });
            return result;
        }
        catch (err) {
            return reply.status(400).send({ error: 'CreateSupplierError', message: err?.message || 'Failed to create supplier.', statusCode: 400 });
        }
    });
}
//# sourceMappingURL=retail.mjs.map