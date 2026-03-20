// src/routes/suppliers.js
const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { query } = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// ── GET /api/suppliers ────────────────────────────────────────────────────────
router.get('/', auth, asyncHandler(async (req, res) => {
  const { search } = req.query;
  let sql = `
    SELECT s.*,
      COUNT(t.id)::int       AS total_transactions,
      COALESCE(SUM(t.total_amount), 0) AS total_value
    FROM suppliers s
    LEFT JOIN transactions t ON t.supplier_id = s.id
    WHERE s.is_active = true
  `;
  const params = [];

  if (search) {
    params.push(`%${search}%`);
    sql += ` AND (s.name ILIKE $1 OR s.phone ILIKE $1 OR s.email ILIKE $1)`;
  }

  sql += ' GROUP BY s.id ORDER BY s.name';

  const { rows } = await query(sql, params);
  res.json({ success: true, count: rows.length, suppliers: rows });
}));

// ── GET /api/suppliers/:id ────────────────────────────────────────────────────
router.get('/:id', auth, asyncHandler(async (req, res) => {
  const [supplierResult, txnResult] = await Promise.all([
    query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]),
    query(`
      SELECT t.*, m.name AS material_name
      FROM transactions t
      LEFT JOIN materials m ON t.material_id = m.id
      WHERE t.supplier_id = $1
      ORDER BY t.created_at DESC
      LIMIT 20
    `, [req.params.id])
  ]);

  if (supplierResult.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Supplier not found.' });
  }

  res.json({
    success: true,
    supplier: supplierResult.rows[0],
    recent_transactions: txnResult.rows,
  });
}));

// ── POST /api/suppliers ───────────────────────────────────────────────────────
router.post('/',
  auth,
  requireRole('admin', 'cashier'),
  [
    body('name').trim().notEmpty().withMessage('Supplier name is required'),
    body('phone').optional().isMobilePhone().withMessage('Invalid phone number'),
    body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    const { name, phone, email, address, id_type, id_number } = req.body;

    const { rows } = await query(`
      INSERT INTO suppliers (name, phone, email, address, id_type, id_number)
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `, [name, phone || null, email || null, address || null, id_type || null, id_number || null]);

    res.status(201).json({ success: true, message: 'Supplier created.', supplier: rows[0] });
  })
);

// ── PUT /api/suppliers/:id ────────────────────────────────────────────────────
router.put('/:id', auth, requireRole('admin', 'cashier'), asyncHandler(async (req, res) => {
  const existing = await query('SELECT * FROM suppliers WHERE id = $1', [req.params.id]);
  if (existing.rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Supplier not found.' });
  }

  const s = existing.rows[0];
  const { name = s.name, phone = s.phone, email = s.email, address = s.address, id_type = s.id_type, id_number = s.id_number } = req.body;

  const { rows } = await query(`
    UPDATE suppliers
    SET name=$1, phone=$2, email=$3, address=$4, id_type=$5, id_number=$6, updated_at=NOW()
    WHERE id=$7
    RETURNING *
  `, [name, phone, email, address, id_type, id_number, req.params.id]);

  res.json({ success: true, message: 'Supplier updated.', supplier: rows[0] });
}));

// ── DELETE /api/suppliers/:id (admin only, soft delete) ───────────────────────
router.delete('/:id', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(
    'UPDATE suppliers SET is_active = false, updated_at = NOW() WHERE id = $1',
    [req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ success: false, message: 'Supplier not found.' });
  res.json({ success: true, message: 'Supplier deactivated.' });
}));

module.exports = router;
