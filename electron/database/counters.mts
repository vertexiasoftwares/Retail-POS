import { createHash, randomBytes, randomInt, randomUUID } from 'node:crypto'
import type { DatabaseSync } from 'node:sqlite'
import { enqueueOutboxEvent } from '../sync/outbox.mjs'

export const MAX_COUNTERS_PER_SHOP = 20
const PAIRING_TTL_MS = 10 * 60 * 1000
const HEARTBEAT_THROTTLE_MS = 30_000

export interface CounterRecord {
  id: string
  businessId: string
  branchId: string
  counterNumber: number
  name: string
  deviceFingerprint: string | null
  status: 'pending' | 'active' | 'revoked'
  isPrimary: boolean
  appVersion: string | null
  lastIp: string | null
  lastSeenAt: string | null
  createdAt: string
  revokedAt: string | null
}

export interface PairingCodeResult {
  counterId: string
  counterNumber: number
  name: string
  pairingCode: string
  expiresAt: string
}

export interface CompletePairingResult {
  counter: CounterRecord
  deviceToken: string
}

type Row = Record<string, string | number | null>

function hashSecret(secret: string): string {
  return createHash('sha256').update(secret).digest('hex')
}

function mapCounter(row: Row): CounterRecord {
  return {
    id: String(row.id),
    businessId: String(row.business_id),
    branchId: String(row.branch_id),
    counterNumber: Number(row.counter_number),
    name: String(row.name),
    deviceFingerprint: row.device_fingerprint === null ? null : String(row.device_fingerprint),
    status: String(row.status) as CounterRecord['status'],
    isPrimary: Number(row.is_primary) === 1,
    appVersion: row.app_version === null ? null : String(row.app_version),
    lastIp: row.last_ip === null ? null : String(row.last_ip),
    lastSeenAt: row.last_seen_at === null ? null : String(row.last_seen_at),
    createdAt: String(row.created_at),
    revokedAt: row.revoked_at === null ? null : String(row.revoked_at),
  }
}

