import { createHash } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { FastifyInstance } from 'fastify'
import type { Pool } from 'pg'
import type { CloudEnvConfig } from '../config/env.mjs'
import type { TenantDatabaseManager } from '../db/tenant-manager.mjs'
import { enforceCloudOwner } from './auth.mjs'

const BACKUP_TABLES = [
  'branches',
  'users',
  'counters',
  'products',
  'stock_levels',
  'stock_movements',
  'customers',
  'suppliers',
  'sales',
  'sale_items',
  'sale_payments',
  'sale_returns',
  'manual_returns',
  'purchases',
  'customer_receipts',
  'supplier_payments',
  'customer_ledger',
  'supplier_ledger',
  'expenses',
  'cash_shifts',
  'cash_movements',
  'sync_conflicts',
] as const

export function registerCloudBackupRoutes(
  app: FastifyInstance,
  config: CloudEnvConfig,
  centralPool: Pool,
  tenantManager: TenantDatabaseManager,
): void {
  // POST /api/cloud/owner/backups/create
  app.post('/api/cloud/owner/backups/create', async (request, reply) => {
    const body = (request.body as { shopUuid?: string }) || {}
    const session = await enforceCloudOwner(request, reply, centralPool, 'backup.manage', body.shopUuid)
    if (!session) return

    const snapshot: Record<string, unknown> = {
      format: 'vertexia-cloud-tenant-backup-v1',
      shopUuid: session.shopUuid,
      createdAt: new Date().toISOString(),
      tables: {} as Record<string, unknown[]>,
    }

    await tenantManager.withTenantTransaction(session.shopUuid, async client => {
      for (const table of BACKUP_TABLES) {
        const { rows } = await client.query(`SELECT * FROM ${table}`)
        ;(snapshot.tables as Record<string, unknown[]>)[table] = rows
      }
    })

    const serialized = JSON.stringify(snapshot)
    const checksum = createHash('sha256').update(serialized).digest('hex')
    const shopDir = join(config.backupDir, session.shopUuid)
    mkdirSync(shopDir, { recursive: true })
    const fileName = `cloud-backup-${session.shopUuid}-${Date.now()}.json`
    const filePath = join(shopDir, fileName)
    writeFileSync(filePath, serialized, 'utf8')
    writeFileSync(`${filePath}.sha256`, checksum, 'utf8')

    return {
      ok: true,
      fileName,
      checksum,
      sizeBytes: Buffer.byteLength(serialized, 'utf8'),
      createdAt: snapshot.createdAt,
    }
  })

  // GET /api/cloud/owner/backups
  app.get('/api/cloud/owner/backups', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'backup.manage', q.shopUuid)
    if (!session) return

    const shopDir = join(config.backupDir, session.shopUuid)
    try {
      const files = readdirSync(shopDir).filter(f => f.endsWith('.json'))
      return {
        records: files.map(fileName => {
          const full = join(shopDir, fileName)
          const st = statSync(full)
          let checksum = ''
          try {
            checksum = readFileSync(`${full}.sha256`, 'utf8').trim()
          } catch {}
          return {
            fileName,
            sizeBytes: st.size,
            checksum,
            createdAt: st.mtime.toISOString(),
          }
        }),
      }
    } catch {
      return { records: [] }
    }
  })

  // GET /api/cloud/owner/backups/:file/verify
  app.get('/api/cloud/owner/backups/:file/verify', async (request, reply) => {
    const params = request.params as { file: string }
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, centralPool, 'backup.manage', q.shopUuid)
    if (!session) return

    if (!/^[a-zA-Z0-9._-]+\.json$/.test(params.file)) {
      return reply.status(400).send({ error: 'InvalidFilename', message: 'Invalid backup filename.', statusCode: 400 })
    }
    const full = join(config.backupDir, session.shopUuid, params.file)
    try {
      const raw = readFileSync(full, 'utf8')
      const actual = createHash('sha256').update(raw).digest('hex')
      const expected = readFileSync(`${full}.sha256`, 'utf8').trim()
      const parsed = JSON.parse(raw) as { shopUuid?: string; format?: string }
      const valid = actual === expected && parsed.shopUuid === session.shopUuid && parsed.format === 'vertexia-cloud-tenant-backup-v1'
      return { valid, checksum: actual, expectedChecksum: expected }
    } catch (err: any) {
      return reply.status(404).send({ error: 'BackupNotFound', message: err?.message || 'Backup file missing.', statusCode: 404 })
    }
  })
}
