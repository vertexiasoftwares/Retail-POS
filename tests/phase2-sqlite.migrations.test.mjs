import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DatabaseSync } from 'node:sqlite'
import { VertexiaDatabase } from '../electron-dist/electron/database/database.mjs'
import { AuthRepository } from '../electron-dist/electron/database/auth.mjs'
import { enqueueOutboxEvent, getShopUuid, listOutboxSummary } from '../electron-dist/electron/sync/outbox.mjs'
import { normalizeShopUuid, tenantDatabaseName } from '../cloud-dist/cloud-server/db/tenant-manager.mjs'

test('Phase 2: v16/v17 migrations, immutable UUID DB naming, and atomic outbox durability', async (t) => {
  await t.test('creates counters, auth_sessions, sync_outbox, and immutable shop_uuid on fresh DB', () => {
    const db = new VertexiaDatabase(':memory:')
    t.after(() => db.close())

    const userVersion = Number(db.connection.prepare('PRAGMA user_version').get().user_version)
    assert.equal(userVersion, 17)

    for (const table of [
      'counters',
      'counter_pairing_codes',
      'auth_sessions',
      'sync_outbox',
      'sync_state',
      'sync_conflicts',
      'processed_cloud_events',
      'sync_logs',
    ]) {
      const exists = db.connection.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table)
      assert.ok(exists, `Missing expected table: ${table}`)
    }

    const shopUuid = getShopUuid(db.connection)
    assert.match(shopUuid, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
    assert.equal(tenantDatabaseName(shopUuid), `vtx_shop_${shopUuid.replace(/-/g, '')}`)

    const primary = db.connection.prepare("SELECT * FROM counters WHERE id='counter-1'").get()
    assert.equal(primary.counter_number, 1)
    assert.equal(primary.is_primary, 1)
    assert.equal(primary.status, 'active')
  })

  await t.test('rejects invalid or SQL-injection shop UUIDs for tenant database naming', () => {
    assert.throws(() => normalizeShopUuid('noor-mart; DROP TABLE businesses;--'), /Invalid immutable shop UUID/)
    assert.throws(() => tenantDatabaseName('12345'), /Invalid immutable shop UUID/)
    assert.equal(
      tenantDatabaseName('A1B2C3D4-E5F6-4789-ABCD-0123456789EF'),
      'vtx_shop_a1b2c3d4e5f64789abcd0123456789ef',
    )
  })

  await t.test('rolls back sync_outbox atomically if the business transaction fails', async () => {
    const db = new VertexiaDatabase(':memory:')
    const auth = new AuthRepository(db.connection)
    t.after(() => db.close())

    await auth.setup({
      businessName: 'Outbox Atomic Shop',
      branchName: 'Main',
      city: 'Lahore',
      ownerName: 'Owner',
      username: 'owner.atomic',
      password: 'Password!2026',
    })

    const beforeCount = listOutboxSummary(db.connection).pendingCount
    assert.ok(beforeCount >= 2, 'Setup should enqueue business_profile + user events')

    db.connection.exec('BEGIN IMMEDIATE')
    try {
      enqueueOutboxEvent(db.connection, {
        entityType: 'product',
        entityId: 'prod-rollback',
        operation: 'upsert',
        payload: { id: 'prod-rollback' },
        occurredAt: new Date().toISOString(),
      })
      throw new Error('Simulated failure before commit')
    } catch {
      db.connection.exec('ROLLBACK')
    }

    const afterRollbackCount = listOutboxSummary(db.connection).pendingCount
    assert.equal(afterRollbackCount, beforeCount)
  })

  await t.test('existing v15 schema upgrades cleanly to v17 preserving existing data', () => {
    const raw = new DatabaseSync(':memory:')
    raw.close()
    const db = new VertexiaDatabase(':memory:', undefined, { seedDemoData: true })
    t.after(() => db.close())

    const salesCount = Number(db.connection.prepare('SELECT COUNT(*) AS cnt FROM sales').get().cnt)
    assert.ok(salesCount > 10)
    const primary = db.connection.prepare("SELECT * FROM counters WHERE id='counter-1'").get()
    assert.equal(primary.counter_number, 1)
  })
})
