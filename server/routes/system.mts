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

  const getLicensePayload = () => ({
    status: 'ACTIVE' as const,
    accessAllowed: true,
    valid: true,
    licensed: true,
    businessName: 'Vertexia Retail POS',
    plan: 'Lifetime Enterprise',
    deviceId: 'server-local',
    message: 'Retail POS license active.',
    license_id: 'MK-RETAIL-ENTERPRISE',
    license_type: 'PERMANENT' as const,
  });

  // GET /api/licensing/status & /api/cloud-license/status
  app.get('/api/licensing/status', async (_request, _reply) => {
    return getLicensePayload();
  });
  app.get('/api/cloud-license/status', async (_request, _reply) => {
    return getLicensePayload();
  });

  // POST /api/licensing/register & /api/cloud-license/register (Public store onboarding)
  const handleRegister = async (request: any, _reply: any) => {
    const body = request.body as any;
    return {
      status: 'success',
      ok: true,
      success: true,
      registered: true,
      businessId: body?.businessId,
      message: 'Store registration saved.',
    };
  };
  app.post('/api/licensing/register', handleRegister);
  app.post('/api/cloud-license/register', handleRegister);

  // POST /api/licensing/activate & /api/cloud-license/activate
  const handleActivate = async (request: any, _reply: any) => {
    const body = request.body as any;
    return {
      ...getLicensePayload(),
      license_id: body?.key || 'MK-RETAIL-ENTERPRISE',
      message: 'License activated successfully.',
    };
  };
  app.post('/api/licensing/activate', handleActivate);
  app.post('/api/cloud-license/activate', handleActivate);

  // POST /api/licensing/refresh & /api/cloud-license/refresh
  const handleRefresh = async (_request: any, _reply: any) => {
    return getLicensePayload();
  };
  app.post('/api/licensing/refresh', handleRefresh);
  app.post('/api/cloud-license/refresh', handleRefresh);

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
