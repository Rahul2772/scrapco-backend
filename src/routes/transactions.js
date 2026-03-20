// src/routes/transactions.js
// Core business route — handles scrap weighing, stock update, and auto-invoice creation
const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { query, getClient } = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// ── Helper: generate sequential transaction number ────────────────────────────
async function generateTxnNumber(client) {
  const { rows } = await client.query(`SELECT COUNT(*) FROM transactions`);
  const count = parseInt(rows[0].count) + 1;
  return `TXN-${String(count).padStart(5, '0')}`;
}

async function generateInvoiceNumber(client) {
  const { rows } = await client.query(`SELECT COUNT(*) FROM invoices`);
  const count = parseInt(rows[0].count) + 1;
  return `INV-${String(count).padStart(5, '0')}`;
}

// ── GET /api/transactions ─────────────────────────────────────────────────────
router.get('/', auth, asyncHandler(async (req, res) => {
  const {
    supplier_id, material_id, from_date, to_date,
    page = 1, limit = 20
  } = req.query;

  let sql = `
    SELECT t.*,
      s.name AS supplier_name, s.phone AS supplier_phone,
      m.name AS material_name, m.unit AS material_unit, m.color_hex,
      i.invoice_number, i.status AS invoice_status,
      u.name AS created_by_name
    FROM transactions t
    LEFT JOIN suppliers s ON t.supplier_id = s.id
    LEFT JOIN materials m ON t.material_id = m.id
    LEFT JOIN invoices  i ON i.transaction_id = t.id
    LEFT JOIN users     u ON t.created_by = u.id
    WHERE 1=1
  `;

  const params = [];

  if (supplier_id) { params.push(supplier_id); sql += ` AND t.supplier_id = $${params.length}`; }
  if (material_id) { params.push(material_id); sql += ` AND t.material_id = $${params.length}`; }
  if (from_date)   { params.push(from_date);   sql += ` AND t.created_at >= $${params.length}`; }
  if (to_date)     { params.push(to_date);     sql += ` AND t.created_at <= $${params.length}::date + 1`; }

  sql += ` ORDER BY t.created_at DESC`;

  // Pagination
  const offset = (parseInt(page) - 1) * parseInt(limit);
  params.push(parseInt(limit)); sql += ` LIMIT $${params.length}`;
  params.push(offset);          sql += ` OFFSET $${params.length}`;

  const { rows } = await query(sql, params);
  res.json({ success: true, count: rows.length, page: parseInt(page), transactions: rows });
}));

// ── GET /api/transactions/:id ─────────────────────────────────────────────────
router.get('/:id', auth, asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT t.*,
      s.name AS supplier_name, s.phone AS supplier_phone, s.email AS supplier_email,
      s.id_type, s.id_number,
      m.name AS material_name, m.category, m.color_hex,
      i.id AS invoice_id, i.invoice_number, i.status AS invoice_status,
      i.due_date, i.paid_at, i.payment_method,
      u.name AS created_by_name
    FROM transactions t
    LEFT JOIN suppliers s ON t.supplier_id = s.id
    LEFT JOIN materials m ON t.material_id = m.id
    LEFT JOIN invoices  i ON i.transaction_id = t.id
    LEFT JOIN users     u ON t.created_by = u.id
    WHERE t.id = $1
  `, [req.params.id]);

  if (rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Transaction not found.' });
  }
  res.json({ success: true, transaction: rows[0] });
}));

// ── POST /api/transactions ────────────────────────────────────────────────────
// Creates a transaction, updates stock, and auto-creates an invoice
router.post('/',
  auth,
  requireRole('admin', 'cashier'),
  [
    body('supplier_id').notEmpty().isUUID().withMessage('Valid supplier ID required'),
    body('material_id').notEmpty().isUUID().withMessage('Valid material ID required'),
    body('weight').isFloat({ min: 0.001 }).withMessage('Weight must be greater than 0'),
    body('price_per_unit').isFloat({ min: 0 }).withMessage('Price must be a positive number'),
    body('gst_rate').optional().isFloat({ min: 0, max: 100 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    const {
      supplier_id, material_id, weight,
      price_per_unit, gst_rate = 0,
      notes = null, due_date = null, payment_method = null,
    } = req.body;

    // Run everything in a DB transaction for safety
    const client = await getClient();
    try {
      await client.query('BEGIN');

      // 1. Verify supplier and material exist
      const [supplierRes, materialRes] = await Promise.all([
        client.query('SELECT id, name FROM suppliers WHERE id = $1 AND is_active = true', [supplier_id]),
        client.query('SELECT id, name, unit, stock_qty FROM materials WHERE id = $1 AND is_active = true', [material_id]),
      ]);

      if (supplierRes.rows.length === 0) throw { status: 404, message: 'Supplier not found or inactive.' };
      if (materialRes.rows.length === 0) throw { status: 404, message: 'Material not found or inactive.' };

      const material = materialRes.rows[0];

      // 2. Calculate amounts
      const subtotal    = parseFloat((weight * price_per_unit).toFixed(2));
      const gst_amount  = parseFloat(((subtotal * gst_rate) / 100).toFixed(2));
      const total_amount = parseFloat((subtotal + gst_amount).toFixed(2));
      const unit        = material.unit;

      // 3. Create transaction
      const txn_number = await generateTxnNumber(client);
      const { rows: txnRows } = await client.query(`
        INSERT INTO transactions
          (txn_number, supplier_id, material_id, weight, unit, price_per_unit,
           subtotal, gst_rate, gst_amount, total_amount, notes, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
        RETURNING *
      `, [txn_number, supplier_id, material_id, weight, unit, price_per_unit,
          subtotal, gst_rate, gst_amount, total_amount, notes, req.user.id]);

      const transaction = txnRows[0];

      // 4. Update material stock (add incoming weight)
      await client.query(`
        UPDATE materials
        SET stock_qty = stock_qty + $1, updated_at = NOW()
        WHERE id = $2
      `, [weight, material_id]);

      // 5. Auto-create invoice
      const invoice_number = await generateInvoiceNumber(client);
      const { rows: invRows } = await client.query(`
        INSERT INTO invoices (invoice_number, transaction_id, supplier_id, amount, due_date, payment_method)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `, [invoice_number, transaction.id, supplier_id, total_amount, due_date, payment_method]);

      await client.query('COMMIT');

      res.status(201).json({
        success: true,
        message: 'Transaction recorded and invoice created.',
        transaction: {
          ...transaction,
          material_name: material.name,
          supplier_name: supplierRes.rows[0].name,
        },
        invoice: invRows[0],
      });

    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  })
);

// ── DELETE /api/transactions/:id (admin only) ─────────────────────────────────
router.delete('/:id', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  // Reverse stock change before deleting
  const { rows } = await query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
  if (rows.length === 0) return res.status(404).json({ success: false, message: 'Transaction not found.' });

  const txn = rows[0];
  const client = await getClient();
  try {
    await client.query('BEGIN');
    // Reverse stock
    await client.query(
      'UPDATE materials SET stock_qty = stock_qty - $1 WHERE id = $2',
      [txn.weight, txn.material_id]
    );
    // Delete invoice and transaction
    await client.query('DELETE FROM invoices WHERE transaction_id = $1', [req.params.id]);
    await client.query('DELETE FROM transactions WHERE id = $1', [req.params.id]);
    await client.query('COMMIT');
    res.json({ success: true, message: 'Transaction and associated invoice deleted. Stock reversed.' });
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

module.exports = router;
