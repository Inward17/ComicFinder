const express = require('express');
const router = express.Router();
const geminiService = require('../services/geminiService');

const MAX_QUERY_LENGTH = 200;
const RATE_WINDOW_MS = 60 * 1000;
const RATE_MAX_REQUESTS = 10;

// ponytail: in-memory, per-process fixed window; move to a shared store if running multiple instances.
// Behind a reverse proxy, set app.set('trust proxy', ...) so req.ip is the client, not the proxy.
const rateHits = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of rateHits) {
    if (now - entry.start > RATE_WINDOW_MS) rateHits.delete(ip);
  }
}, RATE_WINDOW_MS).unref();

function rateLimit(req, res, next) {
  const now = Date.now();
  const entry = rateHits.get(req.ip);
  if (!entry || now - entry.start > RATE_WINDOW_MS) {
    rateHits.set(req.ip, { start: now, count: 1 });
    return next();
  }
  if (++entry.count > RATE_MAX_REQUESTS) {
    res.set('Retry-After', String(Math.ceil((entry.start + RATE_WINDOW_MS - now) / 1000)));
    return res.status(429).json({ error: 'Too many searches. Please wait a minute and try again.' });
  }
  next();
}

// POST /api/search
// Body: { query: "Manga Title", forceRefresh?: boolean }
router.post('/search', rateLimit, async (req, res) => {
  try {
    const { query, forceRefresh } = req.body || {};
    if (typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({ error: 'Query is required' });
    }
    if (query.length > MAX_QUERY_LENGTH) {
      return res.status(400).json({ error: `Query must be at most ${MAX_QUERY_LENGTH} characters` });
    }

    const result = await geminiService.searchManga(query.trim(), !!forceRefresh);

    // As per the fallback chain, if we have passing results, return those.
    // If not, we still return the structure but results is empty.
    res.json(result);

  } catch (error) {
    console.error("Search Route Error:", error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

module.exports = router;
