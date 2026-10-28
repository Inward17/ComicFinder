/**
 * MangaDex Service
 * Handles fetching metadata and normalizing titles.
 */

const { normalizeForMatch } = require('./validationService');

// Simple in-memory cache to respect MangaDex rate limits (5 req/s)
const cache = new Map();

const SEARCH_LIMIT = 5;
const MIN_MATCH_SCORE = 0.3; // Below this the best hit is unrelated to the query (MangaDex also matches descriptions)
const MAX_ALTERNATIVES = 4;
const DOUJINSHI_TAG_ID = 'b13b2a48-c720-44a9-9c77-39c9979373fb'; // Fan works swamp title search results
const DISPLAY_LANGS = new Set(['en', 'ja-ro', 'ko-ro', 'zh-ro']); // Names worth showing back to the user

/**
 * How well a title matches the query: 1 for exact, high for prefix, else word overlap.
 * @param {string} query normalized
 * @param {string} title raw
 */
function titleScore(query, title) {
  const t = normalizeForMatch(title);
  if (!t) return 0;
  if (t === query) return 1;
  // No word boundary on the title side, so "omniscient reader" prefixes "omniscient readers viewpoint"
  if (t.startsWith(query) || query.startsWith(t + ' ')) return 0.9;
  const qWords = new Set(query.split(' '));
  const tWords = new Set(t.split(' '));
  const shared = [...qWords].filter(w => tWords.has(w)).length;
  return shared / new Set([...qWords, ...tWords]).size;
}

/**
 * Best-matching title (any language) of one MangaDex entry for the query.
 * @returns {{score: number, title: string|null, lang: string|null}}
 */
function bestTitleMatch(query, attrs) {
  const titles = [
    ...Object.entries(attrs.title),
    ...(attrs.altTitles || []).flatMap(alt => Object.entries(alt))
  ];
  let best = { score: 0, title: null, lang: null };
  for (const [lang, title] of titles) {
    const score = titleScore(query, title);
    if (score > best.score) best = { score, title, lang };
  }
  return best;
}

/**
 * Display title: the name the user matched if it's English or romanized, else the canonical title.
 * (Korean works have a romanized `title.en`, so "solo leveling" should show the matched "Solo Leveling".)
 */
function displayTitle(match, attrs) {
  const canonical = attrs.title.en || Object.values(attrs.title)[0];
  return match.title && DISPLAY_LANGS.has(match.lang) ? match.title : canonical;
}

// Cover art thumbnail URL from the cover_art relationship, or null
function coverUrlOf(manga) {
  const coverRel = manga.relationships.find(r => r.type === 'cover_art');
  return coverRel && coverRel.attributes && coverRel.attributes.fileName
    ? `https://uploads.mangadex.org/covers/${manga.id}/${coverRel.attributes.fileName}.256.jpg`
    : null;
}

function toMetadata(manga, match) {
  const attrs = manga.attributes;
  const coverUrl = coverUrlOf(manga);

  // Extract Author
  let author = 'Unknown Author';
  const authorRel = manga.relationships.find(r => r.type === 'author');
  if (authorRel && authorRel.attributes && authorRel.attributes.name) {
    author = authorRel.attributes.name;
  }

  return {
    id: manga.id,
    title: displayTitle(match, attrs),
    canonicalTitle: attrs.title.en || Object.values(attrs.title)[0],
    altTitles: attrs.altTitles,
    synopsis: attrs.description.en || '',
    status: attrs.status,
    year: attrs.year,
    tags: attrs.tags.map(t => t.attributes.name.en).filter(Boolean),
    coverUrl: coverUrl,
    author: author,
    lastChapter: attrs.lastChapter,
    contentRating: attrs.contentRating
  };
}

/**
 * Searches MangaDex for a title and returns normalized metadata for the best title match,
 * plus the other hits as `alternatives` so the user can switch when the pick is wrong.
 * @param {string} query User's raw search query
 * @returns {Promise<Object|null>} Metadata object or null if nothing matches well
 */
