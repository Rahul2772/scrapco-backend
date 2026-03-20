// src/services/whatsapp.js
// ─────────────────────────────────────────────────────────────────────────────
// The Scrap Co. — WhatsApp Receipt Service
// Supports: Twilio (sandbox, easy) + Meta Business API (production)
// ─────────────────────────────────────────────────────────────────────────────

require('dotenv').config();

const PROVIDER = process.env.WHATSAPP_PROVIDER || 'twilio';

// ── Format INR currency ───────────────────────────────────────────────────────
function formatINR(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ── Build the receipt message text ────────────────────────────────────────────
function buildReceiptMessage(data) {
  const {
    supplierName,
    invoiceNumber,
    transactionId,
    materialName,
    weight,
    unit,
    pricePerUnit,
    total,
    date,
    status,
    pdfUrl,
  } = data;

  const statusEmoji = { paid: '✅', pending: '⏳', overdue: '⚠️' }[status] || '📋';

  return [
    `🏭 *THE SCRAP CO.*`,
    `_Scrap Collection Receipt_`,
    ``,
    `Hello *${supplierName}*! 👋`,
    `Your scrap collection has been recorded.`,
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `📄 *Invoice:* ${invoiceNumber}`,
    `🔖 *Transaction:* ${transactionId}`,
    `📅 *Date:* ${date}`,
    `━━━━━━━━━━━━━━━━━━━━`,
    ``,
    `*Material Details*`,
    `• Type: ${materialName}`,
    `• Weight: ${Number(weight).toLocaleString('en-IN')} ${unit}`,
    `• Rate: ${formatINR(pricePerUnit)}/${unit}`,
    ``,
    `💰 *Amount Payable*`,
    `*${formatINR(total)}*`,
    ``,
    `${statusEmoji} Status: *${status.toUpperCase()}*`,
    ``,
    pdfUrl
      ? `📎 *Download Invoice PDF:*\n${pdfUrl}`
      : '',
    ``,
    `━━━━━━━━━━━━━━━━━━━━`,
    `For queries: +91 98765 43210`,
    `support@thescrapco.in`,
    ``,
    `_Thank you for doing business with us!_ 🙏`,
  ].filter(line => line !== null).join('\n');
}

// ── TWILIO PROVIDER ───────────────────────────────────────────────────────────
async function sendViaTwilio(toPhone, message, pdfUrl = null) {
  const twilio = require('twilio');
  const client = twilio(
    process.env.TWILIO_ACCOUNT_SID,
    process.env.TWILIO_AUTH_TOKEN
  );

  const payload = {
    from: process.env.TWILIO_WHATSAPP_FROM,
    to:   `whatsapp:${normalizePhone(toPhone)}`,
    body: message,
  };

  // Attach PDF as media if URL provided
  if (pdfUrl) {
    payload.mediaUrl = [pdfUrl];
  }

  const result = await client.messages.create(payload);

  return {
    success:    true,
    provider:   'twilio',
    messageId:  result.sid,
    status:     result.status,
    to:         result.to,
  };
}

// ── META BUSINESS API PROVIDER ────────────────────────────────────────────────
async function sendViaMeta(toPhone, data) {
  const { supplierName, invoiceNumber, total, date, materialName, weight, unit, pdfUrl } = data;

  const phone   = normalizePhone(toPhone).replace('+', '');
  const apiUrl  = `https://graph.facebook.com/v19.0/${process.env.META_PHONE_NUMBER_ID}/messages`;

  // Using a pre-approved template for structured messages
  // You must create and get this template approved at business.facebook.com
  const body = {
    messaging_product: 'whatsapp',
    to: phone,
    type: 'template',
    template: {
      name: process.env.META_TEMPLATE_NAME || 'scrapco_receipt',
      language: { code: 'en' },
      components: [
        {
          type: 'header',
          parameters: [{ type: 'text', text: 'THE SCRAP CO.' }],
        },
        {
          type: 'body',
          parameters: [
            { type: 'text', text: supplierName },
            { type: 'text', text: invoiceNumber },
            { type: 'text', text: `${materialName} — ${weight} ${unit}` },
            { type: 'text', text: `₹${Number(total).toLocaleString('en-IN')}` },
            { type: 'text', text: date },
          ],
        },
        ...(pdfUrl ? [{
          type: 'button',
          sub_type: 'url',
          index: '0',
          parameters: [{ type: 'text', text: pdfUrl }],
        }] : []),
      ],
    },
  };

  const res = await fetch(apiUrl, {
    method:  'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${process.env.META_WHATSAPP_TOKEN}`,
    },
    body: JSON.stringify(body),
  });

  const result = await res.json();

  if (!res.ok) {
    throw new Error(result.error?.message || 'Meta API error');
  }

  return {
    success:   true,
    provider:  'meta',
    messageId: result.messages?.[0]?.id,
    status:    'sent',
    to:        phone,
  };
}

// ── MAIN SEND FUNCTION ────────────────────────────────────────────────────────
async function sendWhatsAppReceipt(toPhone, receiptData) {
  if (!toPhone) {
    return { success: false, skipped: true, reason: 'No phone number provided for supplier.' };
  }

  const phone = normalizePhone(toPhone);
  if (!phone) {
    return { success: false, skipped: true, reason: 'Invalid phone number format.' };
  }

  try {
    if (PROVIDER === 'meta') {
      return await sendViaMeta(phone, receiptData);
    } else {
      // Twilio: build the full text message
      const message = buildReceiptMessage(receiptData);
      return await sendViaTwilio(phone, message, receiptData.pdfUrl);
    }
  } catch (err) {
    console.error('[WhatsApp] Send failed:', err.message);
    return {
      success:  false,
      error:    err.message,
      provider: PROVIDER,
    };
  }
}

// ── PHONE NORMALIZER ─────────────────────────────────────────────────────────
// Converts Indian numbers to E.164 format (+91XXXXXXXXXX)
function normalizePhone(phone) {
  if (!phone) return null;
  let cleaned = phone.toString().replace(/[\s\-\(\)\.]/g, '');

  // Already has country code
  if (cleaned.startsWith('+')) return cleaned;

  // Indian 10-digit number
  if (cleaned.length === 10 && /^[6-9]/.test(cleaned)) {
    return `+91${cleaned}`;
  }

  // Already has 91 prefix
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }

  return `+${cleaned}`;
}

// ── TEST MESSAGE (for development) ────────────────────────────────────────────
async function sendTestMessage(toPhone) {
  return sendWhatsAppReceipt(toPhone, {
    supplierName:  'Test Supplier',
    invoiceNumber: 'INV-00001',
    transactionId: 'TXN-00001',
    materialName:  'Copper',
    weight:        120,
    unit:          'kg',
    pricePerUnit:  752,
    total:         90240,
    date:          new Date().toLocaleDateString('en-IN'),
    status:        'pending',
    pdfUrl:        null,
  });
}

module.exports = {
  sendWhatsAppReceipt,
  buildReceiptMessage,
  normalizePhone,
  sendTestMessage,
};
