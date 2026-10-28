const express = require('express');
const router = express.Router();
const geminiService = require('../services/geminiService');

const MAX_QUERY_LENGTH = 200;
const RATE_WINDOW_MS = 60 * 1000;

/**
 * Per-IP fixed-window rate limiter.
 * ponytail: in-memory, per-process; move to a shared store if running multiple instances.
 * Behind a reverse proxy, set app.set('trust proxy', ...) so req.ip is the client, not the proxy.
 * @param {number} maxRequests Allowed requests per IP per minute
 * @param {string} message Error shown when the limit is hit
 */
function createRateLimit(maxRequests, message) {
  const hits = new Map();
  setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of hits) {
      if (now - entry.start > RATE_WINDOW_MS) hits.delete(ip);
    }
  }, RATE_WINDOW_MS).unref();

  return (req, res, next) => {
    const now = Date.now();
    const entry = hits.get(req.ip);
    if (!entry || now - entry.start > RATE_WINDOW_MS) {
      hits.set(req.ip, { start: now, count: 1 });
      return next();
    }
    if (++entry.count > maxRequests) {
      res.set('Retry-After', String(Math.ceil((entry.start + RATE_WINDOW_MS - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

// Shared by both search routes, so streaming doesn't double anyone's allowance
const searchLimit = createRateLimit(10, 'Too many searches. Please wait a minute and try again.');

/**
 * Validates a search body; sends a 400 and returns null when invalid.
 * @returns {{query: string, forceRefresh: boolean}|null}
 */
function readSearchBody(req, res) {
  const { query, forceRefresh } = req.body || {};
  if (typeof query !== 'string' || !query.trim()) {
    res.status(400).json({ error: 'Query is required' });
    return null;
  }
  if (query.length > MAX_QUERY_LENGTH) {
    res.status(400).json({ error: `Query must be at most ${MAX_QUERY_LENGTH} characters` });
    return null;
  }
  return { query: query.trim(), forceRefresh: !!forceRefresh };
}

// POST /api/search
// Body: { query: "Manga Title", forceRefresh?: boolean }
router.post('/search', searchLimit, async (req, res) => {
  try {
    const body = readSearchBody(req, res);
    if (!body) return;

    const result = await geminiService.searchManga(body.query, body.forceRefresh);

    // As per the fallback chain, if we have passing results, return those.
    // If not, we still return the structure but results is empty.
    res.json(result);

  } catch (error) {
    console.error("Search Route Error:", error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// POST /api/search/stream
// Same body as /api/search. Responds with newline-delimited JSON events as results come in:
//   {"type":"metadata","data":{query, searchTitle, metadata}}   MangaDex match, within ~1s
//   {"type":"site","data":{...}}                                one per direct site lookup hit, as each is found
//   {"type":"done","data":{...same shape as /api/search}}      final ranked result
//   {"type":"error","data":{"message":"..."}}
router.post('/search/stream', searchLimit, async (req, res) => {
  const body = readSearchBody(req, res);
  if (!body) return;

  res.status(200).set({
    'Content-Type': 'application/x-ndjson; charset=utf-8',
    'Cache-Control': 'no-cache',
    'X-Accel-Buffering': 'no' // stop nginx-style proxies from holding events back
  });
  res.flushHeaders();

  // The search keeps running if the client goes away (its result still lands in the cache)
  const send = (type, data) => {
    if (!res.writableEnded && !res.destroyed) res.write(JSON.stringify({ type, data }) + '\n');
  };

  try {
    const result = await geminiService.searchManga(body.query, body.forceRefresh, send);
    send('done', result);
  } catch (error) {
    console.error("Search Stream Error:", error);
    send('error', { message: error.message || 'Internal Server Error' });
  }
  res.end();
});

module.exports = router;
