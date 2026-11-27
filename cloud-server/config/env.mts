import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type PgSslMode = 'disable' | 'require' | 'verify-full'

export interface CloudEnvConfig {
  nodeEnv: string
  host: string
  port: number
  corsOrigins: string[]
  tlsCertPath?: string
  tlsKeyPath?: string
  pgAdminUrl: string
  pgDirectUrl: string
  centralDbUrl: string
  sslMode: PgSslMode
  jwtSecret: string
  nodeHmacSecret: string
  backupDir: string
  backupRetentionDaily: number
  backupRetentionWeekly: number
  tenantPoolMax: number
  tenantPoolMaxConns: number
}

/**
 * Populates unset process.env keys from a local .env file without overriding
 * explicitly configured environment variables.
 */
export function loadDotEnv(filePath = '.env'): void {
  const abs = resolve(filePath)
  if (!existsSync(abs)) return
  const lines = readFileSync(abs, 'utf8').split(/\r?\n/)
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/)
    if (!match) continue
    const key = match[1]
    let val = match[2].trim()
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) {
      process.env[key] = val
    }
  }
}

export function inferPgSslMode(connectionString: string, explicitMode?: string): PgSslMode {
  const normalized = (explicitMode || '').trim().toLowerCase()
  if (normalized === 'disable' || normalized === 'require' || normalized === 'verify-full') {
    return normalized
  }
  try {
    const parsed = new URL(connectionString)
    const sslParam = (parsed.searchParams.get('sslmode') || '').toLowerCase()
    if (sslParam === 'disable') return 'disable'
    if (sslParam === 'verify-full') return 'verify-full'
    const host = parsed.hostname.toLowerCase()
    if (host === '127.0.0.1' || host === 'localhost' || host === '::1') {
      return 'disable'
    }
    return 'require'
  } catch {
    return 'disable'
  }
}

function parsePort(value: string | undefined): number | undefined {
  if (value === undefined) return undefined
  const trimmed = value.trim()
  if (!trimmed) return undefined
  const num = Number(trimmed)
  if (!Number.isInteger(num) || num < 0 || num > 65535) return undefined
  return num
}

export function loadCloudEnv(env: NodeJS.ProcessEnv = process.env): CloudEnvConfig {
  const nodeEnv = env.NODE_ENV ?? 'development'
  const isProduction = nodeEnv === 'production'
  const isRailway = Boolean(env.RAILWAY_ENVIRONMENT || env.RAILWAY_SERVICE_ID)
  const host = env.CLOUD_HOST?.trim() || (isProduction || isRailway ? '0.0.0.0' : '127.0.0.1')
  const port =
    (isProduction || isRailway
      ? parsePort(env.PORT) ?? parsePort(env.CLOUD_PORT)
      : parsePort(env.CLOUD_PORT) ?? parsePort(env.PORT)) ?? 8090
  const corsOrigins = (env.CLOUD_CORS_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const centralDbUrl =
    env.DATABASE_CENTRAL_URL?.trim() ||
    env.DATABASE_URL?.trim() ||
    (nodeEnv === 'production' ? '' : 'postgres://postgres:postgres@127.0.0.1:5432/postgres')

  const pgDirectUrl =
    env.PG_DIRECT_URL?.trim() ||
    env.PG_ADMIN_URL?.trim() ||
    centralDbUrl

  const jwtSecret = env.CLOUD_JWT_SECRET ?? (nodeEnv === 'production' ? '' : 'dev-cloud-jwt-secret-change-in-production-32chars')
  const nodeHmacSecret = env.CLOUD_NODE_HMAC_SECRET ?? (nodeEnv === 'production' ? '' : 'dev-cloud-hmac-secret-change-in-production-32chars')

  if (nodeEnv === 'production') {
    if (!centralDbUrl) {
      throw new Error('[cloud-env] DATABASE_CENTRAL_URL (or DATABASE_URL) is required in production.')
    }
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('[cloud-env] CLOUD_JWT_SECRET must be set (>= 32 chars) in production.')
    }
    if (!nodeHmacSecret || nodeHmacSecret.length < 32) {
      throw new Error('[cloud-env] CLOUD_NODE_HMAC_SECRET must be set (>= 32 chars) in production.')
    }
  }

  const sslMode = inferPgSslMode(centralDbUrl, env.PG_SSL_MODE)
  const poolMax = Math.min(50, Math.max(4, Number(env.PG_POOL_MAX ?? env.PG_TENANT_POOL_MAX_CONNS ?? 20)))

  return {
    nodeEnv,
    host,
    port,
    corsOrigins,
    tlsCertPath: env.CLOUD_TLS_CERT || undefined,
    tlsKeyPath: env.CLOUD_TLS_KEY || undefined,
    pgAdminUrl: pgDirectUrl,
    pgDirectUrl,
    centralDbUrl,
    sslMode,
    jwtSecret,
    nodeHmacSecret,
    backupDir: resolve(env.PG_BACKUP_DIR ?? './backups/cloud'),
    backupRetentionDaily: Math.max(1, Number(env.PG_BACKUP_RETENTION_DAILY ?? 7)),
    backupRetentionWeekly: Math.max(1, Number(env.PG_BACKUP_RETENTION_WEEKLY ?? 4)),
    tenantPoolMax: Math.max(5, Number(env.PG_TENANT_POOL_MAX ?? 128)),
    tenantPoolMaxConns: poolMax,
  }
}
