import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { Pool } from 'pg'
import { isUserRole, rolePermissions } from '../../src/shared/auth-policy.js'
import type { Permission, UserRole } from '../../src/types/auth.js'
import type { CloudEnvConfig } from '../config/env.mjs'
import { normalizeShopUuid } from '../db/tenant-manager.mjs'

const HASH_OPTIONS = { N: 131072, r: 8, p: 1, maxmem: 160 * 1024 * 1024 }
const DUMMY_HASH = `scrypt-v1$${'00'.repeat(16)}$${'00'.repeat(64)}`
const CLOUD_SESSION_TTL_MS = 12 * 60 * 60 * 1000
const HMAC_MAX_SKEW_MS = 5 * 60 * 1000
const MAX_SCRYPT_CONCURRENCY = 2

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
  centralPool: Pool,
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
    const { rows } = await centralPool.query<{ status: string }>(
      'SELECT status FROM vtx_central.installations WHERE node_id = $1 AND shop_uuid = $2',
      [nodeHeader, shopUuid],
    )
    if (!rows.length || rows[0].status !== 'active') {
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
  centralPool: Pool,
  requiredPermission?: Permission,
  requestedShopUuid?: string,
): Promise<{ session: CloudOwnerSession } | { statusCode: number; error: string; message: string }> {
  if (!token) {
    return { statusCode: 401, error: 'Unauthorized', message: 'Authentication required.' }
  }
  const tokenHash = sha256Hex(token)
  const { rows } = await centralPool.query<{
    user_id: string
    shop_uuid: string
    branch_id: string
    username: string
    name: string
    role: string
    is_active: boolean
    user_cred_ver: number
    sess_cred_ver: number
    revoked_at: Date | null
    expires_at: Date
  }>(
    `SELECT s.user_id, s.shop_uuid, u.branch_id, u.username, u.name, u.role,
            u.is_active, u.credential_version AS user_cred_ver, s.credential_version AS sess_cred_ver,
            s.revoked_at, s.expires_at
     FROM vtx_central.central_sessions s
     JOIN vtx_central.central_users u ON u.id = s.user_id AND u.shop_uuid = s.shop_uuid
     WHERE s.token_hash = $1`,
    [tokenHash],
  )
  if (!rows.length) {
    return { statusCode: 401, error: 'Unauthorized', message: 'Cloud session expired or invalid.' }
  }
  const row = rows[0]
  if (row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
    return { statusCode: 401, error: 'SessionExpired', message: 'Cloud session has expired.' }
  }
  if (!row.is_active || Number(row.user_cred_ver) !== Number(row.sess_cred_ver) || !isUserRole(row.role)) {
    return { statusCode: 401, error: 'SessionInvalidated', message: 'Credentials changed or account disabled.' }
  }

  if (requestedShopUuid) {
    let normalizedTarget: string
    try {
      normalizedTarget = normalizeShopUuid(requestedShopUuid)
    } catch {
      return { statusCode: 400, error: 'InvalidShopUuid', message: 'Invalid shop UUID.' }
    }
    if (normalizedTarget !== row.shop_uuid.toLowerCase()) {
      return { statusCode: 403, error: 'CrossTenantForbidden', message: 'Access denied to external shop tenant.' }
    }
  }

  const permissions = [...rolePermissions[row.role]]
  if (requiredPermission && !permissions.includes(requiredPermission)) {
    return { statusCode: 403, error: 'Forbidden', message: 'Insufficient permission for this remote action.' }
  }

  await centralPool.query('UPDATE vtx_central.central_sessions SET touched_at = NOW() WHERE token_hash = $1', [tokenHash])

  return {
    session: {
      userId: row.user_id,
      shopUuid: row.shop_uuid.toLowerCase(),
      branchId: row.branch_id,
      username: row.username,
      name: row.name,
      role: row.role,
      permissions,
      credentialVersion: Number(row.user_cred_ver),
    },
  }
}

