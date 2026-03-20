// src/db/migrate-whatsapp.js
// Run: node src/db/migrate-whatsapp.js
// Adds the whatsapp_logs table to your existing database

const { pool } = require('./pool');
require('dotenv').config();

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄 Creating WhatsApp logs table...');
    await client.query(`
      CREATE TABLE IF NOT EXISTS whatsapp_logs (
        id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
        supplier_phone VARCHAR(20),
        status         VARCHAR(20) DEFAULT 'sent' CHECK (status IN ('sent','failed','skipped')),
        message_id     VARCHAR(100),
        provider       VARCHAR(20) DEFAULT 'twilio',
        pdf_url        TEXT,
        error          TEXT,
        sent_at        TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_txn ON whatsapp_logs(transaction_id);
      CREATE INDEX IF NOT EXISTS idx_whatsapp_logs_sent ON whatsapp_logs(sent_at DESC);
    `);
    console.log('✅ whatsapp_logs table created.');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
