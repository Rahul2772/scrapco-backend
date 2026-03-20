// src/routes/purchaseReceipts.js
const express = require('express');
const router  = express.Router();
const { pool } = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');

router.use(auth);

// ── GET /api/purchase-receipts ───────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const { limit = 100, customer_id } = req.query;
    const params = [];
    let where = '';
    if (customer_id) {
      params.push(customer_id);
      where = `WHERE pr.customer_id = $${params.length}`;
    }
    params.push(limit);

    const { rows } = await pool.query(`
      SELECT
        pr.*,
        c.name        AS customer_name,
        c.phone       AS customer_phone,
        m.name        AS material_name,
        m.unit        AS material_unit,
        u.name        AS created_by_name
      FROM purchase_receipts pr
      LEFT JOIN customers c  ON c.id = pr.customer_id
      LEFT JOIN materials m  ON m.id = pr.material_id
      LEFT JOIN users u      ON u.id = pr.created_by
      ${where}
      ORDER BY pr.created_at DESC
      LIMIT $${params.length}
    `, params);

    res.json({ success: true, receipts: rows });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /api/purchase-receipts ──────────────────────────────────────────────
router.post('/', requireRole(['admin', 'cashier']), async (req, res) => {
  const { customer_id, material_id, weight, price_per_unit, payment_method, notes } = req.body;

  if (!material_id) return res.status(400).json({ success: false, message: 'Material is required' });
  if (!weight || weight <= 0) return res.status(400).json({ success: false, message: 'Weight must be greater than 0' });
  if (!price_per_unit || price_per_unit <= 0) return res.status(400).json({ success: false, message: 'Price is required' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const total_amount = parseFloat(weight) * parseFloat(price_per_unit);

    // Generate receipt number
    const seqRes = await client.query(`SELECT nextval('receipt_number_seq') AS seq`);
    const receipt_number = `RCP-${seqRes.rows[0].seq}`;

    // Get material unit
    const matRes = await client.query(`SELECT unit, stock_qty FROM materials WHERE id=$1`, [material_id]);
    const unit = matRes.rows[0]?.unit || 'kg';

    // Insert receipt
    const { rows } = await client.query(`
      INSERT INTO purchase_receipts
        (receipt_number, customer_id, material_id, weight, unit, price_per_unit, total_amount, payment_method, notes, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
      RETURNING *
    `, [
      receipt_number,
      customer_id || null,
      material_id,
      parseFloat(weight),
      unit,
      parseFloat(price_per_unit),
      total_amount,
      payment_method || 'cash',
      notes || null,
      req.user.id,
    ]);

    // Update material stock (increase — we just bought more)
    await client.query(`
      UPDATE materials
      SET stock_qty = stock_qty + $1, updated_at = NOW()
      WHERE id = $2
    `, [parseFloat(weight), material_id]);

    // Update customer stats if customer provided
    if (customer_id) {
      await client.query(`
        UPDATE customers
        SET total_visits = total_visits + 1,
            total_paid   = total_paid + $1,
            updated_at   = NOW()
        WHERE id = $2
      `, [total_amount, customer_id]);
    }

    // Fetch full receipt with joins
    const full = await client.query(`
      SELECT pr.*, c.name AS customer_name, c.phone AS customer_phone,
             m.name AS material_name, m.unit AS material_unit
      FROM purchase_receipts pr
      LEFT JOIN customers c ON c.id = pr.customer_id
      LEFT JOIN materials m ON m.id = pr.material_id
      WHERE pr.id = $1
    `, [rows[0].id]);

    await client.query('COMMIT');
    res.status(201).json({ success: true, receipt: full.rows[0] });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

// ── DELETE /api/purchase-receipts/:id ───────────────────────────────────────
router.delete('/:id', requireRole(['admin']), async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const { rows } = await client.query(
      `SELECT * FROM purchase_receipts WHERE id=$1`, [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: 'Receipt not found' });

    const r = rows[0];

    // Reverse the stock addition
    await client.query(`
      UPDATE materials SET stock_qty = stock_qty - $1 WHERE id = $2
    `, [r.weight, r.material_id]);

    // Reverse customer stats
    if (r.customer_id) {
      await client.query(`
        UPDATE customers
        SET total_visits = GREATEST(total_visits - 1, 0),
            total_paid   = GREATEST(total_paid - $1, 0)
        WHERE id = $2
      `, [r.total_amount, r.customer_id]);
    }

    await client.query(`DELETE FROM purchase_receipts WHERE id=$1`, [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Receipt deleted' });
  } catch (err) {
    await client.query('ROLLBACK');
    res.status(500).json({ success: false, message: err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
