// Run this once: node src/db/migrate-customers.js
const { pool } = require('./pool');

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ── customers table ─────────────────────────────────────────────────────
    await client.query(`
      CREATE TABLE IF NOT EXISTS customers (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        name          VARCHAR(255) NOT NULL,
        phone         VARCHAR(20),
        address       TEXT,
        id_type       VARCHAR(50)  DEFAULT 'Aadhaar',
        id_number     VARCHAR(100),
        total_visits  INT          DEFAULT 0,
        total_paid    DECIMAL(12,2) DEFAULT 0,
        is_active     BOOLEAN      DEFAULT true,
        notes         TEXT,
        created_at    TIMESTAMP    DEFAULT NOW(),
        updated_at    TIMESTAMP    DEFAULT NOW()
      );
    `);

    // ── purchase_receipts table ──────────────────────────────────────────────
    // Records when WE buy scrap FROM household customers
    await client.query(`
      CREATE TABLE IF NOT EXISTS purchase_receipts (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        receipt_number VARCHAR(50)   UNIQUE NOT NULL,
        customer_id    UUID          REFERENCES customers(id) ON DELETE SET NULL,
        material_id    UUID          REFERENCES materials(id) ON DELETE SET NULL,
        weight         DECIMAL(10,3) NOT NULL,
        unit           VARCHAR(10)   DEFAULT 'kg',
        price_per_unit DECIMAL(10,2) NOT NULL,
        total_amount   DECIMAL(12,2) NOT NULL,
        payment_method VARCHAR(50)   DEFAULT 'cash',
        notes          TEXT,
        created_by     UUID          REFERENCES users(id) ON DELETE SET NULL,
        created_at     TIMESTAMP     DEFAULT NOW()
      );
    `);

    // ── sequence for receipt numbers ─────────────────────────────────────────
    await client.query(`
      CREATE SEQUENCE IF NOT EXISTS receipt_number_seq START 1001;
    `);

    await client.query('COMMIT');
    console.log('✅  customers and purchase_receipts tables created.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Migration failed:', err.message);
  } finally {
    client.release();
    pool.end();
  }
}

migrate();
