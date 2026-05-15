const fs = require('fs');
const path = require('path');
const lockfile = require('proper-lockfile');

const CACHE_FILE = path.join(__dirname, '../../.cache.json');
const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// Ensure cache file exists
if (!fs.existsSync(CACHE_FILE)) {
  fs.writeFileSync(CACHE_FILE, JSON.stringify({}));
}

/**
 * Normalizes a manga title to be used as a cache key.
 * lowercase, trim whitespace, collapse multiple spaces to one, remove special characters.
 */
function normalizeKey(title) {
  if (!title) return '';
  return title
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[^a-z0-9 ]/g, '');
}

async function readCacheFile() {
  try {
    const data = fs.readFileSync(CACHE_FILE, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    console.error("Error reading cache file:", err);
    return {};
  }
}

/**
 * Gets a cached result if it exists and is not expired.
 */
async function getCache(title) {
  const key = normalizeKey(title);
  if (!key) return null;

  try {
    // Read lock is not strictly required if we just read, but we should handle parsing errors gracefully
    const cache = await readCacheFile();
    const entry = cache[key];
    if (!entry) return null;

    if (Date.now() - entry.timestamp > TTL_MS) {
      return null; // Expired
    }
    return entry.data;
  } catch (err) {
    console.error("Cache get error:", err);
    return null;
  }
}

/**
 * Writes to the cache safely using a lockfile.
 * Also prunes all expired entries to prevent file bloat.
 */
async function setCache(title, data) {
  const key = normalizeKey(title);
  if (!key) return;

  let release;
  try {
    // Acquire a write lock
    release = await lockfile.lock(CACHE_FILE, { retries: 5 });
    
    const cache = await readCacheFile();
    
    // Prune expired entries
    const now = Date.now();
    for (const k in cache) {
      if (now - cache[k].timestamp > TTL_MS) {
        delete cache[k];
      }
    }

    // Set new entry
    cache[key] = {
      timestamp: now,
      data: data
    };

    fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2));
  } catch (err) {
    console.error("Cache set error:", err);
  } finally {
    if (release) {
      try {
        await release();
      } catch(e) {
        console.error("Error releasing lock:", e);
      }
    }
  }
}

module.exports = {
  normalizeKey,
  getCache,
  setCache
};
