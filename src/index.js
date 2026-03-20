// src/index.js
// The Scrap Co. — Backend API Server

require('dotenv').config();
const express = require('express');
const cors    = require('cors');

const authRoutes         = require('./routes/auth');
const materialsRoutes    = require('./routes/materials');
const suppliersRoutes    = require('./routes/suppliers');
const transactionsRoutes = require('./routes/transactions');
const invoicesRoutes     = require('./routes/invoices');
const dashboardRoutes    = require('./routes/dashboard');
const { errorHandler }   = require('./middleware/errorHandler');

const app  = express();
const PORT = process.env.PORT || 5000;

// ── CORS ──────────────────────────────────────────────────────────────────────
const allowedOrigins = (process.env.ALLOWED_ORIGINS || 'http://localhost:3000').split(',');

app.use(cors({
  origin: (origin, cb) => {
    if (!origin || allowedOrigins.includes(origin)) {
      cb(null, true);
    } else {
      cb(new Error(`CORS: Origin ${origin} not allowed.`));
    }
  },
  credentials: true,
}));

// ── Body parsing ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Request logger (dev) ──────────────────────────────────────────────────────
if (process.env.NODE_ENV !== 'production') {
  app.use((req, _res, next) => {
    console.log(`${req.method} ${req.path}`);
    next();
  });
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({
  status: 'ok',
  service: 'The Scrap Co. API',
  version: '1.0.0',
  timestamp: new Date().toISOString(),
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use('/api/auth',         authRoutes);
app.use('/api/materials',    materialsRoutes);
app.use('/api/suppliers',    suppliersRoutes);
app.use('/api/transactions', transactionsRoutes);
app.use('/api/invoices',     invoicesRoutes);
app.use('/api/dashboard',    dashboardRoutes);
app.use('/api/customers',         require('./routes/customers'));
app.use('/api/purchase-receipts', require('./routes/purchaseReceipts'));

const whatsappRoutes = require('./routes/whatsapp');
app.use('/api/whatsapp', whatsappRoutes);

// ── 404 handler ───────────────────────────────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, message: 'Route not found.' });
});

// ── Central error handler ─────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log('');
  console.log('  ████████╗██╗  ██╗███████╗    ███████╗ ██████╗██████╗  █████╗ ██████╗  ');
  console.log('     ██╔══╝██║  ██║██╔════╝    ██╔════╝██╔════╝██╔══██╗██╔══██╗██╔══██╗ ');
  console.log('     ██║   ███████║█████╗      ███████╗██║     ██████╔╝███████║██████╔╝ ');
  console.log('     ██║   ██╔══██║██╔══╝      ╚════██║██║     ██╔══██╗██╔══██║██╔═══╝  ');
  console.log('     ██║   ██║  ██║███████╗    ███████║╚██████╗██║  ██║██║  ██║██║      ');
  console.log('     ╚═╝   ╚═╝  ╚═╝╚══════╝   ╚══════╝ ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝      ');
  console.log('');
  console.log(`  🏭  The Scrap Co. API is running`);
  console.log(`  🌐  http://localhost:${PORT}`);
  console.log(`  ✅  Health: http://localhost:${PORT}/health`);
  console.log(`  📦  Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('');
});

module.exports = app;
