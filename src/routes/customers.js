// src/routes/customers.js
const express = require('express');
const router  = express.Router();
const { pool } = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');

// All routes require login
router.use(auth);

// ── GET /api/customers ───────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { search, limit = 200 } = req.query;
    let q = `
      SELECT c.*,
        COUNT(pr.id)            AS visit_count,
        COALESCE(SUM(pr.total_amount), 0) AS lifetime_paid
      FROM customers c
      LEFT JOIN purchase_receipts pr ON pr.customer_id = c.id
      WHERE c.is_active = true
    `;
    const params = [];
    if (search) {
      params.push(`%${search}%`);
      q += ` AND (c.name ILIKE $${params.length} OR c.phone ILIKE $${params.length})`;
    }
    q += ` GROUP BY c.id ORDER BY c.name ASC LIMIT $${params.length + 1}`;
    params.push(limit);

    const result = await pool.query(q, params);
    res.json({ success: true, customers: result.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── GET /api/customers/:id ───────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const { rows } = await pool.query(`SELECT * FROM customers WHERE id = $1`, [req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Customer not found' });

    // Also fetch their receipt history
    const receipts = await pool.query(`
      SELECT pr.*, m.name AS material_name
      FROM purchase_receipts pr
      LEFT JOIN materials m ON m.id = pr.material_id
      WHERE pr.customer_id = $1
      ORDER BY pr.created_at DESC
      LIMIT 50
    `, [req.params.id]);

    res.json({ success: true, customer: rows[0], receipts: receipts.rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/customers ──────────────────────────────────────────────────────
router.post('/', requireRole(['admin', 'cashier']), async (req, res) => {
  const { name, phone, address, id_type, id_number, notes } = req.body;
  if (!name?.trim()) return res.status(400).json({ success: false, message: 'Name is required' });
  try {
    const { rows } = await pool.query(`
      INSERT INTO customers (name, phone, address, id_type, id_number, notes)
      VALUES ($1,$2,$3,$4,$5,$6)
      RETURNING *
    `, [name.trim(), phone||null, address||null, id_type||'Aadhaar', id_number||null, notes||null]);
    res.status(201).json({ success: true, customer: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── PUT /api/customers/:id ───────────────────────────────────────────────────
router.put('/:id', requireRole(['admin', 'cashier']), async (req, res) => {
  const { name, phone, address, id_type, id_number, notes } = req.body;
  try {
    const { rows } = await pool.query(`
      UPDATE customers
      SET name=$1, phone=$2, address=$3, id_type=$4, id_number=$5, notes=$6, updated_at=NOW()
      WHERE id=$7 AND is_active=true
      RETURNING *
    `, [name, phone||null, address||null, id_type||'Aadhaar', id_number||null, notes||null, req.params.id]);
    if (!rows.length) return res.status(404).json({ success: false, message: 'Customer not found' });
    res.json({ success: true, customer: rows[0] });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── DELETE /api/customers/:id ────────────────────────────────────────────────
router.delete('/:id', requireRole(['admin']), async (req, res) => {
  try {
    await pool.query(`UPDATE customers SET is_active=false WHERE id=$1`, [req.params.id]);
    res.json({ success: true, message: 'Customer deactivated' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

module.exports = router;
