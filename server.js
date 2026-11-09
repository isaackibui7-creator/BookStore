// server.js (at project root)
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

// Import your Vercel handlers directly
import createOrderHandler from './api/orders/create.js';
import stkPushHandler from './api/stkpush.js';
import webhookHandler from './api/webhook.js';
import downloadHandler from './api/download.js';

// Import Admin handlers (Update the paths if your files are named differently)
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
  'http://localhost:5173' // For local testing
];

app.use(cors({
  origin: function (origin, callback) {
    if (!origin) return callback(null, true); // Allow requests with no origin
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  credentials: true
}));

// Body Parser Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// --- 2. MANUAL API ROUTING ---

// Orders
app.post('/api/orders/create', async (req, res) => {
  try {
    await createOrderHandler(req, res);
  } catch (err) {
    console.error("Error in createOrderHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// M-Pesa STK Push
app.post('/api/stkpush', async (req, res) => {
  try {
    await stkPushHandler(req, res);
  } catch (err) {
    console.error("Error in stkPushHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// M-Pesa Webhook
app.post('/api/webhook', async (req, res) => {
  try {
    await webhookHandler(req, res);
  } catch (err) {
    console.error("Error in webhookHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Downloads
app.get('/api/download', async (req, res) => {
  try {
    await downloadHandler(req, res);
  } catch (err) {
    console.error("Error in downloadHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Admin Routes
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