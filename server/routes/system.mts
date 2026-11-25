import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import { BackupService, fileChecksum, inspectBackup } from '../../electron/backup.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import { enforceAuth } from '../auth-guard.mjs';

export function registerSystemRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  _sync?: RealtimeSyncServer,
  backups?: BackupService
): void {
  // GET /api/system/database-path
  app.get('/api/system/database-path', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'settings.manage');
    if (!guarded) return;

    return { path: 'data/vertexia.db' };
  });

  // GET /api/system/support-info (Safe read-only technical metadata, visible to all roles including Cashier)
  app.get('/api/system/support-info', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db);
    if (!guarded) return;

    let databaseSizeBytes: number | null = null;
    try {
      const pc = db.connection.prepare('PRAGMA page_count').get() as { page_count?: number } | undefined;
      const ps = db.connection.prepare('PRAGMA page_size').get() as { page_size?: number } | undefined;
      if (pc?.page_count !== undefined && ps?.page_size !== undefined) {
        databaseSizeBytes = Number(pc.page_count) * Number(ps.page_size);
      }
    } catch {
      databaseSizeBytes = null;
    }

    const license = getLicensePayload();
    return {
      appVersion: '1.0.0',
      os: `${os.type()} ${os.release()} (${process.platform} ${process.arch})`,
      databaseSizeBytes,
      licenseId: license.license_id,
      licenseStatus: license.status,
      licenseExpiryDate: null,
      deviceId: license.deviceId,
      shopName: guarded.session.businessName || license.businessName,
    };
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

    if (!backups) {
      return {
        busy: false,
        directory: '',
        records: [],
        lastAutomaticError: 'Backups must be taken on the main PC.',
        remoteClient: true,
        canRestore: false,
      };
    }

    return {
      ...backups.status(),
      remoteClient: true,
      canRestore: false,
    };
  });

  // POST /api/backup/create
  app.post('/api/backup/create', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'backup.manage', undefined, true);
    if (!guarded) return;

    if (!backups) {
      return reply.status(503).send({
        error: 'BackupUnavailable',
        message: 'Take backups from the main PC.',
        statusCode: 503,
      });
    }

    try {
      return await backups.create('manual');
    } catch (err: any) {
      return reply.status(400).send({
        error: 'BackupCreateError',
        message: err?.message || 'Backup could not be created.',
        statusCode: 400,
      });
    }
  });

  // GET /api/backup/download/:id
  app.get('/api/backup/download/:id', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'backup.manage');
    if (!guarded) return;

    if (!backups) {
      return reply.status(503).send({
        error: 'BackupUnavailable',
        message: 'Take backups from the main PC.',
        statusCode: 503,
      });
    }

    const params = request.params as { id?: string };
    const id = params?.id?.trim();
    const record = backups.status().records.find(item => item.id === id);
    if (!record) {
      return reply.status(404).send({
        error: 'BackupNotFound',
        message: 'Backup record is unavailable.',
        statusCode: 404,
      });
    }

    try {
      if ((await fileChecksum(record.path)) !== record.checksum) {
        return reply.status(409).send({
          error: 'BackupIntegrityError',
          message: 'Backup file changed after creation.',
          statusCode: 409,
        });
      }
      inspectBackup(record.path);
      const buffer = await readFile(record.path);
      reply.header('Content-Disposition', `attachment; filename="${record.fileName}"`);
      reply.header('Content-Type', 'application/octet-stream');
      return reply.send(buffer);
    } catch (err: any) {
      return reply.status(400).send({
        error: 'BackupExportError',
        message: err?.message || 'Failed to download backup.',
        statusCode: 400,
      });
    }
  });

  // POST /api/backup/preview & /api/backup/restore (Desktop host PC only)
  const mainPcOnly = async (request: any, reply: any) => {
    const guarded = enforceAuth(request, reply, auth, db, 'backup.manage', undefined, true);
    if (!guarded) return;
    return reply.status(501).send({
      error: 'DesktopOnly',
      message: 'Take backups from the main PC. Database restore must be performed directly on the main PC.',
      statusCode: 501,
    });
  };
  app.post('/api/backup/preview', mainPcOnly);
  app.post('/api/backup/restore', mainPcOnly);
}