async function searchManga(query) {
  const normalizedQuery = normalizeForMatch(query);

  if (cache.has(normalizedQuery)) {
    return cache.get(normalizedQuery);
  }

  try {
    // We include cover_art in the includes array to get the cover relationship
    const url = new URL('https://api.mangadex.org/manga');
    url.searchParams.append('title', query.trim());
    url.searchParams.append('limit', String(SEARCH_LIMIT));
    url.searchParams.append('includes[]', 'cover_art');
    url.searchParams.append('includes[]', 'author');
    // Most-followed first surfaces main series over spin-offs; relevance order is flooded with fan works
    url.searchParams.append('order[followedCount]', 'desc');
    url.searchParams.append('excludedTags[]', DOUJINSHI_TAG_ID);

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'MangaFinderBot/2.0' },
      signal: AbortSignal.timeout(8000)
    });

    if (!response.ok) {
      console.error(`MangaDex API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    const hits = (data.data || []).map((manga, rank) => ({ manga, rank, match: bestTitleMatch(normalizedQuery, manga.attributes) }));

    // Best title match wins; follow count order breaks ties
    hits.sort((a, b) => b.match.score - a.match.score || a.rank - b.rank);
    const best = hits[0];

    if (!best || best.match.score < MIN_MATCH_SCORE) {
      cache.set(normalizedQuery, null);
      return null;
    }

    const metadata = {
      ...toMetadata(best.manga, best.match),
      alternatives: hits.slice(1).filter(h => h.match.score >= MIN_MATCH_SCORE).slice(0, MAX_ALTERNATIVES).map(h => ({
        id: h.manga.id,
        title: displayTitle(h.match, h.manga.attributes),
        year: h.manga.attributes.year
      }))
    };

    cache.set(normalizedQuery, metadata);
    return metadata;

  } catch (error) {
    console.error("MangaDex fetch error:", error);
    return null;
  }
}

const suggestCache = new Map();
const SUGGEST_LIMIT = 8;
const SUGGEST_CACHE_SIZE = 500;

/**
 * Title suggestions for autocomplete: most-followed MangaDex series matching the text, no fan works.
 * @param {string} query Partial title as typed
 * @returns {Promise<Array<{id: string, title: string, year: number|null, status: string, coverUrl: string|null}>>}
 */
async function suggest(query) {
  const normalizedQuery = normalizeForMatch(query);
  if (suggestCache.has(normalizedQuery)) return suggestCache.get(normalizedQuery);

  const url = new URL('https://api.mangadex.org/manga');
  url.searchParams.append('title', query.trim());
  url.searchParams.append('limit', String(SUGGEST_LIMIT));
  url.searchParams.append('includes[]', 'cover_art');
  url.searchParams.append('order[followedCount]', 'desc');
  url.searchParams.append('excludedTags[]', DOUJINSHI_TAG_ID);

  const response = await fetch(url.toString(), {
    headers: { 'User-Agent': 'MangaFinderBot/2.0' },
    signal: AbortSignal.timeout(5000)
  });
  if (!response.ok) throw new Error(`MangaDex API error: ${response.status}`);
  const data = await response.json();

  // Titles that start with what was typed come first; the stable sort keeps follow-count order among equals
  const suggestions = (data.data || [])
    .map(manga => ({ manga, match: bestTitleMatch(normalizedQuery, manga.attributes) }))
    .sort((a, b) => b.match.score - a.match.score)
    .map(({ manga, match }) => ({
      id: manga.id,
      title: displayTitle(match, manga.attributes),
      year: manga.attributes.year,
      status: manga.attributes.status,
      coverUrl: coverUrlOf(manga)
    }));

  // ponytail: evicts the oldest entry, not the least recently used; fine at this size
  if (suggestCache.size >= SUGGEST_CACHE_SIZE) suggestCache.delete(suggestCache.keys().next().value);
  suggestCache.set(normalizedQuery, suggestions);
  return suggestions;
}

module.exports = {
  titleScore,
  searchManga,
  suggest
};
