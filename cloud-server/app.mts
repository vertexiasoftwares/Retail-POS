import fastify, { type FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import { loadCloudEnv, type CloudEnvConfig } from './config/env.mjs'
import { createCentralPool, runCentralMigrations } from './db/central-pool.mjs'
import { TenantDatabaseManager } from './db/tenant-manager.mjs'
import { CloudRealtimeBroker } from './realtime.mjs'
import { registerCloudAuthRoutes } from './routes/auth.mjs'
import { registerCloudSyncRoutes } from './routes/sync.mjs'
import { registerRemoteOwnerRoutes } from './routes/remote-owner.mjs'
import { registerCloudBackupRoutes } from './routes/backup.mjs'

export interface CloudAppOptions {
  config?: CloudEnvConfig
  centralPool?: Pool
  runMigrations?: boolean
  logger?: boolean
}

export interface CloudAppInstance {
  app: FastifyInstance
  config: CloudEnvConfig
  centralPool: Pool
  tenantManager: TenantDatabaseManager
  realtime: CloudRealtimeBroker
  start: () => Promise<string>
  stop: () => Promise<void>
}

export async function createCloudServer(options: CloudAppOptions = {}): Promise<CloudAppInstance> {
  const config = options.config ?? loadCloudEnv()
  const ownsPool = !options.centralPool
  const centralPool = options.centralPool ?? createCentralPool(config)

  if (options.runMigrations !== false) {
    await runCentralMigrations(centralPool)
  }

  const tenantManager = new TenantDatabaseManager(config, centralPool)
  const realtime = new CloudRealtimeBroker(centralPool)

  const app = fastify({
    logger: options.logger ?? config.nodeEnv !== 'test',
  })

  // Preserve exact raw JSON body string for HMAC-SHA256 verification on node sync routes
  app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
    const str = typeof body === 'string' ? body : ''
    ;(req as any).rawBody = str
    try {
      const json = str.trim() ? JSON.parse(str) : {}
      done(null, json)
    } catch (err: any) {
      done(err, undefined)
    }
  })

  app.setErrorHandler((err: unknown, request, reply) => {
    const error = err as { name?: string; message?: string; statusCode?: number }
    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600 ? error.statusCode : 500
    app.log.error({ err, url: request.url }, 'Cloud API error')
    reply.status(statusCode).send({
      error: error.name || 'CloudError',
      message: error.message || 'Cloud server error.',
      statusCode,
    })
  })

  app.get('/api/cloud/health', async () => {
    await centralPool.query('SELECT 1')
    return {
      status: 'ok',
      service: 'vertexia-cloud-gateway',
      timestamp: new Date().toISOString(),
    }
  })

  app.server.on('upgrade', (req, socket) => {
    void realtime.handleUpgrade(req, socket as any)
  })

  registerCloudAuthRoutes(app, centralPool)
  registerCloudSyncRoutes(app, config, centralPool, tenantManager, realtime)
  registerRemoteOwnerRoutes(app, centralPool, tenantManager, realtime)
  registerCloudBackupRoutes(app, config, centralPool, tenantManager)

  let running = false
  const start = async (): Promise<string> => {
    if (running) {
      const addr = app.server.address()
      const p = typeof addr === 'object' && addr ? addr.port : config.port
      return `http://${config.host}:${p}`
    }
    await app.listen({ host: config.host, port: config.port })
    running = true
    const addr = app.server.address()
    const p = typeof addr === 'object' && addr ? addr.port : config.port
    return `http://${config.host}:${p}`
  }

  const stop = async (): Promise<void> => {
    running = false
    realtime.closeAll()
    await app.close().catch(() => undefined)
    await tenantManager.closeAll()
    if (ownsPool) {
      await centralPool.end().catch(() => undefined)
    }
  }

  return {
    app,
    config,
    centralPool,
    tenantManager,
    realtime,
    start,
    stop,
  }
}
