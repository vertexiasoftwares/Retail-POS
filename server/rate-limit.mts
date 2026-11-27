import type { FastifyReply, FastifyRequest } from 'fastify'

interface WindowEntry {
  count: number
  resetAt: number
}

export class SlidingWindowRateLimiter {
  private readonly windows = new Map<string, WindowEntry>()

  constructor(
    private readonly maxRequests: number,
    private readonly windowMs: number,
  ) {}

  check(key: string, nowMs = Date.now()): { allowed: boolean; retryAfterSec: number } {
    if (this.windows.size > 5000) {
      for (const [k, entry] of this.windows) {
        if (entry.resetAt <= nowMs) this.windows.delete(k)
      }
    }
    const existing = this.windows.get(key)
    if (!existing || existing.resetAt <= nowMs) {
      this.windows.set(key, { count: 1, resetAt: nowMs + this.windowMs })
      return { allowed: true, retryAfterSec: 0 }
    }
    if (existing.count >= this.maxRequests) {
      return {
        allowed: false,
        retryAfterSec: Math.max(1, Math.ceil((existing.resetAt - nowMs) / 1000)),
      }
    }
    existing.count += 1
    return { allowed: true, retryAfterSec: 0 }
  }
}

export const authRateLimiter = new SlidingWindowRateLimiter(30, 60_000)
export const writeRateLimiter = new SlidingWindowRateLimiter(600, 60_000)

export function enforceRateLimit(
  limiter: SlidingWindowRateLimiter,
  request: FastifyRequest,
  reply: FastifyReply,
  bucketPrefix: string,
): boolean {
  const key = `${bucketPrefix}:${request.ip || 'unknown'}`
  const res = limiter.check(key)
  if (!res.allowed) {
    reply.header('Retry-After', String(res.retryAfterSec))
    reply.status(429).send({
      error: 'TooManyRequests',
      message: `Too many requests. Try again in ${res.retryAfterSec} seconds.`,
      statusCode: 429,
    })
    return false
  }
  return true
}
