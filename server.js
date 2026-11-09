// server.js (at project root)
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import cors from 'cors';

// Import your Vercel handlers directly
import createOrderHandler from './api/orders/create.js';
import stkPushHandler from './api/stkpush.js';
import webhookHandler from './api/webhook.js';
import downloadHandler from './api/download.js';

// Import Admin handlers
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

// --- 2. MANUAL API ROUTING WITH RAW BODY PARSING ---
// We use express.raw({ type: '*/*' }) so the Vercel handlers can read the raw stream.
// We then manually parse it so our fallback works if the Vercel parser fails.

const rawBodyMiddleware = express.raw({ type: '*/*' });

// Orders
app.post('/api/orders/create', rawBodyMiddleware, async (req, res) => {
  try {
    // Fallback: If req.body is a Buffer, parse it to JSON manually
    if (Buffer.isBuffer(req.body)) {
      try { req.body = JSON.parse(req.body.toString()); } catch (e) { console.error("JSON parse failed", e); }
    }
    await createOrderHandler(req, res);
  } catch (err) {
    console.error("Error in createOrderHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// M-Pesa STK Push
app.post('/api/stkpush', rawBodyMiddleware, async (req, res) => {
  try {
    if (Buffer.isBuffer(req.body)) {
      try { req.body = JSON.parse(req.body.toString()); } catch (e) { console.error("JSON parse failed", e); }
    }
    await stkPushHandler(req, res);
  } catch (err) {
    console.error("Error in stkPushHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// M-Pesa Webhook
app.post('/api/webhook', rawBodyMiddleware, async (req, res) => {
  try {
    if (Buffer.isBuffer(req.body)) {
      try { req.body = JSON.parse(req.body.toString()); } catch (e) { console.error("JSON parse failed", e); }
    }
    await webhookHandler(req, res);
  } catch (err) {
    console.error("Error in webhookHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Downloads (GET requests don't need body parsing)
app.get('/api/download', async (req, res) => {
  try {
    await downloadHandler(req, res);
  } catch (err) {
    console.error("Error in downloadHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin Routes (GET requests)
app.get('/api/admin/orders', async (req, res) => {
  try {
    await adminOrdersHandler(req, res);
  } catch (err) {
    console.error("Error in adminOrdersHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/api/admin/books', async (req, res) => {
  try {
    await adminBooksHandler(req, res);
  } catch (err) {
    console.error("Error in adminBooksHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// --- 3. START SERVER ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server running on port ${PORT}`);
});