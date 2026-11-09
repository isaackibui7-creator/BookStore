// server.js (at project root)
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import cors from 'cors';
import bodyParser from 'body-parser';
import crypto from 'crypto'; 

// Import your Vercel handlers directly
import createOrderHandler from './api/orders/create.js';
import webhookHandler from './api/webhook.js';
import downloadHandler from './api/download.js';
import adminOrdersHandler from './api/admin/orders.js'; 
import adminBooksHandler from './api/admin/books.js';   

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// --- 1. CORS CONFIGURATION ---
const allowedOrigins = [
  'https://isaackkibuibooksofadvisoryinternational.co.ke',
  'https://www.isaackkibuibooksofadvisoryinternational.co.ke',
  'https://bookstore-kchh.onrender.com',
  'http://localhost:5173'
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) === -1) {
      return callback(new Error('CORS blocked'), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Increase limit for large book cover uploads
app.use(bodyParser.json({ limit: '50mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '50mb' }));

// --- 2. MANUAL API ROUTING ---

// Orders
app.post('/api/orders/create', async (req, res) => {
  try {
    await createOrderHandler(req, res);
  } catch (err) {
    console.error("CRITICAL ERROR in /api/orders/create:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
});

// --- INLINE STK PUSH ROUTE (For better error logging) ---
app.post('/api/stkpush', async (req, res) => {
  try {
    const { requestXecoflowJson, buildXecoflowStkPushUrl, getMissingXecoflowConfig } = await import('./api/_lib/xecoflow.js');

    const endpoint = buildXecoflowStkPushUrl();
    const missing = getMissingXecoflowConfig({ requirePayments: true });

    if (!endpoint) missing.push("XECOFLOW_BASE_URL");

    if (missing.length) {
      return res.status(500).json({ error: "STK proxy is not configured.", missing: [...new Set(missing)] });
    }

    const body = req.body;
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

    const data = await requestXecoflowJson(endpoint, {
      method: "POST",
      body: payload,
      sign: true
    });

    res.status(200).json(data);
  } catch (err) {
    console.error("CRITICAL ERROR in /api/stkpush:", err);
    res.status(500).json({ error: err.message || "Internal error in stkpush" });
  }
});

// Webhook
app.post('/api/webhook', async (req, res) => {
  try { await webhookHandler(req, res); } catch (err) { console.error("ERROR webhook:", err); res.status(500).json({error: err.message}); }
});

// Downloads
app.get('/api/download', async (req, res) => {
  try { await downloadHandler(req, res); } catch (err) { console.error("ERROR download:", err); res.status(500).json({error: err.message}); }
});

// --- ADMIN ROUTES (Handles GET, POST, PUT, DELETE automatically) ---
app.all('/api/admin/books', async (req, res) => {
  try { 
    await adminBooksHandler(req, res); 
  } catch (err) { 
    console.error(`ERROR admin books ${req.method}:`, err); 
    res.status(500).json({error: err.message}); 
  }
});

app.all('/api/admin/orders', async (req, res) => {
  try { 
    await adminOrdersHandler(req, res); 
  } catch (err) { 
    console.error(`ERROR admin orders ${req.method}:`, err); 
    res.status(500).json({error: err.message}); 
  }
});

// --- 4. START SERVER ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server running on port ${PORT}`);
});