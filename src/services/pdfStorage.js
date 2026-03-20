// src/services/pdfStorage.js
// ─────────────────────────────────────────────────────────────────────────────
// Generates invoice PDF on the server (Node.js) and either:
//   - Uploads to AWS S3  (production)
//   - Serves from local disk  (development/LAN)
// Returns a public URL that can be sent in WhatsApp
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();
const fs   = require('fs');
const path = require('path');

const USE_S3        = process.env.AWS_S3_BUCKET && process.env.AWS_ACCESS_KEY_ID;
const SERVER_BASE   = process.env.SERVER_BASE_URL || 'http://localhost:5000';
const LOCAL_PDF_DIR = path.join(__dirname, '../../temp_pdfs');

// Ensure local PDF directory exists
if (!USE_S3 && !fs.existsSync(LOCAL_PDF_DIR)) {
  fs.mkdirSync(LOCAL_PDF_DIR, { recursive: true });
}

// ── Generate PDF Buffer from invoice data (server-side, no browser) ───────────
// Uses PDFKit (lighter alternative to jsPDF for Node.js)
async function generatePDFBuffer(invoiceData) {
  // Dynamically require PDFKit only when needed
  let PDFDocument;
  try {
    PDFDocument = require('pdfkit');
  } catch {
    throw new Error('pdfkit not installed. Run: npm install pdfkit');
  }

  return new Promise((resolve, reject) => {
    const doc    = new PDFDocument({ size: 'A4', margin: 40 });
    const chunks = [];

    doc.on('data',  chunk => chunks.push(chunk));
    doc.on('end',   ()    => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const {
      supplierName, invoiceNumber, transactionId, materialName,
      weight, unit, pricePerUnit, total, date, status,
      gstRate = 0, gstAmount = 0, supplierPhone, supplierEmail,
    } = invoiceData;

    const PW = 595 - 80; // usable width (A4 minus margins)
    const inr = (n) => '\u20B9' + Number(n).toLocaleString('en-IN', { minimumFractionDigits: 2 });

    // ── AMBER HEADER ─────────────────────────────────────────────────────────
    doc.rect(0, 0, 595, 100).fill('#F5A623');
    doc.fontSize(26).fillColor('#ffffff').font('Helvetica-Bold')
       .text('THE SCRAP CO.', 40, 20);
    doc.fontSize(10).font('Helvetica').fillColor('#FFEAB0')
       .text('The Scrap Co. Pvt. Ltd', 40, 50)
       .text('GSTIN: 27AABCS1234D1Z5  |  support@thescrapco.in', 40, 64)
       .text('Plot 14, MIDC Industrial Area, Pune, Maharashtra - 411018', 40, 78);

    // INVOICE label (top right)
    doc.fontSize(28).font('Helvetica-Bold').fillColor('#ffffff')
       .text('INVOICE', 300, 22, { width: 255, align: 'right' });
    doc.fontSize(10).font('Helvetica').fillColor('#FFEAB0')
       .text(invoiceNumber, 300, 58, { width: 255, align: 'right' })
       .text('TXN: ' + transactionId, 300, 72, { width: 255, align: 'right' });

    // ── META ROW ─────────────────────────────────────────────────────────────
    doc.rect(40, 112, PW, 36).fillAndStroke('#FEF3DB', '#FEF3DB');
    const metaFields = [
      ['INVOICE DATE', date],
      ['STATUS',       status.toUpperCase()],
      ['TRANSACTION',  transactionId],
    ];
    const statusColors = { PAID: '#16A34A', PENDING: '#B45309', OVERDUE: '#B91C1C' };
    metaFields.forEach(([label, val], i) => {
      const x = 50 + i * 170;
      doc.fontSize(7).font('Helvetica').fillColor('#A0A7B0').text(label, x, 120);
      doc.fontSize(10).font('Helvetica-Bold')
         .fillColor(i === 1 ? (statusColors[val] || '#323740') : '#323740')
         .text(val, x, 132);
    });

    // ── BILL TO ───────────────────────────────────────────────────────────────
    doc.rect(40, 162, 230, 80).fillAndStroke('#F8F9FA', '#DCDEE2');
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#F5A623').text('BILL TO', 52, 172);
    doc.fontSize(13).font('Helvetica-Bold').fillColor('#0D0E0F')
       .text(supplierName || 'Supplier', 52, 184, { width: 206 });
    doc.fontSize(9).font('Helvetica').fillColor('#6469A0');
    if (supplierPhone) doc.text('Phone: ' + supplierPhone, 52, 202);
    if (supplierEmail) doc.text(supplierEmail, 52, 214);

    // ── TABLE HEADER ──────────────────────────────────────────────────────────
    const tableTop = 258;
    doc.rect(40, tableTop, PW, 26).fill('#0D0E0F');
    doc.fontSize(8).font('Helvetica-Bold').fillColor('#ffffff');
    doc.text('#',           50,  tableTop + 9);
    doc.text('DESCRIPTION', 65,  tableTop + 9);
    doc.text('MATERIAL',    250, tableTop + 9);
    doc.text('QTY',         360, tableTop + 9, { width: 60, align: 'right' });
    doc.text('RATE',        420, tableTop + 9, { width: 60, align: 'right' });
    doc.text('AMOUNT',      480, tableTop + 9, { width: 75, align: 'right' });

    // ── TABLE ROW ─────────────────────────────────────────────────────────────
    const rowTop = tableTop + 26;
    doc.rect(40, rowTop, PW, 36).fillAndStroke('#ffffff', '#DCDEE2');
    doc.fontSize(9).font('Helvetica').fillColor('#323740');
    doc.text('1',            50,  rowTop + 13);
    doc.text(materialName + ' Scrap — Supplier Purchase', 65, rowTop + 13, { width: 175 });
    doc.font('Helvetica-Bold').text(materialName, 250, rowTop + 13, { width: 100 });
    doc.font('Helvetica').text(
      Number(weight).toLocaleString('en-IN') + ' ' + unit,
      360, rowTop + 13, { width: 60, align: 'right' }
    );
    doc.text(inr(pricePerUnit), 420, rowTop + 13, { width: 60, align: 'right' });
    doc.font('Helvetica-Bold').text(inr(total), 480, rowTop + 13, { width: 75, align: 'right' });

    // ── TOTALS ────────────────────────────────────────────────────────────────
    const totTop = rowTop + 56;
    doc.rect(330, totTop, 225, 90).fillAndStroke('#F8F9FA', '#DCDEE2');
    doc.fontSize(9).font('Helvetica').fillColor('#6469A0')
       .text('Subtotal', 342, totTop + 14);
    doc.fillColor('#323740').text(inr(total - gstAmount), 342, totTop + 14, { width: 201, align: 'right' });
    doc.moveTo(342, totTop + 28).lineTo(543, totTop + 28).strokeColor('#DCDEE2').stroke();
    doc.fillColor('#6469A0').text(`GST (${gstRate}%)`, 342, totTop + 34);
    doc.fillColor('#323740').text(inr(gstAmount), 342, totTop + 34, { width: 201, align: 'right' });
    doc.moveTo(342, totTop + 48).lineTo(543, totTop + 48).strokeColor('#DCDEE2').stroke();

    // Total due amber block
    doc.rect(330, totTop + 52, 225, 30).fill('#F5A623');
    doc.fontSize(12).font('Helvetica-Bold').fillColor('#ffffff')
       .text('TOTAL DUE', 342, totTop + 62);
    doc.text(inr(total), 342, totTop + 62, { width: 201, align: 'right' });

    // Amount in words
    doc.fontSize(8).font('Helvetica').fillColor('#A0A7B0').text('Amount in words:', 40, totTop + 14);
    doc.font('Helvetica-Bold').fillColor('#323740')
       .text(numToWords(Math.round(total)) + ' Rupees Only', 40, totTop + 26, { width: 280 });

    // ── TERMS ─────────────────────────────────────────────────────────────────
    const termTop = totTop + 110;
    doc.moveTo(40, termTop).lineTo(555, termTop).strokeColor('#DCDEE2').lineWidth(0.5).stroke();
    doc.fontSize(7).font('Helvetica-Bold').fillColor('#F5A623').text('TERMS & CONDITIONS', 40, termTop + 10);
    doc.font('Helvetica').fillColor('#6469A0')
       .text('1. Payment due within 7 days of invoice date.', 40, termTop + 22)
       .text('2. All scrap purchased as-is. No returns after weighing.', 40, termTop + 32)
       .text('3. Computer generated invoice — no signature required.', 40, termTop + 42)
       .text('4. Disputes: accounts@thescrapco.in within 24 hrs.', 40, termTop + 52);

    // ── FOOTER ────────────────────────────────────────────────────────────────
    doc.rect(0, 762, 595, 80).fill('#0D0E0F');
    doc.fontSize(9).font('Helvetica-Bold').fillColor('#F5A623').text('THE SCRAP CO.', 40, 776);
    doc.fontSize(7.5).font('Helvetica').fillColor('#8A9099')
       .text('Plot 14, MIDC Industrial Area, Pune  |  +91 98765 43210  |  support@thescrapco.in', 150, 776);
    doc.text('Page 1 of 1', 40, 776, { width: PW + 40, align: 'right' });

    doc.end();
  });
}

// ── Upload to AWS S3 ──────────────────────────────────────────────────────────
async function uploadToS3(buffer, filename) {
  const AWS = require('aws-sdk');
  const s3  = new AWS.S3({
    accessKeyId:     process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region:          process.env.AWS_REGION || 'ap-south-1',
  });

  const params = {
    Bucket:      process.env.AWS_S3_BUCKET,
    Key:         `invoices/${filename}`,
    Body:        buffer,
    ContentType: 'application/pdf',
    ACL:         'public-read',
  };

  const result = await s3.upload(params).promise();
  return result.Location; // public URL
}

// ── Save locally and return URL ───────────────────────────────────────────────
function saveLocally(buffer, filename) {
  const filePath = path.join(LOCAL_PDF_DIR, filename);
  fs.writeFileSync(filePath, buffer);
  return `${SERVER_BASE}/api/invoices/pdf/${filename}`;
}

// ── Main: generate + store + return URL ──────────────────────────────────────
async function generateAndStorePDF(invoiceData) {
  const filename = `Invoice_${invoiceData.invoiceNumber}_${invoiceData.date}.pdf`
    .replace(/[^a-zA-Z0-9_\-.]/g, '_');

  try {
    const buffer = await generatePDFBuffer(invoiceData);
    let url;
    if (USE_S3) {
      url = await uploadToS3(buffer, filename);
      console.log(`[PDF] Uploaded to S3: ${url}`);
    } else {
      url = saveLocally(buffer, filename);
      console.log(`[PDF] Saved locally: ${url}`);
    }
    return { url, filename, buffer };
  } catch (err) {
    console.error('[PDF] Generation failed:', err.message);
    return { url: null, filename, buffer: null, error: err.message };
  }
}

// ── Serve local PDFs middleware ────────────────────────────────────────────────
function servePDFMiddleware(req, res) {
  const filename = req.params.filename;
  const filePath = path.join(LOCAL_PDF_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, message: 'PDF not found.' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
  res.sendFile(filePath);
}

// ── Number to words helper (Indian) ──────────────────────────────────────────
function numToWords(num) {
  if (num === 0) return 'Zero';
  const ones = ['','One','Two','Three','Four','Five','Six','Seven','Eight','Nine',
    'Ten','Eleven','Twelve','Thirteen','Fourteen','Fifteen','Sixteen','Seventeen','Eighteen','Nineteen'];
  const tens  = ['','','Twenty','Thirty','Forty','Fifty','Sixty','Seventy','Eighty','Ninety'];
  function cv(n) {
    if (n<20)  return ones[n];
    if (n<100) return tens[Math.floor(n/10)]+(n%10?' '+ones[n%10]:'');
    return ones[Math.floor(n/100)]+' Hundred'+(n%100?' '+cv(n%100):'');
  }
  let r='';
  if(num>=10000000){r+=cv(Math.floor(num/10000000))+' Crore '; num%=10000000;}
  if(num>=100000){r+=cv(Math.floor(num/100000))+' Lakh '; num%=100000;}
  if(num>=1000){r+=cv(Math.floor(num/1000))+' Thousand '; num%=1000;}
  if(num>0)r+=cv(num);
  return r.trim();
}

module.exports = { generateAndStorePDF, servePDFMiddleware };
