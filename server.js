// server.js (at project root)
import express from 'express';
import { fileURLToPath } from 'url';
import path from 'path';
import cors from 'cors';
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

// --- 1. CORS ---
app.use(cors());

// --- HELPER: Read raw stream body ---
const getRawBody = async (req) => {
  const buffers = [];
  for await (const chunk of req) buffers.push(chunk);
  const rawData = Buffer.concat(buffers).toString();
  if (!rawData) return {};
  try {
    return JSON.parse(rawData);
  } catch (e) {
    console.error("❌ Failed to parse raw JSON:", rawData);
    return { raw: rawData };
  }
};

// --- 2. ACTUAL PRODUCTION ROUTES ---

// Orders (Now parses raw body manually)
app.post('/api/orders/create', async (req, res) => {
  try {
    req.body = await getRawBody(req);
    console.log("📦 ORDER CREATE BODY:", req.body); // Diagnostic log
    
    await createOrderHandler(req, res);
  } catch (err) { 
    console.error("🔥 Error in /api/orders/create:", err);
    res.status(500).json({ error: err.message }); 
  }
});

// --- PRODUCTION STK PUSH ROUTE ---
app.post('/api/stkpush', async (req, res) => {
  try {
    // 1. Read raw stream
    const body = await getRawBody(req);
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

    // ⚠️ ADDED: business_shortcode to route to your specific database entry
    const payload = { 
      amount, 
      phone, 
      reference, 
      description: body.description || "Book Store Purchase", 
      nonce, 
      timestamp, 
      idempotency_key: idempotencyKey,
      business_shortcode: "4563479" // <--- CRITICAL FIX
    };

    // 4. Generate Signature
    const sortedKeys = Object.keys(payload).sort();
    const sortedBody = {};
    sortedKeys.forEach(k => sortedBody[k] = payload[k]);
    const bodyString = JSON.stringify(sortedBody);
    const signature = crypto.createHmac("sha256", consumerSecret).update(bodyString).digest("base64");

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

// --- WEBHOOK ROUTE ---
app.post('/api/webhook', async (req, res) => { 
  try {
    req.body = await getRawBody(req);
    // THIS LOG IS CRITICAL TO SEE IF XECO IS HITTING YOUR SERVER
    console.log("🔔 WEBHOOK HIT! Raw Body received from Xeco:", req.body); 
    
    await webhookHandler(req, res); 
  } catch (err) { 
    console.error("🔥 WEBHOOK CRASH:", err);
    res.status(500).json({error: err.message}); 
  } 
});

// Downloads & Admin
app.get('/api/download', async (req, res) => { try { await downloadHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });
app.all('/api/admin/books', async (req, res) => { try { await adminBooksHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });
app.all('/api/admin/orders', async (req, res) => { try { await adminOrdersHandler(req, res); } catch (err) { res.status(500).json({error: err.message}); } });

// --- 3. START SERVER ---
const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server running on port ${PORT}`);
});