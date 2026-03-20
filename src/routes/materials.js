// src/routes/materials.js
const express = require('express');
const router  = express.Router();
const { body, validationResult } = require('express-validator');
const { query } = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// ── GET /api/materials ────────────────────────────────────────────────────────
// Returns all active materials with stock info
router.get('/', auth, asyncHandler(async (req, res) => {
  const { category } = req.query;

  let sql = `
    SELECT id, name, category, unit, buy_price, sell_price,
           stock_qty, min_threshold, color_hex, is_active, updated_at
    FROM materials
    WHERE is_active = true
  `;
  const params = [];

  if (category) {
    params.push(category);
    sql += ` AND category = $${params.length}`;
  }

  sql += ' ORDER BY category, name';

  const { rows } = await query(sql, params);

  // Flag low stock items
  const enriched = rows.map(m => ({
    ...m,
    is_low_stock: parseFloat(m.stock_qty) <= parseFloat(m.min_threshold),
  }));

  res.json({ success: true, count: rows.length, materials: enriched });
}));

// ── GET /api/materials/:id ────────────────────────────────────────────────────
router.get('/:id', auth, asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM materials WHERE id = $1', [req.params.id]);

  if (rows.length === 0) {
    return res.status(404).json({ success: false, message: 'Material not found.' });
  }
  res.json({ success: true, material: rows[0] });
}));

// ── POST /api/materials (admin/cashier) ───────────────────────────────────────
router.post('/',
  auth,
  requireRole('admin', 'cashier'),
  [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('category').isIn(['Ferrous', 'Non-Ferrous']).withMessage('Category must be Ferrous or Non-Ferrous'),
    body('buy_price').isFloat({ min: 0 }).withMessage('Buy price must be a positive number'),
    body('sell_price').isFloat({ min: 0 }).withMessage('Sell price must be a positive number'),
    body('min_threshold').optional().isFloat({ min: 0 }),
  ],
  asyncHandler(async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(422).json({ success: false, errors: errors.array() });
    }

    const { name, category, unit = 'kg', buy_price, sell_price, stock_qty = 0, min_threshold = 0, color_hex = '#f5a623' } = req.body;

    const { rows } = await query(`
      INSERT INTO materials (name, category, unit, buy_price, sell_price, stock_qty, min_threshold, color_hex)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `, [name, category, unit, buy_price, sell_price, stock_qty, min_threshold, color_hex]);

    res.status(201).json({ success: true, message: 'Material created.', material: rows[0] });
  })
);

// ── PUT /api/materials/:id (admin/cashier) ────────────────────────────────────
router.put('/:id',
  auth,
  requireRole('admin', 'cashier'),
  asyncHandler(async (req, res) => {
    const existing = await query('SELECT * FROM materials WHERE id = $1', [req.params.id]);
    if (existing.rows.length === 0) {
      return res.status(404).json({ success: false, message: 'Material not found.' });
    }

    const m = existing.rows[0];
    const {
      name        = m.name,
      category    = m.category,
      unit        = m.unit,
      buy_price   = m.buy_price,
      sell_price  = m.sell_price,
      stock_qty   = m.stock_qty,
      min_threshold = m.min_threshold,
      color_hex   = m.color_hex,
    } = req.body;

    // Record price changes in history
    if (parseFloat(buy_price) !== parseFloat(m.buy_price) || parseFloat(sell_price) !== parseFloat(m.sell_price)) {
      await query(`
        INSERT INTO price_history (material_id, old_buy_price, new_buy_price, old_sell_price, new_sell_price, changed_by)
        VALUES ($1, $2, $3, $4, $5, $6)
      `, [req.params.id, m.buy_price, buy_price, m.sell_price, sell_price, req.user.id]);
    }

    const { rows } = await query(`
      UPDATE materials
      SET name=$1, category=$2, unit=$3, buy_price=$4, sell_price=$5,
          stock_qty=$6, min_threshold=$7, color_hex=$8, updated_at=NOW()
      WHERE id=$9
      RETURNING *
    `, [name, category, unit, buy_price, sell_price, stock_qty, min_threshold, color_hex, req.params.id]);

    res.json({ success: true, message: 'Material updated.', material: rows[0] });
  })
);

// ── DELETE /api/materials/:id (admin only — soft delete) ──────────────────────
router.delete('/:id', auth, requireRole('admin'), asyncHandler(async (req, res) => {
  const { rowCount } = await query(
    'UPDATE materials SET is_active = false, updated_at = NOW() WHERE id = $1',
    [req.params.id]
  );
  if (rowCount === 0) return res.status(404).json({ success: false, message: 'Material not found.' });
  res.json({ success: true, message: 'Material deactivated.' });
}));

// ── GET /api/materials/:id/price-history ──────────────────────────────────────
router.get('/:id/price-history', auth, asyncHandler(async (req, res) => {
  const { rows } = await query(`
    SELECT ph.*, u.name AS changed_by_name
    FROM price_history ph
    LEFT JOIN users u ON ph.changed_by = u.id
    WHERE ph.material_id = $1
    ORDER BY ph.changed_at DESC
    LIMIT 50
  `, [req.params.id]);

  res.json({ success: true, history: rows });
}));

module.exports = router;
