import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import net from 'node:net'
import { test } from 'node:test'
import { createCloudServer } from '../cloud-dist/cloud-server/app.mjs'
import { loadCloudEnv, loadDotEnv } from '../cloud-dist/cloud-server/config/env.mjs'
import { CLOUD_COLLECTIONS, connectMongoCloudStore } from '../cloud-dist/cloud-server/db/mongo-store.mjs'
import { hashScryptPassword, resetCloudAuthRateLimits, signNodePayload } from '../cloud-dist/cloud-server/routes/auth.mjs'
import { AuthRepository } from '../electron-dist/electron/database/auth.mjs'
import { VertexiaDatabase } from '../electron-dist/electron/database/database.mjs'
import { RetailRepository } from '../electron-dist/electron/database/retail.mjs'
import { HybridSyncEngine } from '../electron-dist/electron/sync/engine.mjs'
import { reconcileCloudEvents } from '../electron-dist/electron/sync/reconciler.mjs'
import { createInMemoryMongoCloudStore } from './helpers/in-memory-mongo.mjs'

loadDotEnv()

function connectRawWebSocket(port, pathWithQuery, timeoutMs = 4000) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host: '127.0.0.1', port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('WebSocket handshake timeout'))
    }, timeoutMs)

    const wsKey = randomBytes(16).toString('base64')
    let rawHeaderBuf = Buffer.alloc(0)
    let upgraded = false
    const messages = []
    let bodyBuf = Buffer.alloc(0)

    const parseFrames = () => {
      while (bodyBuf.length >= 2) {
        const opcode = bodyBuf[0] & 0x0f
        let len = bodyBuf[1] & 0x7f
        let offset = 2
        if (len === 126) {
          if (bodyBuf.length < 4) break
          len = bodyBuf.readUInt16BE(2)
          offset = 4
        } else if (len === 127) {
          if (bodyBuf.length < 10) break
          len = Number(bodyBuf.readBigUInt64BE(2))
          offset = 10
        }
        if (bodyBuf.length < offset + len) break
        const payload = bodyBuf.subarray(offset, offset + len)
        bodyBuf = bodyBuf.subarray(offset + len)
        if (opcode === 0x01) {
          messages.push(JSON.parse(payload.toString('utf8')))
        }
      }
    }

    socket.on('connect', () => {
      socket.write(
        [
          `GET ${pathWithQuery} HTTP/1.1`,
          `Host: 127.0.0.1:${port}`,
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${wsKey}`,
          'Sec-WebSocket-Version: 13',
          '\r\n',
        ].join('\r\n'),
      )
    })

    socket.on('data', chunk => {
      if (!upgraded) {
        rawHeaderBuf = Buffer.concat([rawHeaderBuf, chunk])
        const idx = rawHeaderBuf.indexOf('\r\n\r\n')
        if (idx === -1) return
        const head = rawHeaderBuf.subarray(0, idx).toString('latin1')
        const statusLine = head.split('\r\n')[0] || ''
        if (!statusLine.startsWith('HTTP/1.1 101')) {
          clearTimeout(timer)
          socket.destroy()
          resolve({ statusLine, socket: null, messages })
          return
        }
        upgraded = true
        clearTimeout(timer)
        const leftover = rawHeaderBuf.subarray(idx + 4)
        if (leftover.length) {
          bodyBuf = Buffer.concat([bodyBuf, leftover])
          parseFrames()
        }
        resolve({
          statusLine,
          socket,
          messages,
          waitForMessages: async count => {
            const start = Date.now()
            while (messages.length < count && Date.now() - start < 3000) {
              await new Promise(r => setTimeout(r, 25))
            }
            return messages
          },
          close: () => socket.destroy(),
        })
      } else {
        bodyBuf = Buffer.concat([bodyBuf, chunk])
        parseFrames()
      }
    })

    socket.on('error', err => {
      clearTimeout(timer)
      reject(err)
    })
  })
}

test('Phase 8: MongoDB Cloud API CORS, SQLite Password Sync, Tombstones, Duplicate Replay & Full Owner Flow', async t => {
  await t.test('enforces strict configured CORS origins, preflight OPTIONS 204/403, Vary: Origin, and zero wildcards', async () => {
    const store = await createInMemoryMongoCloudStore()
    const config = loadCloudEnv({
      NODE_ENV: 'test',
      CLOUD_HOST: '127.0.0.1',
      CLOUD_PORT: '0',
      CLOUD_CORS_ORIGINS: 'https://owner.vertexia.app,http://localhost:5174',
      MONGODB_URI: 'mongodb://127.0.0.1:27017',
      CLOUD_JWT_SECRET: 'test-jwt-secret-key-at-least-32-characters-1234',
      CLOUD_NODE_HMAC_SECRET: 'test-hmac-secret-key-at-least-32-characters-1234',
    })
    const cloud = await createCloudServer({ config, store, logger: false })
    t.after(() => cloud.stop())

    const okGet = await cloud.app.inject({
      method: 'GET',
      url: '/api/cloud/health',
      headers: { origin: 'https://owner.vertexia.app' },
    })
    assert.equal(okGet.statusCode, 200)
    assert.equal(okGet.headers['access-control-allow-origin'], 'https://owner.vertexia.app')
    assert.equal(okGet.headers.vary, 'Origin')
    assert.notEqual(okGet.headers['access-control-allow-origin'], '*')

    const okPreflight = await cloud.app.inject({
      method: 'OPTIONS',
      url: '/api/cloud/owner/sales',
      headers: { origin: 'http://localhost:5174' },
    })
    assert.equal(okPreflight.statusCode, 204)
    assert.equal(okPreflight.headers['access-control-allow-origin'], 'http://localhost:5174')
    assert.match(String(okPreflight.headers['access-control-allow-methods']), /DELETE/)
    assert.match(String(okPreflight.headers['access-control-allow-headers']), /Authorization/)

    const badPreflight = await cloud.app.inject({
      method: 'OPTIONS',
      url: '/api/cloud/owner/sales',
      headers: { origin: 'https://evil.example.com' },
    })
    assert.equal(badPreflight.statusCode, 403)
    assert.equal(badPreflight.headers['access-control-allow-origin'], undefined)

    const badGet = await cloud.app.inject({
      method: 'GET',
      url: '/api/cloud/health',
      headers: { origin: 'https://evil.example.com' },
    })
    assert.equal(badGet.statusCode, 403)

    const noOrigin = await cloud.app.inject({ method: 'GET', url: '/api/cloud/health' })
    assert.equal(noOrigin.statusCode, 200)
    assert.equal(noOrigin.headers['access-control-allow-origin'], undefined)
    assert.equal(noOrigin.headers.vary, 'Origin')
  })

  await t.test('reconciles cloud user_credential password changes & customer/supplier deletion tombstones on Main PC', async () => {
    const db = new VertexiaDatabase(':memory:')
    const auth = new AuthRepository(db.connection)
    t.after(() => db.close())

    const setup = await auth.setup({
      businessName: 'Sync Auth Shop',
      branchName: 'Main',
      city: 'Multan',
      ownerName: 'Owner',
      username: 'owner.auth',
      password: 'OldPassword!2026',
    })
    const { token: oldToken } = await auth.loginWithToken(setup.username, 'OldPassword!2026', 'counter-1')
    assert.ok(auth.authenticateToken(oldToken, false))

    const newHash = await hashScryptPassword('NewCloudPassword!2026')
    const nowIso = new Date().toISOString()

    // 1. Cross-shop attack event rejected
    const crossRes = reconcileCloudEvents(
      db.connection,
      [
        {
          cloudSeq: 1,
          eventId: 'evt-cred-cross',
          originSource: 'cloud_owner',
          entityType: 'user_credential',
          entityId: setup.userId,
          operation: 'password_change',
          payload: {
            userId: setup.userId,
            shopUuid: randomUUID(),
            passwordHash: newHash,
            credentialVersion: 5,
            mustChangePassword: false,
            updatedAt: nowIso,
          },
          createdAt: nowIso,
        },
      ],
      nowIso,
    )
    assert.equal(crossRes.conflictsCount, 1)
    assert.equal(crossRes.updatedUserIds.length, 0)

    // 2. Valid newer credential event updates SQLite & revokes old token
    const applyRes = reconcileCloudEvents(
      db.connection,
      [
        {
          cloudSeq: 2,
          eventId: 'evt-cred-valid',
          originSource: 'cloud_owner',
          entityType: 'user_credential',
          entityId: setup.userId,
          operation: 'password_change',
          payload: {
            userId: setup.userId,
            shopUuid: db.shopUuid,
            passwordHash: newHash,
            credentialVersion: 2,
            mustChangePassword: false,
            updatedAt: nowIso,
          },
          createdAt: nowIso,
        },
      ],
      nowIso,
    )
    assert.equal(applyRes.conflictsCount, 0)
    assert.deepEqual(applyRes.updatedUserIds, [setup.userId])
    auth.purgeMemorySessionsForUsers(applyRes.updatedUserIds)

    assert.equal(auth.authenticateToken(oldToken, false), null)
    await assert.rejects(() => auth.loginWithToken(setup.username, 'OldPassword!2026', 'counter-1'))
    const { session: newLocalSession } = await auth.loginWithToken(setup.username, 'NewCloudPassword!2026', 'counter-1')
    assert.equal(newLocalSession.userId, setup.userId)

    // 3. Stale downgrade rejected cleanly
    const olderHash = await hashScryptPassword('DowngradeAttempt!2026')
    const downgradeRes = reconcileCloudEvents(
      db.connection,
      [
        {
          cloudSeq: 3,
          eventId: 'evt-cred-downgrade',
          originSource: 'cloud_owner',
          entityType: 'user_credential',
          entityId: setup.userId,
          operation: 'password_change',
          payload: {
            userId: setup.userId,
            shopUuid: db.shopUuid,
            passwordHash: olderHash,
            credentialVersion: 1,
            mustChangePassword: false,
            updatedAt: nowIso,
          },
          createdAt: nowIso,
        },
      ],
      nowIso,
    )
    assert.equal(downgradeRes.conflictsCount, 1)
    assert.equal(downgradeRes.updatedUserIds.length, 0)

    // 4. Customer tombstone deactivation
    reconcileCloudEvents(
      db.connection,
      [
        {
          cloudSeq: 4,
          eventId: 'evt-cust-create',
          originSource: 'cloud_owner',
          entityType: 'customer',
          entityId: 'cust-tomb-1',
          operation: 'upsert',
          payload: { name: 'Ali Khan', phone: '03001112233', isActive: true, syncVersion: 1 },
          createdAt: nowIso,
        },
        {
          cloudSeq: 5,
          eventId: 'evt-cust-delete',
          originSource: 'cloud_owner',
          entityType: 'customer',
          entityId: 'cust-tomb-1',
          operation: 'delete',
          payload: { syncVersion: 2 },
          createdAt: nowIso,
        },
      ],
      nowIso,
    )
    const custRow = db.connection.prepare('SELECT is_active FROM customers WHERE id=?').get('cust-tomb-1')
    assert.equal(Number(custRow.is_active), 0)
  })

  await t.test('verifies built Remote Owner PWA bundle files and Service Worker excludes API responses', () => {
    assert.equal(existsSync('remote-dist/index.html'), true)
    assert.equal(existsSync('remote-dist/manifest.webmanifest'), true)
    assert.equal(existsSync('remote-dist/sw.js'), true)
    assert.equal(existsSync('remote-dist/retail-pos-icon.png'), true)

    const swSource = readFileSync('remote-dist/sw.js', 'utf8')
    assert.match(swSource, /\/api\/cloud\//)
    const manifest = JSON.parse(readFileSync('remote-dist/manifest.webmanifest', 'utf8'))
    assert.equal(manifest.display, 'standalone')
  })

  await t.test('end-to-end MongoDB Cloud API: Remote Owner endpoints, backup download, WS realtime, tombstones & password sync', async subT => {
    resetCloudAuthRateLimits()
    const liveUri = process.env.TEST_MONGODB_URI
    const testDbName = liveUri ? 'vertexia_cloud_test' : 'vertexia_cloud'
    const config = loadCloudEnv({
      NODE_ENV: 'test',
      CLOUD_HOST: '127.0.0.1',
      CLOUD_PORT: '0',
      CLOUD_CORS_ORIGINS: 'https://owner.vertexia.app',
      MONGODB_URI: liveUri || 'mongodb://127.0.0.1:27017',
      MONGODB_DB_NAME: testDbName,
      CLOUD_JWT_SECRET: 'test-jwt-secret-key-at-least-32-characters-1234',
      CLOUD_NODE_HMAC_SECRET: 'test-hmac-secret-key-at-least-32-characters-1234',
    })

    if (liveUri) {
      console.log(`[LIVE ATLAS] Phase 8 using dedicated test database: ${testDbName}`)
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

    subT.after(async () => {
      resetCloudAuthRateLimits()
      db.close()
      await cloud.stop()
      if (liveUri) {
        try {
          await store.db.dropDatabase()
        } catch {}
        await store.close()
      }
    })

    const ownerUsername = `p8owner_${Date.now()}`
    const ownerSession = await auth.setup({
      businessName: 'Phase8 Mongo SuperMart',
      branchName: 'Main Branch',
      city: 'Islamabad',
      ownerName: 'Riyaz Owner',
      username: ownerUsername,
      password: 'Password!2026',
    })
    const retail = new RetailRepository(db.connection, ownerSession.businessId, () => ownerSession.userId, () => new Date())

    const prod = db.saveProduct(ownerSession.branchId, {
      name: 'Basmati Rice 5kg',
      sku: 'RICE-5KG',
      barcode: 'RICE-5KG',
      category: 'Grocery',
      subcategory: '',
      brand: 'Guard',
      unit: 'Bag',
      purchasePricePaisa: 120000,
      sellingPricePaisa: 150000,
      mrpPaisa: 165000,
      minimumStockMilli: 2000,
      openingStockMilli: 15000,
      status: 'active',
      imageDataUrl: null,
    })

    const shift = db.openPosShift(ownerSession.branchId, 50000, 'p8-shift-op')
    assert.ok(shift)
    const todayDate = new Date(Date.now() + 5 * 3600_000).toISOString().slice(0, 10)
    retail.receivePurchase({
      operationId: 'p8-purchase-1',
      branchId: ownerSession.branchId,
      supplierName: 'Punjab Mills',
      supplierInvoiceNumber: 'PM-001',
      businessDate: todayDate,
      paymentMethod: 'Cash',
      paidAmountPaisa: 100000,
      lines: [{ productId: prod.id, quantityMilli: 2000, unitCostPaisa: 120000 }],
      note: 'Opening purchase',
    })
    const sale = db.completePosSale({
      operationId: 'p8-sale-1',
      branchId: ownerSession.branchId,
      customerId: 'customer-walk-in',
      lines: [{ productId: prod.id, quantityMilli: 2000, discountBasisPoints: 0 }],
      paymentMethod: 'Cash',
      cashReceivedPaisa: 300000,
    })

    const engine = new HybridSyncEngine({
      db: db.connection,
      cloudUrl: cloudBase,
      hmacSecret: config.nodeHmacSecret,
      onUsersReconciled: ids => auth.purgeMemorySessionsForUsers(ids),
    })
    const syncPush = await engine.triggerNow()
    assert.equal(syncPush.synced, true)

    // Verify tombstone protection: delete product via sync push -> stale upsert cannot resurrect it
    const nodeId = `node-${String(db.connection.prepare("SELECT value FROM app_meta WHERE key='installation_id'").get().value)}`
    const delBody = JSON.stringify({
      events: [
        { eventId: 'evt-del-prod-1', entityType: 'product', entityId: prod.id, operation: 'delete', payload: { syncVersion: 2 } },
      ],
    })
    const ts1 = String(Date.now())
    const delRes = await fetch(`${cloudBase}/api/cloud/sync/push`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vertexia-shop-uuid': db.shopUuid,
        'x-vertexia-node-id': nodeId,
        'x-vertexia-timestamp': ts1,
        'x-vertexia-signature': signNodePayload(config.nodeHmacSecret, db.shopUuid, ts1, delBody),
      },
      body: delBody,
    })
    assert.equal(delRes.status, 200)
    const tombCount = await store.col(CLOUD_COLLECTIONS.entityTombstones).countDocuments({ shopUuid: db.shopUuid, entityId: prod.id })
    assert.equal(tombCount, 1)

    // Un-delete back via active product upsert with higher syncVersion so remote owner test can edit it
    const resBody = JSON.stringify({
      events: [
        {
          eventId: 'evt-restore-prod-1',
          entityType: 'product',
          entityId: prod.id,
          operation: 'upsert',
          payload: { name: 'Basmati Rice 5kg', sku: 'RICE-5KG', sellingPricePaisa: 150000, purchasePricePaisa: 120000, status: 'active', syncVersion: 5 },
        },
      ],
    })
    const ts2 = String(Date.now())
    await fetch(`${cloudBase}/api/cloud/sync/push`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-vertexia-shop-uuid': db.shopUuid,
        'x-vertexia-node-id': nodeId,
        'x-vertexia-timestamp': ts2,
        'x-vertexia-signature': signNodePayload(config.nodeHmacSecret, db.shopUuid, ts2, resBody),
      },
      body: resBody,
    })

    // Login remotely
    const login1 = await fetch(`${cloudBase}/api/cloud/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://owner.vertexia.app' },
      body: JSON.stringify({ username: ownerUsername, password: 'Password!2026', shopUuid: db.shopUuid }),
    })
    assert.equal(login1.status, 200)
    assert.equal(login1.headers.get('access-control-allow-origin'), 'https://owner.vertexia.app')
    const tok1 = (await login1.json()).token
    const authHeader = { authorization: `Bearer ${tok1}` }

    const login2 = await fetch(`${cloudBase}/api/cloud/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ownerUsername, password: 'Password!2026', shopUuid: db.shopUuid }),
    })
    assert.equal(login2.status, 200)
    const tok2 = (await login2.json()).token

    const dash = await (await fetch(`${cloudBase}/api/cloud/owner/dashboard`, { headers: authHeader })).json()
    assert.equal(dash.summary.todaySalesPaisa, 300000)
    assert.equal(dash.summary.openShiftsCount, 1)

    const salesRes = await (
      await fetch(`${cloudBase}/api/cloud/owner/sales?search=${encodeURIComponent(sale.invoiceNumber)}&dateFrom=${todayDate}&dateTo=${todayDate}`, {
        headers: authHeader,
      })
    ).json()
    assert.equal(salesRes.total, 1)
    const saleId = sale.saleId || salesRes.sales[0].id

    const saleDetailRes = await fetch(`${cloudBase}/api/cloud/owner/sales/${saleId}`, { headers: authHeader })
    assert.equal(saleDetailRes.status, 200)
    const saleDetail = await saleDetailRes.json()
    assert.equal(saleDetail.sale.invoice_number, sale.invoiceNumber)
    assert.equal(saleDetail.items.length, 1)
    assert.equal(saleDetail.payments.length, 1)

    const purchasesRes = await (await fetch(`${cloudBase}/api/cloud/owner/purchases`, { headers: authHeader })).json()
    assert.equal(purchasesRes.total, 1)

    const shiftsRes = await (await fetch(`${cloudBase}/api/cloud/owner/cash-shifts`, { headers: authHeader })).json()
    assert.equal(shiftsRes.shifts.length, 1)

    const staffRes = await (await fetch(`${cloudBase}/api/cloud/owner/staff`, { headers: authHeader })).json()
    assert.equal(staffRes.staff.length >= 1, true)
    assert.equal('passwordHash' in staffRes.staff[0], false)

    const syncStatusRes = await (await fetch(`${cloudBase}/api/cloud/owner/sync-status`, { headers: authHeader })).json()
    assert.equal(syncStatusRes.installations.length, 1)

    // MongoDB Backup create + verify + download + traversal check
    const bCreate = await (
      await fetch(`${cloudBase}/api/cloud/owner/backups/create`, {
        method: 'POST',
        headers: { ...authHeader, 'content-type': 'application/json' },
        body: '{}',
      })
    ).json()
    const bDownload = await fetch(`${cloudBase}/api/cloud/owner/backups/${bCreate.fileName}/download`, { headers: authHeader })
    assert.equal(bDownload.status, 200)
    assert.match(String(bDownload.headers.get('content-disposition')), /attachment/)
    const downloadedText = await bDownload.text()
    assert.equal(createHash('sha256').update(downloadedText).digest('hex'), bCreate.checksum)

    const traversal = await fetch(`${cloudBase}/api/cloud/owner/backups/..%2F..%2Fsecret.json/download`, { headers: authHeader })
    assert.equal(traversal.status, 400)

    // WebSocket /api/cloud/events
    const badWs = await connectRawWebSocket(port, '/api/cloud/events?token=invalid-token')
    assert.match(badWs.statusLine, /401/)

    const goodWs = await connectRawWebSocket(port, `/api/cloud/events?token=${encodeURIComponent(tok1)}`)
    assert.match(goodWs.statusLine, /101/)
    subT.after(() => goodWs.close())
    await goodWs.waitForMessages(1)
    assert.equal(goodWs.messages[0].type, 'cloud:connected')

    const updProd = await fetch(`${cloudBase}/api/cloud/owner/products/${prod.id}`, {
      method: 'PUT',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ salePricePaisa: 155000 }),
    })
    assert.equal(updProd.status, 200)
    await goodWs.waitForMessages(2)
    assert.equal(goodWs.messages[1].type, 'product:updated')

    // Cloud password change -> revokes tok2 -> stale syncCredentials does NOT overwrite -> Main PC pulls & updates SQLite
    const chPwdRes = await fetch(`${cloudBase}/api/cloud/auth/change-password`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'Password!2026', newPassword: 'RemoteNewPassword!2026' }),
    })
    assert.equal(chPwdRes.status, 200)

    const oldSessRes = await fetch(`${cloudBase}/api/cloud/auth/me`, { headers: { authorization: `Bearer ${tok2}` } })
    assert.equal(oldSessRes.status, 401)

    await engine.syncCredentials()
    const cloudReLogin = await fetch(`${cloudBase}/api/cloud/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ownerUsername, password: 'RemoteNewPassword!2026', shopUuid: db.shopUuid }),
    })
    assert.equal(cloudReLogin.status, 200)

    const localOldToken = (await auth.loginWithToken(ownerUsername, 'Password!2026', 'counter-1')).token
    const syncPull = await engine.triggerNow()
    assert.equal(syncPull.synced, true)
    assert.equal(auth.authenticateToken(localOldToken, false), null)
    const { session: localAfter } = await auth.loginWithToken(ownerUsername, 'RemoteNewPassword!2026', 'counter-1')
    assert.equal(localAfter.userId, ownerSession.userId)
  })
})
