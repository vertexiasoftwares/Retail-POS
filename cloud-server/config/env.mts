import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'

export interface CloudEnvConfig {
  nodeEnv: string
  host: string
  port: number
  corsOrigins: string[]
  tlsCertPath?: string
  tlsKeyPath?: string
  mongoUri: string
  mongoDbName: string
  mongoMaxPoolSize: number
  jwtSecret: string
  nodeHmacSecret: string
  backupRetentionDaily: number
  backupRetentionWeekly: number
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
  const host = env.CLOUD_HOST?.trim() || (isProduction ? '0.0.0.0' : '127.0.0.1')
  const port =
    (isProduction
      ? parsePort(env.PORT) ?? parsePort(env.CLOUD_PORT)
      : parsePort(env.CLOUD_PORT) ?? parsePort(env.PORT)) ?? 8090

  const corsOrigins = (env.CLOUD_CORS_ORIGINS ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean)

  const mongoUri = env.MONGODB_URI?.trim() || (isProduction ? '' : 'mongodb://127.0.0.1:27017')
  const mongoDbName = env.MONGODB_DB_NAME?.trim() || 'vertexia_cloud'
  const mongoMaxPoolSize = Math.min(50, Math.max(4, Number(env.MONGODB_MAX_POOL_SIZE ?? 20)))

  const jwtSecret = env.CLOUD_JWT_SECRET ?? (isProduction ? '' : 'dev-cloud-jwt-secret-change-in-production-32chars')
  const nodeHmacSecret = env.CLOUD_NODE_HMAC_SECRET ?? (isProduction ? '' : 'dev-cloud-hmac-secret-change-in-production-32chars')

  if (isProduction) {
    if (!mongoUri) {
      throw new Error('[cloud-env] MONGODB_URI is required in production.')
    }
    if (!jwtSecret || jwtSecret.length < 32) {
      throw new Error('[cloud-env] CLOUD_JWT_SECRET must be set (>= 32 chars) in production.')
    }
    if (!nodeHmacSecret || nodeHmacSecret.length < 32) {
      throw new Error('[cloud-env] CLOUD_NODE_HMAC_SECRET must be set (>= 32 chars) in production.')
    }
  }

  return {
    nodeEnv,
    host,
    port,
    corsOrigins,
    tlsCertPath: env.CLOUD_TLS_CERT || undefined,
    tlsKeyPath: env.CLOUD_TLS_KEY || undefined,
    mongoUri,
    mongoDbName,
    mongoMaxPoolSize,
    jwtSecret,
    nodeHmacSecret,
    backupRetentionDaily: Math.max(1, Number(env.CLOUD_BACKUP_RETENTION_DAILY ?? 7)),
    backupRetentionWeekly: Math.max(1, Number(env.CLOUD_BACKUP_RETENTION_WEEKLY ?? 4)),
  }
}
