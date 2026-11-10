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

// --- GLOBAL SAFETY NET ---
process.on('unhandledRejection', (reason, promise) => {
  console.error('🚨 UNHANDLED REJECTION CAUGHT:', reason);
});
process.on('uncaughtException', (err) => {
  console.error('🚨 UNCAUGHT EXCEPTION CAUGHT:', err);
});

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

// --- 2. BODY PARSING ---
app.use(bodyParser.json({ limit: '10mb', strict: false }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// --- 3. ACTUAL API ROUTES ---

app.post('/api/orders/create', async (req, res) => {
  try {
    await createOrderHandler(req, res);
  } catch (err) {
    console.error("CRITICAL ERROR in /api/orders/create:", err);
    res.status(500).json({ error: err.message || "Internal error" });
  }
});

// --- DIRECT NATIVE FETCH STK PUSH ROUTE ---
app.post('/api/stkpush', async (req, res) => {
  try {
    // 1. Manually read the raw stream
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const rawData = Buffer.concat(buffers).toString();
    
    let body = {};
    if (rawData) {
      try { body = JSON.parse(rawData); } catch (e) { return res.status(400).json({ error: "Invalid JSON payload" }); }
    }

    console.log("🚀 STK ROUTE HIT! Parsed Body:", body);

    // 2. Fetch Xeco Config Directly from Environment
    const baseUrl = (process.env.XECOFLOW_BASE_URL || "").replace(/\/+$/, "");
    const consumerKey = process.env.XECOFLOW_CONSUMER_KEY;
    const consumerSecret = process.env.XECOFLOW_CONSUMER_SECRET;
    const shortcode = process.env.XECO_BUSINESS_SHORTCODE;

    if (!baseUrl || !consumerKey || !consumerSecret) {
      console.log("❌ MISSING XECO CONFIG");
      return res.status(500).json({ error: "Missing Xeco configuration variables." });
    }

    // 3. Get Xeco Access Token
    console.log("🔑 Requesting Xeco Access Token...");
    const authString = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    
    // NOTE: Assuming standard /api/v1/auth/token endpoint based on your xecoflow.js file
    const tokenUrl = `${baseUrl}/api/v1/auth/token`; 
    const tokenRes = await fetch(tokenUrl, {
      method: "POST",
      headers: { "Authorization": `Basic ${authString}`, "Content-Type": "application/json" }
    });

    const tokenText = await tokenRes.text();
    console.log("🔑 Token Response Status:", tokenRes.status);
    console.log("🔑 Token Response Body:", tokenText);

    if (!tokenRes.ok) {
      return res.status(502).json({ error: "Xeco Auth Failed", details: tokenText });
    }

    let tokenData;
    try { tokenData = JSON.parse(tokenText); } catch(e) { return res.status(502).json({ error: "Invalid token JSON", details: tokenText }); }
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return res.status(502).json({ error: "No access_token found in Xeco response", details: tokenData });
    }

    // 4. Prepare STK Push Payload
    const amount = Number(body.amount);
    const phone = (body.phone || body.phoneNumber || "").toString().trim();
    const reference = (body.reference || body.orderId || "").toString().trim();

    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "A valid amount is required." });
    if (!phone) return res.status(400).json({ error: "Phone number is required." });
    if (!reference) return res.status(400).json({ error: "Payment reference is required." });

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    const payload = { amount, phone, reference, description: "Book Store Purchase", nonce, timestamp, idempotency_key: idempotencyKey };
    
    // 5. Generate Xeco HMAC Signature (Based on your xecoflow.js logic)
    const sortedKeys = Object.keys(payload).sort();
    const sortedBody = {};
    sortedKeys.forEach(k => sortedBody[k] = payload[k]);
    const bodyString = JSON.stringify(sortedBody);
    const signature = crypto.createHmac("sha256", consumerSecret).update(bodyString).digest("base64");

    console.log("📤 SENDING STK PAYLOAD TO XECO:", payload);

    // 6. Send STK Push Request
    const stkUrl = `${baseUrl}/api/v1/payments/stkpush`;
    const stkRes = await fetch(stkUrl, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "X-Timestamp": timestamp.toString(),
        "X-Nonce": nonce,
        "X-Idempotency-Key": idempotencyKey,
        "X-Signature": signature
      },
      body: bodyString
    });

    const stkText = await stkRes.text();
    console.log("✅ XECO STK STATUS:", stkRes.status);
    console.log("✅ XECO STK RESPONSE:", stkText);

    let stkData;
    try { stkData = JSON.parse(stkText); } catch(e) { stkData = { raw: stkText }; }

    if (!stkRes.ok) {
      return res.status(502).json({ error: "Xeco rejected STK push", details: stkData });
    }

    return res.status(200).json(stkData);

  } catch (err) {
    console.error("🔥 DIRECT FETCH CRASH:", err);
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// Webhook, Downloads, Admin
app.post('/api/webhook', async (req, res) => { try { await webhookHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });
app.get('/api/download', async (req, res) => { try { await downloadHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });
app.all('/api/admin/books', async (req, res) => { try { await adminBooksHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });
app.all('/api/admin/orders', async (req, res) => { try { await adminOrdersHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });

// --- 4. START SERVER ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server running on port ${PORT}`);
});