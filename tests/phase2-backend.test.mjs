import assert from 'node:assert/strict'
import { test } from 'node:test'
import { randomUUID } from 'node:crypto'
import { VertexiaDatabase } from '../electron-dist/electron/database/database.mjs'
import { AuthRepository } from '../electron-dist/electron/database/auth.mjs'
import { runWithContext } from '../electron-dist/electron/database/context.mjs'
import { createServer } from '../server-dist/server/server.mjs'

const branchId = 'branch-main'
const ownerPassword = 'Owner password 2026!'
const tempPassword = 'Cashier temp pass 2026!'
const cashierPassword = 'Cashier permanent pass 2026!'

async function createEnv(t) {
  let now = new Date('2026-11-23T10:00:00Z')
  const db = new VertexiaDatabase(':memory:', () => now)
  const auth = new AuthRepository(db.connection, () => now)
  t.after(() => db.close())

  await auth.setup({
    businessName: 'Phase 2 Test Retail',
    branchName: 'Main Karachi',
    city: 'Karachi',
    ownerName: 'Owner Riyaz',
    username: 'owner.test',
    password: ownerPassword,
  })

  return {
    db,
    auth,
    advance: (ms) => {
      now = new Date(now.getTime() + ms)
    },
  }
}

async function createTestCashier(auth, username, name = 'Test Cashier', branchIds = [branchId]) {
  const users = await auth.createUser({
    name,
    username,
    password: tempPassword,
    role: 'Cashier',
    branchIds,
  })
  const user = users.find((u) => u.username === username)
  // Complete initial temporary password requirement for testing
  auth.db.prepare('UPDATE user_credentials SET must_change_password=0 WHERE user_id=?').run(user.id)
  return user
}

async function createTestManager(auth, username, name = 'Test Manager', branchIds = [branchId]) {
  const users = await auth.createUser({
    name,
    username,
    password: tempPassword,
    role: 'Manager',
    branchIds,
  })
  const user = users.find((u) => u.username === username)
  auth.db.prepare('UPDATE user_credentials SET must_change_password=0 WHERE user_id=?').run(user.id)
  return user
}

// -----------------------------------------------------------------------------
// Test Suite A: Authentication Isolation
// -----------------------------------------------------------------------------
test('Phase 2A: Authentication Isolation - Concurrent logins, branch switching, expiry, and credential revocation', async (t) => {
  const { auth, advance } = await createEnv(t)
  const cashierA = await createTestCashier(auth, 'cashier.a', 'Cashier Ali')
  const cashierB = await createTestCashier(auth, 'cashier.b', 'Cashier Bilal')

  // 1. Two users can log in simultaneously
  const { token: tokenA, session: sessionA } = await auth.loginWithToken('cashier.a', tempPassword)
  const { token: tokenB, session: sessionB } = await auth.loginWithToken('cashier.b', tempPassword)

  assert.equal(sessionA.userId, cashierA.id)
  assert.equal(sessionB.userId, cashierB.id)
  assert.notEqual(tokenA, tokenB)

  // 2. Both sessions remain independent
  const authA = auth.authenticateToken(tokenA)
  const authB = auth.authenticateToken(tokenB)
  assert.equal(authA.userId, cashierA.id)
  assert.equal(authB.userId, cashierB.id)

  // 3. Logging out User A does not affect User B
  auth.logoutToken(tokenA)
  assert.equal(auth.authenticateToken(tokenA), null)
  assert.equal(auth.authenticateToken(tokenB).userId, cashierB.id)

  // 4. Invalid tokens are rejected
  assert.equal(auth.authenticateToken('completely-invalid-random-token'), null)
  assert.throws(() => auth.requireToken('completely-invalid-random-token'), /Session expired/)

  // 5. Expired sessions are rejected (idle timeout 30 min)
  advance(31 * 60 * 1000)
  assert.equal(auth.authenticateToken(tokenB), null)
})

