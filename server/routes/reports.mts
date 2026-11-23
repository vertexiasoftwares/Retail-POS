import type { FastifyInstance } from 'fastify';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import type { ReportQuery } from '../../src/types/reports.js';
import { enforceAuth } from '../auth-guard.mjs';

export function registerReportsRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  _sync?: RealtimeSyncServer
): void {
  // POST /api/reports/snapshot
  app.post('/api/reports/snapshot', async (request, reply) => {
    const body = request.body as ReportQuery | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'reports.read', body.branchId);
    if (!guarded) return;

    try {
      const branchIds = body.allBranches ? guarded.session.branches.map(b => b.id) : [body.branchId];
      const snapshot = db.reports.snapshot(body, branchIds);
      return snapshot;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ReportError', message: err?.message || 'Failed to load report snapshot.', statusCode: 400 });
    }
  });

  // GET /api/reports/valuation?branchId=...
  app.get('/api/reports/valuation', async (request, reply) => {
    const query = request.query as { branchId?: string };
    if (!query.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'retail.read', query.branchId);
    if (!guarded) return;

    try {
      const valuation = db.reports.valuation(query.branchId);
      return valuation;
    } catch (err: any) {
      return reply.status(400).send({ error: 'ValuationError', message: err?.message || 'Failed to load stock valuation.', statusCode: 400 });
    }
  });

  // POST /api/reports/export-csv
  app.post('/api/reports/export-csv', async (request, reply) => {
    const body = request.body as ReportQuery | undefined;
    if (!body || !body.branchId) {
      return reply.status(400).send({ error: 'BadRequest', message: 'A branch is required.', statusCode: 400 });
    }
    const guarded = enforceAuth(request, reply, auth, db, 'data.export', body.branchId);
    if (!guarded) return;

    try {
      const branchIds = body.allBranches ? guarded.session.branches.map(b => b.id) : [body.branchId];
      const csv = db.reports.exportCsv(body, branchIds);
      return { canceled: false, csv, filename: `report-${body.section}-${body.branchId}.csv` };
    } catch (err: any) {
      return reply.status(400).send({ error: 'ExportReportCsvError', message: err?.message || 'Failed to export report CSV.', statusCode: 400 });
    }
  });
}
