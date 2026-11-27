import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from 'pg'
import type { CloudEnvConfig } from '../config/env.mjs'
import { buildPgSslOption, stripSslQueryParams } from './central-pool.mjs'

const currentDir = dirname(fileURLToPath(import.meta.url))
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const SCHEMA_NAME_RE = /^vtx_shop_[0-9a-f]{32}$/

function resolveTenantMigrationsDir(): string {
  const localDir = join(currentDir, 'migrations', 'tenant')
  try {
    readdirSync(localDir)
    return localDir
  } catch {
    return join(process.cwd(), 'cloud-server', 'db', 'migrations', 'tenant')
  }
}

export function normalizeShopUuid(shopUuid: string): string {
  const cleaned = (shopUuid || '').trim().toLowerCase()
  if (!UUID_RE.test(cleaned)) {
    throw new Error(`Invalid immutable shop UUID: "${shopUuid}"`)
  }
  return cleaned
}

export function tenantSchemaName(shopUuid: string): string {
  const normalized = normalizeShopUuid(shopUuid)
  const name = `vtx_shop_${normalized.replace(/-/g, '')}`
  if (!SCHEMA_NAME_RE.test(name)) {
    throw new Error(`Unsafe tenant schema name computed: ${name}`)
  }
  return name
}

/**
 * Backward-compatible alias preserved for callers referencing tenantDatabaseName;
 * in Supabase/PostgreSQL schema isolation this returns the canonical schema identifier `vtx_shop_<32hex>`.
 */
export function tenantDatabaseName(shopUuid: string): string {
  return tenantSchemaName(shopUuid)
}

export function quoteSchemaIdent(schemaName: string): string {
  if (!SCHEMA_NAME_RE.test(schemaName)) {
    throw new Error(`Refusing to quote non-canonical tenant schema identifier: ${schemaName}`)
  }
  return `"${schemaName}"`
}

function lockKeyPairForSchema(schemaName: string): [number, number] {
  const digest = createHash('sha256').update(schemaName).digest()
  return [digest.readInt32BE(0), digest.readInt32BE(4)]
}

/**
 * Single-pool schema-based tenant manager designed for Supabase & managed PostgreSQL:
 * - Zero `CREATE DATABASE` calls.
 * - Single shared `pg.Pool` across `vtx_central` and all `vtx_shop_<32hex>` schemas.
 * - Strictly transaction-local `set_config('search_path', '<schema>', true)` inside explicit transactions.
 */
export class TenantSchemaManager {
  private readonly sharedPool: Pool
  private readonly ownsSharedPool: boolean
  private readonly activeSchemas = new Map<string, string>()

  constructor(
    private readonly config: CloudEnvConfig,
    centralPool?: Pool,
  ) {
    if (centralPool) {
      this.sharedPool = centralPool
      this.ownsSharedPool = false
    } else {
      this.sharedPool = new Pool({
        connectionString: stripSslQueryParams(config.centralDbUrl, config.sslMode),
        max: config.tenantPoolMaxConns,
        idleTimeoutMillis: 30_000,
        connectionTimeoutMillis: 15_000,
        ssl: buildPgSslOption(config.centralDbUrl, config.sslMode),
      })
      this.ownsSharedPool = true
    }
  }

