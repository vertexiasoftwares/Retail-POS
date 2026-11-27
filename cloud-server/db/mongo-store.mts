import { MongoClient, type Collection, type Db, type Document } from 'mongodb'
import type { CloudEnvConfig } from '../config/env.mjs'

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function normalizeShopUuid(raw: string): string {
  const trimmed = String(raw || '').trim().toLowerCase()
  if (!UUID_RE.test(trimmed)) {
    throw new Error(`Invalid shop UUID: ${raw}`)
  }
  return trimmed
}

export const CLOUD_COLLECTIONS = {
  shops: 'shops',
  installations: 'installations',
  cloudUsers: 'cloud_users',
  cloudSessions: 'cloud_sessions',
  counters: 'counters',
  branches: 'branches',
  products: 'products',
  stockLevels: 'stock_levels',
  stockMovements: 'stock_movements',
  customers: 'customers',
  suppliers: 'suppliers',
  sales: 'sales',
  saleReturns: 'sale_returns',
  manualReturns: 'manual_returns',
  purchases: 'purchases',
  customerReceipts: 'customer_receipts',
  supplierPayments: 'supplier_payments',
  customerLedger: 'customer_ledger',
  supplierLedger: 'supplier_ledger',
  expenses: 'expenses',
  cashShifts: 'cash_shifts',
  cashMovements: 'cash_movements',
  syncConflicts: 'sync_conflicts',
  processedSyncEvents: 'processed_sync_events',
  cloudSyncEvents: 'cloud_sync_events',
  syncCounters: 'sync_counters',
  entityTombstones: 'entity_tombstones',
  cloudBackups: 'cloud_backups',
} as const

/**
 * MongoDB Atlas data layer with strict `shopUuid` tenant partitioning.
 * Every shop-scoped helper merges `{ shopUuid: normalizeShopUuid(shopUuid) }`
 * so cross-tenant reads or writes are prevented structurally.
 */
export class MongoCloudStore {
  constructor(
    public readonly client: MongoClient | null,
    public readonly db: Db,
  ) {}

  col<T extends Document = Document>(name: string): Collection<T> {
    return this.db.collection<T>(name)
  }

  async ping(): Promise<void> {
    await this.db.command({ ping: 1 })
  }

