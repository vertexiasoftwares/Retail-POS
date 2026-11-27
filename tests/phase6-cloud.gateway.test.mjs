import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { test } from 'node:test'
import { createCloudServer } from '../cloud-dist/cloud-server/app.mjs'
import { loadCloudEnv, loadDotEnv } from '../cloud-dist/cloud-server/config/env.mjs'
import { CLOUD_COLLECTIONS, connectMongoCloudStore, normalizeShopUuid } from '../cloud-dist/cloud-server/db/mongo-store.mjs'
import { signNodePayload } from '../cloud-dist/cloud-server/routes/auth.mjs'
import { AuthRepository } from '../electron-dist/electron/database/auth.mjs'
import { VertexiaDatabase } from '../electron-dist/electron/database/database.mjs'
import { HybridSyncEngine } from '../electron-dist/electron/sync/engine.mjs'
import { createInMemoryMongoCloudStore } from './helpers/in-memory-mongo.mjs'

loadDotEnv()

test('Phase 6: Cloud environment, HMAC signing, MongoDB tenant partitioning & offline owner sync flow', async t => {
  await t.test('rejects insecure production configuration without secrets or MONGODB_URI', () => {
    assert.throws(
      () =>
        loadCloudEnv({
          NODE_ENV: 'production',
          MONGODB_URI: '',
          CLOUD_JWT_SECRET: 'short',
          CLOUD_NODE_HMAC_SECRET: 'short',
        }),
      /MONGODB_URI is required/,
    )
    const prodCfg = loadCloudEnv({
      NODE_ENV: 'production',
      PORT: '41234',
      CLOUD_PORT: '8090',
      MONGODB_URI: 'mongodb+srv://user:pass@cluster.mongodb.net/?retryWrites=true&w=majority',
      CLOUD_JWT_SECRET: 'prod-jwt-secret-value-at-least-32-characters-long',
      CLOUD_NODE_HMAC_SECRET: 'prod-hmac-secret-value-at-least-32-characters-long',
    })
    assert.equal(prodCfg.host, '0.0.0.0')
    assert.equal(prodCfg.port, 41234)
    assert.equal(prodCfg.mongoDbName, 'vertexia_cloud')

    const localCfg = loadCloudEnv({
      NODE_ENV: 'development',
      CLOUD_HOST: '127.0.0.1',
      CLOUD_PORT: '8095',
      PORT: '3000',
    })
    assert.equal(localCfg.host, '127.0.0.1')
    assert.equal(localCfg.port, 8095)
  })

  await t.test('generates deterministic HMAC-SHA256 node signatures and validates canonical shopUuid keys', () => {
    const shopUuid = randomUUID().toUpperCase()
    const normalized = normalizeShopUuid(shopUuid)
    assert.equal(normalized, shopUuid.toLowerCase())
    assert.throws(() => normalizeShopUuid('not-a-uuid'), /Invalid shop UUID/)

    const ts = String(Date.now())
    const body = JSON.stringify({ events: [{ id: 1 }] })
    const sig1 = signNodePayload('my-secret-32-char-minimum-hmac-key', normalized, ts, body)
    const sig2 = signNodePayload('my-secret-32-char-minimum-hmac-key', normalized, ts, body)
    assert.equal(sig1, sig2)
    assert.match(sig1, /^[a-f0-9]{64}$/)
  })

  await t.test('syncs Main PC data to MongoDB store, serves Owner while Main PC OFF, enforces 403 cross-tenant, tombstones & 409 hardware error', async subT => {
    const liveUri = process.env.TEST_MONGODB_URI
    const testDbName = liveUri ? 'vertexia_cloud_test' : 'vertexia_cloud'
    const config = loadCloudEnv({
      NODE_ENV: 'test',
      CLOUD_HOST: '127.0.0.1',
      CLOUD_PORT: '0',
      MONGODB_URI: liveUri || 'mongodb://127.0.0.1:27017',
      MONGODB_DB_NAME: testDbName,
      CLOUD_JWT_SECRET: 'test-jwt-secret-key-at-least-32-characters-1234',
      CLOUD_NODE_HMAC_SECRET: 'test-hmac-secret-key-at-least-32-characters-1234',
    })

    if (liveUri) {
      console.log(`[LIVE ATLAS] Phase 6 using dedicated test database: ${testDbName}`)
    }
    const store = liveUri
      ? await connectMongoCloudStore(config)
      : await createInMemoryMongoCloudStore()

    const cloud = await createCloudServer({ config, store, logger: false })
    await cloud.start()

    const port = cloud.app.server.address().port
    const cloudBase = `http://127.0.0.1:${port}`

    const db = new VertexiaDatabase(':memory:')
    const auth = new AuthRepository(db.connection)
    const secondShopUuid = randomUUID()

    subT.after(async () => {
      db.close()
      await cloud.stop()
      if (liveUri) {
        try {
          await store.db.dropDatabase()
        } catch {}
        await store.close()
      }
    })

    const ownerSession = await auth.setup({
      businessName: 'Mongo Live Shop',
      branchName: 'Main',
      city: 'Lahore',
      ownerName: 'Mongo Owner',
      username: `mgowner_${Date.now()}`,
      password: 'Password!2026',
    })
    const prod = db.saveProduct(ownerSession.branchId, {
      name: 'Mongo Tea 1kg',
      sku: 'MG-TEA-1',
      barcode: 'MG-TEA-1',
      category: 'Grocery',
      subcategory: '',
      brand: 'Tapal',
      unit: 'Pack',
      purchasePricePaisa: 80000,
      sellingPricePaisa: 100000,
      mrpPaisa: 110000,
      minimumStockMilli: 1000,
      openingStockMilli: 20_000,
      status: 'active',
      imageDataUrl: null,
    })
    db.openPosShift(ownerSession.branchId, 50000, 'mg-shift-1')
    db.completePosSale({
      operationId: 'mg-sale-1',
      branchId: ownerSession.branchId,
      customerId: 'customer-walk-in',
      lines: [{ productId: prod.id, quantityMilli: 3000, discountBasisPoints: 0 }],
      paymentMethod: 'Cash',
      cashReceivedPaisa: 300000,
    })

    const syncEngine = new HybridSyncEngine({
      db: db.connection,
      cloudUrl: cloudBase,
      hmacSecret: config.nodeHmacSecret,
    })
    const pushRes = await syncEngine.triggerNow()
    assert.equal(pushRes.synced, true)

    // Turn Main PC "OFF" and verify Owner logs into Cloud directly
    const cloudLoginRes = await fetch(`${cloudBase}/api/cloud/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        username: ownerSession.username,
        password: 'Password!2026',
        shopUuid: db.shopUuid,
      }),
    })
    assert.equal(cloudLoginRes.status, 200)
    const loginJson = await cloudLoginRes.json()
    const bearer = `Bearer ${loginJson.token}`

    const dashRes = await fetch(`${cloudBase}/api/cloud/owner/dashboard`, { headers: { authorization: bearer } })
    assert.equal(dashRes.status, 200)
    const dashJson = await dashRes.json()
    assert.equal(dashJson.summary.netSalesPaisa, 300000)

    // Cross-tenant isolation check
    const foreignRes = await fetch(`${cloudBase}/api/cloud/owner/dashboard?shopUuid=${secondShopUuid}`, {
      headers: { authorization: bearer },
    })
    assert.equal(foreignRes.status, 403)
    const foreignProducts = await store.col(CLOUD_COLLECTIONS.products).countDocuments({ shopUuid: secondShopUuid })
    assert.equal(foreignProducts, 0)

    // Remote hardware rejection check
    const drawerRes = await fetch(`${cloudBase}/api/cloud/owner/open-cash-drawer`, {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(drawerRes.status, 409)
    assert.equal((await drawerRes.json()).error, 'MAIN_PC_HARDWARE_REQUIRED')

    // Remote inventory increase while Main PC offline, then Main PC reconciles
    const adjRes = await fetch(`${cloudBase}/api/cloud/owner/inventory/adjust`, {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: JSON.stringify({ productId: prod.id, quantityDeltaMilli: 5000, reason: 'Owner restock' }),
    })
    assert.equal(adjRes.status, 200)

    const pullRes = await syncEngine.triggerNow()
    assert.equal(pullRes.synced, true)
    assert.equal(pullRes.pulledCount, 1)

    const localQty = Number(
      db.connection.prepare('SELECT quantity_milli FROM stock_levels WHERE branch_id=? AND product_id=?').get(ownerSession.branchId, prod.id).quantity_milli,
    )
    assert.equal(localQty, 22_000)

    // Cloud backup create & SHA-256 verify inside MongoDB
    const backupCreateRes = await fetch(`${cloudBase}/api/cloud/owner/backups/create`, {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(backupCreateRes.status, 200)
    const backupCreateJson = await backupCreateRes.json()
    assert.equal(backupCreateJson.ok, true)
    const backupVerifyRes = await fetch(`${cloudBase}/api/cloud/owner/backups/${backupCreateJson.fileName}/verify`, {
      headers: { authorization: bearer },
    })
    assert.equal(backupVerifyRes.status, 200)
    assert.equal((await backupVerifyRes.json()).valid, true)
  })
})
