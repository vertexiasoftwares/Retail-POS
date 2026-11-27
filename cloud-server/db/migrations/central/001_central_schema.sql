CREATE TABLE IF NOT EXISTS vtx_central.schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vtx_central.businesses (
  shop_uuid UUID PRIMARY KEY,
  local_business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  branch_name TEXT NOT NULL DEFAULT 'Main Shop',
  city TEXT NOT NULL DEFAULT 'Main City',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vtx_central.tenant_databases (
  shop_uuid UUID PRIMARY KEY REFERENCES vtx_central.businesses(shop_uuid) ON DELETE CASCADE,
  db_name TEXT NOT NULL UNIQUE,
  schema_name TEXT UNIQUE,
  schema_version INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'provisioning' CHECK (status IN ('provisioning', 'active', 'maintenance', 'archived')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  migrated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS vtx_central.central_users (
  id TEXT PRIMARY KEY,
  shop_uuid UUID NOT NULL REFERENCES vtx_central.businesses(shop_uuid) ON DELETE CASCADE,
  branch_id TEXT NOT NULL,
  username TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Owner', 'Manager', 'Cashier', 'Inventory')),
  password_hash TEXT NOT NULL,
  credential_version INTEGER NOT NULL DEFAULT 1,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  must_change_password BOOLEAN NOT NULL DEFAULT FALSE,
  allowed_tabs JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (shop_uuid, username)
);
CREATE INDEX IF NOT EXISTS idx_central_users_username ON vtx_central.central_users(username);

CREATE TABLE IF NOT EXISTS vtx_central.central_sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES vtx_central.central_users(id) ON DELETE CASCADE,
  shop_uuid UUID NOT NULL REFERENCES vtx_central.businesses(shop_uuid) ON DELETE CASCADE,
  role TEXT NOT NULL,
  credential_version INTEGER NOT NULL,
  device_type TEXT NOT NULL DEFAULT 'owner_web',
  issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  touched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_central_sessions_user ON vtx_central.central_sessions(user_id, revoked_at);

CREATE TABLE IF NOT EXISTS vtx_central.licenses (
  id TEXT PRIMARY KEY,
  shop_uuid UUID NOT NULL REFERENCES vtx_central.businesses(shop_uuid) ON DELETE CASCADE,
  product TEXT NOT NULL DEFAULT 'retail-pos',
  license_key TEXT NOT NULL UNIQUE,
  plan TEXT NOT NULL DEFAULT 'Hybrid Multi-Counter',
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'TRIAL', 'EXPIRED', 'REVOKED')),
  max_counters INTEGER NOT NULL DEFAULT 20 CHECK (max_counters BETWEEN 1 AND 20),
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vtx_central.subscriptions (
  id TEXT PRIMARY KEY,
  shop_uuid UUID NOT NULL REFERENCES vtx_central.businesses(shop_uuid) ON DELETE CASCADE,
  plan TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'past_due', 'canceled', 'trialing')),
  current_period_end TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vtx_central.installations (
  node_id TEXT PRIMARY KEY,
  shop_uuid UUID NOT NULL REFERENCES vtx_central.businesses(shop_uuid) ON DELETE CASCADE,
  hmac_secret_hash TEXT NOT NULL,
  sync_epoch INTEGER NOT NULL DEFAULT 1,
  app_version TEXT,
  last_ip TEXT,
  last_sync_at TIMESTAMPTZ,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS vtx_central.counter_devices (
  id TEXT NOT NULL,
  shop_uuid UUID NOT NULL REFERENCES vtx_central.businesses(shop_uuid) ON DELETE CASCADE,
  counter_number INTEGER NOT NULL CHECK (counter_number BETWEEN 1 AND 20),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  last_ip TEXT,
  last_seen_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  PRIMARY KEY (shop_uuid, id)
);