  async close(): Promise<void> {
    if (this.client) {
      await this.client.close().catch(() => undefined)
    }
  }

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.col(CLOUD_COLLECTIONS.shops).createIndex({ shopUuid: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.installations).createIndex({ nodeId: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.installations).createIndex({ shopUuid: 1, nodeId: 1 }, { unique: true }),

      this.col(CLOUD_COLLECTIONS.cloudUsers).createIndex({ shopUuid: 1, userId: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.cloudUsers).createIndex({ shopUuid: 1, username: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.cloudUsers).createIndex({ username: 1 }),

      this.col(CLOUD_COLLECTIONS.cloudSessions).createIndex({ tokenHash: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.cloudSessions).createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
      this.col(CLOUD_COLLECTIONS.cloudSessions).createIndex({ shopUuid: 1, userId: 1, revokedAt: 1 }),

      this.col(CLOUD_COLLECTIONS.branches).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.counters).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.counters).createIndex({ shopUuid: 1, counterNumber: 1 }, { unique: true }),

      this.col(CLOUD_COLLECTIONS.products).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.products).createIndex({ shopUuid: 1, sku: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.products).createIndex({ shopUuid: 1, isDeleted: 1, name: 1 }),

      this.col(CLOUD_COLLECTIONS.stockLevels).createIndex({ shopUuid: 1, branchId: 1, productId: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.stockMovements).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.stockMovements).createIndex({ shopUuid: 1, productId: 1, occurredAt: -1 }),

      this.col(CLOUD_COLLECTIONS.customers).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.customers).createIndex({ shopUuid: 1, isWalkIn: 1, name: 1 }),

      this.col(CLOUD_COLLECTIONS.suppliers).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),

      this.col(CLOUD_COLLECTIONS.sales).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.sales).createIndex({ shopUuid: 1, invoiceNumber: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.sales).createIndex({ shopUuid: 1, businessDate: -1, completedAt: -1 }),
      this.col(CLOUD_COLLECTIONS.sales).createIndex({ shopUuid: 1, counterId: 1, businessDate: -1 }),

      this.col(CLOUD_COLLECTIONS.saleReturns).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.saleReturns).createIndex({ shopUuid: 1, saleId: 1 }),
      this.col(CLOUD_COLLECTIONS.manualReturns).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),

      this.col(CLOUD_COLLECTIONS.purchases).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.purchases).createIndex({ shopUuid: 1, purchaseNumber: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.purchases).createIndex({ shopUuid: 1, businessDate: -1, occurredAt: -1 }),

      this.col(CLOUD_COLLECTIONS.customerReceipts).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.supplierPayments).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.customerLedger).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.customerLedger).createIndex({ shopUuid: 1, customerId: 1 }),
      this.col(CLOUD_COLLECTIONS.supplierLedger).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.supplierLedger).createIndex({ shopUuid: 1, supplierId: 1 }),

      this.col(CLOUD_COLLECTIONS.expenses).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.expenses).createIndex({ shopUuid: 1, businessDate: -1, occurredAt: -1 }),

      this.col(CLOUD_COLLECTIONS.cashShifts).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.cashShifts).createIndex({ shopUuid: 1, openedAt: -1 }),
      this.col(CLOUD_COLLECTIONS.cashMovements).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.cashMovements).createIndex({ shopUuid: 1, shiftId: 1, occurredAt: -1 }),

      this.col(CLOUD_COLLECTIONS.syncConflicts).createIndex({ shopUuid: 1, id: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.syncConflicts).createIndex({ shopUuid: 1, resolvedAt: -1 }),

      this.col(CLOUD_COLLECTIONS.processedSyncEvents).createIndex({ shopUuid: 1, eventId: 1 }, { unique: true }),

      this.col(CLOUD_COLLECTIONS.cloudSyncEvents).createIndex({ shopUuid: 1, cloudSeq: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.cloudSyncEvents).createIndex({ shopUuid: 1, eventId: 1 }, { unique: true }),

      this.col(CLOUD_COLLECTIONS.entityTombstones).createIndex({ shopUuid: 1, entityType: 1, entityId: 1 }, { unique: true }),
      this.col(CLOUD_COLLECTIONS.cloudBackups).createIndex({ shopUuid: 1, fileName: 1 }, { unique: true }),
    ])
  }

  async ensureActiveShop(shopUuid: string): Promise<string> {
    const normalized = normalizeShopUuid(shopUuid)
    const shop = await this.col(CLOUD_COLLECTIONS.shops).findOne({ shopUuid: normalized })
    if (!shop || shop.status !== 'active') {
      throw new Error(`Tenant shop missing or inactive for ${normalized}`)
    }
    return normalized
  }

  async nextCloudSeq(shopUuid: string): Promise<number> {
    const normalized = normalizeShopUuid(shopUuid)
    const counterId = `cloud_seq:${normalized}`
    const doc = await this.col(CLOUD_COLLECTIONS.syncCounters).findOneAndUpdate(
      { _id: counterId as any },
      { $inc: { seq: 1 }, $setOnInsert: { shopUuid: normalized } },
      { upsert: true, returnDocument: 'after' },
    )
    const seq = Number((doc as any)?.seq ?? 1)
    return Number.isFinite(seq) && seq >= 1 ? seq : 1
  }

  async appendCloudOwnerEvent(params: {
    shopUuid: string
    entityType: string
    entityId: string
    operation: string
    payload: Record<string, unknown>
    eventId: string
  }): Promise<{ eventId: string; cloudSeq: number }> {
    const shopUuid = normalizeShopUuid(params.shopUuid)
    const cloudSeq = await this.nextCloudSeq(shopUuid)
    await this.col(CLOUD_COLLECTIONS.cloudSyncEvents).insertOne({
      _id: `${shopUuid}:${cloudSeq}` as any,
      cloudSeq,
      eventId: params.eventId,
      shopUuid,
      originSource: 'cloud_owner',
      counterId: 'cloud',
      entityType: params.entityType,
      entityId: params.entityId,
      operation: params.operation,
      payload: params.payload,
      createdAt: new Date(),
    })
    return { eventId: params.eventId, cloudSeq }
  }
}

export async function connectMongoCloudStore(config: CloudEnvConfig): Promise<MongoCloudStore> {
  const client = new MongoClient(config.mongoUri, {
    maxPoolSize: config.mongoMaxPoolSize,
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
  })
  await client.connect()
  const db = client.db(config.mongoDbName)
  const store = new MongoCloudStore(client, db)
  await store.ensureIndexes()
  return store
}