// -----------------------------------------------------------------------------
// Test Suite B: Actor Isolation (10+ Concurrent Asynchronous Operations)
// -----------------------------------------------------------------------------
test('Phase 2B: Actor Isolation - 10 concurrent async operations retain correct actor context with zero leaks', async (t) => {
  const { db, auth } = await createEnv(t)

  // Create 10 distinct cashiers
  const cashiers = []
  for (let i = 1; i <= 10; i++) {
    const c = await createTestCashier(auth, `cashier.${i}`, `Cashier ${i}`)
    cashiers.push(c)
  }

  // Interleaved concurrent execution of product creation & audit logging under request context
  const results = await Promise.all(
    cashiers.map(async (cashier, idx) => {
      const context = {
        userId: cashier.id,
        branchId,
        role: 'Cashier',
      }

      return runWithContext(context, async () => {
        // Introduce random async jitter to ensure execution interleaved across ticks
        await new Promise((resolve) => setTimeout(resolve, Math.floor(Math.random() * 20) + 5))

        // Perform product creation inside request context
        const product = db.createPosProduct(branchId, {
          name: `Concurrent Product ${idx + 1}`,
          category: 'Concurrent',
          unit: 'Piece',
          purchasePricePaisa: 5000,
          sellingPricePaisa: 8000,
          openingStockMilli: 10000,
        })

        // Verify that inside the context, getActorId matches exactly this cashier
        assert.equal(db.getActorId(), cashier.id)

        return { cashierId: cashier.id, productId: product.id }
      })
    })
  )

  assert.equal(results.length, 10)

  // Verify that in the database, each audit event and product record has the exact right actor_id
  for (const { cashierId, productId } of results) {
    const audit = db.connection
      .prepare("SELECT user_id FROM audit_events WHERE entity_id=? AND event_type='Product'")
      .get(productId)
    assert.ok(audit, `Audit event for product ${productId} must exist`)
    assert.equal(
      audit.user_id,
      cashierId,
      `Audit record must record actor ${cashierId}, found ${audit.user_id}`
    )
  }
})

// -----------------------------------------------------------------------------
// Test Suite C: Cash Shift Isolation
// -----------------------------------------------------------------------------
test('Phase 2C: Cash Shift Isolation - Multi-cashier shifts at same branch, drawer independence, and RBAC closure', async (t) => {
  const { db, auth } = await createEnv(t)
  const cashierA = await createTestCashier(auth, 'cashier.shift.a', 'Cashier Shift A')
  const cashierB = await createTestCashier(auth, 'cashier.shift.b', 'Cashier Shift B')
  const manager = await createTestManager(auth, 'manager.shift', 'Manager Shift')

  // Create a product for sale
  const product = db.saveProduct(branchId, {
    name: 'Shift Test Item',
    sku: 'SHIFT-ITEM-001',
    category: 'General',
    unit: 'Piece',
    purchasePricePaisa: 5000,
    sellingPricePaisa: 10000,
    mrpPaisa: 12000,
    minimumStockMilli: 0,
    openingStockMilli: 50000,
    status: 'active',
  })

  // 1. Cashier A opens shift at branchId
  const shiftAId = runWithContext(
    { userId: cashierA.id, branchId, role: 'Cashier' },
    () => db.openPosShift(branchId, 10000, randomUUID())
  )

  // 2. Cashier B independently opens shift at same branchId
  const shiftBId = runWithContext(
    { userId: cashierB.id, branchId, role: 'Cashier' },
    () => db.openPosShift(branchId, 20000, randomUUID())
  )

  assert.notEqual(shiftAId, shiftBId)

  // 3. Duplicate open shift by Cashier A at same branch is rejected
  assert.throws(
    () =>
      runWithContext({ userId: cashierA.id, branchId, role: 'Cashier' }, () =>
        db.openPosShift(branchId, 10000, randomUUID())
      ),
    /already open/
  )

  // 4. Cashier A completes a cash sale (credited to Shift A)
  runWithContext({ userId: cashierA.id, branchId, role: 'Cashier' }, () => {
    db.completePosSale({
      branchId,
      operationId: randomUUID(),
      customerId: 'customer-walk-in',
      paymentMethod: 'Cash',
      cashReceivedPaisa: 10000,
      lines: [{ productId: product.id, quantityMilli: 1000, discountBasisPoints: 0 }],
    })
  })

  // 5. Cashier B completes a cash sale (credited to Shift B)
  runWithContext({ userId: cashierB.id, branchId, role: 'Cashier' }, () => {
    db.completePosSale({
      branchId,
      operationId: randomUUID(),
      customerId: 'customer-walk-in',
      paymentMethod: 'Cash',
      cashReceivedPaisa: 20000,
      lines: [{ productId: product.id, quantityMilli: 2000, discountBasisPoints: 0 }],
    })
  })

  // 6. Verify drawer balances are completely independent:
  // Shift A: opening 10000 + sale 10000 = 20000
  // Shift B: opening 20000 + sale 20000 = 40000
  assert.equal(db.cash.expected(shiftAId), 20000)
  assert.equal(db.cash.expected(shiftBId), 40000)

  // 7. Cashier A cannot close Cashier B's shift
  assert.throws(
    () =>
      runWithContext({ userId: cashierA.id, branchId, role: 'Cashier' }, () =>
        db.cash.close({
          branchId,
          operationId: randomUUID(),
          shiftId: shiftBId,
          countedCashPaisa: 40000,
          note: 'Unauthorized close',
        })
      ),
    /own cash shift/
  )

  // 8. Cashier A can close Cashier A's shift
  const closedA = runWithContext(
    { userId: cashierA.id, branchId, role: 'Cashier' },
    () =>
      db.cash.close({
        branchId,
        operationId: randomUUID(),
        shiftId: shiftAId,
        countedCashPaisa: 20000,
        note: 'Closing shift A',
      })
  )
  assert.equal(closedA.status, 'closed')
  assert.equal(closedA.countedCashPaisa, 20000)

  // Shift B remains open!
  const shiftBRecord = db.connection
    .prepare('SELECT status FROM cash_shifts WHERE id=?')
    .get(shiftBId)
  assert.equal(shiftBRecord.status, 'open')

  // 9. Manager CAN close Cashier B's shift
  const closedB = runWithContext(
    { userId: manager.id, branchId, role: 'Manager' },
    () =>
      db.cash.close({
        branchId,
        operationId: randomUUID(),
        shiftId: shiftBId,
        countedCashPaisa: 40000,
        note: 'Manager closing shift B',
      })
  )
  assert.equal(closedB.status, 'closed')
})

