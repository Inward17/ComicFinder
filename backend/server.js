require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Behind a host's load balancer (Render, Fly, …), trust its hop so req.ip is the visitor and
// per-IP rate limits work. TRUST_PROXY is the number of proxies in front, usually 1.
if (process.env.TRUST_PROXY) app.set('trust proxy', Number(process.env.TRUST_PROXY) || process.env.TRUST_PROXY);

// The GitHub Pages frontend calls the API from another site. Only origins listed in
// ALLOWED_ORIGINS (comma-separated, e.g. "https://inward17.github.io") may; same-site use needs nothing.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || '')
  .split(',').map(o => o.trim().replace(/\/$/, '')).filter(Boolean);
app.use('/api', (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.set({
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'GET, POST',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin'
    });
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// For the host's health checks (not rate limited)
const { version } = require('../package.json');
app.get('/api/health', (req, res) => res.json({ ok: true, version }));

// Middleware
// Image search carries a base64 image (4 MB max, ~5.4 MB encoded); every other route keeps the 100 KB default.
// Registered first: once a body is parsed, the general parser below skips it.
app.use('/api/image-search', express.json({ limit: '6mb' }));
app.use(express.json());

// Serve only the frontend; the project root holds backend source and local files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api', apiRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 MangaFinder v${version} running on http://localhost:${PORT}`);
  console.log(`   Gemini model: ${require('./services/geminiService').GEMINI_MODEL}`);
});