export async function enforceCloudOwner(
  request: FastifyRequest,
  reply: FastifyReply,
  centralPool: Pool,
  requiredPermission?: Permission,
  requestedShopUuid?: string,
): Promise<CloudOwnerSession | null> {
  const token = extractBearerToken(request)
  const result = await authenticateCloudSession(token, centralPool, requiredPermission, requestedShopUuid)
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

export function registerCloudAuthRoutes(app: FastifyInstance, centralPool: Pool): void {
  // POST /api/cloud/auth/login
  app.post('/api/cloud/auth/login', async (request, reply) => {
    const body = request.body as {
      username?: string
      password?: string
      shopUuid?: string
      deviceType?: string
    } | undefined

    if (!body?.username || !body?.password) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Username and password are required.', statusCode: 400 })
    }

    const login = body.username.trim().toLowerCase()
    const params: unknown[] = [login]
    let sql = `SELECT u.*, b.name AS shop_name FROM vtx_central.central_users u JOIN vtx_central.businesses b ON b.shop_uuid = u.shop_uuid WHERE u.username = $1`
    if (body.shopUuid) {
      try {
        const norm = normalizeShopUuid(body.shopUuid)
        params.push(norm)
        sql += ' AND u.shop_uuid = $2'
      } catch {
        return reply.status(400).send({ error: 'InvalidShopUuid', message: 'Invalid shop identifier.', statusCode: 400 })
      }
    } else {
      sql += ' ORDER BY u.updated_at DESC LIMIT 2'
    }

    const { rows } = await centralPool.query<{
      id: string
      shop_uuid: string
      branch_id: string
      username: string
      name: string
      role: string
      password_hash: string
      credential_version: number
      is_active: boolean
      must_change_password: boolean
      shop_name: string
    }>(sql, params)

    if (rows.length > 1 && !body.shopUuid) {
      return reply.status(409).send({
        error: 'ShopSelectionRequired',
        message: 'Specify shopUuid to sign into this cloud account.',
        statusCode: 409,
      })
    }

    const user = rows[0]
    const ok = user ? await verifyScryptPassword(body.password, user.password_hash) : await verifyScryptPassword(body.password, DUMMY_HASH)
    if (!ok || !user || !user.is_active || !isUserRole(user.role)) {
      return reply.status(401).send({ error: 'AuthError', message: 'Invalid username or password.', statusCode: 401 })
    }

    const rawToken = randomBytes(32).toString('hex')
    const tokenHash = sha256Hex(rawToken)
    const expiresAt = new Date(Date.now() + CLOUD_SESSION_TTL_MS)
    const deviceType = (body.deviceType || 'owner_web').slice(0, 32)

    await centralPool.query(
      `INSERT INTO vtx_central.central_sessions (token_hash, user_id, shop_uuid, role, credential_version, device_type, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [tokenHash, user.id, user.shop_uuid, user.role, user.credential_version, deviceType, expiresAt],
    )

    reply.header(
      'Set-Cookie',
      `vertexia_cloud_session=${encodeURIComponent(rawToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor(CLOUD_SESSION_TTL_MS / 1000)}`,
    )

    return {
      ok: true,
      token: rawToken,
      session: {
        userId: user.id,
        shopUuid: user.shop_uuid.toLowerCase(),
        branchId: user.branch_id,
        shopName: user.shop_name,
        username: user.username,
        name: user.name,
        role: user.role,
        permissions: [...rolePermissions[user.role]],
        mustChangePassword: user.must_change_password,
      },
    }
  })

  // GET /api/cloud/auth/me
  app.get('/api/cloud/auth/me', async (request, reply) => {
    const session = await enforceCloudOwner(request, reply, centralPool)
    if (!session) return
    return { session }
  })

  // POST /api/cloud/auth/logout
  app.post('/api/cloud/auth/logout', async (request, reply) => {
    const token = extractBearerToken(request)
    if (token) {
      await centralPool.query('UPDATE vtx_central.central_sessions SET revoked_at = NOW() WHERE token_hash = $1 AND revoked_at IS NULL', [
        sha256Hex(token),
      ])
    }
    reply.header('Set-Cookie', 'vertexia_cloud_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0')
    return { ok: true }
  })

  // POST /api/cloud/auth/change-password
  app.post('/api/cloud/auth/change-password', async (request, reply) => {
    const session = await enforceCloudOwner(request, reply, centralPool)
    if (!session) return
    const body = request.body as { currentPassword?: string; newPassword?: string } | undefined
    if (!body?.currentPassword || !body?.newPassword || body.newPassword.length < 8 || body.newPassword.length > 128) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Use a new password of 8–128 characters.', statusCode: 400 })
    }
    const { rows } = await centralPool.query<{ password_hash: string }>(
      'SELECT password_hash FROM vtx_central.central_users WHERE id = $1 AND shop_uuid = $2',
      [session.userId, session.shopUuid],
    )
    if (!rows.length || !(await verifyScryptPassword(body.currentPassword, rows[0].password_hash))) {
      return reply.status(400).send({ error: 'PasswordMismatch', message: 'Current password is incorrect.', statusCode: 400 })
    }
    const nextHash = await hashScryptPassword(body.newPassword)
    const token = extractBearerToken(request)
    const currentHash = token ? sha256Hex(token) : ''
    await centralPool.query(
      `UPDATE vtx_central.central_users
       SET password_hash = $1, credential_version = credential_version + 1, must_change_password = FALSE, updated_at = NOW()
       WHERE id = $2 AND shop_uuid = $3`,
      [nextHash, session.userId, session.shopUuid],
    )
    await centralPool.query(
      `UPDATE vtx_central.central_sessions
       SET revoked_at = NOW()
       WHERE user_id = $1 AND shop_uuid = $2 AND token_hash <> $3 AND revoked_at IS NULL`,
      [session.userId, session.shopUuid, currentHash],
    )
    if (currentHash) {
      await centralPool.query(
        'UPDATE vtx_central.central_sessions SET credential_version = credential_version + 1 WHERE token_hash = $1',
        [currentHash],
      )
    }
    return { ok: true }
  })
}
