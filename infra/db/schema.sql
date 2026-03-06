CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS admins (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'admin',
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_admin_email_lower ON admins (LOWER(email));

CREATE TABLE IF NOT EXISTS products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  safety_stock INTEGER NOT NULL DEFAULT 0 CHECK (safety_stock >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);

CREATE TABLE IF NOT EXISTS inventories (
  product_id UUID PRIMARY KEY REFERENCES products(id) ON DELETE CASCADE,
  available_qty INTEGER NOT NULL DEFAULT 0 CHECK (available_qty >= 0),
  version BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_logs (
  id BIGSERIAL PRIMARY KEY,
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  admin_id UUID REFERENCES admins(id),
  order_id TEXT,
  op_type TEXT NOT NULL,
  reason TEXT,
  delta_qty INTEGER NOT NULL CHECK (delta_qty <> 0),
  before_qty INTEGER NOT NULL CHECK (before_qty >= 0),
  after_qty INTEGER NOT NULL CHECK (after_qty >= 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_logs_order_product_op
  ON inventory_logs(order_id, product_id, op_type)
  WHERE order_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_inventory_logs_product_created
  ON inventory_logs(product_id, created_at DESC);

CREATE TABLE IF NOT EXISTS restock_suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  suggested_qty INTEGER NOT NULL CHECK (suggested_qty > 0),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_restock_status_generated
  ON restock_suggestions(status, generated_at DESC);
