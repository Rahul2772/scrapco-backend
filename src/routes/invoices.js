// src/routes/invoices.js
const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { query } = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// ── GET /api/invoices ─────────────────────────────────────────────────────────
router.get('/', auth, asyncHandler(async (req, res) => {
  const { status, from_date, to_date, page = 1, limit = 20 } = req.query;

  let sql = `
    SELECT i.*,
      s.name AS supplier_name, s.phone AS supplier_phone,
      t.txn_number, t.weight, t.unit, t.price_per_unit,
      m.name AS material_name
    FROM invoices i
    LEFT JOIN suppliers   s ON i.supplier_id   = s.id
    LEFT JOIN transactions t ON i.transaction_id = t.id
    LEFT JOIN materials   m ON t.material_id   = m.id
    WHERE 1=1
  `;
  const params = [];

  if (status)    { params.push(status);    sql += ` AND i.status = $${params.length}`; }
  if (from_date) { params.push(from_date); sql += ` AND i.created_at >= $${params.length}`; }
  if (to_date)   { params.push(to_date);   sql += ` AND i.created_at <= $${params.length}::date + 1`; }

  sql += ' ORDER BY i.created_at DESC';

  const offset = (parseInt(page) - 1) * parseInt(limit);
  params.push(parseInt(limit)); sql += ` LIMIT $${params.length}`;
  params.push(offset);          sql += ` OFFSET $${params.length}`;

  const { rows } = await query(sql, params);

  // Summary counts
  const summary = await query(`
    SELECT
      COUNT(*) FILTER (WHERE status='paid')    AS paid_count,
      COUNT(*) FILTER (WHERE status='pending') AS pending_count,
      COUNT(*) FILTER (WHERE status='overdue') AS overdue_count,
      COALESCE(SUM(amount) FILTER (WHERE status='paid'),    0) AS paid_total,
      COALESCE(SUM(amount) FILTER (WHERE status='pending'), 0) AS pending_total,
      COALESCE(SUM(amount) FILTER (WHERE status='overdue'), 0) AS overdue_total
    FROM invoices
  `);

  res.json({
    success: true,
    count: rows.length,
    summary: summary.rows[0],
    invoices: rows,
  });
}));

// ── GET /api/invoices/:id ─────────────────────────────────────────────────────
router.get('/:id', auth, asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT i.*,
      s.name AS supplier_name, s.phone AS supplier_phone,
      s.email AS supplier_email, s.address AS supplier_address,
      s.id_type, s.id_number,
      t.txn_number, t.weight, t.unit, t.price_per_unit,
      t.subtotal, t.gst_rate, t.gst_amount,
      m.name AS material_name, m.category
    FROM invoices i
    LEFT JOIN suppliers   s ON i.supplier_id   = s.id
    LEFT JOIN transactions t ON i.transaction_id = t.id
    LEFT JOIN materials   m ON t.material_id   = m.id
    WHERE i.id = $1
  `, [req.params.id]);

  if (rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Invoice not found.' });
  }
  res.json({ success: true, invoice: rows[0] });
}));

// ── PATCH /api/invoices/:id/pay — Mark invoice as paid ────────────────────────
router.patch('/:id/pay',
  auth,
  requireRole('admin', 'cashier'),
  [
    body('payment_method')
      .isIn(['cash', 'upi', 'bank_transfer', 'cheque'])
      .withMessage('payment_method must be cash, upi, bank_transfer, or cheque'),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    const { payment_method, notes } = req.body;

    const { rows } = await query(`
      UPDATE invoices
      SET status = 'paid', paid_at = NOW(), payment_method = $1, notes = COALESCE($2, notes), updated_at = NOW()
      WHERE id = $3 AND status != 'paid'
      RETURNING *
    `, [payment_method, notes || null, req.params.id]);

    if (rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Invoice not found or already paid.' });
    }

    res.json({ success: true, message: 'Invoice marked as paid.', invoice: rows[0] });
  })
);

// ── PATCH /api/invoices/:id/status — Update any status (admin) ───────────────
router.patch('/:id/status',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { status } = req.body;
    if (!['pending', 'paid', 'overdue', 'cancelled'].includes(status)) {
      return res.status(422).json({ success: false, message: 'Invalid status.' });
    }

    const { rows } = await query(`
      UPDATE invoices SET status = $1, updated_at = NOW() WHERE id = $2 RETURNING *
    `, [status, req.params.id]);

    if (rows.length === 0) return res.status(404).json({ success: false, message: 'Invoice not found.' });
    res.json({ success: true, message: `Invoice status updated to ${status}.`, invoice: rows[0] });
  })
);

module.exports = router;
