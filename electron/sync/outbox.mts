import { createHash, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'

export type SyncEntityType =
  | 'sale'
  | 'sale_return'
  | 'manual_return'
  | 'stock_movement'
  | 'product'
  | 'customer'
  | 'customer_receipt'
  | 'supplier'
  | 'supplier_payment'
  | 'purchase'
  | 'expense'
  | 'cash_shift'
  | 'cash_movement'
  | 'counter'
  | 'user'
  | 'business_profile'

export type SyncOutboxStatus = 'pending' | 'in_flight' | 'acked' | 'failed_permanent'

export interface SyncOutboxRow {
  seq: number
  eventId: string
  entityType: string
  entityId: string
  operation: string
  counterId: string
  syncEpoch: number
  payload: Record<string, unknown>
  payloadHash: string
  status: SyncOutboxStatus
  attempts: number
  nextAttemptAt: string
  lastError: string | null
  createdAt: string
  ackedAt: string | null
}

function stableSort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableSort)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, stableSort(v)]),
    )
  }
  return value
}

export function canonicalPayload(payload: unknown): string {
  return JSON.stringify(stableSort(payload))
}

export function hashSyncPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalPayload(payload)).digest('hex')
}

export function getShopUuid(db: DatabaseSync): string {
  const row = db.prepare("SELECT value FROM app_meta WHERE key='shop_uuid'").get() as { value?: string } | undefined
  if (row?.value) return String(row.value)
  const generated = randomUUID()
  db.prepare("INSERT INTO app_meta(key, value) VALUES ('shop_uuid', ?) ON CONFLICT(key) DO NOTHING").run(generated)
  const confirmed = db.prepare("SELECT value FROM app_meta WHERE key='shop_uuid'").get() as { value: string }
  return String(confirmed.value)
}

export function getSyncEpoch(db: DatabaseSync): number {
  const row = db.prepare("SELECT value FROM sync_state WHERE key='sync_epoch'").get() as { value?: string } | undefined
  const parsed = Number(row?.value ?? '1')
  return Number.isSafeInteger(parsed) && parsed >= 1 ? parsed : 1
}

export function incrementSyncEpoch(db: DatabaseSync, nowIso: string): number {
  const next = getSyncEpoch(db) + 1
  db.prepare(
    "INSERT INTO sync_state(key, value, updated_at) VALUES ('sync_epoch', ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at",
  ).run(String(next), nowIso)
  return next
}

export function getSyncStateValue(db: DatabaseSync, key: string, fallback = ''): string {
  const row = db.prepare('SELECT value FROM sync_state WHERE key=?').get(key) as { value?: string } | undefined
  return row?.value !== undefined ? String(row.value) : fallback
}

export function setSyncStateValue(db: DatabaseSync, key: string, value: string, nowIso: string): void {
  db.prepare(
    'INSERT INTO sync_state(key, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_at=excluded.updated_at',
  ).run(key, value, nowIso)
}

/**
 * Enqueues a sync event INSIDE the caller's active SQLite transaction (`BEGIN IMMEDIATE`).
 * Never commits or rolls back on its own so local durability is strictly atomic.
 */
export function enqueueOutboxEvent(
  db: DatabaseSync,
  params: {
    entityType: SyncEntityType
    entityId: string
    operation: string
    counterId?: string | null
    payload: Record<string, unknown>
    occurredAt: string
    eventId?: string
  },
): string {
  const eventId = params.eventId || `evt-${randomUUID()}`
  const counterId = params.counterId && params.counterId.trim() ? params.counterId.trim() : 'counter-1'
  const epoch = getSyncEpoch(db)
  const payloadJson = canonicalPayload(params.payload)
  const payloadHash = createHash('sha256').update(payloadJson).digest('hex')
  db.prepare(
    `INSERT INTO sync_outbox (
      event_id, entity_type, entity_id, operation, counter_id, sync_epoch,
      payload_json, payload_hash, status, attempts, next_attempt_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)`,
  ).run(
    eventId,
    params.entityType,
    params.entityId,
    params.operation,
    counterId,
    epoch,
    payloadJson,
    payloadHash,
    params.occurredAt,
    params.occurredAt,
  )
  return eventId
}

export function recoverInterruptedOutbox(db: DatabaseSync, nowIso: string): number {
  const res = db
    .prepare("UPDATE sync_outbox SET status='pending', next_attempt_at=? WHERE status='in_flight'")
    .run(nowIso)
  return Number(res.changes ?? 0)
}

