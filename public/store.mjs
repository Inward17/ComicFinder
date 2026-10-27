/**
 * Browser-local storage for the whole app: watchlist, search history, theme and
 * the short-lived search cache, all under one versioned localStorage key.
 *
 * This is the only persistence layer; there are no accounts and nothing is sent
 * to the server. Swapping in a real backend later means changing this file and
 * nothing else.
 */

export const STORAGE_KEY = 'mangafinder.v1';

const HISTORY_LIMIT = 8;
const CACHE_LIMIT = 30; // Search results are large; keep only the most recent
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // Matches the server cache

// Keys written by builds before this store existed; migrated once, then removed.
const LEGACY_BOOKMARKS = 'mf_bookmarks';
const LEGACY_HISTORY = 'mf_history';
const LEGACY_THEME = 'mf_theme';
const LEGACY_CACHE_PREFIX = 'mf_cache_';

/**
 * @typedef {Object} Bookmark
 * @property {string} id MangaDex id
 * @property {string} title
 * @property {string} [coverUrl]
 * @property {string|number} [lastChapter]
 * @property {string} [readingUrl]
 * @property {string} [readingSite]
 * @property {boolean} [hasNewChapter]
 * @property {number} addedAt
 */

const emptyDb = () => ({
  bookmarks: {},
  history: [],
  theme: null,
  searchCache: {}
});

function storage() {
  try {
    return globalThis.localStorage || null;
  } catch {
    return null; // Access throws in some private modes
  }
}

/**
 * Why a stored bookmark can't be shown, or null if it can.
 * Bookmarks saved by older builds or edited by hand may be malformed; those are dropped.
 * @param {unknown} b
 * @returns {string|null}
 */
export function bookmarkProblem(b) {
  if (!b || typeof b !== 'object') return 'not an object';
  if (typeof b.id !== 'string' || !b.id) return 'no id';
  if (typeof b.title !== 'string' || !b.title) return 'no title';
  return null;
}

function cleanBookmarks(raw) {
  const out = {};
  for (const b of Object.values(raw && typeof raw === 'object' ? raw : {})) {
    if (bookmarkProblem(b)) continue;
    out[b.id] = { ...b, addedAt: Number(b.addedAt ?? b.timestamp) || Date.now() };
    delete out[b.id].timestamp;
  }
  return out;
}

function parse(json, fallback) {
  try {
    return json ? JSON.parse(json) : fallback;
  } catch {
    return fallback;
  }
}

/** Builds the store from the pre-store keys, then deletes them. */
function migrateLegacy(ls) {
  const db = emptyDb();
  db.bookmarks = cleanBookmarks(parse(ls.getItem(LEGACY_BOOKMARKS), {}));
  const history = parse(ls.getItem(LEGACY_HISTORY), []);
  db.history = Array.isArray(history) ? history.filter(h => typeof h === 'string').slice(0, HISTORY_LIMIT) : [];
  const theme = ls.getItem(LEGACY_THEME);
  db.theme = theme === 'dark' || theme === 'light' ? theme : null;

  const keys = Array.from({ length: ls.length }, (_, i) => ls.key(i));
  for (const key of keys) {
    if (key === LEGACY_BOOKMARKS || key === LEGACY_HISTORY || key === LEGACY_THEME || key.startsWith(LEGACY_CACHE_PREFIX)) {
      ls.removeItem(key);
    }
  }
  return db;
}

function read() {
  const ls = storage();
  if (!ls) return emptyDb();
  try {
    const raw = ls.getItem(STORAGE_KEY);
    if (!raw) {
      const migrated = migrateLegacy(ls);
      write(migrated);
      return migrated;
    }
    const parsed = JSON.parse(raw);
    return {
      bookmarks: cleanBookmarks(parsed.bookmarks),
      history: Array.isArray(parsed.history) ? parsed.history.filter(h => typeof h === 'string') : [],
      theme: parsed.theme === 'dark' || parsed.theme === 'light' ? parsed.theme : null,
      searchCache: parsed.searchCache && typeof parsed.searchCache === 'object' ? parsed.searchCache : {}
    };
  } catch {
    // Corrupted or unavailable storage shouldn't hard-fail the app.
    return emptyDb();
  }
}

function write(db) {
  const ls = storage();
  if (!ls) return;
  try {
    ls.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    // Quota full: drop the search cache (the only bulky part) and keep the watchlist.
    try {
      ls.setItem(STORAGE_KEY, JSON.stringify({ ...db, searchCache: {} }));
    } catch {
      // Still failing (e.g. private mode): state just isn't persisted.
    }
  }
}

// Prefixed so a query like "20" isn't an integer-like key, which objects order before all others
const cacheKey = query => `q:${query.trim().toLowerCase()}`;

export const store = {
  /** @returns {Bookmark[]} newest first */
  listBookmarks() {
    return Object.values(read().bookmarks).sort((a, b) => b.addedAt - a.addedAt);
  },

  /** @returns {Bookmark|null} */
  getBookmark(id) {
    return read().bookmarks[id] || null;
  },

  hasBookmark(id) {
    return !!read().bookmarks[id];
  },

  /** @param {Omit<Bookmark, 'addedAt'>} bookmark */
  addBookmark(bookmark) {
    if (bookmarkProblem(bookmark)) throw new Error(`Invalid bookmark: ${bookmarkProblem(bookmark)}`);
    const db = read();
    db.bookmarks[bookmark.id] = { ...bookmark, addedAt: Date.now() };
    write(db);
  },

  /** @param {Partial<Bookmark>} patch */
  updateBookmark(id, patch) {
    const db = read();
    if (!db.bookmarks[id]) return;
    db.bookmarks[id] = { ...db.bookmarks[id], ...patch, id };
    write(db);
  },

  removeBookmark(id) {
    const db = read();
    delete db.bookmarks[id];
    write(db);
  },

  /** @returns {string[]} most recent first */
  listHistory() {
    return read().history;
  },

  addHistory(query) {
    const db = read();
    db.history = [query, ...db.history.filter(h => h.toLowerCase() !== query.toLowerCase())].slice(0, HISTORY_LIMIT);
    write(db);
  },

  clearHistory() {
    const db = read();
    db.history = [];
    write(db);
  },

  /** @returns {'dark'|'light'|null} null means follow the system setting */
  getTheme() {
    return read().theme;
  },

  setTheme(theme) {
    const db = read();
    db.theme = theme;
    write(db);
  },

  /** @returns {Object|null} cached /api/search response, if under 24h old */
  getCachedSearch(query) {
    const entry = read().searchCache[cacheKey(query)];
    if (!entry || Date.now() - entry.savedAt > CACHE_TTL_MS) return null;
    return entry.data;
  },

  cacheSearch(query, data) {
    const db = read();
    const key = cacheKey(query);
    // Re-insert so key order is oldest -> newest (timestamps can tie within one millisecond)
    delete db.searchCache[key];
    db.searchCache[key] = { savedAt: Date.now(), data };
    const keys = Object.keys(db.searchCache);
    for (const old of keys.slice(0, Math.max(0, keys.length - CACHE_LIMIT))) delete db.searchCache[old];
    write(db);
  }
};
