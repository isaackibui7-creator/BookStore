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

// Orders
app.post('/api/orders/create', async (req, res) => {
  try {
    req.body = await getRawBody(req);
    console.log("📦 ORDER CREATE BODY:", req.body);
    await createOrderHandler(req, res);
  } catch (err) { 
    console.error("🔥 Error in /api/orders/create:", err);
    res.status(500).json({ error: err.message }); 
  }
});

// --- DIRECT DARAJA STK PUSH ROUTE (No XecoFlow) ---
app.post('/api/stkpush', async (req, res) => {
  try {
    // 1. Read raw stream
    const body = await getRawBody(req);
    console.log("🚀 STK ROUTE HIT! Parsed Body:", body);

    // 2. Isaac's Daraja Credentials
    const consumerKey = process.env.MPESA_CONSUMER_KEY;
    const consumerSecret = process.env.MPESA_CONSUMER_SECRET;
    const passkey = process.env.MPESA_PASSKEY;
    const callbackUrl = process.env.MPESA_CALLBACK_URL;

    // 3. CRITICAL FIX: Short Code vs Till Number
    const shortCode = "4563479"; // BusinessShortCode (Short Code from Daraja)
    const tillNumber = "9036539"; // PartyB (Till Number from Daraja)

    if (!consumerKey || !consumerSecret || !passkey || !callbackUrl) {
      return res.status(500).json({ error: "Missing Daraja configuration variables." });
    }

    // 4. Get OAuth Token from Safaricom
    const authString = Buffer.from(`${consumerKey}:${consumerSecret}`).toString('base64');
    const tokenRes = await fetch('https://api.safaricom.co.ke/oauth/v1/generate?grant_type=client_credentials', {
      headers: { Authorization: `Basic ${authString}` }
    });
    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error("❌ DARAJA AUTH FAILED:", tokenData);
      return res.status(502).json({ error: "Daraja Auth Failed", details: tokenData });
    }

    // 5. Prepare STK Push Payload
    const amount = Number(body.amount);
    const phone = (body.phone || body.phoneNumber || "").toString().trim();
    const reference = (body.reference || body.orderId || "").toString().trim();

    if (!Number.isFinite(amount) || amount <= 0) return res.status(400).json({ error: "A valid amount is required." });
    if (!phone) return res.status(400).json({ error: "Phone number is required." });
    if (!reference) return res.status(400).json({ error: "Payment reference is required." });

    // 6. Generate Timestamp and Password (using SHORT CODE)
    const now = new Date();
    const eatOffset = 3 * 60 * 60 * 1000; // EAT is UTC+3
    const eatDate = new Date(now.getTime() + eatOffset);
    const timestamp = eatDate.toISOString().replace(/[-:T.Z]/g, '').slice(0, 14);
    const password = Buffer.from(`${shortCode}${passkey}${timestamp}`).toString('base64');

    const payload = {
      BusinessShortCode: shortCode, // <-- Short Code
      Password: password,           // <-- Password uses Short Code
      Timestamp: timestamp,
      TransactionType: "CustomerBuyGoodsOnline",
      Amount: amount,
      PartyA: phone,
      PartyB: tillNumber,           // <-- Till Number
      PhoneNumber: phone,
      CallBackURL: callbackUrl,
      AccountReference: reference,
      TransactionDesc: "Book Store Purchase"
    };

    console.log("📤 SENDING TO DARAJA:", JSON.stringify(payload, null, 2));

    // 7. Send STK Push to Safaricom
    const stkRes = await fetch('https://api.safaricom.co.ke/mpesa/stkpush/v1/processrequest', {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const stkText = await stkRes.text();
    console.log("✅ DARAJA STK RESPONSE:", stkText);

    let stkData;
    try { stkData = JSON.parse(stkText); } catch(e) { stkData = { raw: stkText }; }

    if (!stkRes.ok) {
      return res.status(502).json({ error: "Daraja rejected STK push", details: stkData });
    }

    return res.status(200).json({
      success: true,
      message: "STK Push sent successfully",
      data: {
        checkoutRequestId: stkData.CheckoutRequestID,
        merchantRequestId: stkData.MerchantRequestID,
        responseCode: stkData.ResponseCode,
        responseDescription: stkData.ResponseDescription
      }
    });

  } catch (err) {
    console.error("🔥 CRASH in /api/stkpush:", err);
    res.status(500).json({ error: err.message });
  }
});

// --- WEBHOOK ROUTE ---
app.post('/api/webhook', async (req, res) => { 
  try {
    req.body = await getRawBody(req);
    console.log("🔔 WEBHOOK HIT! Raw Body received from Daraja:", req.body); 
    
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