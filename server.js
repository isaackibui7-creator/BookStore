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

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();

// Middleware
app.use(cors()); // Allow your frontend to talk to this backend
app.use(express.json()); // Parse JSON bodies (replaces your parseBody logic)
app.use(express.urlencoded({ extended: true }));

// Manual API Routes
app.post('/api/orders/create', async (req, res) => {
  try {
    await createOrderHandler(req, res);
  } catch (err) {
    console.error("Error in createOrderHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post('/api/stkpush', async (req, res) => {
  try {
    await stkPushHandler(req, res);
  } catch (err) {
    console.error("Error in stkPushHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.post('/api/webhook', async (req, res) => {
  try {
    await webhookHandler(req, res);
  } catch (err) {
    console.error("Error in webhookHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

app.get('/api/download', async (req, res) => {
  try {
    await downloadHandler(req, res);
  } catch (err) {
    console.error("Error in downloadHandler:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// Note: We are not serving the frontend here. This is an API-only server.

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`API Server running on port ${PORT}`);
});