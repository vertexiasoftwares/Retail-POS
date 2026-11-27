import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { isUserRole, rolePermissions } from '../../src/shared/auth-policy.js'
import type { Permission, UserRole } from '../../src/types/auth.js'
import type { CloudEnvConfig } from '../config/env.mjs'
import { CLOUD_COLLECTIONS, normalizeShopUuid, type MongoCloudStore } from '../db/mongo-store.mjs'

const HASH_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }
const DUMMY_HASH = `scrypt-v1$${'00'.repeat(16)}$${'00'.repeat(64)}`
const CLOUD_SESSION_TTL_MS = 12 * 60 * 60 * 1000
const HMAC_MAX_SKEW_MS = 5 * 60 * 1000
const MAX_SCRYPT_CONCURRENCY = 2
const AUTH_RATE_WINDOW_MS = 5 * 60 * 1000
const AUTH_RATE_MAX_FAILURES = 20

const authFailures = new Map<string, { count: number; resetAt: number }>()

export function resetCloudAuthRateLimits(): void {
  authFailures.clear()
}

function getAuthThrottleRemainingMs(key: string): number {
  const entry = authFailures.get(key)
  if (!entry) return 0
  const now = Date.now()
  if (now >= entry.resetAt) {
    authFailures.delete(key)
    return 0
  }
  return entry.count >= AUTH_RATE_MAX_FAILURES ? entry.resetAt - now : 0
}

function recordAuthFailure(key: string): void {
  const now = Date.now()
  const existing = authFailures.get(key)
  if (!existing || now >= existing.resetAt) {
    authFailures.set(key, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS })
  } else {
    existing.count += 1
  }
}

function clearAuthFailures(key: string): void {
  authFailures.delete(key)
}

let activeScrypt = 0
const scryptQueue: Array<() => void> = []

async function boundedScrypt(value: string, saltHex: string): Promise<Buffer> {
  if (activeScrypt >= MAX_SCRYPT_CONCURRENCY) {
    await new Promise<void>(resolve => scryptQueue.push(resolve))
  }
  activeScrypt += 1
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(value, Buffer.from(saltHex, 'hex'), 64, HASH_OPTIONS, (err, key) => {
        if (err) reject(err)
        else resolve(key)
      })
    })
  } finally {
    activeScrypt -= 1
    const next = scryptQueue.shift()
    if (next) next()
  }
}

export async function verifyScryptPassword(secret: string, encoded: string): Promise<boolean> {
  const valid = /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{128}$/.test(encoded)
  const [, salt, expectedHex] = (valid ? encoded : DUMMY_HASH).split('$')
  const actual = await boundedScrypt(secret, salt)
  return timingSafeEqual(actual, Buffer.from(expectedHex, 'hex')) && valid
}

export async function hashScryptPassword(secret: string): Promise<string> {
  const salt = randomBytes(16).toString('hex')
  const derived = await boundedScrypt(secret, salt)
  return `scrypt-v1$${salt}$${derived.toString('hex')}`
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

export interface CloudOwnerSession {
  userId: string
  shopUuid: string
  branchId: string
  shopName?: string
  username: string
  name: string
  role: UserRole
  permissions: Permission[]
  credentialVersion: number
}

export function signNodePayload(secret: string, shopUuid: string, timestamp: string, rawBody: string): string {
  return createHmac('sha256', secret).update(`${shopUuid}|${timestamp}|${rawBody}`).digest('hex')
}

export async function verifyNodeHmac(
  request: FastifyRequest,
  reply: FastifyReply,
  config: CloudEnvConfig,
  store: MongoCloudStore,
  allowBootstrapSecret = false,
): Promise<{ shopUuid: string; nodeId: string } | null> {
  const shopHeader = String(request.headers['x-vertexia-shop-uuid'] || '')
  const nodeHeader = String(request.headers['x-vertexia-node-id'] || '')
  const tsHeader = String(request.headers['x-vertexia-timestamp'] || '')
  const sigHeader = String(request.headers['x-vertexia-signature'] || '').toLowerCase()

  if (!shopHeader || !nodeHeader || !tsHeader || !/^[a-f0-9]{64}$/.test(sigHeader)) {
    reply.status(401).send({ error: 'UnauthorizedNode', message: 'Missing node HMAC headers.', statusCode: 401 })
    return null
  }

  let shopUuid: string
  try {
    shopUuid = normalizeShopUuid(shopHeader)
  } catch {
    reply.status(400).send({ error: 'InvalidShopUuid', message: 'Invalid shop identifier.', statusCode: 400 })
    return null
  }

  const tsMs = Number(tsHeader)
  if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > HMAC_MAX_SKEW_MS) {
    reply.status(401).send({ error: 'ReplayRejected', message: 'Node timestamp outside valid window.', statusCode: 401 })
    return null
  }

  const rawBody =
    typeof (request as any).rawBody === 'string'
      ? (request as any).rawBody
      : request.body !== undefined
        ? JSON.stringify(request.body)
        : ''

  if (!allowBootstrapSecret) {
    const inst = await store.col(CLOUD_COLLECTIONS.installations).findOne({
      nodeId: nodeHeader,
      shopUuid,
    })
    if (!inst || inst.status !== 'active') {
      reply.status(403).send({ error: 'NodeRevoked', message: 'Node registration is inactive or revoked.', statusCode: 403 })
      return null
    }
  }

  const expectedSig = signNodePayload(config.nodeHmacSecret, shopUuid, tsHeader, rawBody)
  if (!timingSafeEqual(Buffer.from(expectedSig, 'hex'), Buffer.from(sigHeader, 'hex'))) {
    reply.status(401).send({ error: 'InvalidHmacSignature', message: 'Node signature verification failed.', statusCode: 401 })
    return null
  }

  return { shopUuid, nodeId: nodeHeader }
}

