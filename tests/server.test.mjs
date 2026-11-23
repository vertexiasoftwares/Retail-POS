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
})
