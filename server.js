// server.js (at project root)
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import cors from 'cors';
import bodyParser from 'body-parser';

// Import your Vercel handlers directly
import createOrderHandler from './api/orders/create.js';
import stkPushHandler from './api/stkpush.js';
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

// --- 2. BODY PARSING ---
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- 3. MANUAL API ROUTING WITH ERROR CATCHING ---

app.post('/api/orders/create', async (req, res) => {
  try {
    await createOrderHandler(req, res);
  } catch (err) {
    console.error("CRITICAL ERROR in /api/orders/create:", err);
    res.status(500).json({ error: err.message || "Internal Server Error in create order" });
  }
});

app.post('/api/stkpush', async (req, res) => {
  try {
    await stkPushHandler(req, res);
  } catch (err) {
    console.error("CRITICAL ERROR in /api/stkpush:", err);
    res.status(500).json({ error: err.message || "Internal Server Error in stkpush" });
  }
});

app.post('/api/webhook', async (req, res) => {
  try {
    await webhookHandler(req, res);
  } catch (err) {
    console.error("CRITICAL ERROR in /api/webhook:", err);
    res.status(500).json({ error: err.message || "Internal Server Error in webhook" });
  }
});

app.get('/api/download', async (req, res) => {
  try {
    await downloadHandler(req, res);
  } catch (err) {
    console.error("CRITICAL ERROR in /api/download:", err);
    res.status(500).json({ error: err.message || "Internal Server Error in download" });
  }
});

app.get('/api/admin/orders', async (req, res) => {
  try {
    await adminOrdersHandler(req, res);
  } catch (err) {
    console.error("CRITICAL ERROR in /api/admin/orders:", err);
    res.status(500).json({ error: err.message || "Internal Server Error in admin orders" });
  }
});

app.get('/api/admin/books', async (req, res) => {
  try {
    await adminBooksHandler(req, res);
  } catch (err) {
    console.error("CRITICAL ERROR in /api/admin/books:", err);
    res.status(500).json({ error: err.message || "Internal Server Error in admin books" });
  }
});

// --- 4. START SERVER ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server running on port ${PORT}`);
});