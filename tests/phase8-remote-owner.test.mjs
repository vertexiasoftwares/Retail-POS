import assert from 'node:assert/strict'
import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { createCloudServer } from '../cloud-dist/cloud-server/app.mjs'
import { loadCloudEnv, loadDotEnv } from '../cloud-dist/cloud-server/config/env.mjs'
import { hashScryptPassword, resetCloudAuthRateLimits } from '../cloud-dist/cloud-server/routes/auth.mjs'
import { AuthRepository } from '../electron-dist/electron/database/auth.mjs'
import { VertexiaDatabase } from '../electron-dist/electron/database/database.mjs'
import { RetailRepository } from '../electron-dist/electron/database/retail.mjs'
import { HybridSyncEngine } from '../electron-dist/electron/sync/engine.mjs'
import { reconcileCloudEvents } from '../electron-dist/electron/sync/reconciler.mjs'

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

test('Phase 8: Strict CORS, SQLite Password Sync Reconciliation, Backup Traversal & PWA Artifact Verification', async t => {
  await t.test('enforces strict configured CORS origins, preflight OPTIONS 204/403, Vary: Origin, and zero wildcards', async () => {
    const fakePool = {
      async query() {
        return { rows: [{ '?column?': 1 }] }
      },
      async end() {},
    }
    const config = loadCloudEnv({
      NODE_ENV: 'test',
      CLOUD_HOST: '127.0.0.1',
      CLOUD_PORT: '0',
      CLOUD_CORS_ORIGINS: 'https://owner.vertexia.app,http://localhost:5174',
      DATABASE_CENTRAL_URL: 'postgres://postgres:postgres@127.0.0.1:5432/postgres',
      CLOUD_JWT_SECRET: 'test-jwt-secret-key-at-least-32-characters-1234',
      CLOUD_NODE_HMAC_SECRET: 'test-hmac-secret-key-at-least-32-characters-1234',
    })
    const cloud = await createCloudServer({ config, centralPool: fakePool, runMigrations: false, logger: false })
    t.after(() => cloud.stop())

    // Allowed origin GET
    const okGet = await cloud.app.inject({
      method: 'GET',
      url: '/api/cloud/health',
      headers: { origin: 'https://owner.vertexia.app' },
    })
    assert.equal(okGet.statusCode, 200)
    assert.equal(okGet.headers['access-control-allow-origin'], 'https://owner.vertexia.app')
    assert.equal(okGet.headers.vary, 'Origin')
    assert.notEqual(okGet.headers['access-control-allow-origin'], '*')

    // Allowed origin preflight OPTIONS
    const okPreflight = await cloud.app.inject({
      method: 'OPTIONS',
      url: '/api/cloud/owner/sales',
      headers: { origin: 'http://localhost:5174' },
    })
    assert.equal(okPreflight.statusCode, 204)
    assert.equal(okPreflight.headers['access-control-allow-origin'], 'http://localhost:5174')
    assert.match(String(okPreflight.headers['access-control-allow-methods']), /DELETE/)
    assert.match(String(okPreflight.headers['access-control-allow-headers']), /Authorization/)
    assert.match(String(okPreflight.headers['access-control-allow-headers']), /Content-Type/)

    // Disallowed origin preflight OPTIONS
    const badPreflight = await cloud.app.inject({
      method: 'OPTIONS',
      url: '/api/cloud/owner/sales',
      headers: { origin: 'https://evil.example.com' },
    })
    assert.equal(badPreflight.statusCode, 403)
    assert.equal(badPreflight.headers['access-control-allow-origin'], undefined)

    // Disallowed cross-origin API GET
    const badGet = await cloud.app.inject({
      method: 'GET',
      url: '/api/cloud/health',
      headers: { origin: 'https://evil.example.com' },
    })
    assert.equal(badGet.statusCode, 403)
    assert.equal(badGet.headers['access-control-allow-origin'], undefined)

    // Server-to-server / native client without Origin works without emitting wildcard CORS
    const noOrigin = await cloud.app.inject({
      method: 'GET',
      url: '/api/cloud/health',
    })
    assert.equal(noOrigin.statusCode, 200)
    assert.equal(noOrigin.headers['access-control-allow-origin'], undefined)
    assert.equal(noOrigin.headers.vary, 'Origin')
  })

  await t.test('reconciles cloud user_credential password changes on Main PC, revokes live sessions & blocks stale/cross-shop events', async () => {
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

    // 1. Cross-shop attack event MUST be rejected and logged as conflict
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
    assert.ok(auth.authenticateToken(oldToken, false))

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

    // 3. Stale downgrade credentialVersion (<= local v2) MUST be rejected cleanly
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

    // 4. Replay of valid event is idempotent
    const replayRes = reconcileCloudEvents(
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
    assert.equal(replayRes.skippedCount, 1)
    assert.equal(replayRes.appliedCount, 0)
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

  const centralUrl = process.env.TEST_DATABASE_CENTRAL_URL || process.env.DATABASE_CENTRAL_URL
  if (!centralUrl) {
    console.log('[SKIP LIVE PG PHASE 8] Set TEST_DATABASE_CENTRAL_URL or DATABASE_CENTRAL_URL for full live PG Remote Owner integration checks.')
    return
  }

  await t.test('live PostgreSQL: Remote Owner APIs, invoice details, purchases, shifts, staff, backup download, WS realtime & cloud-to-Main-PC password sync', async subT => {
    resetCloudAuthRateLimits()
    const tempBackupDir = mkdtempSync(join(tmpdir(), 'vtx-cloud-bak-'))
    const config = loadCloudEnv({
      NODE_ENV: 'test',
      CLOUD_HOST: '127.0.0.1',
      CLOUD_PORT: '0',
      CLOUD_CORS_ORIGINS: 'https://owner.vertexia.app',
      PG_BACKUP_DIR: tempBackupDir,
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

    subT.after(async () => {
      resetCloudAuthRateLimits()
      try {
        await cloud.tenantManager.dropTenantSchemaForTest(db.shopUuid)
      } catch {}
      try {
        await cloud.centralPool.query('DELETE FROM vtx_central.central_sessions WHERE shop_uuid = $1', [db.shopUuid])
        await cloud.centralPool.query('DELETE FROM vtx_central.central_users WHERE shop_uuid = $1', [db.shopUuid])
        await cloud.centralPool.query('DELETE FROM vtx_central.installations WHERE shop_uuid = $1', [db.shopUuid])
        await cloud.centralPool.query('DELETE FROM vtx_central.counter_devices WHERE shop_uuid = $1', [db.shopUuid])
        await cloud.centralPool.query('DELETE FROM vtx_central.tenant_databases WHERE shop_uuid = $1', [db.shopUuid])
        await cloud.centralPool.query('DELETE FROM vtx_central.businesses WHERE shop_uuid = $1', [db.shopUuid])
      } catch {}
      db.close()
      await cloud.stop()
      rmSync(tempBackupDir, { recursive: true, force: true })
    })

    const ownerUsername = `p8owner_${Date.now()}`
    const ownerSession = await auth.setup({
      businessName: 'Phase8 SuperMart',
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
    assert.ok(shift)

    const engine = new HybridSyncEngine({
      db: db.connection,
      cloudUrl: cloudBase,
      hmacSecret: config.nodeHmacSecret,
      onUsersReconciled: ids => auth.purgeMemorySessionsForUsers(ids),
    })
    const syncPush = await engine.triggerNow()
    assert.equal(syncPush.synced, true)

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

    // 2nd login for testing multi-session invalidation after password change
    const login2 = await fetch(`${cloudBase}/api/cloud/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ownerUsername, password: 'Password!2026', shopUuid: db.shopUuid }),
    })
    assert.equal(login2.status, 200)
    const tok2 = (await login2.json()).token

    // Check Dashboard + Sales filter + Invoice Detail + Purchases + Shifts + Staff (no password_hash!) + Sync Status
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
    assert.equal('password_hash' in staffRes.staff[0], false)

    const syncStatusRes = await (await fetch(`${cloudBase}/api/cloud/owner/sync-status`, { headers: authHeader })).json()
    assert.equal(syncStatusRes.installations.length, 1)

    // Backup create + verify + download + path traversal block
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

    // WebSocket /api/cloud/events rejects invalid token & receives live product broadcast on valid token
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

    // Cloud password change -> revokes tok2 -> stale Main PC syncCredentials does NOT overwrite -> Main PC pulls & updates SQLite
    const chPwdRes = await fetch(`${cloudBase}/api/cloud/auth/change-password`, {
      method: 'POST',
      headers: { ...authHeader, 'content-type': 'application/json' },
      body: JSON.stringify({ currentPassword: 'Password!2026', newPassword: 'RemoteNewPassword!2026' }),
    })
    assert.equal(chPwdRes.status, 200)

    // Older remote session tok2 MUST immediately fail with 401
    const oldSessRes = await fetch(`${cloudBase}/api/cloud/auth/me`, { headers: { authorization: `Bearer ${tok2}` } })
    assert.equal(oldSessRes.status, 401)

    // Stale Main PC syncCredentials (still on v1) MUST NOT overwrite cloud v2 password!
    await engine.syncCredentials()
    const cloudReLogin = await fetch(`${cloudBase}/api/cloud/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: ownerUsername, password: 'RemoteNewPassword!2026', shopUuid: db.shopUuid }),
    })
    assert.equal(cloudReLogin.status, 200)

    // Main PC pulls cloud_sync_events -> reconciles user_credential -> local SQLite accepts RemoteNewPassword!2026
    const localOldToken = (await auth.loginWithToken(ownerUsername, 'Password!2026', 'counter-1')).token
    const syncPull = await engine.triggerNow()
    assert.equal(syncPull.synced, true)
    assert.equal(auth.authenticateToken(localOldToken, false), null)
    const { session: localAfter } = await auth.loginWithToken(ownerUsername, 'RemoteNewPassword!2026', 'counter-1')
    assert.equal(localAfter.userId, ownerSession.userId)
  })
})
