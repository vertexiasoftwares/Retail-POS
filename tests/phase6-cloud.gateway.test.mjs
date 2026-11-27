import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { loadCloudEnv, loadDotEnv } from '../cloud-dist/cloud-server/config/env.mjs'
import { signNodePayload } from '../cloud-dist/cloud-server/routes/auth.mjs'
import { tenantDatabaseName, tenantSchemaName } from '../cloud-dist/cloud-server/db/tenant-manager.mjs'

loadDotEnv()

test('Phase 6: Cloud environment, HMAC signing, tenant schema naming & live Supabase PostgreSQL remote owner flow', async (t) => {
  await t.test('rejects insecure production configuration without secrets or DB URLs', () => {
    assert.throws(
      () =>
        loadCloudEnv({
          NODE_ENV: 'production',
          DATABASE_CENTRAL_URL: '',
          CLOUD_JWT_SECRET: 'short',
          CLOUD_NODE_HMAC_SECRET: 'short',
        }),
      /DATABASE_CENTRAL_URL \(or DATABASE_URL\) is required/,
    )
    const cfg = loadCloudEnv({
      NODE_ENV: 'production',
      DATABASE_CENTRAL_URL: 'postgres://postgres:secret@127.0.0.1:5432/postgres',
      CLOUD_JWT_SECRET: 'prod-jwt-secret-value-at-least-32-characters-long',
      CLOUD_NODE_HMAC_SECRET: 'prod-hmac-secret-value-at-least-32-characters-long',
    })
    assert.equal(cfg.port, 8090)
    assert.equal(cfg.sslMode, 'disable')
  })

  await t.test('generates deterministic HMAC-SHA256 node signatures and deterministic immutable tenant schema names', () => {
    const shopUuid = randomUUID()
    const ts = String(Date.now())
    const body = JSON.stringify({ events: [{ id: 1 }] })
    const sig1 = signNodePayload('my-secret-32-char-minimum-hmac-key', shopUuid, ts, body)
    const sig2 = signNodePayload('my-secret-32-char-minimum-hmac-key', shopUuid, ts, body)
    assert.equal(sig1, sig2)
    assert.match(sig1, /^[a-f0-9]{64}$/)
    assert.match(tenantDatabaseName(shopUuid), /^vtx_shop_[0-9a-f]{32}$/)
    assert.equal(tenantDatabaseName(shopUuid), tenantSchemaName(shopUuid))
  })

  const centralUrl = process.env.TEST_DATABASE_CENTRAL_URL || process.env.DATABASE_CENTRAL_URL

  if (!centralUrl) {
    console.log('[SKIP LIVE PG] Set TEST_DATABASE_CENTRAL_URL or DATABASE_CENTRAL_URL to run live PostgreSQL gateway & multi-tenant tests.')
    return
  }

  await t.test('live Supabase PostgreSQL: provisions isolated tenant schemas, syncs Main PC data, serves Owner while Main PC OFF, enforces 403 cross-tenant & 409 hardware error', async (subT) => {
    const { createCloudServer } = await import('../cloud-dist/cloud-server/app.mjs')
    const { VertexiaDatabase } = await import('../electron-dist/electron/database/database.mjs')
    const { AuthRepository } = await import('../electron-dist/electron/database/auth.mjs')
    const { HybridSyncEngine } = await import('../electron-dist/electron/sync/engine.mjs')

    const config = loadCloudEnv({
      NODE_ENV: 'test',
      CLOUD_HOST: '127.0.0.1',
      CLOUD_PORT: '0',
      DATABASE_CENTRAL_URL: centralUrl,
      CLOUD_JWT_SECRET: 'test-jwt-secret-key-at-least-32-characters-1234',
      CLOUD_NODE_HMAC_SECRET: 'test-hmac-secret-key-at-least-32-characters-1234',
    })

    const cloud = await createCloudServer({ config, logger: false })
    await cloud.start()

    const port = cloud.app.server.address().port
    const cloudBase = `http://127.0.0.1:${port}`

    const db = new VertexiaDatabase(':memory:')
    const auth = new AuthRepository(db.connection)
    const secondShopUuid = randomUUID()

    subT.after(async () => {
      try {
        await cloud.tenantManager.dropTenantSchemaForTest(db.shopUuid)
      } catch {}
      try {
        await cloud.tenantManager.dropTenantSchemaForTest(secondShopUuid)
      } catch {}
      db.close()
      await cloud.stop()
    })

    const ownerSession = await auth.setup({
      businessName: 'PG Live Shop',
      branchName: 'Main',
      city: 'Lahore',
      ownerName: 'Live Owner',
      username: `pgowner_${Date.now()}`,
      password: 'Password!2026',
    })
    const prod = db.saveProduct(ownerSession.branchId, {
      name: 'PG Tea 1kg',
      sku: 'PG-TEA-1',
      barcode: 'PG-TEA-1',
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
    db.openPosShift(ownerSession.branchId, 50000, 'pg-shift-1')
    db.completePosSale({
      operationId: 'pg-sale-1',
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

    // Turn Main PC "OFF" (no requests hit Main PC below!) and verify Owner logs into Cloud directly
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

    // Cross-tenant rejection check
    const foreignRes = await fetch(`${cloudBase}/api/cloud/owner/dashboard?shopUuid=${randomUUID()}`, {
      headers: { authorization: bearer },
    })
    assert.equal(foreignRes.status, 403)

    // Remote hardware rejection check
    const drawerRes = await fetch(`${cloudBase}/api/cloud/owner/open-cash-drawer`, {
      method: 'POST',
      headers: { authorization: bearer, 'content-type': 'application/json' },
      body: JSON.stringify({}),
    })
    assert.equal(drawerRes.status, 409)
    assert.equal((await drawerRes.json()).error, 'MAIN_PC_HARDWARE_REQUIRED')

    // Remote inventory increase while Main PC offline, then Main PC comes back & reconciles!
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
    assert.equal(localQty, 22_000) // 20 - 3 + 5 = 22

    // Verify second isolated tenant schema + privilege revocation + cloud backup verification
    await cloud.centralPool.query(
      `INSERT INTO vtx_central.businesses (shop_uuid, local_business_id, name, branch_name, city, status)
       VALUES ($1, 'biz-2', 'Second Isolated Shop', 'Main', 'Karachi', 'active')`,
      [secondShopUuid],
    )
    const secondSchema = await cloud.tenantManager.ensureTenantSchema(secondShopUuid)
    assert.equal(secondSchema, tenantSchemaName(secondShopUuid))
    const privRes = await cloud.centralPool.query(
      `SELECT has_schema_privilege('anon', 'vtx_central', 'USAGE') AS anon_central,
              has_schema_privilege('anon', $1, 'USAGE') AS anon_tenant`,
      [secondSchema],
    )
    assert.equal(privRes.rows[0].anon_central, false)
    assert.equal(privRes.rows[0].anon_tenant, false)

    const secondProducts = await cloud.tenantManager.queryTenant(secondShopUuid, 'SELECT COUNT(*)::int AS cnt FROM products')
    assert.equal(secondProducts.rows[0].cnt, 0) // Zero cross-tenant bleed from Shop 1

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