export function extractBearerToken(request: FastifyRequest): string | null {
  const authHeader = request.headers.authorization
  if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) {
    const tok = authHeader.slice(7).trim()
    if (tok) return tok
  }
  const cookieHeader = request.headers.cookie
  if (cookieHeader) {
    for (const part of cookieHeader.split(';')) {
      const idx = part.indexOf('=')
      if (idx < 0) continue
      if (part.slice(0, idx).trim() === 'vertexia_cloud_session') {
        return decodeURIComponent(part.slice(idx + 1).trim())
      }
    }
  }
  return null
}

export async function authenticateCloudSession(
  token: string | null,
  store: MongoCloudStore,
  requiredPermission?: Permission,
  requestedShopUuid?: string,
): Promise<{ session: CloudOwnerSession } | { statusCode: number; error: string; message: string }> {
  if (!token) {
    return { statusCode: 401, error: 'Unauthorized', message: 'Authentication required.' }
  }
  const tokenHash = sha256Hex(token)
  const sess = await store.col(CLOUD_COLLECTIONS.cloudSessions).findOne({ tokenHash })
  if (!sess) {
    return { statusCode: 401, error: 'Unauthorized', message: 'Cloud session expired or invalid.' }
  }
  if (sess.revokedAt || new Date(sess.expiresAt as Date | string).getTime() <= Date.now()) {
    return { statusCode: 401, error: 'SessionExpired', message: 'Cloud session has expired.' }
  }

  const user = await store.col(CLOUD_COLLECTIONS.cloudUsers).findOne({
    userId: String(sess.userId),
    shopUuid: String(sess.shopUuid),
  })
  if (
    !user ||
    !user.isActive ||
    Number(user.credentialVersion) !== Number(sess.credentialVersion) ||
    !isUserRole(String(user.role))
  ) {
    return { statusCode: 401, error: 'SessionInvalidated', message: 'Credentials changed or account disabled.' }
  }

  const shopUuid = String(sess.shopUuid).toLowerCase()
  if (requestedShopUuid) {
    let normalizedTarget: string
    try {
      normalizedTarget = normalizeShopUuid(requestedShopUuid)
    } catch {
      return { statusCode: 400, error: 'InvalidShopUuid', message: 'Invalid shop UUID.' }
    }
    if (normalizedTarget !== shopUuid) {
      return { statusCode: 403, error: 'CrossTenantForbidden', message: 'Access denied to external shop tenant.' }
    }
  }

  const permissions = [...rolePermissions[String(user.role) as UserRole]]
  if (requiredPermission && !permissions.includes(requiredPermission)) {
    return { statusCode: 403, error: 'Forbidden', message: 'Insufficient permission for this remote action.' }
  }

  await store.col(CLOUD_COLLECTIONS.cloudSessions).updateOne({ tokenHash }, { $set: { touchedAt: new Date() } })
  const shopDoc = await store.col(CLOUD_COLLECTIONS.shops).findOne({ shopUuid })

  return {
    session: {
      userId: String(user.userId),
      shopUuid,
      branchId: String(user.branchId || 'branch-main'),
      shopName: shopDoc ? String(shopDoc.name) : undefined,
      username: String(user.username),
      name: String(user.name),
      role: String(user.role) as UserRole,
      permissions,
      credentialVersion: Number(user.credentialVersion),
    },
  }
}