// -----------------------------------------------------------------------------
// Test Suite D: Concurrent Stock Checkout
// -----------------------------------------------------------------------------
test('Phase 2D: Concurrent Stock Protection - Exact stock deduction under simultaneous checkout; negative stock impossible', async (t) => {
  const { db, auth } = await createEnv(t)
  const cashierA = await createTestCashier(auth, 'stock.cashier.a', 'Stock Cashier A')
  const cashierB = await createTestCashier(auth, 'stock.cashier.b', 'Stock Cashier B')

  // Create product with EXACTLY 1 unit (1000 milli) of stock
  const product = db.saveProduct(branchId, {
    name: 'Last Remaining Item',
    sku: 'LAST-ITEM-001',
    category: 'Scarcity',
    unit: 'Piece',
    purchasePricePaisa: 10000,
    sellingPricePaisa: 15000,
    mrpPaisa: 18000,
    minimumStockMilli: 0,
    openingStockMilli: 1000, // 1 unit only
    status: 'active',
  })

  // Open shifts for both cashiers
  runWithContext({ userId: cashierA.id, branchId, role: 'Cashier' }, () =>
    db.openPosShift(branchId, 0, randomUUID())
  )
  runWithContext({ userId: cashierB.id, branchId, role: 'Cashier' }, () =>
    db.openPosShift(branchId, 0, randomUUID())
  )

  // Submit two simultaneous checkout requests from two cashiers for 1 unit each
  const checkoutA = async () => {
    return runWithContext({ userId: cashierA.id, branchId, role: 'Cashier' }, async () => {
      return db.completePosSale({
        branchId,
        operationId: randomUUID(),
        customerId: 'customer-walk-in',
        paymentMethod: 'Cash',
        cashReceivedPaisa: 15000,
        lines: [{ productId: product.id, quantityMilli: 1000, discountBasisPoints: 0 }],
      })
    })
  }

  const checkoutB = async () => {
    return runWithContext({ userId: cashierB.id, branchId, role: 'Cashier' }, async () => {
      return db.completePosSale({
        branchId,
        operationId: randomUUID(),
        customerId: 'customer-walk-in',
        paymentMethod: 'Cash',
        cashReceivedPaisa: 15000,
        lines: [{ productId: product.id, quantityMilli: 1000, discountBasisPoints: 0 }],
      })
    })
  }

  const results = await Promise.allSettled([checkoutA(), checkoutB()])

  const fulfilled = results.filter((r) => r.status === 'fulfilled')
  const rejected = results.filter((r) => r.status === 'rejected')

  // Exactly one succeeds, and exactly one fails!
  assert.equal(fulfilled.length, 1, 'Exactly one concurrent checkout must succeed')
  assert.equal(rejected.length, 1, 'The other concurrent checkout must be rejected')
  assert.match(rejected[0].reason.message, /insufficient stock|stock changed/i)

  // Stock level must be exactly 0, NEVER negative
  const stock = db.connection
    .prepare('SELECT quantity_milli FROM stock_levels WHERE product_id=? AND branch_id=?')
    .get(product.id, branchId)
  assert.equal(stock.quantity_milli, 0, 'Remaining stock must be zero')

  // Sales count must be exactly 1
  const salesCount = db.connection
    .prepare('SELECT COUNT(*) as n FROM sales WHERE branch_id=?')
    .get(branchId)
  assert.equal(salesCount.n, 1)

  // Sale items count must be exactly 1
  const itemsCount = db.connection.prepare('SELECT COUNT(*) as n FROM sale_items').get()
  assert.equal(itemsCount.n, 1)
})