  /**
   * Provisions and migrates a private PostgreSQL schema (`vtx_shop_<32hex>`) for the given
   * immutable shop UUID inside a single shared-pool transaction.
   */
  async ensureTenantSchema(shopUuid: string): Promise<string> {
    const normalized = normalizeShopUuid(shopUuid)
    const schemaName = tenantSchemaName(normalized)
    const quotedSchema = quoteSchemaIdent(schemaName)
    const [k1, k2] = lockKeyPairForSchema(schemaName)

    const client = await this.sharedPool.connect()
    let latestVersion = 0
    try {
      await client.query('BEGIN')
      await client.query('SELECT pg_advisory_xact_lock($1, $2)', [k1, k2])
      await client.query(`CREATE SCHEMA IF NOT EXISTS ${quotedSchema}`)
      await client.query(`REVOKE ALL ON SCHEMA ${quotedSchema} FROM PUBLIC`)
      await client.query(`
        DO $$
        BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            EXECUTE 'REVOKE ALL ON SCHEMA ${schemaName} FROM anon';
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            EXECUTE 'REVOKE ALL ON SCHEMA ${schemaName} FROM authenticated';
          END IF;
        END $$;
      `)
      await client.query("SELECT set_config('search_path', $1, true)", [schemaName])
      await client.query(`
        CREATE TABLE IF NOT EXISTS ${quotedSchema}.schema_migrations (
          version INTEGER PRIMARY KEY,
          name TEXT NOT NULL,
          applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `)

      const appliedRes = await client.query<{ version: number }>(
        `SELECT version FROM ${quotedSchema}.schema_migrations`,
      )
      const applied = new Set(appliedRes.rows.map(r => Number(r.version)))

      const dir = resolveTenantMigrationsDir()
      const files = readdirSync(dir)
        .filter(f => f.endsWith('.sql'))
        .sort()

      for (const file of files) {
        const version = Number(file.split('_')[0])
        if (Number.isInteger(version) && version > latestVersion) latestVersion = version
        if (!Number.isInteger(version) || applied.has(version)) continue
        const sql = readFileSync(join(dir, file), 'utf8')
        await client.query(sql)
        await client.query(
          `INSERT INTO ${quotedSchema}.schema_migrations (version, name) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING`,
          [version, file],
        )
      }

      await client.query(`
        DO $$
        BEGIN
          EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaName} FROM PUBLIC';
          EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schemaName} FROM PUBLIC';
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
            EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaName} FROM anon';
            EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schemaName} FROM anon';
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
            EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA ${schemaName} FROM authenticated';
            EXECUTE 'REVOKE ALL ON ALL SEQUENCES IN SCHEMA ${schemaName} FROM authenticated';
          END IF;
        END $$;
      `)

      await client.query(
        `INSERT INTO vtx_central.tenant_databases (shop_uuid, db_name, schema_name, schema_version, status, migrated_at)
         VALUES ($1, $2, $2, $3, 'active', NOW())
         ON CONFLICT (shop_uuid) DO UPDATE SET
           db_name = EXCLUDED.db_name,
           schema_name = EXCLUDED.schema_name,
           schema_version = EXCLUDED.schema_version,
           status = 'active',
           migrated_at = NOW()`,
        [normalized, schemaName, latestVersion],
      )

      await client.query('COMMIT')
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }

    this.activeSchemas.set(normalized, schemaName)
    return schemaName
  }

  /** Alias preserved for call-site compatibility. */
  async ensureTenantDatabase(shopUuid: string): Promise<string> {
    return this.ensureTenantSchema(shopUuid)
  }

  /**
   * Resolves and verifies that an active, canonical tenant schema exists for `shopUuid`.
   */
  async resolveActiveSchema(shopUuid: string): Promise<string> {
    const normalized = normalizeShopUuid(shopUuid)
    const expectedSchema = tenantSchemaName(normalized)

    const cached = this.activeSchemas.get(normalized)
    if (cached === expectedSchema) {
      return cached
    }

    const res = await this.sharedPool.query<{ db_name: string; schema_name: string | null; status: string }>(
      'SELECT db_name, schema_name, status FROM vtx_central.tenant_databases WHERE shop_uuid = $1',
      [normalized],
    )
    const row = res.rows[0]
    const registeredName = row?.schema_name || row?.db_name
    if (!row || registeredName !== expectedSchema || row.status !== 'active') {
      throw new Error(`Tenant schema missing or inactive for shop ${normalized}`)
    }

    this.activeSchemas.set(normalized, expectedSchema)
    return expectedSchema
  }

  /**
   * Executes a callback inside an explicit transaction pinned exclusively to the shop's
   * isolated schema via transaction-local `set_config('search_path', schemaName, true)`.
   * No other schemas (including `public`) are placed on `search_path`, and PostgreSQL
   * automatically resets `search_path` on COMMIT or ROLLBACK before pooling reuse.
   */
  async withTenantTransaction<T>(shopUuid: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const schemaName = await this.resolveActiveSchema(shopUuid)
    const client = await this.sharedPool.connect()
    try {
      await client.query('BEGIN')
      await client.query("SELECT set_config('search_path', $1, true)", [schemaName])
      const result = await fn(client)
      await client.query('COMMIT')
      return result
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined)
      throw err
    } finally {
      client.release()
    }
  }

  async queryTenant<R extends QueryResultRow = QueryResultRow>(
    shopUuid: string,
    sql: string,
    params: unknown[] = [],
  ): Promise<QueryResult<R>> {
    return this.withTenantTransaction(shopUuid, client => client.query<R>(sql, params))
  }

  /**
   * Test/maintenance helper to remove an isolated test tenant schema cleanly.
   */
  async dropTenantSchemaForTest(shopUuid: string): Promise<void> {
    if (this.config.nodeEnv !== 'test') {
      throw new Error('dropTenantSchemaForTest may only run in NODE_ENV=test')
    }
    const normalized = normalizeShopUuid(shopUuid)
    const schemaName = tenantSchemaName(normalized)
    const quoted = quoteSchemaIdent(schemaName)
    this.activeSchemas.delete(normalized)
    await this.sharedPool.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`)
    await this.sharedPool.query('DELETE FROM vtx_central.businesses WHERE shop_uuid = $1', [normalized])
  }

  async closeAll(): Promise<void> {
    this.activeSchemas.clear()
    if (this.ownsSharedPool) {
      await this.sharedPool.end().catch(() => undefined)
    }
  }
}

export { TenantSchemaManager as TenantDatabaseManager }