export async function enforceCloudOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  store: MongoCloudStore,
  requiredPermission?: Permission,
  requestedShopUuid?: string,
): Promise<CloudOwnerSession | null> {
  const token = extractBearerToken(request)
  const result = await authenticateCloudSession(token, store, requiredPermission, requestedShopUuid)
  if ('error' in result) {
    reply.status(result.statusCode).send({
      error: result.error,
      message: result.message,
      statusCode: result.statusCode,
    })
    return null
  }
  return result.session
}

export function registerCloudAuthRoutes(app: FastifyInstance, store: MongoCloudStore): void {
  // POST /api/cloud/auth/login
  app.post('/api/cloud/auth/login', async (request, reply) => {
    const body = request.body as
      | {
          username?: string
          password?: string
          shopUuid?: string
          deviceType?: string
        }
      | undefined

    if (!body?.username || !body?.password) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Username and password are required.', statusCode: 400 })
    }

    const login = body.username.trim().toLowerCase()
    const rateKey = `login:${request.ip}:${login}`
    const retryMs = getAuthThrottleRemainingMs(rateKey)
    if (retryMs > 0) {
      reply.header('Retry-After', String(Math.max(1, Math.ceil(retryMs / 1000))))
      return reply.status(429).send({
        error: 'RateLimited',
        message: 'Too many failed sign-in attempts. Please wait a few minutes and try again.',
        statusCode: 429,
      })
    }

    const filter: Record<string, unknown> = { username: login }
    if (body.shopUuid) {
      try {
        filter.shopUuid = normalizeShopUuid(body.shopUuid)
      } catch {
        return reply.status(400).send({ error: 'InvalidShopUuid', message: 'Invalid shop identifier.', statusCode: 400 })
      }
    }

    const users = await store
      .col(CLOUD_COLLECTIONS.cloudUsers)
      .find(filter)
      .sort({ updatedAt: -1 })
      .limit(2)
      .toArray()

    if (users.length > 1 && !body.shopUuid) {
      return reply.status(409).send({
        error: 'ShopSelectionRequired',
        message: 'Specify shopUuid to sign into this cloud account.',
        statusCode: 409,
      })
    }

    const user = users[0]
    const ok = user
      ? await verifyScryptPassword(body.password, String(user.passwordHash || ''))
      : await verifyScryptPassword(body.password, DUMMY_HASH)
    if (!ok || !user || !user.isActive || !isUserRole(String(user.role))) {
      recordAuthFailure(rateKey)
      return reply.status(401).send({ error: 'AuthError', message: 'Invalid username or password.', statusCode: 401 })
    }
    clearAuthFailures(rateKey)

    const shopUuid = String(user.shopUuid).toLowerCase()
    const shopDoc = await store.col(CLOUD_COLLECTIONS.shops).findOne({ shopUuid })
    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = sha256Hex(rawToken)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + CLOUD_SESSION_TTL_MS)
    const deviceType = (body.deviceType || 'owner_web').slice(0, 32)

    await store.col(CLOUD_COLLECTIONS.cloudSessions).insertOne({
      _id: tokenHash as any,
      tokenHash,
      userId: String(user.userId),
      shopUuid,
      role: String(user.role),
      credentialVersion: Number(user.credentialVersion),
      deviceType,
      issuedAt: now,
      touchedAt: now,
      expiresAt,
      revokedAt: null,
    })

    const isSecure = request.headers['x-forwarded-proto'] === 'https' || request.protocol === 'https'
    reply.header(
      'Set-Cookie',
      `vertexia_cloud_session=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax;${isSecure ? ' Secure;' : ''} Max-Age=${Math.floor(CLOUD_SESSION_TTL_MS / 1000)}`,
    )

    return {
      ok: true,
      token: rawToken,
      session: {
        userId: String(user.userId),
        shopUuid,
        branchId: String(user.branchId || 'branch-main'),
        shopName: shopDoc ? String(shopDoc.name) : 'Vertexia Shop',
        username: String(user.username),
        name: String(user.name),
        role: String(user.role),
        permissions: [...rolePermissions[String(user.role) as UserRole]],
        mustChangePassword: Boolean(user.mustChangePassword),
      },
    }
  })

  // GET /api/cloud/auth/me
  app.get('/api/cloud/auth/me', async (request, reply) => {
    const session = await enforceCloudOwner(request, reply, store)
    if (!session) return
    return { session }
  })

  // POST /api/cloud/auth/logout
  app.post('/api/cloud/auth/logout', async (request, reply) => {
    const token = extractBearerToken(request)
    if (token) {
      await store
        .col(CLOUD_COLLECTIONS.cloudSessions)
        .updateOne({ tokenHash: sha256Hex(token), revokedAt: null }, { $set: { revokedAt: new Date() } })
    }
    reply.header('Set-Cookie', 'vertexia_cloud_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
    return { ok: true }
  })

  // POST /api/cloud/auth/change-password
  app.post('/api/cloud/auth/change-password', async (request, reply) => {
    const session = await enforceCloudOwner(request, reply, store)
    if (!session) return

    const rateKey = `chpwd:${request.ip}:${session.userId}`
    const retryMs = getAuthThrottleRemainingMs(rateKey)
    if (retryMs > 0) {
      reply.header('Retry-After', String(Math.max(1, Math.ceil(retryMs / 1000))))
      return reply.status(429).send({
        error: 'RateLimited',
        message: 'Too many password verification attempts. Please wait a few minutes.',
        statusCode: 429,
      })
    }

    const body = request.body as { currentPassword?: string; newPassword?: string } | undefined
    if (!body?.currentPassword || !body?.newPassword || body.newPassword.length < 8 || body.newPassword.length > 128) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Use a new password of 8–128 characters.', statusCode: 400 })
    }

    const userDoc = await store.col(CLOUD_COLLECTIONS.cloudUsers).findOne({
      userId: session.userId,
      shopUuid: session.shopUuid,
    })
    if (!userDoc || !(await verifyScryptPassword(body.currentPassword, String(userDoc.passwordHash || '')))) {
      recordAuthFailure(rateKey)
      return reply.status(400).send({ error: 'PasswordMismatch', message: 'Current password is incorrect.', statusCode: 400 })
    }
    clearAuthFailures(rateKey)

    const nextHash = await hashScryptPassword(body.newPassword)
    const token = extractBearerToken(request)
    const currentHash = token ? sha256Hex(token) : ''
    const now = new Date()
    const nowIso = now.toISOString()

    const updated = await store.col(CLOUD_COLLECTIONS.cloudUsers).findOneAndUpdate(
      { userId: session.userId, shopUuid: session.shopUuid },
      {
        $set: { passwordHash: nextHash, mustChangePassword: false, updatedAt: now },
        $inc: { credentialVersion: 1 },
      },
      { returnDocument: 'after' },
    )
    const nextCredentialVersion = Number((updated as any)?.credentialVersion ?? Number(userDoc.credentialVersion) + 1)

    await store.col(CLOUD_COLLECTIONS.cloudSessions).updateMany(
      { userId: session.userId, shopUuid: session.shopUuid, tokenHash: { $ne: currentHash }, revokedAt: null },
      { $set: { revokedAt: now } },
    )
    if (currentHash) {
      await store
        .col(CLOUD_COLLECTIONS.cloudSessions)
        .updateOne({ tokenHash: currentHash }, { $set: { credentialVersion: nextCredentialVersion } })
    }

    let cloudSeq: number | null = null
    const hasShop = await store.ensureActiveShop(session.shopUuid).then(() => true, () => false)
    if (hasShop) {
      const evt = await store.appendCloudOwnerEvent({
        shopUuid: session.shopUuid,
        eventId: `cevt-${randomUUID()}`,
        entityType: 'user_credential',
        entityId: session.userId,
        operation: 'password_change',
        payload: {
          userId: session.userId,
          shopUuid: session.shopUuid,
          passwordHash: nextHash,
          credentialVersion: nextCredentialVersion,
          mustChangePassword: false,
          updatedAt: nowIso,
        },
      })
      cloudSeq = evt.cloudSeq
    }

    return { ok: true, credentialVersion: nextCredentialVersion, cloudSeq }
  })
}