// -----------------------------------------------------------------------------
// Test Suite E: Transaction Integrity & Idempotency
// -----------------------------------------------------------------------------
test('Phase 2E: Transaction Integrity - Idempotent replay, sequence uniqueness, and rollback on failure', async (t) => {
  const { db } = await createEnv(t)
  const shiftId = db.openPosShift(branchId, 50000, randomUUID())

  const product = db.saveProduct(branchId, {
    name: 'Integrity Rice',
    sku: 'INT-001',
    category: 'Grains',
    unit: 'Kg',
    purchasePricePaisa: 5000,
    sellingPricePaisa: 8000,
    mrpPaisa: 10000,
    minimumStockMilli: 0,
    openingStockMilli: 100000,
    status: 'active',
  })

  const operationId = 'op-sale-test-idempotency-1234'
  const saleRequest = {
    branchId,
    operationId,
    customerId: 'customer-walk-in',
    paymentMethod: 'Cash',
    cashReceivedPaisa: 8000,
    lines: [{ productId: product.id, quantityMilli: 1000, discountBasisPoints: 0 }],
  }

  // 1. Initial sale succeeds
  const sale1 = db.completePosSale(saleRequest)
  assert.ok(sale1.invoiceNumber)

  // 2. Exact retry returns the exact same result without duplicate stock deduction or invoice
  const sale2 = db.completePosSale(saleRequest)
  assert.equal(sale2.saleId, sale1.saleId)
  assert.equal(sale2.invoiceNumber, sale1.invoiceNumber)

  // Stock deducted only ONCE (100000 - 1000 = 99000)
  const stock = db.connection
    .prepare('SELECT quantity_milli FROM stock_levels WHERE product_id=? AND branch_id=?')
    .get(product.id, branchId)
  assert.equal(stock.quantity_milli, 99000)

  // 3. Different request with same operationId is rejected
  assert.throws(
    () =>
      db.completePosSale({
        ...saleRequest,
        cashReceivedPaisa: 16000,
        lines: [{ productId: product.id, quantityMilli: 2000, discountBasisPoints: 0 }],
      }),
    /already used for a different request/
  )

  // 4. Sequential invoice numbering
  const saleB = db.completePosSale({
    ...saleRequest,
    operationId: 'op-sale-second-operation-5678',
  })
  assert.notEqual(saleB.invoiceNumber, sale1.invoiceNumber)

  // 5. Rollback on failure leaves zero partial database records
  const salesBefore = db.connection.prepare('SELECT COUNT(*) as n FROM sales').get().n
  const movementsBefore = db.connection.prepare('SELECT COUNT(*) as n FROM stock_movements').get().n

  assert.throws(
    () =>
      db.completePosSale({
        branchId,
        operationId: randomUUID(),
        customerId: 'customer-walk-in',
        paymentMethod: 'Cash',
        cashReceivedPaisa: 5000, // Less than total
        lines: [{ productId: product.id, quantityMilli: 1000, discountBasisPoints: 0 }],
      }),
    /Cash received is less/
  )

  assert.equal(db.connection.prepare('SELECT COUNT(*) as n FROM sales').get().n, salesBefore)
  assert.equal(db.connection.prepare('SELECT COUNT(*) as n FROM stock_movements').get().n, movementsBefore)
})