export class CounterRepository {
  private readonly lastHeartbeatWrite = new Map<string, number>()

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => Date = () => new Date(),
  ) {}

  ensurePrimaryCounter(businessId: string, branchId: string): CounterRecord {
    const existing = this.db
      .prepare('SELECT * FROM counters WHERE id=? OR (branch_id=? AND is_primary=1) LIMIT 1')
      .get('counter-1', branchId) as Row | undefined
    if (existing) return mapCounter(existing)

    const nowIso = this.now().toISOString()
    this.db
      .prepare(
        `INSERT OR IGNORE INTO counters (id, business_id, branch_id, counter_number, name, status, is_primary, last_seen_at, created_at)
         VALUES ('counter-1', ?, ?, 1, 'Counter 1 (Main PC)', 'active', 1, ?, ?)`,
      )
      .run(businessId, branchId, nowIso, nowIso)
    const row = this.db.prepare("SELECT * FROM counters WHERE id='counter-1'").get() as Row
    return mapCounter(row)
  }

  list(businessId: string): CounterRecord[] {
    const rows = this.db
      .prepare('SELECT * FROM counters WHERE business_id=? ORDER BY counter_number ASC, created_at ASC')
      .all(businessId) as Row[]
    return rows.map(mapCounter)
  }

  getById(counterId: string): CounterRecord | null {
    const row = this.db.prepare('SELECT * FROM counters WHERE id=?').get(counterId) as Row | undefined
    return row ? mapCounter(row) : null
  }

  createPairingCode(params: {
    businessId: string
    branchId: string
    createdBy: string
    name?: string
    counterNumber?: number
  }): PairingCodeResult {
    const now = this.now()
    const nowIso = now.toISOString()
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS).toISOString()

    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.ensurePrimaryCounter(params.businessId, params.branchId)

      const activeOrPending = this.db
        .prepare("SELECT counter_number FROM counters WHERE branch_id=? AND status IN ('pending','active')")
        .all(params.branchId) as Array<{ counter_number: number }>
      const takenNumbers = new Set(activeOrPending.map(r => Number(r.counter_number)))
      if (takenNumbers.size >= MAX_COUNTERS_PER_SHOP) {
        throw new Error(`Maximum ${MAX_COUNTERS_PER_SHOP} counters allowed per shop. Revoke an unused counter first.`)
      }

      let chosenNumber = params.counterNumber
      if (chosenNumber !== undefined) {
        if (!Number.isInteger(chosenNumber) || chosenNumber < 2 || chosenNumber > MAX_COUNTERS_PER_SHOP) {
          throw new Error(`Counter number must be between 2 and ${MAX_COUNTERS_PER_SHOP}.`)
        }
        if (takenNumbers.has(chosenNumber)) {
          throw new Error(`Counter ${chosenNumber} is already assigned.`)
        }
      } else {
        for (let n = 2; n <= MAX_COUNTERS_PER_SHOP; n++) {
          if (!takenNumbers.has(n)) {
            chosenNumber = n
            break
          }
        }
        if (!chosenNumber) {
          throw new Error(`Maximum ${MAX_COUNTERS_PER_SHOP} counters allowed per shop.`)
        }
      }

      // Free the slot if a previously revoked counter occupied this number
      const revokedSameSlot = this.db
        .prepare("SELECT id FROM counters WHERE branch_id=? AND counter_number=? AND status='revoked'")
        .get(params.branchId, chosenNumber) as { id: string } | undefined

      const counterName =
        params.name && params.name.trim() ? params.name.trim().slice(0, 60) : `Counter ${chosenNumber}`
      const counterId = revokedSameSlot ? revokedSameSlot.id : `counter-${randomUUID()}`

      if (revokedSameSlot) {
        this.db
          .prepare(
            "UPDATE counters SET name=?, status='pending', device_fingerprint=NULL, device_token_hash=NULL, revoked_at=NULL WHERE id=?",
          )
          .run(counterName, counterId)
      } else {
        this.db
          .prepare(
            `INSERT INTO counters (id, business_id, branch_id, counter_number, name, status, is_primary, created_at)
             VALUES (?, ?, ?, ?, ?, 'pending', 0, ?)`,
          )
          .run(counterId, params.businessId, params.branchId, chosenNumber, counterName, nowIso)
      }

      // Generate high-entropy 8-character pairing code (VTX-XXXX-XXXX formatted cleanly)
      const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
      const rawChars = Array.from({ length: 8 }, () => alphabet[randomInt(0, alphabet.length)]).join('')
      const pairingCode = `${rawChars.slice(0, 4)}-${rawChars.slice(4, 8)}`
      const codeHash = hashSecret(pairingCode.replace(/-/g, '').toUpperCase())

      this.db
        .prepare(
          `INSERT INTO counter_pairing_codes (id, business_id, branch_id, counter_id, code_hash, created_by, expires_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(`pair-${randomUUID()}`, params.businessId, params.branchId, counterId, codeHash, params.createdBy, expiresAt, nowIso)

      enqueueOutboxEvent(this.db, {
        entityType: 'counter',
        entityId: counterId,
        operation: 'upsert',
        counterId: 'counter-1',
        occurredAt: nowIso,
        payload: {
          id: counterId,
          businessId: params.businessId,
          branchId: params.branchId,
          counterNumber: chosenNumber,
          name: counterName,
          status: 'pending',
          isPrimary: false,
          createdAt: nowIso,
        },
      })

      this.db.exec('COMMIT')
      return {
        counterId,
        counterNumber: chosenNumber,
        name: counterName,
        pairingCode,
        expiresAt,
      }
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  completePairing(params: {
    pairingCode: string
    deviceFingerprint?: string
    appVersion?: string
    ipAddress?: string
  }): CompletePairingResult {
    const normalized = String(params.pairingCode || '').replace(/[\s-]/g, '').toUpperCase()
    if (normalized.length < 6) {
      throw new Error('Invalid pairing code.')
    }
    const codeHash = hashSecret(normalized)
    const nowIso = this.now().toISOString()
    const deviceToken = randomBytes(32).toString('hex')
    const deviceTokenHash = hashSecret(deviceToken)

    this.db.exec('BEGIN IMMEDIATE')
    try {
      const pairing = this.db
        .prepare('SELECT * FROM counter_pairing_codes WHERE code_hash=?')
        .get(codeHash) as Row | undefined
      if (!pairing) throw new Error('Pairing code not recognized.')
      if (pairing.used_at !== null) throw new Error('Pairing code was already used.')
      if (Date.parse(String(pairing.expires_at)) <= this.now().getTime()) {
        throw new Error('Pairing code has expired. Generate a new code on the Main PC.')
      }

      const counterId = String(pairing.counter_id)
      const counter = this.db.prepare('SELECT * FROM counters WHERE id=?').get(counterId) as Row | undefined
      if (!counter || String(counter.status) === 'revoked') {
        throw new Error('This counter registration was revoked.')
      }

      this.db
        .prepare('UPDATE counter_pairing_codes SET used_at=? WHERE id=?')
        .run(nowIso, String(pairing.id))

      this.db
        .prepare(
          `UPDATE counters
           SET status='active', device_fingerprint=?, device_token_hash=?, app_version=?, last_ip=?, last_seen_at=?, revoked_at=NULL
           WHERE id=?`,
        )
        .run(
          params.deviceFingerprint?.slice(0, 128) || null,
          deviceTokenHash,
          params.appVersion?.slice(0, 32) || null,
          params.ipAddress?.slice(0, 64) || null,
          nowIso,
          counterId,
        )

      const updated = mapCounter(this.db.prepare('SELECT * FROM counters WHERE id=?').get(counterId) as Row)

      enqueueOutboxEvent(this.db, {
        entityType: 'counter',
        entityId: updated.id,
        operation: 'upsert',
        counterId: updated.id,
        occurredAt: nowIso,
        payload: {
          id: updated.id,
          businessId: updated.businessId,
          branchId: updated.branchId,
          counterNumber: updated.counterNumber,
          name: updated.name,
          deviceFingerprint: updated.deviceFingerprint,
          status: updated.status,
          isPrimary: updated.isPrimary,
          appVersion: updated.appVersion,
          lastIp: updated.lastIp,
          lastSeenAt: updated.lastSeenAt,
          createdAt: updated.createdAt,
        },
      })

      this.db.exec('COMMIT')
      return { counter: updated, deviceToken }
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }

  authenticateDeviceToken(rawToken: string, ipAddress?: string): CounterRecord | null {
    if (!rawToken || typeof rawToken !== 'string') return null
    const tokenHash = hashSecret(rawToken)
    const row = this.db.prepare('SELECT * FROM counters WHERE device_token_hash=?').get(tokenHash) as Row | undefined
    if (!row) return null
    const counter = mapCounter(row)
    if (counter.status !== 'active') return null

    // Throttle SQLite heartbeat writes to at most once every 30s per counter
    const nowMs = this.now().getTime()
    const prevMs = this.lastHeartbeatWrite.get(counter.id) ?? 0
    if (nowMs - prevMs >= HEARTBEAT_THROTTLE_MS) {
      this.lastHeartbeatWrite.set(counter.id, nowMs)
      try {
        this.db
          .prepare('UPDATE counters SET last_seen_at=?, last_ip=COALESCE(?, last_ip) WHERE id=?')
          .run(new Date(nowMs).toISOString(), ipAddress?.slice(0, 64) || null, counter.id)
      } catch {
        // Non-fatal if DB is briefly locked on heartbeat
      }
    }
    return counter
  }

  recordHeartbeat(counterId: string, ipAddress?: string, appVersion?: string): CounterRecord | null {
    const existing = this.getById(counterId)
    if (!existing || existing.status !== 'active') return null
    const nowIso = this.now().toISOString()
    this.lastHeartbeatWrite.set(counterId, this.now().getTime())
    this.db
      .prepare('UPDATE counters SET last_seen_at=?, last_ip=COALESCE(?, last_ip), app_version=COALESCE(?, app_version) WHERE id=?')
      .run(nowIso, ipAddress?.slice(0, 64) || null, appVersion?.slice(0, 32) || null, counterId)
    return this.getById(counterId)
  }

  revokeCounter(counterId: string, actorUserId: string): CounterRecord {
    const target = this.getById(counterId)
    if (!target) throw new Error('Counter not found.')
    if (target.isPrimary || target.id === 'counter-1') {
      throw new Error('The primary Main PC counter cannot be revoked.')
    }
    const nowIso = this.now().toISOString()
    this.db.exec('BEGIN IMMEDIATE')
    try {
      this.db
        .prepare("UPDATE counters SET status='revoked', device_token_hash=NULL, revoked_at=? WHERE id=?")
        .run(nowIso, counterId)
      this.db
        .prepare('UPDATE auth_sessions SET revoked_at=? WHERE counter_id=? AND revoked_at IS NULL')
        .run(nowIso, counterId)
      this.db
        .prepare('INSERT INTO audit_events VALUES (?,?,?,?,?,?,?,?,?)')
        .run(`audit-${randomUUID()}`, target.branchId, actorUserId, 'Security', 'counter', counterId, 'Counter revoked', '', nowIso)

      const updated = this.getById(counterId)!
      enqueueOutboxEvent(this.db, {
        entityType: 'counter',
        entityId: updated.id,
        operation: 'revoke',
        counterId: 'counter-1',
        occurredAt: nowIso,
        payload: {
          id: updated.id,
          businessId: updated.businessId,
          branchId: updated.branchId,
          counterNumber: updated.counterNumber,
          name: updated.name,
          status: 'revoked',
          isPrimary: false,
          revokedAt: nowIso,
          createdAt: updated.createdAt,
        },
      })
      this.db.exec('COMMIT')
      return updated
    } catch (err) {
      this.db.exec('ROLLBACK')
      throw err
    }
  }
}
