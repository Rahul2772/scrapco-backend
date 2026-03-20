// src/db/migrate.js
// Run: npm run db:migrate
// Creates all tables from scratch. Safe to run multiple times (IF NOT EXISTS).

const { pool } = require('./pool');
require('dotenv').config();

const migrations = `

-- ── USERS (staff accounts) ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        VARCHAR(100)        NOT NULL,
  email       VARCHAR(150) UNIQUE NOT NULL,
  password    VARCHAR(255)        NOT NULL,
  role        VARCHAR(20)  DEFAULT 'cashier' CHECK (role IN ('admin', 'cashier', 'driver')),
  is_active   BOOLEAN      DEFAULT TRUE,
  created_at  TIMESTAMPTZ  DEFAULT NOW(),
  updated_at  TIMESTAMPTZ  DEFAULT NOW()
);

-- ── MATERIALS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS materials (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          VARCHAR(100) UNIQUE NOT NULL,
  category      VARCHAR(30)  NOT NULL CHECK (category IN ('Ferrous', 'Non-Ferrous')),
  unit          VARCHAR(10)  NOT NULL DEFAULT 'kg',
  buy_price     NUMERIC(12,2) NOT NULL DEFAULT 0,
  sell_price    NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_qty     NUMERIC(12,2) NOT NULL DEFAULT 0,
  min_threshold NUMERIC(12,2) NOT NULL DEFAULT 0,
  color_hex     VARCHAR(7)   DEFAULT '#f5a623',
  is_active     BOOLEAN      DEFAULT TRUE,
  created_at    TIMESTAMPTZ  DEFAULT NOW(),
  updated_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- ── SUPPLIERS ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS suppliers (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         VARCHAR(150) NOT NULL,
  phone        VARCHAR(20),
  email        VARCHAR(150),
  address      TEXT,
  id_type      VARCHAR(30),   -- Aadhaar, PAN, Passport, etc.
  id_number    VARCHAR(50),
  is_active    BOOLEAN      DEFAULT TRUE,
  created_at   TIMESTAMPTZ  DEFAULT NOW(),
  updated_at   TIMESTAMPTZ  DEFAULT NOW()
);

-- ── TRANSACTIONS ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS transactions (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  txn_number      VARCHAR(20) UNIQUE NOT NULL,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  material_id     UUID REFERENCES materials(id) ON DELETE SET NULL,
  weight          NUMERIC(12,3) NOT NULL,
  unit            VARCHAR(10)   NOT NULL DEFAULT 'kg',
  price_per_unit  NUMERIC(12,2) NOT NULL,
  subtotal        NUMERIC(14,2) NOT NULL,
  gst_rate        NUMERIC(5,2)  DEFAULT 0,
  gst_amount      NUMERIC(12,2) DEFAULT 0,
  total_amount    NUMERIC(14,2) NOT NULL,
  notes           TEXT,
  created_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── INVOICES ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number  VARCHAR(20) UNIQUE NOT NULL,
  transaction_id  UUID REFERENCES transactions(id) ON DELETE CASCADE,
  supplier_id     UUID REFERENCES suppliers(id) ON DELETE SET NULL,
  amount          NUMERIC(14,2) NOT NULL,
  status          VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending','paid','overdue','cancelled')),
  due_date        DATE,
  paid_at         TIMESTAMPTZ,
  payment_method  VARCHAR(30),  -- cash, upi, bank_transfer, cheque
  notes           TEXT,
  created_at      TIMESTAMPTZ DEFAULT NOW(),
  updated_at      TIMESTAMPTZ DEFAULT NOW()
);

-- ── PRICE HISTORY ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS price_history (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  material_id  UUID REFERENCES materials(id) ON DELETE CASCADE,
  old_buy_price  NUMERIC(12,2),
  new_buy_price  NUMERIC(12,2),
  old_sell_price NUMERIC(12,2),
  new_sell_price NUMERIC(12,2),
  changed_by   UUID REFERENCES users(id) ON DELETE SET NULL,
  changed_at   TIMESTAMPTZ DEFAULT NOW()
);

-- ── INDEXES for performance ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_transactions_supplier  ON transactions(supplier_id);
CREATE INDEX IF NOT EXISTS idx_transactions_material  ON transactions(material_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created   ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_invoices_status        ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_transaction   ON invoices(transaction_id);
CREATE INDEX IF NOT EXISTS idx_price_history_material ON price_history(material_id);

`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running migrations...');
    await client.query(migrations);
    console.log('✅ All tables created successfully.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
