import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import cors from 'cors';
import bodyParser from 'body-parser';
import crypto from 'crypto'; 

// Import your Vercel handlers
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

// --- 1. CORS & BODY PARSING ---
app.use(cors());
app.use(bodyParser.json({ limit: '10mb', strict: false }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));

// --- 2. DIAGNOSTIC TEST ROUTES ---
app.get('/api/test-xeco', async (req, res) => {
  try {
    const baseUrl = (process.env.XECOFLOW_BASE_URL || "").replace(/\/+$/, "");
    const consumerKey = process.env.XECOFLOW_CONSUMER_KEY;
    const consumerSecret = process.env.XECOFLOW_CONSUMER_SECRET;

    if (!baseUrl || !consumerKey || !consumerSecret) {
      return res.status(500).json({ error: "Missing env vars" });
    }

    const authString = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenRes = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Authorization": `Basic ${authString}`, "Content-Type": "application/json" }
    });

    const tokenText = await tokenRes.text();
    res.status(tokenRes.status).json({ status: tokenRes.status, body: tokenText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/test-stk', async (req, res) => {
  try {
    const baseUrl = (process.env.XECOFLOW_BASE_URL || "").replace(/\/+$/, "");
    const consumerKey = process.env.XECOFLOW_CONSUMER_KEY;
    const consumerSecret = process.env.XECOFLOW_CONSUMER_SECRET;

    const authString = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenRes = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Authorization": `Basic ${authString}`, "Content-Type": "application/json" }
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    const amount = 1; 
    const phone = "254708050827"; 
    const reference = "TEST-" + Date.now();
    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    const payload = { amount, phone, reference, description: "Test Payment", nonce, timestamp, idempotency_key: idempotencyKey };

    const sortedKeys = Object.keys(payload).sort();
    const sortedBody = {};
    sortedKeys.forEach(k => sortedBody[k] = payload[k]);
    const bodyString = JSON.stringify(sortedBody);
    const signature = crypto.createHmac("sha256", consumerSecret).update(bodyString).digest("base64");

    const stkRes = await fetch(`${baseUrl}/api/v1/payments/stkpush`, {
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
    res.status(stkRes.status).json({ status: stkRes.status, response: stkText });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- 3. ACTUAL PRODUCTION ROUTES ---

// Orders
app.post('/api/orders/create', async (req, res) => {
  try { await createOrderHandler(req, res); } catch (err) { res.status(500).json({ error: err.message }); }
});

// --- PRODUCTION STK PUSH ROUTE (Uses native fetch) ---
app.post('/api/stkpush', async (req, res) => {
  try {
    // 1. Read raw stream
    const buffers = [];
    for await (const chunk of req) buffers.push(chunk);
    const rawData = Buffer.concat(buffers).toString();
    let body = {};
    if (rawData) {
      try { body = JSON.parse(rawData); } catch (e) { return res.status(400).json({ error: "Invalid JSON" }); }
    }

    console.log("🚀 STK ROUTE HIT! Parsed Body:", body);

    const baseUrl = (process.env.XECOFLOW_BASE_URL || "").replace(/\/+$/, "");
    const consumerKey = process.env.XECOFLOW_CONSUMER_KEY;
    const consumerSecret = process.env.XECOFLOW_CONSUMER_SECRET;

    if (!baseUrl || !consumerKey || !consumerSecret) {
      return res.status(500).json({ error: "Missing Xeco configuration variables." });
    }

    // 2. Get Token
    const authString = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenRes = await fetch(`${baseUrl}/api/v1/auth/token`, {
      method: "POST",
      headers: { "Authorization": `Basic ${authString}`, "Content-Type": "application/json" }
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error("❌ AUTH FAILED:", tokenData);
      return res.status(502).json({ error: "Xeco Auth Failed", details: tokenData });
    }

    // 3. Prepare Payload
    const amount = Number(body.amount);
    const phone = (body.phone || body.phoneNumber || "").toString().trim();
    const reference = (body.reference || body.orderId || "").toString().trim();

    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "A valid amount is required." });
    if (!phone) return res.status(400).json({ error: "Phone number is required." });
    if (!reference) return res.status(400).json({ error: "Payment reference is required." });

    const timestamp = Math.floor(Date.now() / 1000);
    const nonce = crypto.randomUUID();
    const idempotencyKey = crypto.randomUUID();

    const payload = { 
      amount, 
      phone, 
      reference, 
      description: body.description || "Book Store Purchase", 
      nonce, 
      timestamp, 
      idempotency_key: idempotencyKey 
    };

    // 4. Generate Signature
    const sortedKeys = Object.keys(payload).sort();
    const sortedBody = {};
    sortedKeys.forEach(k => sortedBody[k] = payload[k]);
    const bodyString = JSON.stringify(sortedBody);
    const signature = crypto.createHmac("sha256", consumerSecret).update(bodyString).digest("base64");

    console.log("📤 SENDING TO XECO:", payload);

    // 5. Send STK Push
    const stkRes = await fetch(`${baseUrl}/api/v1/payments/stkpush`, {
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
    console.error("🔥 CRASH in /api/stkpush:", err);
    res.status(500).json({ error: err.message });
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