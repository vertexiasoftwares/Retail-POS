import { createHmac } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import type { SyncController } from '../../server/routes/sync.mjs'
import type { RealtimeSyncServer } from '../../server/websocket.mjs'
import {
  ackOutboxEvents,
  appendSyncLog,
  claimPendingOutboxBatch,
  getShopUuid,
  getSyncEpoch,
  getSyncStateValue,
  markOutboxFailed,
  recoverInterruptedOutbox,
} from './outbox.mjs'
import { reconcileCloudEvents, type CloudPullEvent } from './reconciler.mjs'

export interface HybridSyncOptions {
  db: DatabaseSync
  cloudUrl?: string
  hmacSecret?: string
  nodeId?: string
  appVersion?: string
  intervalMs?: number
  realtime?: RealtimeSyncServer
  onUsersReconciled?: (userIds: string[]) => void
  fetchImpl?: typeof fetch
  now?: () => Date
}

export class HybridSyncEngine implements SyncController {
  private readonly db: DatabaseSync
  private readonly cloudUrl: string
  private readonly hmacSecret: string
  private readonly nodeId: string
  private readonly appVersion: string
  private readonly intervalMs: number
  private readonly realtime?: RealtimeSyncServer
  private readonly onUsersReconciled?: (userIds: string[]) => void
  private readonly fetchImpl: typeof fetch
  private readonly now: () => Date

  private timer: NodeJS.Timeout | null = null
  private inFlight: Promise<Record<string, unknown>> | null = null
  private registered = false
  private lastSuccessAt: string | null = null
  private lastError: string | null = null
  private running = false

  constructor(options: HybridSyncOptions) {
    this.db = options.db
    this.cloudUrl = (options.cloudUrl || process.env.VERTEXIA_CLOUD_URL || '').replace(/\/+$/, '')
    this.hmacSecret = options.hmacSecret || process.env.CLOUD_NODE_HMAC_SECRET || ''
    this.nodeId = options.nodeId || this.resolveNodeId()
    this.appVersion = options.appVersion || '1.0.0'
    this.intervalMs = Math.max(1_000, options.intervalMs ?? 5_000)
    this.realtime = options.realtime
    this.onUsersReconciled = options.onUsersReconciled
    this.fetchImpl = options.fetchImpl ?? fetch
    this.now = options.now ?? (() => new Date())
  }

  private resolveNodeId(): string {
    const row = this.db.prepare("SELECT value FROM app_meta WHERE key='installation_id'").get() as { value?: string } | undefined
    const shop = getShopUuid(this.db)
    return row?.value ? `node-${String(row.value)}` : `node-${shop}`
  }

  isConfigured(): boolean {
    return Boolean(this.cloudUrl && this.hmacSecret)
  }

  start(): void {
    if (this.running) return
    this.running = true
    recoverInterruptedOutbox(this.db, this.now().toISOString())
    if (!this.isConfigured()) return

    void this.triggerNow().catch(() => undefined)
    this.timer = setInterval(() => {
      void this.triggerNow().catch(() => undefined)
    }, this.intervalMs)
    this.timer.unref?.()
  }

