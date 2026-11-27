CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shop_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS branches (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  code TEXT NOT NULL,
  city TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  username TEXT UNIQUE,
  role TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  allowed_tabs JSONB,
  sync_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS counters (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  branch_id TEXT NOT NULL,
  counter_number INTEGER NOT NULL CHECK (counter_number BETWEEN 1 AND 20),
  name TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'active', 'revoked')),
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  app_version TEXT,
  last_ip TEXT,
  last_seen_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS products (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  sku TEXT NOT NULL,
  barcode TEXT,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  unit TEXT NOT NULL,
  cost_price_paisa BIGINT NOT NULL DEFAULT 0,
  sale_price_paisa BIGINT NOT NULL,
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  low_stock_milli BIGINT NOT NULL DEFAULT 5000,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sync_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (business_id, sku)
);
CREATE INDEX IF NOT EXISTS idx_tenant_products_barcode ON products(business_id, barcode);

CREATE TABLE IF NOT EXISTS stock_levels (
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  quantity_milli BIGINT NOT NULL DEFAULT 0,
  sync_version INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (branch_id, product_id)
);

CREATE TABLE IF NOT EXISTS stock_movements (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  product_id TEXT NOT NULL REFERENCES products(id),
  movement_type TEXT NOT NULL,
  quantity_delta_milli BIGINT NOT NULL,
  reference_type TEXT NOT NULL,
  reference_id TEXT NOT NULL,
  origin_source TEXT NOT NULL DEFAULT 'local',
  counter_id TEXT DEFAULT 'counter-1',
  note TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_stock_movements_prod ON stock_movements(product_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS customers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  is_walk_in BOOLEAN NOT NULL DEFAULT FALSE,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sync_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS suppliers (
  id TEXT PRIMARY KEY,
  business_id TEXT NOT NULL,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  address TEXT NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  sync_version INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sales (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  counter_id TEXT NOT NULL DEFAULT 'counter-1',
  invoice_number TEXT NOT NULL UNIQUE,
  customer_id TEXT NOT NULL,
  cashier_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  subtotal_paisa BIGINT NOT NULL,
  discount_paisa BIGINT NOT NULL,
  tax_paisa BIGINT NOT NULL,
  total_paisa BIGINT NOT NULL,
  cost_paisa BIGINT NOT NULL DEFAULT 0,
  paid_paisa BIGINT NOT NULL,
  change_paisa BIGINT NOT NULL DEFAULT 0,
  due_paisa BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'completed',
  note TEXT NOT NULL DEFAULT '',
  completed_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tenant_sales_date ON sales(business_date DESC, completed_at DESC);
CREATE INDEX IF NOT EXISTS idx_tenant_sales_counter ON sales(counter_id, business_date DESC);

CREATE TABLE IF NOT EXISTS sale_items (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  product_id TEXT NOT NULL,
  product_name_snapshot TEXT NOT NULL,
  sku_snapshot TEXT NOT NULL DEFAULT '',
  unit_snapshot TEXT NOT NULL DEFAULT 'pcs',
  quantity_milli BIGINT NOT NULL,
  unit_price_paisa BIGINT NOT NULL,
  cost_price_paisa BIGINT NOT NULL DEFAULT 0,
  tax_rate_bps INTEGER NOT NULL DEFAULT 0,
  line_total_paisa BIGINT NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_payments (
  id TEXT PRIMARY KEY,
  sale_id TEXT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
  method TEXT NOT NULL,
  amount_paisa BIGINT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS sale_returns (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  counter_id TEXT NOT NULL DEFAULT 'counter-1',
  sale_id TEXT NOT NULL REFERENCES sales(id),
  return_number TEXT NOT NULL UNIQUE,
  refund_method TEXT NOT NULL,
  subtotal_paisa BIGINT NOT NULL,
  tax_paisa BIGINT NOT NULL,
  total_paisa BIGINT NOT NULL,
  cost_paisa BIGINT NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS manual_returns (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  counter_id TEXT NOT NULL DEFAULT 'counter-1',
  customer_id TEXT NOT NULL,
  business_date TEXT NOT NULL,
  return_number TEXT NOT NULL UNIQUE,
  refund_method TEXT NOT NULL,
  total_paisa BIGINT NOT NULL,
  cost_paisa BIGINT NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS purchases (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  supplier_name_snapshot TEXT NOT NULL,
  purchase_number TEXT NOT NULL UNIQUE,
  business_date TEXT NOT NULL,
  total_paisa BIGINT NOT NULL,
  paid_paisa BIGINT NOT NULL DEFAULT 0,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_receipts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  receipt_number TEXT NOT NULL UNIQUE,
  business_date TEXT NOT NULL,
  method TEXT NOT NULL,
  amount_paisa BIGINT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_payments (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  payment_number TEXT NOT NULL UNIQUE,
  business_date TEXT NOT NULL,
  method TEXT NOT NULL,
  amount_paisa BIGINT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS customer_ledger (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  debit_paisa BIGINT NOT NULL DEFAULT 0,
  credit_paisa BIGINT NOT NULL DEFAULT 0,
  reference_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS supplier_ledger (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  supplier_id TEXT NOT NULL,
  entry_type TEXT NOT NULL,
  debit_paisa BIGINT NOT NULL DEFAULT 0,
  credit_paisa BIGINT NOT NULL DEFAULT 0,
  reference_id TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS expenses (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  expense_number TEXT NOT NULL UNIQUE,
  business_date TEXT NOT NULL,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  method TEXT NOT NULL,
  amount_paisa BIGINT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS cash_shifts (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL,
  counter_id TEXT NOT NULL DEFAULT 'counter-1',
  cashier_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'closed', 'force_closed')),
  opening_cash_paisa BIGINT NOT NULL DEFAULT 0,
  expected_cash_paisa BIGINT,
  counted_cash_paisa BIGINT,
  variance_paisa BIGINT,
  note TEXT,
  opened_at TIMESTAMPTZ NOT NULL,
  closed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS cash_movements (
  id TEXT PRIMARY KEY,
  shift_id TEXT NOT NULL REFERENCES cash_shifts(id) ON DELETE CASCADE,
  branch_id TEXT NOT NULL,
  movement_type TEXT NOT NULL,
  amount_paisa BIGINT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS processed_sync_events (
  event_id TEXT PRIMARY KEY,
  counter_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  sync_epoch INTEGER NOT NULL,
  payload_hash TEXT NOT NULL,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS cloud_sync_events (
  cloud_seq BIGSERIAL PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE,
  origin_source TEXT NOT NULL CHECK (origin_source IN ('local', 'cloud_owner')),
  counter_id TEXT,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cloud_sync_events_seq ON cloud_sync_events(cloud_seq ASC);

CREATE TABLE IF NOT EXISTS sync_conflicts (
  id TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  local_event_id TEXT,
  cloud_seq BIGINT,
  conflict_type TEXT NOT NULL,
  local_summary TEXT NOT NULL,
  cloud_summary TEXT NOT NULL,
  resolution TEXT NOT NULL,
  resolved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
