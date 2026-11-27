import assert from 'node:assert/strict'
import { test } from 'node:test'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { existsSync, unlinkSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { createServer } from '../server-dist/server/server.mjs'

function extractCookie(res, name) {
  const header = res.headers.get('set-cookie') || ''
  for (const part of header.split(',')) {
    const first = part.split(';')[0].trim()
    if (first.startsWith(`${name}=`)) return first
  }
  return ''
}

test('Phase 3: 20-counter pairing, concurrent stock race, persistent sessions, revocation & 10k SKU benchmark', async (t) => {
  const tempDbPath = join(tmpdir(), `vertexia-mc-${randomUUID()}.db`)
  let server = await createServer({
    port: 0,
    host: '127.0.0.1',
    databasePath: tempDbPath,
    logger: false,
  })

  t.after(async () => {
    if (server) {
      await server.stop()
      server = null
    }
    for (const p of [tempDbPath, `${tempDbPath}.server.lock`, `${tempDbPath}-wal`, `${tempDbPath}-shm`]) {
      try {
        if (existsSync(p)) unlinkSync(p)
      } catch {}
    }
  })

  await server.start()
  let port = server.app.server.address().port
  let baseUrl = `http://127.0.0.1:${port}`

  // 1. Setup owner
  const setupRes = await fetch(`${baseUrl}/api/auth/setup`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      businessName: 'Mega Supermart',
      branchName: 'Main Hall',
      city: 'Lahore',
      ownerName: 'Tariq Owner',
      username: 'tariq.owner',
      password: 'OwnerPass!2026',
    }),
  })
  assert.equal(setupRes.status, 200)
  const setupJson = await setupRes.json()
  const branchId = setupJson.session.branchId
  const ownerCookie = extractCookie(setupRes, 'vertexia_session')
  assert.ok(ownerCookie)

  // 2. Pair counters 2..20 (total 20 counters including Counter 1), verify 21st counter rejected
  const counterCookies = new Map() // counterNumber -> { counterId, deviceCookie, cashierCookie }
  for (let n = 2; n <= 20; n++) {
    const codeRes = await fetch(`${baseUrl}/api/counters/pair-code`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({ counterNumber: n, name: `Lane ${n}`, branchId }),
    })
    assert.equal(codeRes.status, 200, `Pairing code generation failed for Counter ${n}`)
    const codeJson = await codeRes.json()

    const completeRes = await fetch(`${baseUrl}/api/counters/complete-pairing`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pairingCode: codeJson.pairingCode, deviceFingerprint: `pc-lane-${n}`, appVersion: '1.0.0' }),
    })
    assert.equal(completeRes.status, 200, `Pairing completion failed for Counter ${n}`)
    const deviceCookie = extractCookie(completeRes, 'vertexia_counter_device')
    assert.ok(deviceCookie, `Counter ${n} must receive HttpOnly device cookie`)
    const compJson = await completeRes.json()
    counterCookies.set(n, { counterId: compJson.counter.id, deviceCookie })
  }

  const overflowRes = await fetch(`${baseUrl}/api/counters/pair-code`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ name: 'Counter 21', branchId }),
  })
  assert.equal(overflowRes.status, 400)
  const overflowErr = await overflowRes.json()
  assert.match(overflowErr.message, /Maximum 20 counters/)

  // 3. Create 20 cashier accounts & open shifts on all 20 counters
  for (let n = 1; n <= 20; n++) {
    const uname = `cashier${n}`
    const uRes = await fetch(`${baseUrl}/api/auth/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: ownerCookie },
      body: JSON.stringify({
        name: `Cashier ${n}`,
        username: uname,
        role: 'Cashier',
        password: 'TempPass!2026',
        branchIds: [branchId],
      }),
    })
    assert.equal(uRes.status, 200)

    const devCookie = n === 1 ? '' : counterCookies.get(n).deviceCookie
    const loginRes = await fetch(`${baseUrl}/api/auth/login`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(devCookie ? { cookie: devCookie } : {}),
      },
      body: JSON.stringify({ username: uname, password: 'TempPass!2026' }),
    })
    assert.equal(loginRes.status, 200)
    let sessionCookie = extractCookie(loginRes, 'vertexia_session')

    const pwRes = await fetch(`${baseUrl}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: [devCookie, sessionCookie].filter(Boolean).join('; '),
      },
      body: JSON.stringify({ currentPassword: 'TempPass!2026', newPassword: `CashierPass${n}!2026` }),
    })
    assert.equal(pwRes.status, 200)
    const refreshed = extractCookie(pwRes, 'vertexia_session')
    if (refreshed) sessionCookie = refreshed

    const openShiftRes = await fetch(`${baseUrl}/api/pos/open-shift`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: [devCookie, sessionCookie].filter(Boolean).join('; '),
      },
      body: JSON.stringify({ branchId, openingCashPaisa: 100000, operationId: `open-shift-${n}` }),
    })
    assert.equal(openShiftRes.status, 200, `Counter ${n} failed to open shift`)
    if (n === 1) {
      counterCookies.set(1, { counterId: 'counter-1', deviceCookie: '', sessionCookie })
    } else {
      counterCookies.get(n).sessionCookie = sessionCookie
    }
  }

  // 4. Create scarce product with ONLY 5 units in stock, then race ALL 20 counters simultaneously!
  const prodRes = await fetch(`${baseUrl}/api/products/save`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({
      branchId,
      input: {
        name: 'Scarce Cooking Oil 5L',
        sku: 'SCARCE-OIL-5',
        barcode: '8964009990001',
        category: 'Grocery',
        subcategory: 'Oil',
        brand: 'Dalda',
        unit: 'Piece',
        purchasePricePaisa: 200000,
        sellingPricePaisa: 250000,
        mrpPaisa: 260000,
        minimumStockMilli: 1000,
        openingStockMilli: 5000, // 5 units!
        status: 'active',
        imageDataUrl: null,
      },
    }),
  })
  assert.equal(prodRes.status, 200)
  const scarceProd = await prodRes.json()

  const racePromises = Array.from({ length: 20 }, (_, i) => {
    const n = i + 1
    const c = counterCookies.get(n)
    return fetch(`${baseUrl}/api/pos/sale`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: [c.deviceCookie, c.sessionCookie].filter(Boolean).join('; '),
      },
      body: JSON.stringify({
        operationId: 'same-client-op-id', // Even with identical client opId, server scopes per user+counter!
        branchId,
        customerId: 'customer-walk-in',
        lines: [{ productId: scarceProd.id, quantityMilli: 1000, discountBasisPoints: 0 }],
        paymentMethod: 'Cash',
        cashReceivedPaisa: 250000,
      }),
    }).then(async r => ({ n, status: r.status, body: await r.json() }))
  })

  const raceResults = await Promise.all(racePromises)
  const succeeded = raceResults.filter(r => r.status === 200)
  const rejected = raceResults.filter(r => r.status !== 200)
  assert.equal(succeeded.length, 5, 'Exactly 5 counters may succeed for 5 units of stock (zero oversell)')
  assert.equal(rejected.length, 15, 'Remaining 15 counters must receive stock exhaustion error')

  // Verify unique invoice numbers across winners
  const invoiceSet = new Set(succeeded.map(s => s.body.invoiceNumber))
  assert.equal(invoiceSet.size, 5, 'Every winning sale must receive a unique invoice number')

  // Verify stock level is strictly 0 (never negative)
  const stockRow = server.database.connection
    .prepare('SELECT quantity_milli FROM stock_levels WHERE branch_id=? AND product_id=?')
    .get(branchId, scarceProd.id)
  assert.equal(Number(stockRow.quantity_milli), 0)

  // 5. Idempotency replay test on winning Counter #1
  const winner = succeeded[0]
  const winnerCtx = counterCookies.get(winner.n)
  const replayRes = await fetch(`${baseUrl}/api/pos/sale`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      cookie: [winnerCtx.deviceCookie, winnerCtx.sessionCookie].filter(Boolean).join('; '),
    },
    body: JSON.stringify({
      operationId: 'same-client-op-id',
      branchId,
      customerId: 'customer-walk-in',
      lines: [{ productId: scarceProd.id, quantityMilli: 1000, discountBasisPoints: 0 }],
      paymentMethod: 'Cash',
      cashReceivedPaisa: 250000,
    }),
  })
  assert.equal(replayRes.status, 200)
  const replayBody = await replayRes.json()
  assert.equal(replayBody.saleId, winner.body.saleId, 'Retry must replay exact committed sale without deducting stock again')

  // 6. Report breakdown by counter (`byCounter`)
  const todayStr = server.database.connection.prepare('SELECT business_date FROM sales ORDER BY completed_at DESC LIMIT 1').get().business_date
  const repRes = await fetch(`${baseUrl}/api/reports/snapshot`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({ branchId, dateFrom: todayStr, dateTo: todayStr, section: 'sales', page: 1, pageSize: 25 }),
  })
  assert.equal(repRes.status, 200)
  const repJson = await repRes.json()
  assert.ok(Array.isArray(repJson.byCounter) && repJson.byCounter.length === 5, 'Report must break down sales across all 5 winning counters')

  // 7. Revoke Counter 20 & verify immediate 403 rejection
  const c20 = counterCookies.get(20)
  const revokeRes = await fetch(`${baseUrl}/api/counters/${encodeURIComponent(c20.counterId)}/revoke`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: ownerCookie },
    body: JSON.stringify({}),
  })
  assert.equal(revokeRes.status, 200)

  const revokedStatusRes = await fetch(`${baseUrl}/api/pos/bootstrap?branchId=${encodeURIComponent(branchId)}`, {
    headers: { cookie: [c20.deviceCookie, c20.sessionCookie].filter(Boolean).join('; ') },
  })
  assert.equal(revokedStatusRes.status, 403)
  const revokedErr = await revokedStatusRes.json()
  assert.equal(revokedErr.error, 'CounterRevoked')

  // 8. Persistent auth_sessions across full Fastify server restart
  await server.stop()
  server = await createServer({
    port: 0,
    host: '127.0.0.1',
    databasePath: tempDbPath,
    logger: false,
  })
  await server.start()
  port = server.app.server.address().port
  baseUrl = `http://127.0.0.1:${port}`

  const c2 = counterCookies.get(2)
  const survivedAuthRes = await fetch(`${baseUrl}/api/auth/status`, {
    headers: { cookie: [c2.deviceCookie, c2.sessionCookie].filter(Boolean).join('; ') },
  })
  assert.equal(survivedAuthRes.status, 200)
  const survivedAuth = await survivedAuthRes.json()
  assert.ok(survivedAuth.session && survivedAuth.session.username === 'cashier2', 'Session must survive server restart cleanly')

  // 9. Benchmark 10,000 SKUs & measure delta + concurrent checkout p95 latency
  const rawDb = server.database.connection
  const bizId = server.database.businessId
  const nowIso = new Date().toISOString()
  rawDb.exec('BEGIN IMMEDIATE')
  const insProd = rawDb.prepare(
    `INSERT INTO products(id,business_id,sku,barcode,name,category,brand,unit,visual_kind,purchase_price_paisa,selling_price_paisa,minimum_stock_milli,is_active,created_at,updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  )
  const insStock = rawDb.prepare('INSERT INTO stock_levels(branch_id,product_id,quantity_milli,updated_at) VALUES (?,?,?,?)')
  const insVal = rawDb.prepare('INSERT INTO stock_values(branch_id,product_id,total_cost_paisa,estimated,updated_at) VALUES (?,?,?,0,?)')
  for (let i = 1; i <= 10_000; i++) {
    const pid = `sku-bench-${i}`
    insProd.run(pid, bizId, `SKU-${i}`, `890000${String(i).padStart(7, '0')}`, `Bench Item ${i}`, 'Grocery', 'Bench', 'Piece', 'box', 5000, 7500, 1000, 1, nowIso, nowIso)
    insStock.run(branchId, pid, 100_000, nowIso)
    insVal.run(branchId, pid, 500_000, nowIso)
  }
  rawDb.exec('COMMIT')

  const deltaStart = performance.now()
  const deltaRes = await fetch(`${baseUrl}/api/pos/delta?branchId=${encodeURIComponent(branchId)}&since=${encodeURIComponent(nowIso)}`, {
    headers: { cookie: ownerCookie },
  })
  assert.equal(deltaRes.status, 200)
  const deltaMs = performance.now() - deltaStart
  const deltaJson = await deltaRes.json()
  assert.ok(deltaJson.products.length >= 10_000)

  const latencies = []
  const batchSales = []
  for (let i = 2; i <= 11; i++) {
    const c = counterCookies.get(i)
    const t0 = performance.now()
    batchSales.push(
      fetch(`${baseUrl}/api/pos/sale`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: [c.deviceCookie, c.sessionCookie].filter(Boolean).join('; ') },
        body: JSON.stringify({
          operationId: `bench-sale-${i}`,
          branchId,
          customerId: 'customer-walk-in',
          lines: [{ productId: `sku-bench-${i * 100}`, quantityMilli: 1000, discountBasisPoints: 0 }],
          paymentMethod: 'Cash',
          cashReceivedPaisa: 7500,
        }),
      }).then(res => {
        latencies.push(performance.now() - t0)
        return res.status
      }),
    )
  }
  const benchStatuses = await Promise.all(batchSales)
  assert.ok(benchStatuses.every(s => s === 200))
  latencies.sort((a, b) => a - b)
  const p95 = latencies[Math.min(latencies.length - 1, Math.floor(latencies.length * 0.95))]
  console.log(`[Benchmark 10k SKUs] deltaLoad=${deltaMs.toFixed(1)}ms, 10-counter concurrent checkout p95=${p95.toFixed(1)}ms`)
  assert.ok(p95 < 2000, `Checkout p95 latency unexpectedly high: ${p95}ms`)
})
