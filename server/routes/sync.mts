import type { FastifyInstance } from 'fastify'
import type { VertexiaDatabase } from '../../electron/database/database.mjs'
import type { AuthRepository } from '../../electron/database/auth.mjs'
import { listOutboxSummary, retryFailedOutboxEvents } from '../../electron/sync/outbox.mjs'
import { enforceAuth } from '../auth-guard.mjs'

export interface SyncController {
  status: () => Record<string, unknown>
  triggerNow: () => Promise<Record<string, unknown>>
}

export function registerSyncRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  syncController?: SyncController,
): void {
  // GET /api/sync/status
  app.get('/api/sync/status', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db)
    if (!guarded) return
    const outbox = listOutboxSummary(db.connection)
    return {
      shopUuid: db.shopUuid,
      ...outbox,
      engine: syncController ? syncController.status() : { enabled: false, mode: 'local_only' },
    }
  })

  // GET /api/sync/conflicts
  app.get('/api/sync/conflicts', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'settings.manage')
    if (!guarded) return
    const conflicts = db.connection
      .prepare('SELECT * FROM sync_conflicts ORDER BY resolved_at DESC LIMIT 100')
      .all()
    const logs = db.connection
      .prepare('SELECT * FROM sync_logs ORDER BY created_at DESC LIMIT 100')
      .all()
    return { conflicts, logs }
  })

  // POST /api/sync/trigger
  app.post('/api/sync/trigger', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'settings.manage', undefined, true)
    if (!guarded) return
    if (!syncController) {
      return { ok: true, triggered: false, reason: 'Cloud sync engine not attached to this server instance.' }
    }
    const result = await syncController.triggerNow()
    return { ok: true, triggered: true, result }
  })

  // POST /api/sync/retry-failed
  app.post('/api/sync/retry-failed', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'settings.manage', undefined, true)
    if (!guarded) return
    const retried = retryFailedOutboxEvents(db.connection, new Date().toISOString())
    const triggered = syncController ? await syncController.triggerNow() : null
    return { ok: true, retriedCount: retried, triggered }
  })
}