export function claimPendingOutboxBatch(db: DatabaseSync, limit: number, nowIso: string): SyncOutboxRow[] {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)))
  db.exec('BEGIN IMMEDIATE')
  try {
    const rows = db
      .prepare(
        `SELECT seq, event_id, entity_type, entity_id, operation, counter_id, sync_epoch,
                payload_json, payload_hash, status, attempts, next_attempt_at, last_error, created_at, acked_at
         FROM sync_outbox
         WHERE status='pending' AND next_attempt_at <= ?
         ORDER BY seq ASC
         LIMIT ?`,
      )
      .all(nowIso, safeLimit) as Array<Record<string, unknown>>

    if (rows.length > 0) {
      const seqs = rows.map(r => Number(r.seq))
      const marks = seqs.map(() => '?').join(',')
      db.prepare(`UPDATE sync_outbox SET status='in_flight' WHERE seq IN (${marks})`).run(...seqs)
    }
    db.exec('COMMIT')

    return rows.map(r => ({
      seq: Number(r.seq),
      eventId: String(r.event_id),
      entityType: String(r.entity_type),
      entityId: String(r.entity_id),
      operation: String(r.operation),
      counterId: String(r.counter_id),
      syncEpoch: Number(r.sync_epoch),
      payload: JSON.parse(String(r.payload_json)) as Record<string, unknown>,
      payloadHash: String(r.payload_hash),
      status: 'in_flight',
      attempts: Number(r.attempts),
      nextAttemptAt: String(r.next_attempt_at),
      lastError: r.last_error === null ? null : String(r.last_error),
      createdAt: String(r.created_at),
      ackedAt: r.acked_at === null ? null : String(r.acked_at),
    }))
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function ackOutboxEvents(db: DatabaseSync, eventIds: string[], nowIso: string): number {
  if (!eventIds.length) return 0
  const marks = eventIds.map(() => '?').join(',')
  let maxSeq = 0
  db.exec('BEGIN IMMEDIATE')
  try {
    const res = db
      .prepare(`UPDATE sync_outbox SET status='acked', acked_at=?, last_error=NULL WHERE event_id IN (${marks})`)
      .run(nowIso, ...eventIds)
    const row = db.prepare(`SELECT COALESCE(MAX(seq), 0) AS max_seq FROM sync_outbox WHERE status='acked'`).get() as {
      max_seq?: number
    }
    maxSeq = Number(row?.max_seq ?? 0)
    if (maxSeq > 0) {
      setSyncStateValue(db, 'last_pushed_seq', String(maxSeq), nowIso)
    }
    db.exec('COMMIT')
    return Number(res.changes ?? 0)
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

const BACKOFF_MS = [2_000, 5_000, 15_000, 30_000, 60_000, 120_000, 300_000]
const MAX_RETRY_ATTEMPTS = 25

export function markOutboxFailed(
  db: DatabaseSync,
  eventIds: string[],
  errorMessage: string,
  nowMs: number,
  permanent = false,
): void {
  if (!eventIds.length) return
  const nowIso = new Date(nowMs).toISOString()
  db.exec('BEGIN IMMEDIATE')
  try {
    const select = db.prepare('SELECT seq, attempts FROM sync_outbox WHERE event_id=?')
    const update = db.prepare('UPDATE sync_outbox SET status=?, attempts=?, next_attempt_at=?, last_error=? WHERE seq=?')
    for (const eventId of eventIds) {
      const row = select.get(eventId) as { seq: number; attempts: number } | undefined
      if (!row) continue
      const nextAttempts = Number(row.attempts) + 1
      const isPermanent = permanent || nextAttempts >= MAX_RETRY_ATTEMPTS
      const delayMs = BACKOFF_MS[Math.min(nextAttempts - 1, BACKOFF_MS.length - 1)]
      const nextAt = new Date(nowMs + delayMs).toISOString()
      update.run(
        isPermanent ? 'failed_permanent' : 'pending',
        nextAttempts,
        nextAt,
        errorMessage.slice(0, 500),
        Number(row.seq),
      )
    }
    db.exec('COMMIT')
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

export function retryFailedOutboxEvents(db: DatabaseSync, nowIso: string): number {
  const res = db
    .prepare("UPDATE sync_outbox SET status='pending', attempts=0, next_attempt_at=? WHERE status='failed_permanent'")
    .run(nowIso)
  return Number(res.changes ?? 0)
}

export function listOutboxSummary(db: DatabaseSync): {
  pendingCount: number
  inFlightCount: number
  ackedCount: number
  failedPermanentCount: number
  conflictCount: number
  lastPushedSeq: number
  lastPulledSeq: number
  syncEpoch: number
} {
  const counts = db
    .prepare(
      `SELECT
        SUM(CASE WHEN status='pending' THEN 1 ELSE 0 END) AS pending_count,
        SUM(CASE WHEN status='in_flight' THEN 1 ELSE 0 END) AS in_flight_count,
        SUM(CASE WHEN status='acked' THEN 1 ELSE 0 END) AS acked_count,
        SUM(CASE WHEN status='failed_permanent' THEN 1 ELSE 0 END) AS failed_count
       FROM sync_outbox`,
    )
    .get() as Record<string, number | null>
  const conflicts = db.prepare('SELECT COUNT(*) AS cnt FROM sync_conflicts').get() as { cnt: number }
  return {
    pendingCount: Number(counts.pending_count ?? 0),
    inFlightCount: Number(counts.in_flight_count ?? 0),
    ackedCount: Number(counts.acked_count ?? 0),
    failedPermanentCount: Number(counts.failed_count ?? 0),
    conflictCount: Number(conflicts.cnt ?? 0),
    lastPushedSeq: Number(getSyncStateValue(db, 'last_pushed_seq', '0')),
    lastPulledSeq: Number(getSyncStateValue(db, 'last_pulled_seq', '0')),
    syncEpoch: getSyncEpoch(db),
  }
}

export function appendSyncLog(
  db: DatabaseSync,
  direction: 'push' | 'pull' | 'reconcile' | 'system',
  status: 'ok' | 'error' | 'conflict',
  eventsCount: number,
  detail: string,
  nowIso: string,
): void {
  db.prepare(
    'INSERT INTO sync_logs (id, direction, status, events_count, detail, created_at) VALUES (?, ?, ?, ?, ?, ?)',
  ).run(`slog-${randomUUID()}`, direction, status, eventsCount, detail.slice(0, 500), nowIso)
}
