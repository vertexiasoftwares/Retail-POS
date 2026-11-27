import type { FastifyInstance } from 'fastify'
import type { VertexiaDatabase } from '../../electron/database/database.mjs'
import type { AuthRepository } from '../../electron/database/auth.mjs'
import type { RealtimeSyncServer } from '../websocket.mjs'
import {
  clearCounterDeviceCookie,
  enforceAuth,
  getCounterDeviceToken,
  isLoopbackIp,
  isPrivateOrLoopbackIp,
  setCounterDeviceCookie,
} from '../auth-guard.mjs'
import { isSecureRequest, validateOrigin } from '../server.mjs'
import { authRateLimiter, enforceRateLimit } from '../rate-limit.mjs'

export function registerCounterRoutes(
  app: FastifyInstance,
  db: VertexiaDatabase,
  auth: AuthRepository,
  sync?: RealtimeSyncServer,
): void {
  // GET /api/counters — List registered counters (Owner/Manager)
  app.get('/api/counters', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'users.manage')
    if (!guarded) return
    return { counters: db.counters.list(guarded.session.businessId) }
  })

  // GET /api/counters/me — Inspect current client device pairing
  app.get('/api/counters/me', async (request, reply) => {
    if (!isPrivateOrLoopbackIp(request.ip)) {
      return reply.status(403).send({
        error: 'ForbiddenNetwork',
        message: 'LAN counter access is restricted to private local network addresses.',
        statusCode: 403,
      })
    }
    const rawDeviceToken = getCounterDeviceToken(request)
    if (rawDeviceToken) {
      const matched = db.counters.authenticateDeviceToken(rawDeviceToken, request.ip)
      if (matched) {
        return { paired: true, counter: matched }
      }
      clearCounterDeviceCookie(reply, isSecureRequest(request))
      return { paired: false, revoked: true, counter: null }
    }
    if (isLoopbackIp(request.ip)) {
      const primary = db.counters.getById('counter-1')
      return { paired: true, counter: primary }
    }
    return { paired: false, revoked: false, counter: null }
  })

  // POST /api/counters/pair-code — Generate single-use short-lived pairing code
  app.post('/api/counters/pair-code', async (request, reply) => {
    if (!enforceRateLimit(authRateLimiter, request, reply, 'pair-create')) return
    const guarded = enforceAuth(request, reply, auth, db, 'users.manage', undefined, true)
    if (!guarded) return
    const body = (request.body as { name?: string; counterNumber?: number; branchId?: string }) || {}
    const branchId = body.branchId || guarded.session.branchId
    if (!guarded.session.branches.some(b => b.id === branchId)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Invalid business branch.', statusCode: 403 })
    }
    try {
      const result = db.counters.createPairingCode({
        businessId: guarded.session.businessId,
        branchId,
        createdBy: guarded.session.userId,
        name: body.name,
        counterNumber: body.counterNumber,
      })
      return result
    } catch (err: any) {
      return reply.status(400).send({
        error: 'CounterPairingError',
        message: err?.message || 'Unable to create counter pairing code.',
        statusCode: 400,
      })
    }
  })

  // POST /api/counters/complete-pairing — Exchange pairing code for 256-bit HttpOnly device cookie
  app.post('/api/counters/complete-pairing', async (request, reply) => {
    if (!isPrivateOrLoopbackIp(request.ip)) {
      return reply.status(403).send({
        error: 'ForbiddenNetwork',
        message: 'Counter pairing is allowed only from the shop private network.',
        statusCode: 403,
      })
    }
    if (!validateOrigin(request)) {
      return reply.status(403).send({ error: 'Forbidden', message: 'Cross-origin request blocked.', statusCode: 403 })
    }
    if (!enforceRateLimit(authRateLimiter, request, reply, 'pair-complete')) return

    const body = (request.body as { pairingCode?: string; deviceFingerprint?: string; appVersion?: string }) || {}
    if (!body.pairingCode || typeof body.pairingCode !== 'string') {
      return reply.status(400).send({ error: 'BadRequest', message: 'Pairing code is required.', statusCode: 400 })
    }

    try {
      const { counter, deviceToken } = db.counters.completePairing({
        pairingCode: body.pairingCode,
        deviceFingerprint: body.deviceFingerprint,
        appVersion: body.appVersion,
        ipAddress: request.ip,
      })
      setCounterDeviceCookie(reply, deviceToken, isSecureRequest(request))
      sync?.broadcast({
        type: 'counter:paired',
        businessId: counter.businessId,
        branchId: counter.branchId,
        payload: { counterId: counter.id, counterNumber: counter.counterNumber, name: counter.name },
      })
      return { ok: true, counter }
    } catch (err: any) {
      clearCounterDeviceCookie(reply, isSecureRequest(request))
      return reply.status(400).send({
        error: 'PairingFailed',
        message: err?.message || 'Pairing failed.',
        statusCode: 400,
      })
    }
  })

  // POST /api/counters/heartbeat — Throttled counter liveness update
  app.post('/api/counters/heartbeat', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, undefined, undefined, true)
    if (!guarded) return
    const rawToken = getCounterDeviceToken(request)
    let counterId = 'counter-1'
    if (rawToken) {
      const counter = db.counters.authenticateDeviceToken(rawToken, request.ip)
      if (!counter) {
        return reply.status(403).send({ error: 'CounterRevoked', message: 'Counter device token is invalid or revoked.', statusCode: 403 })
      }
      counterId = counter.id
    }
    const body = (request.body as { appVersion?: string }) || {}
    const updated = db.counters.recordHeartbeat(counterId, request.ip, body.appVersion)
    return { ok: true, counter: updated }
  })

  // POST /api/counters/:id/revoke — Revoke counter device and disconnect active sessions
  app.post('/api/counters/:id/revoke', async (request, reply) => {
    const guarded = enforceAuth(request, reply, auth, db, 'users.manage', undefined, true)
    if (!guarded) return
    const params = request.params as { id?: string }
    if (!params?.id) {
      return reply.status(400).send({ error: 'BadRequest', message: 'Counter identifier is required.', statusCode: 400 })
    }
    try {
      const revoked = db.counters.revokeCounter(params.id, guarded.session.userId)
      sync?.disconnectCounter(revoked.id)
      sync?.broadcast({
        type: 'counter:revoked',
        businessId: revoked.businessId,
        branchId: revoked.branchId,
        payload: { counterId: revoked.id, counterNumber: revoked.counterNumber },
      })
      return { ok: true, counter: revoked }
    } catch (err: any) {
      return reply.status(400).send({
        error: 'CounterRevokeError',
        message: err?.message || 'Unable to revoke counter.',
        statusCode: 400,
      })
    }
  })
}
