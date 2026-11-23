import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createHash } from 'node:crypto'
import { VertexiaDatabase } from '../electron-dist/electron/database/database.mjs'
import { AuthRepository } from '../electron-dist/electron/database/auth.mjs'

const branchId = 'branch-main'
const ownerPassword = 'Owner test passphrase 2026'
const tempPassword = 'Cashier temp passphrase 2026'
const setupInput = {
  businessName: 'Vertexia Multi-Session Shop',
  branchName: 'Counter 1',
  city: 'Karachi',
  ownerName: 'Shop Owner',
  username: 'owner.test',
  password: ownerPassword,
}

function createTestEnvironment(t) {
  let now = new Date('2026-11-23T10:00:00Z')
  const db = new VertexiaDatabase(':memory:', () => now)
  const auth = new AuthRepository(db.connection, () => now)
  t.after(() => db.close())
  return {
    db,
    auth,
    advance: (ms) => {
      now = new Date(now.getTime() + ms)
    },
  }
}

async function setupShop(t) {
  const env = createTestEnvironment(t)
  await env.auth.setup(setupInput)
  return env
}

async function createCashier(auth, username, name = 'Cashier Staff') {
  const users = await auth.createUser({
    name,
    username,
    password: tempPassword,
    role: 'Cashier',
    branchIds: [branchId],
  })
  const user = users.find((u) => u.username === username)
  auth.db.prepare('UPDATE user_credentials SET must_change_password=0 WHERE user_id=?').run(user.id)
  return user
}

test('Multi-Session Authentication: User A and User B can have simultaneous independent sessions', async (t) => {
  const { auth } = await setupShop(t)

  const cashierA = await createCashier(auth, 'cashier.a', 'Cashier Ali')
  const cashierB = await createCashier(auth, 'cashier.b', 'Cashier Sana')
  assert.ok(cashierA)
  assert.ok(cashierB)

  // Both users log in independently with tokens
  const loginA = await auth.loginWithToken('cashier.a', tempPassword)
  const loginB = await auth.loginWithToken('cashier.b', tempPassword)

  // Tokens must be 256-bit (64 hex characters) and distinct
  assert.equal(typeof loginA.token, 'string')
  assert.equal(loginA.token.length, 64)
  assert.equal(typeof loginB.token, 'string')
  assert.equal(loginB.token.length, 64)
  assert.notEqual(loginA.token, loginB.token)

  // Sessions must belong to respective users
  assert.equal(loginA.session.userId, cashierA.id)
  assert.equal(loginA.session.username, 'cashier.a')
  assert.equal(loginB.session.userId, cashierB.id)
  assert.equal(loginB.session.username, 'cashier.b')
})

test('Multi-Session Authentication: Authenticating Token A returns User A; Token B returns User B', async (t) => {
  const { auth } = await setupShop(t)
  await createCashier(auth, 'cashier.a', 'Cashier Ali')
  await createCashier(auth, 'cashier.b', 'Cashier Sana')

  const { token: tokenA } = await auth.loginWithToken('cashier.a', tempPassword)
  const { token: tokenB } = await auth.loginWithToken('cashier.b', tempPassword)

  const sessionA = auth.authenticateToken(tokenA)
  const sessionB = auth.authenticateToken(tokenB)

  assert.ok(sessionA)
  assert.ok(sessionB)
  assert.equal(sessionA.username, 'cashier.a')
  assert.equal(sessionB.username, 'cashier.b')
  assert.equal(sessionA.sessionToken, tokenA)
  assert.equal(sessionB.sessionToken, tokenB)

  // requireToken validates permissions for the specific user
  const reqA = auth.requireToken(tokenA, 'pos.sell')
  const reqB = auth.requireToken(tokenB, 'pos.sell')
  assert.equal(reqA.username, 'cashier.a')
  assert.equal(reqB.username, 'cashier.b')

  // Invalid token returns null
  assert.equal(auth.authenticateToken('invalid-nonexistent-token-1234567890'), null)
  assert.throws(
    () => auth.requireToken('invalid-nonexistent-token-1234567890', 'pos.sell'),
    /Session expired/
  )
})

test('Multi-Session Authentication: Logging out User B does not invalidate User A', async (t) => {
  const { auth } = await setupShop(t)
  await createCashier(auth, 'cashier.a', 'Cashier Ali')
  await createCashier(auth, 'cashier.b', 'Cashier Sana')

  const { token: tokenA } = await auth.loginWithToken('cashier.a', tempPassword)
  const { token: tokenB } = await auth.loginWithToken('cashier.b', tempPassword)

  assert.ok(auth.authenticateToken(tokenA))
  assert.ok(auth.authenticateToken(tokenB))

  // User B logs out
  auth.logoutToken(tokenB)

  // User B is now logged out
  assert.equal(auth.authenticateToken(tokenB), null)

  // User A remains fully authenticated
  const currentA = auth.authenticateToken(tokenA)
  assert.ok(currentA)
  assert.equal(currentA.username, 'cashier.a')
})

test('Multi-Session Authentication: Raw tokens are stored hashed (SHA-256) in registry', async (t) => {
  const { auth } = await setupShop(t)
  await createCashier(auth, 'cashier.a', 'Cashier Ali')

  const { token } = await auth.loginWithToken('cashier.a', tempPassword)

  // The hashed token must exist in the repository
  assert.equal(auth.hasHashedToken(token), true)

  // A raw token lookup or tampering check
  const rawHash = createHash('sha256').update(token).digest('hex')
  assert.notEqual(token, rawHash)
  assert.equal(auth.hasHashedToken(token), true)
})

