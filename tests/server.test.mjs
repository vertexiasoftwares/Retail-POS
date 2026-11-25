import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { createServer } from '../server-dist/server/server.mjs'

test('Vertexia Central Server Foundation', async (t) => {
  const tempDbPath = join(tmpdir(), `vertexia-test-${randomUUID()}.db`)
  let server

  t.afterEach(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    // Clean up temp database and lock
    try {
      if (existsSync(tempDbPath)) unlinkSync(tempDbPath)
      const lockPath = `${tempDbPath}.server.lock`
      if (existsSync(lockPath)) unlinkSync(lockPath)
    } catch {}
  })

  await t.test('initializes and binds to port, serves GET /api/health with database status', async () => {
    server = await createServer({
      port: 0, // Random available port
      host: '127.0.0.1',
      databasePath: tempDbPath,
      logger: false,
    })

    const address = await server.start()
    assert.ok(address.startsWith('http://127.0.0.1:'), `Expected valid address, got: ${address}`)

    const port = server.app.server.address().port
    const response = await fetch(`http://127.0.0.1:${port}/api/health`)
    assert.equal(response.status, 200)

    const health = await response.json()
    assert.equal(health.status, 'ok')
    assert.equal(health.version, '1.0.0')
    assert.equal(health.database.connected, true)
    assert.equal(health.database.path, tempDbPath)
    assert.ok(typeof health.database.businessName === 'string')
    assert.ok(health.uptimeSeconds >= 0)
    assert.equal(health.server.port, 0)
  })

  await t.test('serves production build index.html from dist/ on root and SPA routes', async () => {
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      databasePath: tempDbPath,
      logger: false,
    })

    await server.start()
    const port = server.app.server.address().port

    // Root /
    const rootRes = await fetch(`http://127.0.0.1:${port}/`)
    assert.equal(rootRes.status, 200)
    const rootHtml = await rootRes.text()
    assert.ok(rootHtml.includes('<!doctype html>') || rootHtml.includes('<!DOCTYPE html>'))
    assert.ok(rootHtml.includes('Vertexia') || rootHtml.includes('root'))

    // SPA fallback: /pos
    const spaRes = await fetch(`http://127.0.0.1:${port}/pos`)
    assert.equal(spaRes.status, 200)
    const spaHtml = await spaRes.text()
    assert.ok(spaHtml.includes('<!doctype html>') || spaHtml.includes('<!DOCTYPE html>'))
  })

  await t.test('returns structured JSON 404 for unknown /api/* endpoints', async () => {
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      databasePath: tempDbPath,
      logger: false,
    })

    await server.start()
    const port = server.app.server.address().port

    const res = await fetch(`http://127.0.0.1:${port}/api/nonexistent-action`)
    assert.equal(res.status, 404)
    assert.equal(res.headers.get('content-type')?.includes('application/json'), true)

    const json = await res.json()
    assert.equal(json.error, 'NotFound')
    assert.equal(json.statusCode, 404)
    assert.ok(json.message.includes('/api/nonexistent-action'))
  })

  await t.test('enforces single server instance lock against the same database file', async () => {
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      databasePath: tempDbPath,
      logger: false,
    })

    await server.start()

    // Attempting to create a second server against the same database path must fail
    await assert.rejects(
      async () => {
        const secondServer = await createServer({
          port: 0,
          host: '127.0.0.1',
          databasePath: tempDbPath,
          logger: false,
        })
        await secondServer.start()
      },
      (err) => {
        assert.ok(err instanceof Error)
        assert.ok(err.message.includes('Database is locked by another running Vertexia POS server instance'))
        return true
      }
    )
  })

  await t.test('graceful shutdown releases the lock and database connection cleanly', async () => {
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      databasePath: tempDbPath,
      logger: false,
    })

    await server.start()
    const lockPath = `${tempDbPath}.server.lock`
    assert.equal(existsSync(lockPath), true)

    await server.stop()
    assert.equal(existsSync(lockPath), false)

    // Now a new server can successfully start against the same database
    const newServer = await createServer({
      port: 0,
      host: '127.0.0.1',
      databasePath: tempDbPath,
      logger: false,
    })

    await newServer.start()
    assert.equal(existsSync(lockPath), true)
    await newServer.stop()
    assert.equal(existsSync(lockPath), false)
  })

  await t.test('serves GET /api/system/support-info to any signed-in role including Cashier without exposing sensitive data', async () => {
    server = await createServer({
      port: 0,
      host: '127.0.0.1',
      databasePath: tempDbPath,
      logger: false,
    })

    await server.start()
    const port = server.app.server.address().port
    const baseUrl = `http://127.0.0.1:${port}`

    // Reject unauthenticated call
    const unauth = await fetch(`${baseUrl}/api/system/support-info`)
    assert.equal(unauth.status, 401)

    // Setup owner & sign in
    const setupRes = await fetch(`${baseUrl}/api/auth/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        businessName: 'Al-Madina Mart',
        branchName: 'Main Branch',
        city: 'Lahore',
        ownerName: 'Owner',
        username: 'owner1',
        password: 'StrongPassword!123',
      }),
    })
    assert.equal(setupRes.status, 200)
    const setupData = await setupRes.json()
    const branchId = setupData.session.branchId
    const ownerCookie = setupRes.headers.get('set-cookie')?.split(';')[0] ?? ''
    assert.ok(ownerCookie)

    // Create Cashier account, login, clear temporary password, and fetch support-info as Cashier
    const createCashier = await fetch(`${baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({
        name: 'Bilal Cashier',
        username: 'bilal',
        role: 'Cashier',
        password: 'TempPassword!123',
        branchIds: [branchId],
      }),
    })
    assert.equal(createCashier.status, 200)

    const cashierLogin = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'bilal', password: 'TempPassword!123' }),
    })
    assert.equal(cashierLogin.status, 200)
    let cashierCookie = cashierLogin.headers.get('set-cookie')?.split(';')[0] ?? ''
    assert.ok(cashierCookie)

    const pwChange = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cashierCookie },
      body: JSON.stringify({
        currentPassword: 'TempPassword!123',
        newPassword: 'CashierPass!456',
      }),
    })
    assert.equal(pwChange.status, 200)
    const refreshedCookie = pwChange.headers.get('set-cookie')?.split(';')[0]
    if (refreshedCookie) cashierCookie = refreshedCookie

    const supportRes = await fetch(`${baseUrl}/api/system/support-info`, {
      headers: { cookie: cashierCookie },
    })
    assert.equal(supportRes.status, 200)
    const info = await supportRes.json()
    assert.equal(info.appVersion, '1.0.0')
    assert.equal(info.shopName, 'Al-Madina Mart')
    assert.ok(typeof info.os === 'string' && info.os.length > 0)
    assert.ok(typeof info.databaseSizeBytes === 'number' && info.databaseSizeBytes > 0)
    assert.ok(typeof info.licenseId === 'string' && info.licenseId.length > 0)
    assert.ok(typeof info.deviceId === 'string' && info.deviceId.length > 0)
    assert.equal('password' in info, false)
    assert.equal('sales' in info, false)

    // Cashier cannot update business name or verify settings password
    const cashierUpdate = await fetch(`${baseUrl}/api/auth/update-business`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cashierCookie },
      body: JSON.stringify({ businessName: 'Hijacked', password: 'CashierPass!456' }),
    })
    assert.equal(cashierUpdate.status, 403)

    // Wrong password rejected for Owner
    const badPassUpdate = await fetch(`${baseUrl}/api/auth/update-business`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ businessName: 'New Mart', password: 'WrongPassword!' }),
    })
    assert.equal(badPassUpdate.status, 400)

    // Valid password updates store & branch name and verifies password
    const okVerify = await fetch(`${baseUrl}/api/auth/verify-password`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ password: 'StrongPassword!123' }),
    })
    assert.equal(okVerify.status, 200)

    const okUpdate = await fetch(`${baseUrl}/api/auth/update-business`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ businessName: 'Karachi Super Store', branchName: 'Gulshan Branch', city: 'Karachi', password: 'StrongPassword!123' }),
    })
    assert.equal(okUpdate.status, 200)
    const updatedBody = await okUpdate.json()
    assert.equal(updatedBody.session.businessName, 'Karachi Super Store')
    assert.equal(updatedBody.session.branches[0].name, 'Gulshan Branch')
    assert.equal(updatedBody.session.branches[0].city, 'Karachi')
  })
})
