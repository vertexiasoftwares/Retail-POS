import { createHash, randomBytes } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';
import type { AuthRepository } from '../electron/database/auth.mjs';
import type { VertexiaDatabase } from '../electron/database/database.mjs';
import type { LicenseClient } from '../electron/licensing/client.mjs';
import type { Permission, AuthSession } from '../src/types/auth.js';
import { requestActorStorage } from '../electron/database/context.mjs';
import { getSessionToken, parseCookies, validateOrigin } from './server.mjs';
import { enforceRateLimit, writeRateLimiter } from './rate-limit.mjs';

export const COUNTER_DEVICE_COOKIE = 'vertexia_counter_device';

export interface GuardedSession {
  session: AuthSession;
  token: string;
  counterId: string;
}

export function isLoopbackIp(ip?: string): boolean {
  if (!ip) return true;
  const clean = ip.replace(/^::ffff:/, '').toLowerCase();
  return clean === '127.0.0.1' || clean === '::1' || clean === 'localhost';
}

export function isPrivateOrLoopbackIp(ip?: string): boolean {
  if (process.env.ALLOW_NON_PRIVATE_LAN === 'true') return true;
  if (!ip) return true;
  if (isLoopbackIp(ip)) return true;
  const clean = ip.replace(/^::ffff:/, '').toLowerCase();
  // RFC1918 IPv4: 10.0.0.0/8, 172.16.0.0/12, 192.168.0.0/16, link-local 169.254.0.0/16
  if (clean.startsWith('10.') || clean.startsWith('192.168.') || clean.startsWith('169.254.')) {
    return true;
  }
  const m172 = /^172\.(\d+)\./.exec(clean);
  if (m172) {
    const second = Number(m172[1]);
    if (second >= 16 && second <= 31) return true;
  }
  // ULA IPv6 fc00::/7 or link-local fe80::/10
  if (clean.startsWith('fc') || clean.startsWith('fd') || clean.startsWith('fe80:')) {
    return true;
  }
  return false;
}

export function getCounterDeviceToken(request: FastifyRequest): string | null {
  const cookies = parseCookies(request.headers.cookie);
  const token = cookies[COUNTER_DEVICE_COOKIE];
  return token && token.trim() ? token.trim() : null;
}

export function setCounterDeviceCookie(reply: FastifyReply, deviceToken: string, isSecure = false): void {
  const maxAge = 365 * 24 * 60 * 60;
  const secureFlag = isSecure ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${COUNTER_DEVICE_COOKIE}=${encodeURIComponent(deviceToken)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secureFlag}`
  );
}

export function clearCounterDeviceCookie(reply: FastifyReply, isSecure = false): void {
  const secureFlag = isSecure ? '; Secure' : '';
  reply.header(
    'Set-Cookie',
    `${COUNTER_DEVICE_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0; Expires=Thu, 01 Jan 1970 00:00:00 GMT${secureFlag}`
  );
}

export function resolveRequestCounterId(
  request: FastifyRequest,
  database: VertexiaDatabase,
  reply?: FastifyReply,
  requirePairedForRemote = false
): string | null {
  const rawDeviceToken = getCounterDeviceToken(request);
  if (rawDeviceToken) {
    const matched = database.counters.authenticateDeviceToken(rawDeviceToken, request.ip);
    if (!matched) {
      if (reply) {
        reply.status(403).send({
          error: 'CounterRevoked',
          message: 'This counter device has been revoked or its pairing token is invalid. Pair it again from the Main PC.',
          statusCode: 403,
        });
      }
      return null;
    }
    return matched.id;
  }

  if (requirePairedForRemote && !isLoopbackIp(request.ip)) {
    if (reply) {
      reply.status(403).send({
        error: 'CounterPairingRequired',
        message: 'Pair this LAN counter from the Main PC before transacting.',
        statusCode: 403,
      });
    }
    return null;
  }

  return 'counter-1';
}

export function enforceAuth(
  request: FastifyRequest,
  reply: FastifyReply,
  auth: AuthRepository,
  database: VertexiaDatabase,
  permission?: Permission,
  branchId?: string,
  checkCsrf = false,
  licenseClient?: LicenseClient,
  requirePairedForRemote = false
): GuardedSession | null {
  if (!isPrivateOrLoopbackIp(request.ip)) {
    reply.status(403).send({
      error: 'ForbiddenNetwork',
      message: 'Local server requests are only permitted on private LAN networks.',
      statusCode: 403,
    });
    return null;
  }

  if (checkCsrf && !validateOrigin(request)) {
    reply.status(403).send({
      error: 'Forbidden',
      message: 'Cross-origin request blocked.',
      statusCode: 403,
    });
    return null;
  }

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    if (!enforceRateLimit(writeRateLimiter, request, reply, 'api-write')) {
      return null;
    }
  }

  const resolvedCounterId = resolveRequestCounterId(request, database, reply, requirePairedForRemote);
  if (!resolvedCounterId) {
    return null;
  }

  const token = getSessionToken(request);
  if (!token) {
    reply.status(401).send({
      error: 'Unauthorized',
      message: 'Sign in to access this resource.',
      statusCode: 401,
    });
    return null;
  }

  try {
    const session = auth.requireToken(token, permission, branchId);
    const tokenCounter = auth.getTokenCounterId(token);
    const effectiveCounterId = resolvedCounterId !== 'counter-1' ? resolvedCounterId : tokenCounter;

    if (
      licenseClient &&
      (request.method === 'POST' || request.method === 'PUT' || request.method === 'DELETE' || request.method === 'PATCH') &&
      !request.url.startsWith('/api/auth/') &&
      !request.url.startsWith('/api/licensing/') &&
      !request.url.startsWith('/api/cloud-license/')
    ) {
      const lic = licenseClient.status(branchId || session.branchId);
      if (!lic.canTransact) {
        reply.status(403).send({
          error: 'LicenseRequired',
          message: lic.message || 'Active POS license is required to perform this operation.',
          statusCode: 403,
        });
        return null;
      }
    }

    requestActorStorage.enterWith({
      userId: session.userId,
      branchId: session.branchId,
      role: session.role,
      sessionToken: token,
      counterId: effectiveCounterId,
      ipAddress: request.ip,
    });
    database.setActor(session.userId);
    return { session, token, counterId: effectiveCounterId };
  } catch (err: any) {
    const message = err?.message || 'Access denied.';
    const isUnauth = message.includes('Session expired') || message.includes('temporary password') || message.includes('Sign in');
    const statusCode = isUnauth ? 401 : 403;
    reply.status(statusCode).send({
      error: isUnauth ? 'Unauthorized' : 'Forbidden',
      message,
      statusCode,
    });
    return null;
  }
}

export function ensureOperationId<T extends Record<string, any>>(
  body: T,
  userId?: string,
  counterId?: string
): T {
  const rawOpId =
    body && typeof body.operationId === 'string' && body.operationId.trim()
      ? body.operationId.trim()
      : '';

  if (rawOpId) {
    const digest = createHash('sha256')
      .update(`${userId || 'anon'}|${counterId || 'counter-1'}|${rawOpId}`)
      .digest('hex')
      .slice(0, 40);
    return {
      ...body,
      operationId: `op-${digest}`,
    };
  }

  return {
    ...body,
    operationId: `op-${randomBytes(16).toString('hex')}`,
  };
}