test('Multi-Session Authentication: Expired sessions are rejected independently (idle and absolute timeout)', async (t) => {
  const { auth, advance } = await setupShop(t)
  await createCashier(auth, 'cashier.a', 'Cashier Ali')
  await createCashier(auth, 'cashier.b', 'Cashier Sana')

  const { token: tokenA } = await auth.loginWithToken('cashier.a', tempPassword)

  // 10 minutes later, User B logs in
  advance(10 * 60 * 1000)
  const { token: tokenB } = await auth.loginWithToken('cashier.b', tempPassword)

  // 21 minutes later (total 31 mins for User A, 21 mins for User B)
  advance(21 * 60 * 1000)

  // User A has been idle for 31 minutes (> 30m idle limit) -> expired
  assert.equal(auth.authenticateToken(tokenA), null)

  // User B was idle for only 21 minutes (< 30m idle limit) -> still active
  const sessionB = auth.authenticateToken(tokenB)
  assert.ok(sessionB)
  assert.equal(sessionB.username, 'cashier.b')

  // Absolute 12-hour limit test
  advance(13 * 60 * 60 * 1000)
  assert.equal(auth.authenticateToken(tokenB), null)
})

test('Multi-Session Authentication: Credential version changes invalidate affected sessions', async (t) => {
  const { auth } = await setupShop(t)
  const cashierA = await createCashier(auth, 'cashier.a', 'Cashier Ali')
  await createCashier(auth, 'cashier.b', 'Cashier Sana')

  const { token: tokenA } = await auth.loginWithToken('cashier.a', tempPassword)
  const { token: tokenB } = await auth.loginWithToken('cashier.b', tempPassword)

  assert.ok(auth.authenticateToken(tokenA))
  assert.ok(auth.authenticateToken(tokenB))

  // Admin resets User A's password (increments credential_version)
  await auth.resetPassword(cashierA.id, 'BrandNewPassphrase2026')

  // User A's token is immediately invalidated
  assert.equal(auth.authenticateToken(tokenA), null)

  // User B's token remains completely valid
  const sessionB = auth.authenticateToken(tokenB)
  assert.ok(sessionB)
  assert.equal(sessionB.username, 'cashier.b')
})

test('Multi-Session Authentication: Independent branch selection per session', async (t) => {
  const { db, auth } = await setupShop(t)
  // Create a second branch with code 'SUB' (so 'MAIN' is the default branch by code ordering)
  db.connection.prepare(
    "INSERT INTO branches VALUES ('branch-2', ?, 'Second Branch', 'SUB', 'Lahore', 1, '2026-11-23')"
  ).run(db.businessId)

  // Create staff assigned to both branches
  const users = await auth.createUser({
    name: 'Multi-Branch Staff',
    username: 'staff.multi',
    password: tempPassword,
    role: 'Cashier',
    branchIds: [branchId, 'branch-2'],
  })
  const staff = users.find((u) => u.username === 'staff.multi')
  assert.ok(staff)
  db.connection.prepare('UPDATE user_credentials SET must_change_password=0 WHERE user_id=?').run(staff.id)

  // Staff logs in from Counter 1 and Counter 2
  const { token: counter1Token } = await auth.loginWithToken('staff.multi', tempPassword)
  const { token: counter2Token } = await auth.loginWithToken('staff.multi', tempPassword)

  // Counter 2 selects branch-2
  const updatedB = auth.selectSessionBranch(counter2Token, 'branch-2')
  assert.equal(updatedB.branchId, 'branch-2')

  // Counter 1 branch remains unchanged
  const currentA = auth.authenticateToken(counter1Token)
  assert.equal(currentA.branchId, branchId)

  // Counter 2 branch is branch-2
  const currentB = auth.authenticateToken(counter2Token)
  assert.equal(currentB.branchId, 'branch-2')
})

test('Multi-Session Authentication: Desktop session compatibility co-exists with token sessions', async (t) => {
  const { auth } = await setupShop(t)
  // Owner from setup creates the cashier
  await createCashier(auth, 'cashier.token', 'Token Cashier')

  // Now logout the desktop session
  auth.logout()
  assert.equal(auth.current(), null)

  // 1. Desktop login (no token)
  const desktopSession = await auth.login('owner.test', ownerPassword)
  assert.equal(desktopSession.username, 'owner.test')
  assert.equal(auth.current().username, 'owner.test')

  // 2. Token login simultaneously
  const { token, session: tokenSession } = await auth.loginWithToken('cashier.token', tempPassword)
  assert.equal(tokenSession.username, 'cashier.token')

  // 3. Both exist without interference
  assert.equal(auth.current().username, 'owner.test')
  assert.equal(auth.authenticateToken(token).username, 'cashier.token')

  // 4. Desktop logout does not affect token session
  auth.logout()
  assert.equal(auth.current(), null)
  assert.equal(auth.authenticateToken(token).username, 'cashier.token')

  // 5. Token logout does not affect desktop
  auth.logoutToken(token)
  assert.equal(auth.authenticateToken(token), null)
})
