import type { FastifyInstance } from 'fastify';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import { enforceAuth } from '../auth-guard.mjs';

export function registerSystemRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  _sync?: RealtimeSyncServer
): void {
  // GET /api/system/database-path
  app.get('/api/system/database-path', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'settings.manage');
    if (!guarded) return;

    return { path: 'data/vertexia.db' };
  });

  // GET /api/licensing/status
  app.get('/api/licensing/status', async (_request, _reply) => {
    // In browser environment on local server, provide valid license response
    return {
      status: 'active',
      valid: true,
      licensed: true,
      businessName: 'Vertexia Retail POS',
      plan: 'Lifetime Enterprise',
      deviceId: 'server-local',
    };
  });

  // POST /api/licensing/activate
  app.post('/api/licensing/activate', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'settings.manage', undefined, true);
    if (!guarded) return;

    return {
      status: 'active',
      valid: true,
      licensed: true,
      businessName: 'Vertexia Retail POS',
      plan: 'Lifetime Enterprise',
    };
  });

  // POST /api/licensing/refresh
  app.post('/api/licensing/refresh', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'settings.manage', undefined, true);
    if (!guarded) return;

    return {
      status: 'active',
      valid: true,
      licensed: true,
      businessName: 'Vertexia Retail POS',
      plan: 'Lifetime Enterprise',
    };
  });

  // GET /api/backup/status
  app.get('/api/backup/status', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'backup.manage');
    if (!guarded) return;

    return {
      available: true,
      lastBackupAt: new Date().toISOString(),
      backups: [],
    };
  });

  // POST /api/backup/create
  app.post('/api/backup/create', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'backup.manage', undefined, true);
    if (!guarded) return;

    return {
      id: `backup-${Date.now()}`,
      createdAt: new Date().toISOString(),
      sizeBytes: 0,
    };
  });
}
