import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool } from 'pg'
import type { CloudEnvConfig, PgSslMode } from '../config/env.mjs'
import { inferPgSslMode } from '../config/env.mjs'

const currentDir = dirname(fileURLToPath(import.meta.url))

function resolveCentralMigrationsDir(): string {
  const localDir = join(currentDir, 'migrations', 'central')
  try {
    readdirSync(localDir)
    return localDir
  } catch {
    return join(process.cwd(), 'cloud-server', 'db', 'migrations', 'central')
  }
}

export function buildPgSslOption(
  connectionString: string,
  sslMode?: PgSslMode,
): false | { rejectUnauthorized: boolean } {
  const mode = sslMode ?? inferPgSslMode(connectionString)
  if (mode === 'disable') return false
  if (mode === 'verify-full') return { rejectUnauthorized: true }
  return { rejectUnauthorized: false }
}

/**
 * Normalizes a PostgreSQL URI so pg-connection-string does not silently override
 * ssl: { rejectUnauthorized: false } when `sslmode=require` is present in the URL.
 */
export function stripSslQueryParams(connectionString: string, sslMode?: PgSslMode): string {
  const mode = sslMode ?? inferPgSslMode(connectionString)
  if (mode === 'verify-full') return connectionString
  try {
    const parsed = new URL(connectionString)
    parsed.searchParams.delete('sslmode')
    parsed.searchParams.delete('uselibpqcompat')
    return parsed.toString()
  } catch {
    return connectionString
  }
}

/**
 * Runs ordered central schema SQL migrations safely inside the private `vtx_central`
 * PostgreSQL schema using transaction-scoped advisory locks and Supavisor-compatible SQL.
 */
export async function runCentralMigrations(pool: Pool): Promise<void> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(8429001)')
    await client.query('CREATE SCHEMA IF NOT EXISTS vtx_central')
    await client.query('REVOKE ALL ON SCHEMA vtx_central FROM PUBLIC')
    await client.query(`
      DO $$
      BEGIN
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          EXECUTE 'REVOKE ALL ON SCHEMA vtx_central FROM anon';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          EXECUTE 'REVOKE ALL ON SCHEMA vtx_central FROM authenticated';
        END IF;
      END $$;
    `)
    await client.query("SELECT set_config('search_path', 'vtx_central', true)")
    await client.query(`
      CREATE TABLE IF NOT EXISTS vtx_central.schema_migrations (
        version INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `)

    const appliedRes = await client.query<{ version: number }>(
      'SELECT version FROM vtx_central.schema_migrations',
    )
    const applied = new Set(appliedRes.rows.map(r => Number(r.version)))

    const dir = resolveCentralMigrationsDir()
    const files = readdirSync(dir)
      .filter(f => f.endsWith('.sql'))
      .sort()

    for (const file of files) {
      const version = Number(file.split('_')[0])
      if (!Number.isInteger(version) || applied.has(version)) continue
      const sql = readFileSync(join(dir, file), 'utf8')
      await client.query(sql)
      await client.query(
        'INSERT INTO vtx_central.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
        [version, file],
      )
    }

    await client.query(`
      DO $$
      BEGIN
        EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA vtx_central FROM PUBLIC';
        EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA vtx_central FROM PUBLIC';
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
          EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA vtx_central FROM anon';
          EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA vtx_central FROM anon';
        END IF;
        IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
          EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA vtx_central FROM authenticated';
          EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA vtx_central FROM authenticated';
        END IF;
      END $$;
    `)

    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK').catch(() => undefined)
    throw err
  } finally {
    client.release()
  }
}

export function createCentralPool(config: CloudEnvConfig): Pool {
  return new Pool({
    connectionString: stripSslQueryParams(config.centralDbUrl, config.sslMode),
    max: config.tenantPoolMaxConns,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 15_000,
    ssl: buildPgSslOption(config.centralDbUrl, config.sslMode),
  })
}
