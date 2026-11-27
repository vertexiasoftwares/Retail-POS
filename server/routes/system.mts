import type { FastifyInstance } from 'fastify';
import os from 'node:os';
import { readFile } from 'node:fs/promises';
import type { VertexiaDatabase } from '../../electron/database/database.mjs';
import type { AuthRepository } from '../../electron/database/auth.mjs';
import { BackupService, fileChecksum, inspectBackup } from '../../electron/backup.mjs';
import type { LicenseClient } from '../../electron/licensing/client.mjs';
import type { CloudLicenseClient } from '../../electron/licensing/cloudClient.mjs';
import type { RealtimeSyncServer } from '../websocket.mjs';
import { enforceAuth } from '../auth-guard.mjs';

export function registerSystemRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  _sync?: RealtimeSyncServer,
  backups?: BackupService,
  licenseClient?: LicenseClient,
  cloudLicenseClient?: CloudLicenseClient
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

    const port = Number(process.env.PORT) || 8080;
    const nets = os.networkInterfaces();
    const candidates: string[] = [];
    for (const iface of Object.values(nets)) {
      if (!iface) continue;
      for (const addr of iface) {
        if (addr.family === 'IPv4' && !addr.internal && addr.address) {
          candidates.push(addr.address);
        }
      }
    }
    const lanIp =
      candidates.find(ip => ip.startsWith('192.168.') || ip.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) ||
      candidates[0] ||
      '127.0.0.1';

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
      lanUrl: `http://${lanIp}:${port}`,
      lanPort: port,
    };
  });

  const getLicensePayload = () => {
    if (cloudLicenseClient) {
      const cloud = cloudLicenseClient.inspect();
      return {
        status: cloud.status,
        accessAllowed: cloud.accessAllowed,
        valid: cloud.accessAllowed,
        licensed: cloud.accessAllowed,
        businessId: cloud.businessId,
        businessName: cloud.registration?.businessName || 'Vertexia Retail POS',
        plan: 'Hybrid Multi-Counter',
        deviceId: cloud.deviceId,
        message: cloud.message,
        license_id: cloud.license_id || null,
        license_type: cloud.license_type,
        expires_at: cloud.expires_at ?? null,
        offline_until: cloud.offline_until ?? null,
        last_verified_at: cloud.last_verified_at ?? null,
        contact: cloud.contact,
        registration: cloud.registration ?? null,
      };
    }
    if (licenseClient) {
      const status = licenseClient.status();
      return {
        status: status.state === 'active' ? ('ACTIVE' as const) : (status.state.toUpperCase() as any),
        accessAllowed: status.canTransact,
        valid: status.canTransact,
        licensed: status.canTransact,
        businessName: status.customerName || 'Vertexia Retail POS',
        plan: 'Hybrid Multi-Counter',
        deviceId: status.deviceId || 'server-local',
        message: status.message,
        license_id: status.licenseId || null,
        license_type: 'PERMANENT' as const,
      };
    }
    return {
      status: 'ACTIVE' as const,
      accessAllowed: true,
      valid: true,
      licensed: true,
      businessName: 'Vertexia Retail POS',
      plan: 'Standalone Dev Server',
      deviceId: 'server-local',
      message: 'Standalone development API server active.',
      license_id: 'VTX-RETAIL-DEV',
      license_type: 'PERMANENT' as const,
    };
  };

  // GET /api/licensing/status & /api/cloud-license/status
  app.get('/api/licensing/status', async (_request, _reply) => {
    if (licenseClient) {
      return licenseClient.status();
    }
    return getLicensePayload();
  });
  app.get('/api/cloud-license/status', async (_request, _reply) => {
    return getLicensePayload();
  });

  // POST /api/licensing/register & /api/cloud-license/register (Public store onboarding)
  const handleRegister = async (request: any, reply: any) => {
    const body = request.body as any;
    if (cloudLicenseClient) {
      try {
        return await cloudLicenseClient.register(body);
      } catch (err: any) {
        return reply.status(err?.status || 400).send({
          error: err?.code || 'RegistrationError',
          code: err?.code,
          message: err?.message || 'Store registration failed.',
          statusCode: err?.status || 400,
        });
      }
    }
    return {
      status: 'ACTIVATION_REQUIRED',
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
  const handleActivate = async (request: any, reply: any) => {
    const body = request.body as any;
    const key = String(body?.key || '').trim();
    if (cloudLicenseClient) {
      try {
        const result = await cloudLicenseClient.activate(key, body?.businessId);
        return result;
      } catch (err: any) {
        return reply.status(err?.status || 400).send({
          error: err?.code || 'ActivationError',
          code: err?.code,
          message: err?.message || 'License activation failed.',
          statusCode: err?.status || 400,
        });
      }
    }
    if (licenseClient) {
      try {
        await licenseClient.activate(key);
        return licenseClient.status();
      } catch (err: any) {
        return reply.status(err?.status || 400).send({
          error: err?.code || 'ActivationError',
          code: err?.code,
          message: err?.message || 'License activation failed.',
          statusCode: err?.status || 400,
        });
      }
    }
    return {
      ...getLicensePayload(),
      license_id: key || 'VTX-RETAIL-DEV',
      message: 'License activated successfully.',
    };
  };
  app.post('/api/licensing/activate', handleActivate);
  app.post('/api/cloud-license/activate', handleActivate);

  // POST /api/licensing/refresh & /api/cloud-license/refresh
  const handleRefresh = async (_request: any, reply: any) => {
    if (cloudLicenseClient) {
      try {
        return await cloudLicenseClient.refresh();
      } catch (err: any) {
        return reply.status(err?.status || 503).send({
          error: err?.code || 'RefreshError',
          code: err?.code,
          message: err?.message || 'License verification failed.',
          statusCode: err?.status || 503,
        });
      }
    }
    if (licenseClient) {
      try {
        await licenseClient.refresh();
        return licenseClient.status();
      } catch (err: any) {
        return reply.status(err?.status || 503).send({
          error: err?.code || 'RefreshError',
          code: err?.code,
          message: err?.message || 'License verification failed.',
          statusCode: err?.status || 503,
        });
      }
    }
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
