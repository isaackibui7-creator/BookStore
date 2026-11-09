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

// --- 2. BODY PARSING (Exactly like Vercel) ---
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// --- 3. MANUAL API ROUTING ---
// Since body is parsed, we just pass the request directly to your handler.

app.post('/api/orders/create', createOrderHandler);
app.post('/api/stkpush', stkPushHandler);
app.post('/api/webhook', webhookHandler);
app.get('/api/download', downloadHandler);
app.get('/api/admin/orders', adminOrdersHandler);
app.get('/api/admin/books', adminBooksHandler);

// --- 4. START SERVER ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server running on port ${PORT}`);
});