// -----------------------------------------------------------------------------
// Test Suite F: Fastify Authentication, Cookies & Security Endpoints
// -----------------------------------------------------------------------------
test('Phase 2F: Fastify Authentication API - Login cookie, status, branch selection, and logout', async (t) => {
  const { db, auth } = await createEnv(t)
  const cashier = await createTestCashier(auth, 'cashier.http', 'HTTP Cashier')

  // Create second branch for branch selection testing
  db.connection
    .prepare("INSERT INTO branches VALUES ('branch-karachi-2', ?, 'Second Branch', 'SUB2', 'Karachi', 1, '2026-11-23')")
    .run(db.businessId)
  db.connection
    .prepare('INSERT INTO user_branches VALUES (?, ?)')
    .run(cashier.id, 'branch-karachi-2')

  const server = await createServer({
    database: db,
    auth,
    port: 0,
    host: '127.0.0.1',
    logger: false,
  })
  t.after(() => server.stop())

  // 1. Unauthenticated status returns session: null
  const statusBefore = await server.app.inject({
    method: 'GET',
    url: '/api/auth/status',
  })
  assert.equal(statusBefore.statusCode, 200)
  assert.equal(JSON.parse(statusBefore.payload).session, null)

  // 2. Cross-origin request with hostile origin is blocked
  const hostileLogin = await server.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: {
      origin: 'https://evil-attacker.com',
      host: 'localhost:8080',
    },
    payload: {
      username: 'cashier.http',
      password: tempPassword,
    },
  })
  assert.equal(hostileLogin.statusCode, 403)

  // 3. Invalid credentials return 401
  const badLogin = await server.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { host: 'localhost:8080' },
    payload: {
      username: 'cashier.http',
      password: 'wrong-password',
    },
  })
  assert.equal(badLogin.statusCode, 401)

  // 4. Successful login returns safe session and sets HttpOnly cookie
  const loginRes = await server.app.inject({
    method: 'POST',
    url: '/api/auth/login',
    headers: { host: 'localhost:8080' },
    payload: {
      username: 'cashier.http',
      password: tempPassword,
    },
  })
  assert.equal(loginRes.statusCode, 200)
  const loginBody = JSON.parse(loginRes.payload)
  assert.equal(loginBody.ok, true)
  assert.equal(loginBody.session.username, 'cashier.http')
  assert.equal(loginBody.session.userId, cashier.id)
  assert.equal(loginBody.session.sessionToken, undefined, 'Raw token must never leak into session body')

  const setCookieHeader = loginRes.headers['set-cookie']
  assert.ok(setCookieHeader, 'Set-Cookie header must be present')
  assert.match(setCookieHeader, /vertexia_session=/)
  assert.match(setCookieHeader, /HttpOnly/)
  assert.match(setCookieHeader, /SameSite=Lax/)

  // Extract raw cookie string to pass in subsequent requests
  const sessionCookie = setCookieHeader.split(';')[0]

  // 5. GET /api/auth/status with valid cookie returns active authenticated session
  const statusAfter = await server.app.inject({
    method: 'GET',
    url: '/api/auth/status',
    headers: {
      cookie: sessionCookie,
      host: 'localhost:8080',
    },
  })
  assert.equal(statusAfter.statusCode, 200)
  const statusBody = JSON.parse(statusAfter.payload)
  assert.ok(statusBody.session)
  assert.equal(statusBody.session.username, 'cashier.http')
  assert.equal(statusBody.session.branchId, branchId)

  // 6. POST /api/auth/select-branch updates branch for this session
  const branchRes = await server.app.inject({
    method: 'POST',
    url: '/api/auth/select-branch',
    headers: {
      cookie: sessionCookie,
      host: 'localhost:8080',
    },
    payload: {
      branchId: 'branch-karachi-2',
    },
  })
  assert.equal(branchRes.statusCode, 200)
  const branchBody = JSON.parse(branchRes.payload)
  assert.equal(branchBody.session.branchId, 'branch-karachi-2')

  // Verify status now reports branch-karachi-2
  const statusBranchUpdated = await server.app.inject({
    method: 'GET',
    url: '/api/auth/status',
    headers: {
      cookie: sessionCookie,
      host: 'localhost:8080',
    },
  })
  assert.equal(JSON.parse(statusBranchUpdated.payload).session.branchId, 'branch-karachi-2')

  // 7. POST /api/auth/logout invalidates session and clears cookie
  const logoutRes = await server.app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: {
      cookie: sessionCookie,
      host: 'localhost:8080',
    },
  })
  assert.equal(logoutRes.statusCode, 200)
  assert.match(logoutRes.headers['set-cookie'], /Max-Age=0/)

  // Status with old cookie now returns session: null
  const statusAfterLogout = await server.app.inject({
    method: 'GET',
    url: '/api/auth/status',
    headers: {
      cookie: sessionCookie,
      host: 'localhost:8080',
    },
  })
  assert.equal(JSON.parse(statusAfterLogout.payload).session, null)
})
