import type { FastifyInstance } from 'fastify';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import type { ProductCatalogQuery, ProductSaveInput } from '../../src/types/desktop-api.js';
import { enforceAuth } from '../auth-guard.mjs';

export function registerProductsRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  sync?: RealtimeSyncServer
): void {
  // POST /api/products/list
  app.post('/api/products/list', async (request, reply) => {
    const body = request.body as ProductCatalogQuery | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'products.read', body.branchId);
    if (!guarded) return;

    try {
      const result = db.listProducts(body);
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ProductListError', message: err?.message || 'Failed to list products.', statusCode: 400 });
    }
  });

  // POST /api/products/save
  app.post('/api/products/save', async (request, reply) => {
    const body = request.body as { branchId: string; input: ProductSaveInput } | undefined;
    if (!body || !body.branchId || !body.input) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and input are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'products.manage', body.branchId, true);
    if (!guarded) return;

    try {
      const saved = db.saveProduct(body.branchId, body.input);
      sync?.broadcast({
        type: 'product:updated',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: { productId: saved.id },
      });
      sync?.broadcast({
        type: 'inventory:changed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return saved;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ProductSaveError', message: err?.message || 'Failed to save product.', statusCode: 400 });
    }
  });

  // POST /api/products/toggle-status
  app.post('/api/products/toggle-status', async (request, reply) => {
    const body = request.body as { branchId: string; id: string } | undefined;
    if (!body || !body.branchId || !body.id) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and product id are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'products.manage', body.branchId, true);
    if (!guarded) return;

    try {
      const status = db.toggleProductStatus(body.branchId, body.id);
      sync?.broadcast({
        type: 'product:updated',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: { productId: body.id, status },
      });
      return status;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ToggleStatusError', message: err?.message || 'Failed to toggle product status.', statusCode: 400 });
    }
  });

  // POST /api/products/delete
  app.post('/api/products/delete', async (request, reply) => {
    const body = request.body as { branchId: string; id: string } | undefined;
    if (!body || !body.branchId || !body.id) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and product id are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'products.manage', body.branchId, true);
    if (!guarded) return;

    try {
      const result = db.deleteProduct(body.branchId, body.id);
      sync?.broadcast({
        type: 'product:updated',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
        payload: { productId: body.id, deleted: true },
      });
      sync?.broadcast({
        type: 'inventory:changed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return result;
    } catch (err: any) {
      return reply.status(400).send({ error: 'DeleteProductError', message: err?.message || 'Failed to delete product.', statusCode: 400 });
    }
  });

  // POST /api/products/import-csv
  app.post('/api/products/import-csv', async (request, reply) => {
    const body = request.body as { branchId: string; csv: string } | undefined;
    if (!body || !body.branchId || typeof body.csv !== 'string') {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId and csv are required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'products.manage', body.branchId, true);
    if (!guarded) return;

    try {
      const imported = db.importProductsCsv(body.branchId, body.csv);
      sync?.broadcast({
        type: 'inventory:changed',
        branchId: body.branchId,
        businessId: guarded.session.businessId,
      });
      return imported;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ImportCsvError', message: err?.message || 'Failed to import CSV.', statusCode: 400 });
    }
  });

  // POST /api/products/export-csv
  app.post('/api/products/export-csv', async (request, reply) => {
    const body = request.body as { branchId: string } | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'branchId is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'data.export', body.branchId);
    if (!guarded) return;

    try {
      const csv = db.exportProductsCsv(body.branchId);
      return { canceled: false, csv, filename: `products-${body.branchId}.csv` };
    } catch (err: any) {
      return reply.status(400).send({ error: 'ExportCsvError', message: err?.message || 'Failed to export CSV.', statusCode: 400 });
    }
  });
}
