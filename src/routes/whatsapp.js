// src/routes/whatsapp.js
// ─────────────────────────────────────────────────────────────────────────────
// WhatsApp receipt routes
// POST /api/whatsapp/send/:transactionId  — send receipt for a transaction
// POST /api/whatsapp/test                 — send a test message (admin only)
// GET  /api/whatsapp/logs                 — see send history
// ─────────────────────────────────────────────────────────────────────────────

const express = require('express');
const router  = express.Router();
const { query } = require('../db/pool');
const { auth, requireRole } = require('../middleware/auth');
const { asyncHandler } = require('../middleware/errorHandler');
const { sendWhatsAppReceipt } = require('../services/whatsapp');
const { generateAndStorePDF }  = require('../services/pdfStorage');

// ── Helper: fetch full transaction details ────────────────────────────────────
async function getTransactionDetails(transactionId) {
  const { rows } = await query(`
    SELECT
      t.id, t.txn_number, t.weight, t.unit, t.price_per_unit,
      t.subtotal, t.gst_rate, t.gst_amount, t.total_amount,
      t.created_at::date AS date, t.notes,
      s.name AS supplier_name, s.phone AS supplier_phone,
      s.email AS supplier_email,
      m.name AS material_name,
      i.invoice_number, i.status AS invoice_status
    FROM transactions t
    LEFT JOIN suppliers   s ON t.supplier_id   = s.id
    LEFT JOIN materials   m ON t.material_id   = m.id
    LEFT JOIN invoices    i ON i.transaction_id = t.id
    WHERE t.id = $1
  `, [transactionId]);
  return rows[0] || null;
}

// ── POST /api/whatsapp/send/:transactionId ────────────────────────────────────
// Generates PDF + sends WhatsApp receipt to supplier
router.post('/send/:transactionId',
  auth,
  requireRole('admin', 'cashier'),
  asyncHandler(async (req, res) => {
    const txn = await getTransactionDetails(req.params.transactionId);
    if (!txn) {
      return res.status(404).json({ success: false, message: 'Transaction not found.' });
    }

    if (!txn.supplier_phone) {
      return res.status(400).json({
        success: false,
        message: 'This supplier has no phone number on record. Update supplier details first.',
      });
    }

    // Build receipt data object
    const receiptData = {
      supplierName:  txn.supplier_name,
      invoiceNumber: txn.invoice_number || txn.txn_number,
      transactionId: txn.txn_number,
      materialName:  txn.material_name,
      weight:        txn.weight,
      unit:          txn.unit,
      pricePerUnit:  txn.price_per_unit,
      total:         txn.total_amount,
      gstRate:       txn.gst_rate,
      gstAmount:     txn.gst_amount,
      date:          new Date(txn.date).toLocaleDateString('en-IN'),
      status:        txn.invoice_status || 'pending',
      supplierPhone: txn.supplier_phone,
      supplierEmail: txn.supplier_email,
      notes:         txn.notes,
    };

    // 1. Generate PDF and get URL
    const { url: pdfUrl, error: pdfError } = await generateAndStorePDF({
      ...receiptData,
      invoiceNumber: txn.invoice_number || ('INV-' + txn.txn_number),
    });

    if (pdfError) console.warn('[WhatsApp] PDF generation failed:', pdfError);

    receiptData.pdfUrl = pdfUrl;

    // 2. Send WhatsApp
    const result = await sendWhatsAppReceipt(txn.supplier_phone, receiptData);

    // 3. Log to DB
    await query(`
      INSERT INTO whatsapp_logs
        (transaction_id, supplier_phone, status, message_id, provider, pdf_url, error)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT DO NOTHING
    `, [
      txn.id,
      txn.supplier_phone,
      result.success ? 'sent' : 'failed',
      result.messageId || null,
      result.provider  || 'unknown',
      pdfUrl || null,
      result.error     || null,
    ]).catch(() => {}); // log errors silently

    if (!result.success && !result.skipped) {
      return res.status(502).json({
        success: false,
        message: 'WhatsApp send failed.',
        error:   result.error,
      });
    }

    res.json({
      success:  true,
      message:  result.skipped
        ? 'Skipped — ' + result.reason
        : `WhatsApp receipt sent to ${txn.supplier_phone}`,
      pdfUrl,
      whatsapp: result,
    });
  })
);

// ── POST /api/whatsapp/test (admin only) ──────────────────────────────────────
router.post('/test',
  auth,
  requireRole('admin'),
  asyncHandler(async (req, res) => {
    const { phone } = req.body;
    if (!phone) {
      return res.status(400).json({ success: false, message: 'phone is required.' });
    }

    const { sendTestMessage } = require('../services/whatsapp');
    const result = await sendTestMessage(phone);

    res.json({
      success: result.success,
      message: result.success
        ? `Test message sent to ${phone}`
        : 'Test failed: ' + result.error,
      result,
    });
  })
);

// ── GET /api/whatsapp/logs ─────────────────────────────────────────────────────
router.get('/logs',
  auth,
  requireRole('admin', 'cashier'),
  asyncHandler(async (req, res) => {
    const { rows } = await query(`
      SELECT
        wl.*,
        t.txn_number,
        s.name AS supplier_name
      FROM whatsapp_logs wl
      LEFT JOIN transactions t ON wl.transaction_id = t.id
      LEFT JOIN suppliers    s ON t.supplier_id = s.id
      ORDER BY wl.sent_at DESC
      LIMIT 100
    `).catch(() => ({ rows: [] }));

    res.json({ success: true, logs: rows });
  })
);

module.exports = router;
