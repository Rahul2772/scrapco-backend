// src/db/seed.js
// Run: npm run db:seed
// Inserts default materials, an admin user, and sample suppliers.

const { pool } = require('./pool');
const bcrypt = require('bcryptjs');
require('dotenv').config();

async function seed() {
  const client = await pool.connect();
  try {
    console.log('🌱 Seeding database...');
    await client.query('BEGIN');

    // ── Admin user ────────────────────────────────────────────────────────────
    const hashedPassword = await bcrypt.hash('admin123', 10);
    await client.query(`
      INSERT INTO users (name, email, password, role)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (email) DO NOTHING
    `, ['Admin User', 'admin@thescrapco.in', hashedPassword, 'admin']);
    console.log('  ✓ Admin user created  |  email: admin@thescrapco.in  |  password: admin123');

    // ── Materials (INR MCX rates) ─────────────────────────────────────────────
    const materials = [
      { name: 'Copper',         category: 'Non-Ferrous', buy_price: 752,  sell_price: 865,  stock: 1240, threshold: 200,  color: '#b87333' },
      { name: 'Aluminium',      category: 'Non-Ferrous', buy_price: 197,  sell_price: 227,  stock: 3800, threshold: 500,  color: '#a8a9ad' },
      { name: 'Steel',          category: 'Ferrous',     buy_price: 42,   sell_price: 48,   stock: 12000,threshold: 1000, color: '#71797e' },
      { name: 'Brass',          category: 'Non-Ferrous', buy_price: 380,  sell_price: 437,  stock: 520,  threshold: 100,  color: '#cd9b1d' },
      { name: 'Iron',           category: 'Ferrous',     buy_price: 28,   sell_price: 32,   stock: 6500, threshold: 800,  color: '#8b4513' },
      { name: 'Stainless Steel',category: 'Ferrous',     buy_price: 110,  sell_price: 127,  stock: 2100, threshold: 300,  color: '#c0c0c0' },
      { name: 'Lead',           category: 'Non-Ferrous', buy_price: 166,  sell_price: 191,  stock: 380,  threshold: 50,   color: '#708090' },
      { name: 'Zinc',           category: 'Non-Ferrous', buy_price: 248,  sell_price: 285,  stock: 450,  threshold: 80,   color: '#7b9b9b' },
    ];

    for (const m of materials) {
      await client.query(`
        INSERT INTO materials (name, category, unit, buy_price, sell_price, stock_qty, min_threshold, color_hex)
        VALUES ($1, $2, 'kg', $3, $4, $5, $6, $7)
        ON CONFLICT (name) DO UPDATE SET
          buy_price = EXCLUDED.buy_price,
          sell_price = EXCLUDED.sell_price
      `, [m.name, m.category, m.buy_price, m.sell_price, m.stock, m.threshold, m.color]);
    }
    console.log(`  ✓ ${materials.length} materials seeded`);

    // ── Sample suppliers ──────────────────────────────────────────────────────
    const suppliers = [
      { name: 'Sharma Metals Ltd',   phone: '9876543210', email: 'sharma@metals.in',   id_type: 'GSTIN', id_number: '27AABCS1234D1Z5' },
      { name: 'Green Recycle Co',    phone: '9765432109', email: 'info@greenrecycle.in', id_type: 'PAN',   id_number: 'ABCPG1234H' },
      { name: 'Metro Scrap Yard',    phone: '9654321098', email: 'metro@scrapyard.in',  id_type: 'GSTIN', id_number: '29AADCM5678E1ZK' },
      { name: 'Rahul Kumar',         phone: '9543210987', email: null,                  id_type: 'Aadhaar',id_number: 'XXXX-XXXX-1234' },
      { name: 'City Iron Works',     phone: '9432109876', email: 'city@ironworks.in',   id_type: 'PAN',   id_number: 'BCDPH5678J' },
    ];

    for (const s of suppliers) {
      await client.query(`
        INSERT INTO suppliers (name, phone, email, id_type, id_number)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT DO NOTHING
      `, [s.name, s.phone, s.email, s.id_type, s.id_number]);
    }
    console.log(`  ✓ ${suppliers.length} suppliers seeded`);

    await client.query('COMMIT');
    console.log('\n✅ Database seeded successfully!');
    console.log('──────────────────────────────────────');
    console.log('  Login: admin@thescrapco.in / admin123');
    console.log('──────────────────────────────────────');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌ Seed failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
