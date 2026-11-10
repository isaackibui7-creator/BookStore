// server.js (at project root)
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import cors from 'cors';
import bodyParser from 'body-parser';
import crypto from 'crypto'; 

import createOrderHandler from './api/orders/create.js';
import webhookHandler from './api/webhook.js';
import downloadHandler from './api/download.js';
import adminOrdersHandler from './api/admin/orders.js'; 
import adminBooksHandler from './api/admin/books.js';   

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- 1. CORS ---
const allowedOrigins = [
  'https://isaackkibuibooksofadvisoryinternational.co.ke',
  'https://www.isaackkibuibooksofadvisoryinternational.co.ke',
  'https://bookstore-kchh.onrender.com',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) return callback(new Error('CORS blocked'), false);
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// --- 2. BODY PARSING (Only for other routes) ---
app.use(bodyParser.json({ limit: '10mb', strict: false }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// --- 3. DIAGNOSTIC TEST ROUTE ---
app.post('/api/stkpush-test', (req, res) => {
  console.log("✅ TEST ROUTE HIT! Data received:", req.body);
  res.status(200).json({ success: true, message: "Backend works!", received: req.body });
});

// --- 4. ACTUAL API ROUTES ---

app.post('/api/orders/create', async (req, res) => {
  try {
    await createOrderHandler(req, res);
  } catch (err) {
    console.error("CRITICAL ERROR in /api/orders/create:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
});

// --- BULLETPROOF STK PUSH ROUTE ---
// We DO NOT use bodyParser here. We read the raw stream manually.
app.post('/api/stkpush', async (req, res) => {
  try {
    // 1. Manually read the raw stream
    const buffers = [];
    for await (const chunk of req) {
      buffers.push(chunk);
    }
    const rawData = Buffer.concat(buffers).toString();
    
    let body = {};
    if (rawData) {
      try {
        body = JSON.parse(rawData);
      } catch (e) {
        console.error("Failed to parse raw JSON:", rawData);
        return res.status(400).json({ error: "Invalid JSON payload" });
      }
    }

    console.log("🚀 STK ROUTE HIT! Parsed Body:", body);

    const { requestXecoflowJson, buildXecoflowStkPushUrl, getMissingXecoflowConfig } = await import('./api/_lib/xecoflow.js');

    const endpoint = buildXecoflowStkPushUrl();
    const missing = getMissingXecoflowConfig({ requirePayments: true });

    if (!endpoint) missing.push("XECOFLOW_BASE_URL");

    if (missing.length) {
      console.log("❌ MISSING CONFIG:", missing);
      return res.status(500).json({ error: "STK proxy is not configured.", missing: [...new Set(missing)] });
    }

    const amount = Number(body.amount);
    const phone = (body.phone || body.phoneNumber || "").toString().trim();
    const reference = (body.reference || body.orderId || "").toString().trim();
    const description = (body.description || "Book Store Purchase").toString().trim();

    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "A valid amount is required." });
    if (!phone) return res.status(400).json({ error: "Phone number is required." });
    if (!reference) return res.status(400).json({ error: "Payment reference is required." });

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    const payload = { amount, phone, reference, description, nonce, timestamp, idempotency_key: idempotencyKey };
    console.log("📤 SENDING TO XECO:", payload);

    const data = await requestXecoflowJson(endpoint, {
      method: "POST",
      body: payload,
      sign: true
    });

    console.log("✅ XECO RESPONSE:", data);
    res.status(200).json(data);
  } catch (err) {
    console.error("🔥 CRITICAL ERROR in /api/stkpush:", err);
    res.status(500).json({ error: err.message || "Internal error in stkpush" });
  }
});

// Webhook, Downloads, Admin
app.post('/api/webhook', async (req, res) => { try { await webhookHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });
app.get('/api/download', async (req, res) => { try { await downloadHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });
app.all('/api/admin/books', async (req, res) => { try { await adminBooksHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });
app.all('/api/admin/orders', async (req, res) => { try { await adminOrdersHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });

// --- 5. START SERVER ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server running on port ${PORT}`);
});