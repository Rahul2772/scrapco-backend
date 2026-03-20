// src/routes/dashboard.js
// Aggregated analytics for the frontend dashboard
const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { auth } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');

// ── GET /api/dashboard ────────────────────────────────────────────────────────
router.get('/', auth, asyncHandler(async (req, res) => {

  const [
    revenueStats,
    stockAlerts,
    recentTransactions,
    monthlyTrend,
    topMaterials,
    invoiceSummary,
  ] = await Promise.all([

    // Total revenue & weight this month
    query(`
      SELECT
        COALESCE(SUM(total_amount), 0)  AS revenue_this_month,
        COALESCE(SUM(weight), 0)        AS weight_this_month,
        COUNT(*)                         AS txn_count_this_month
      FROM transactions
      WHERE created_at >= date_trunc('month', NOW())
    `),

    // Low stock materials
    query(`
      SELECT id, name, stock_qty, min_threshold, color_hex, unit
      FROM materials
      WHERE stock_qty <= min_threshold AND is_active = true
      ORDER BY (stock_qty::float / NULLIF(min_threshold, 0)) ASC
    `),

    // Last 10 transactions
    query(`
      SELECT t.id, t.txn_number, t.weight, t.unit, t.total_amount, t.created_at,
        s.name AS supplier_name,
        m.name AS material_name, m.color_hex,
        i.status AS invoice_status, i.invoice_number
      FROM transactions t
      LEFT JOIN suppliers   s ON t.supplier_id = s.id
      LEFT JOIN materials   m ON t.material_id = m.id
      LEFT JOIN invoices    i ON i.transaction_id = t.id
      ORDER BY t.created_at DESC
      LIMIT 10
    `),

    // Monthly revenue last 6 months
    query(`
      SELECT
        TO_CHAR(date_trunc('month', created_at), 'Mon') AS month,
        COALESCE(SUM(total_amount), 0) AS total_revenue,
        COUNT(*) AS transaction_count
      FROM transactions
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY date_trunc('month', created_at)
      ORDER BY date_trunc('month', created_at)
    `),

    // Top 5 materials by revenue this month
    query(`
      SELECT
        m.name, m.color_hex,
        SUM(t.total_amount) AS revenue,
        SUM(t.weight) AS weight_collected
      FROM transactions t
      JOIN materials m ON t.material_id = m.id
      WHERE t.created_at >= date_trunc('month', NOW())
      GROUP BY m.id, m.name, m.color_hex
      ORDER BY revenue DESC
      LIMIT 5
    `),

    // Invoice summary
    query(`
      SELECT
        COUNT(*) FILTER (WHERE status='pending') AS pending_count,
        COUNT(*) FILTER (WHERE status='overdue') AS overdue_count,
        COALESCE(SUM(amount) FILTER (WHERE status='pending'), 0) AS pending_amount,
        COALESCE(SUM(amount) FILTER (WHERE status='overdue'), 0) AS overdue_amount
      FROM invoices
    `),
  ]);

  res.json({
    success: true,
    dashboard: {
      revenue:             revenueStats.rows[0],
      low_stock_alerts:    stockAlerts.rows,
      recent_transactions: recentTransactions.rows,
      monthly_trend:       monthlyTrend.rows,
      top_materials:       topMaterials.rows,
      invoice_summary:     invoiceSummary.rows[0],
    },
  });
}));

module.exports = router;
