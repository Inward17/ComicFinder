/**
 * AniList import: reads a user's public manga list (no API key needed) and turns each entry
 * into a watchlist bookmark keyed by its MangaDex ID, matched via mangadexService.findByExternalId.
 */

const mangadexService = require('./mangadexService');

const ANILIST_URL = 'https://graphql.anilist.co';
const USERNAME_RE = /^[A-Za-z0-9_-]{2,30}$/;
const DEFAULT_STATUSES = ['CURRENT', 'REPEATING', 'PAUSED', 'PLANNING'];
const MAX_ENTRIES = 300;
// ponytail: one MangaDex request at a time with a gap keeps us under its ~5 req/s per-IP limit;
// a shared queue would be needed if many people imported at once.
const MANGADEX_GAP_MS = 250;

const LIST_QUERY = `query ($name: String) {
  MediaListCollection(userName: $name, type: MANGA) {
    lists { entries { status progress media { id idMal format title { english romaji } coverImage { large } chapters } } }
  }
}`;

function importError(message) {
  const err = new Error(message);
  err.code = 'IMPORT_USER';
  return err;
}

/**
 * The user's manga entries (novels skipped, each series once).
 * @param {string} username
 */
async function fetchList(username) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) {
    throw importError('Enter an AniList username (letters, numbers, - and _).');
  }
  const resp = await fetch(ANILIST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
    body: JSON.stringify({ query: LIST_QUERY, variables: { name: username } })
  });
  const data = await resp.json();
  if (data.errors && data.errors.length) {
    const message = data.errors[0].message;
    if (message === 'User not found') throw importError(`There is no AniList user called "${username}".`);
    if (message === 'Private User') throw importError(`${username}'s list is private on AniList. Make it public in AniList's settings, then try again.`);
    throw new Error(`AniList: ${message}`);
  }

  // Custom lists repeat entries from the status lists, so keep each series once
  const seen = new Map();
  for (const list of data.data.MediaListCollection.lists) {
    for (const entry of list.entries) {
      if (entry.media.format === 'NOVEL' || seen.has(entry.media.id)) continue;
      seen.set(entry.media.id, entry);
    }
  }
  return [...seen.values()];
}

/**
 * @param {string} username
 * @param {{includeCompleted?: boolean}} options
 * @param {(progress: {done: number, total: number}) => void} [onProgress]
 * @returns {Promise<{bookmarks: Object[], notFound: string[], truncated: boolean}>}
 */
async function importList(username, { includeCompleted = false } = {}, onProgress = () => {}) {
  const statuses = new Set(includeCompleted ? [...DEFAULT_STATUSES, 'COMPLETED'] : DEFAULT_STATUSES);
  const all = (await fetchList(username)).filter(e => statuses.has(e.status));
  const entries = all.slice(0, MAX_ENTRIES);

  const bookmarks = [];
  const notFound = [];
  for (let i = 0; i < entries.length; i++) {
    const { media, progress } = entries[i];
    const title = media.title.english || media.title.romaji;
    const match = await mangadexService.findByExternalId({
      anilistId: media.id,
      malId: media.idMal,
      titles: [media.title.english, media.title.romaji]
    });

    if (match) {
      bookmarks.push({
        id: match.id,
        title,
        coverUrl: match.coverUrl || (media.coverImage && media.coverImage.large) || '',
        // Where the user is up to, so "Check for new chapters" flags only unread ones
        lastChapter: progress > 0 ? progress : media.chapters || null,
        readingUrl: null,
        readingSite: null,
        hasNewChapter: false
      });
    } else {
      notFound.push(title);
    }
    onProgress({ done: i + 1, total: entries.length });
    if (i < entries.length - 1) await new Promise(resolve => setTimeout(resolve, MANGADEX_GAP_MS));
  }

  return { bookmarks, notFound, truncated: all.length > entries.length };
}

module.exports = {
  fetchList,
  importList
};