  stop(): void {
    this.running = false
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  status(): Record<string, unknown> {
    return {
      enabled: this.isConfigured(),
      running: this.running,
      nodeId: this.nodeId,
      registered: this.registered,
      cloudUrl: this.cloudUrl ? 'configured' : 'unconfigured',
      lastSuccessAt: this.lastSuccessAt,
      lastError: this.lastError,
    }
  }

  private signHeaders(shopUuid: string, rawBody: string): Record<string, string> {
    const timestamp = String(Date.now())
    const signature = createHmac('sha256', this.hmacSecret)
      .update(`${shopUuid}|${timestamp}|${rawBody}`)
      .digest('hex')
    return {
      'content-type': 'application/json',
      'x-vertexia-shop-uuid': shopUuid,
      'x-vertexia-node-id': this.nodeId,
      'x-vertexia-timestamp': timestamp,
      'x-vertexia-signature': signature,
    }
  }

  private async ensureRegistered(): Promise<void> {
    if (this.registered) return
    const shopUuid = getShopUuid(this.db)
    const biz = this.db.prepare('SELECT id, name FROM businesses ORDER BY created_at LIMIT 1').get() as { id: string; name: string }
    const branch = this.db.prepare('SELECT id, name, city FROM branches WHERE business_id=? AND is_active=1 ORDER BY created_at LIMIT 1').get(biz.id) as {
      id: string
      name: string
      city: string
    }
    const rawBody = JSON.stringify({
      businessId: biz.id,
      businessName: biz.name,
      branchId: branch?.id || 'branch-main',
      branchName: branch?.name || biz.name,
      city: branch?.city || 'Main City',
      appVersion: this.appVersion,
      syncEpoch: getSyncEpoch(this.db),
    })
    const res = await this.fetchImpl(`${this.cloudUrl}/api/cloud/sync/register-node`, {
      method: 'POST',
      headers: this.signHeaders(shopUuid, rawBody),
      body: rawBody,
    })
    if (!res.ok) {
      throw new Error(`Node registration failed with HTTP ${res.status}`)
    }
    this.registered = true
    await this.syncCredentials()
  }

  async syncCredentials(): Promise<void> {
    if (!this.isConfigured()) return
    const shopUuid = getShopUuid(this.db)
    const rows = this.db
      .prepare(
        `SELECT u.id AS user_id, u.name, u.role, u.is_active, c.username, c.password_hash, c.credential_version, c.must_change_password,
                COALESCE((SELECT ub.branch_id FROM user_branches ub WHERE ub.user_id = u.id LIMIT 1), 'branch-main') AS branch_id
         FROM users u
         JOIN user_credentials c ON c.user_id = u.id`,
      )
      .all() as Array<Record<string, unknown>>
    if (!rows.length) return

    const rawBody = JSON.stringify({
      users: rows.map(r => ({
        userId: String(r.user_id),
        branchId: String(r.branch_id),
        username: String(r.username),
        name: String(r.name),
        role: String(r.role),
        passwordHash: String(r.password_hash),
        credentialVersion: Number(r.credential_version),
        isActive: Number(r.is_active) === 1,
        mustChangePassword: Number(r.must_change_password) === 1,
      })),
    })
    const res = await this.fetchImpl(`${this.cloudUrl}/api/cloud/sync/credentials`, {
      method: 'POST',
      headers: this.signHeaders(shopUuid, rawBody),
      body: rawBody,
    })
    if (!res.ok) {
      throw new Error(`Credential sync failed with HTTP ${res.status}`)
    }
  }

  async triggerNow(): Promise<Record<string, unknown>> {
    if (!this.isConfigured()) {
      return { synced: false, reason: 'Cloud sync is not configured.' }
    }
    if (this.inFlight) return this.inFlight
    this.inFlight = this.runCycle()
    try {
      return await this.inFlight
    } finally {
      this.inFlight = null
    }
  }

  private async runCycle(): Promise<Record<string, unknown>> {
    const now = this.now()
    const nowIso = now.toISOString()
    const shopUuid = getShopUuid(this.db)
    let pushedCount = 0
    let pulledCount = 0
    let conflictsCount = 0

    try {
      await this.ensureRegistered()

      // 1. Push local outbox batches FIFO
      while (true) {
        const batch = claimPendingOutboxBatch(this.db, 50, nowIso)
        if (!batch.length) break
        const eventIds = batch.map(b => b.eventId)
        try {
          const rawBody = JSON.stringify({ events: batch })
          const res = await this.fetchImpl(`${this.cloudUrl}/api/cloud/sync/push`, {
            method: 'POST',
            headers: this.signHeaders(shopUuid, rawBody),
            body: rawBody,
          })
          if (!res.ok) {
            const errText = await res.text().catch(() => '')
            markOutboxFailed(this.db, eventIds, `HTTP ${res.status}: ${errText}`, now.getTime(), res.status === 400 || res.status === 403)
            throw new Error(`Cloud push HTTP ${res.status}`)
          }
          const json = (await res.json()) as { ackedEventIds?: string[] }
          const acked = Array.isArray(json.ackedEventIds) ? json.ackedEventIds : eventIds
          ackOutboxEvents(this.db, acked, nowIso)
          pushedCount += acked.length
          const unacked = eventIds.filter(id => !acked.includes(id))
          if (unacked.length) {
            markOutboxFailed(this.db, unacked, 'Unacknowledged by cloud push response', now.getTime())
          }
          if (batch.some(b => b.entityType === 'user')) {
            await this.syncCredentials()
          }
        } catch (err: any) {
          markOutboxFailed(this.db, eventIds, err?.message || 'Push transport error', now.getTime())
          throw err
        }
      }

      if (pushedCount > 0) {
        appendSyncLog(this.db, 'push', 'ok', pushedCount, `Pushed ${pushedCount} local event(s)`, nowIso)
      }

      // 2. Pull incremental remote owner events from cloud
      while (true) {
        const lastPulled = Number(getSyncStateValue(this.db, 'last_pulled_seq', '0'))
        const res = await this.fetchImpl(
          `${this.cloudUrl}/api/cloud/sync/pull?sinceCloudSeq=${lastPulled}&limit=100`,
          {
            method: 'GET',
            headers: this.signHeaders(shopUuid, ''),
          },
        )
        if (!res.ok) {
          throw new Error(`Cloud pull HTTP ${res.status}`)
        }
        const json = (await res.json()) as { events?: CloudPullEvent[] }
        const events = Array.isArray(json.events) ? json.events : []
        if (!events.length) break

        const reconciled = reconcileCloudEvents(this.db, events, nowIso)
        pulledCount += reconciled.appliedCount
        conflictsCount += reconciled.conflictsCount

        if (reconciled.updatedUserIds.length) {
          this.onUsersReconciled?.(reconciled.updatedUserIds)
        }

        if (reconciled.updatedProductIds.length && this.realtime) {
          const biz = this.db.prepare('SELECT id FROM businesses LIMIT 1').get() as { id: string }
          const branch = this.db.prepare('SELECT id FROM branches WHERE is_active=1 LIMIT 1').get() as { id: string }
          this.realtime.broadcast({
            type: 'inventory:changed',
            businessId: biz.id,
            branchId: branch.id,
            payload: { source: 'cloud_owner', productIds: reconciled.updatedProductIds },
          })
        }
        if (events.length < 100) break
      }

      this.lastSuccessAt = nowIso
      this.lastError = null
      return { synced: true, pushedCount, pulledCount, conflictsCount }
    } catch (err: any) {
      const msg = err?.message || 'Cloud sync cycle failed'
      this.lastError = msg
      appendSyncLog(this.db, 'system', 'error', 0, msg, nowIso)
      return { synced: false, error: msg, pushedCount, pulledCount }
    }
  }
}
