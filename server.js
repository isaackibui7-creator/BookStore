// server.js (at project root)
import express from 'express';
import { createServer } from 'vercel-node-server';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());

// This tells the wrapper to look for your Vercel handlers in the 'api' folder
const server = createServer(app, {
  dir: path.join(__dirname, 'api'),
});

// Serve your built frontend (Vite output)
app.use(express.static(path.join(__dirname, 'dist')));

// Fallback to index.html for React Router
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

const PORT = process.env.PORT || 10000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
});