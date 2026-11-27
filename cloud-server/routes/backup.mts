import { createHash } from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { CLOUD_COLLECTIONS, type MongoCloudStore } from '../db/mongo-store.mjs'
import { enforceCloudOwner } from './auth.mjs'

const BACKUP_FILE_RE = /^[a-zA-Z0-9._-]+\.json$/

const BACKUP_COLLECTION_KEYS = [
  'branches',
  'cloudUsers',
  'counters',
  'products',
  'stockLevels',
  'stockMovements',
  'customers',
  'suppliers',
  'sales',
  'saleReturns',
  'manualReturns',
  'purchases',
  'customerReceipts',
  'supplierPayments',
  'customerLedger',
  'supplierLedger',
  'expenses',
  'cashShifts',
  'cashMovements',
  'syncConflicts',
  'entityTombstones',
] as const

export function registerCloudBackupRoutes(app: FastifyInstance, store: MongoCloudStore): void {
  // POST /api/cloud/owner/backups/create
  app.post('/api/cloud/owner/backups/create', async (request, reply) => {
    const body = (request.body as { shopUuid?: string }) || {}
    const session = await enforceCloudOwner(request, reply, store, 'backup.manage', body.shopUuid)
    if (!session) return

    const createdAt = new Date().toISOString()
    const tables: Record<string, unknown[]> = {}

    for (const key of BACKUP_COLLECTION_KEYS) {
      const colName = CLOUD_COLLECTIONS[key]
      const docs = await store.col(colName).find({ shopUuid: session.shopUuid }).toArray()
      tables[colName] = docs
    }

    const snapshot = {
      format: 'vertexia-cloud-mongo-backup-v1',
      shopUuid: session.shopUuid,
      createdAt,
      tables,
    }

    const serialized = JSON.stringify(snapshot)
    const checksum = createHash('sha256').update(serialized).digest('hex')
    const fileName = `cloud-backup-${session.shopUuid}-${Date.now()}.json`
    const sizeBytes = Buffer.byteLength(serialized, 'utf8')

    await store.col(CLOUD_COLLECTIONS.cloudBackups).insertOne({
      _id: `${session.shopUuid}:${fileName}` as any,
      fileName,
      shopUuid: session.shopUuid,
      format: snapshot.format,
      sizeBytes,
      checksum,
      createdAt,
      snapshotJson: serialized,
    })

    return {
      ok: true,
      fileName,
      checksum,
      sizeBytes,
      createdAt,
    }
  })

  // GET /api/cloud/owner/backups
  app.get('/api/cloud/owner/backups', async (request, reply) => {
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'backup.manage', q.shopUuid)
    if (!session) return

    const docs = await store
      .col(CLOUD_COLLECTIONS.cloudBackups)
      .find({ shopUuid: session.shopUuid }, { projection: { snapshotJson: 0 } })
      .sort({ createdAt: -1 })
      .limit(50)
      .toArray()

    return {
      records: docs.map(d => ({
        fileName: String(d.fileName),
        sizeBytes: Number(d.sizeBytes ?? 0),
        checksum: String(d.checksum || ''),
        createdAt: String(d.createdAt || ''),
      })),
    }
  })

  // GET /api/cloud/owner/backups/:file/verify
  app.get('/api/cloud/owner/backups/:file/verify', async (request, reply) => {
    const params = request.params as { file: string }
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'backup.manage', q.shopUuid)
    if (!session) return

    if (!BACKUP_FILE_RE.test(params.file) || params.file.includes('..') || params.file.includes('/') || params.file.includes('\\')) {
      return reply.status(400).send({ error: 'InvalidFilename', message: 'Invalid backup filename.', statusCode: 400 })
    }

    const doc = await store.col(CLOUD_COLLECTIONS.cloudBackups).findOne({
      shopUuid: session.shopUuid,
      fileName: params.file,
    })
    if (!doc || typeof doc.snapshotJson !== 'string') {
      return reply.status(404).send({ error: 'BackupNotFound', message: 'Backup file missing.', statusCode: 404 })
    }

    const actual = createHash('sha256').update(doc.snapshotJson).digest('hex')
    const expected = String(doc.checksum || '')
    let valid = false
    try {
      const parsed = JSON.parse(doc.snapshotJson) as { shopUuid?: string; format?: string }
      valid = actual === expected && parsed.shopUuid === session.shopUuid && parsed.format === 'vertexia-cloud-mongo-backup-v1'
    } catch {
      valid = false
    }
    return { valid, checksum: actual, expectedChecksum: expected }
  })

  // GET /api/cloud/owner/backups/:file/download
  app.get('/api/cloud/owner/backups/:file/download', async (request, reply) => {
    const params = request.params as { file: string }
    const q = request.query as { shopUuid?: string }
    const session = await enforceCloudOwner(request, reply, store, 'backup.manage', q.shopUuid)
    if (!session) return

    if (!BACKUP_FILE_RE.test(params.file) || params.file.includes('..') || params.file.includes('/') || params.file.includes('\\')) {
      return reply.status(400).send({ error: 'InvalidFilename', message: 'Invalid backup filename.', statusCode: 400 })
    }

    const doc = await store.col(CLOUD_COLLECTIONS.cloudBackups).findOne({
      shopUuid: session.shopUuid,
      fileName: params.file,
    })
    if (!doc || typeof doc.snapshotJson !== 'string') {
      return reply.status(404).send({ error: 'BackupNotFound', message: 'Backup file missing.', statusCode: 404 })
    }

    const raw = doc.snapshotJson
    const actual = createHash('sha256').update(raw).digest('hex')
    const expected = String(doc.checksum || '')
    const parsed = JSON.parse(raw) as { shopUuid?: string; format?: string }
    if (parsed.shopUuid !== session.shopUuid || parsed.format !== 'vertexia-cloud-mongo-backup-v1' || actual !== expected) {
      return reply.status(409).send({
        error: 'BackupIntegrityError',
        message: 'Cloud backup checksum or tenant ownership check failed.',
        statusCode: 409,
      })
    }

    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${String(doc.fileName)}"`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('X-Backup-Checksum-Sha256', actual)
      .send(raw)
  })
}
