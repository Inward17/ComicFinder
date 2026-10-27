/**
 * Site Family Service
 * Looks titles up directly on known aggregator sites instead of trusting LLM-written URLs.
 * Sites in one family share a URL layout, so each site is just a config entry.
 *
 * Per site: guess the series slug from the title (free plain fetch). If every guess misses,
 * or the site answers with a Cloudflare challenge, scrape its search page through Firecrawl
 * (1 credit, only when FIRECRAWL_API_KEY is set).
 */

const { fetchPage } = require('./validationService');
const firecrawlService = require('./firecrawlService');

// Entry points are the well-known domains; redirects lead to wherever each site lives now
// (e.g. mangakakalot.gg -> kakamanga.com, natomanga.com -> manganami.com).
const SITE_FAMILIES = [
  {
    family: 'mangakakalot',
    seriesPath: '/manga/{slug}',
    searchPath: '/search/story/{query}',
    sites: [
      { name: 'MangaKakalot', base: 'https://www.mangakakalot.gg' },
      { name: 'MangaNato', base: 'https://www.natomanga.com' },
      { name: 'MangaBat', base: 'https://www.mangabats.com' }
    ]
  }
];

const MAX_SLUG_GUESSES = 4;
const MIN_MATCH_SCORE = 0.75;

/**
 * "Solo Leveling: Ragnarök!" -> "solo-leveling-ragnarok"
 * @param {string} title
 */
function slugify(title) {
  return String(title || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Candidate titles in priority order: what the user typed, then MangaDex English titles.
 * @param {string} query
 * @param {Object|null} metadata MangaDex metadata
 */
function candidateTitles(query, metadata) {
  const titles = [query];
  if (metadata) {
    titles.push(metadata.title);
    for (const alt of metadata.altTitles || []) {
      if (alt.en) titles.push(alt.en);
    }
  }
  return titles;
}

/**
 * Highest chapter number linked from a page for this series ("chapter-7-1" -> 7.1).
 * @param {string[]} hrefs
 * @param {string} seriesUrl
 * @returns {number|null}
 */
function newestChapter(hrefs, seriesUrl) {
  const prefix = seriesUrl.replace(/\/$/, '') + '/chapter-';
  let newest = null;
  for (const href of hrefs) {
    if (!href.startsWith(prefix)) continue;
    const num = parseFloat(href.slice(prefix.length).replace('-', '.'));
    if (!Number.isNaN(num) && (newest === null || num > newest)) newest = num;
  }
  return newest;
}

function slugTokens(slug) {
  return new Set(slug.split('-').filter(Boolean));
}

/**
 * Picks the series link from a search results page whose slug best matches one of our slugs.
 * Search pages also link popular/sidebar titles, so require an exact or near-exact token match.
 * ponytail: token Jaccard is naive; "one-piece" vs "one-piece-colored" scores 0.67 and is rejected.
 * @param {string[]} links
 * @param {string} origin e.g. "https://www.kakamanga.com"
 * @param {string} seriesPath e.g. "/manga/{slug}"
 * @param {string[]} slugs
 * @returns {string|null} series URL
 */
function pickSeriesLink(links, origin, seriesPath, slugs) {
  const [before, after] = seriesPath.split('{slug}');
  const seriesRe = new RegExp(`^${escapeRe(origin + before)}([a-z0-9-]+)${escapeRe(after)}/?$`);

  let best = null;
  let bestScore = 0;
  for (const link of links) {
    const match = link.match(seriesRe);
    if (!match) continue;
    const linkTokens = slugTokens(match[1]);
    for (const slug of slugs) {
      const tokens = slugTokens(slug);
      const shared = [...tokens].filter(t => linkTokens.has(t)).length;
      const score = shared / new Set([...tokens, ...linkTokens]).size;
      if (score > bestScore) {
        best = link.replace(/\/$/, '');
        bestScore = score;
      }
    }
  }
  return bestScore >= MIN_MATCH_SCORE ? best : null;
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractHrefs(html) {
  return [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
}

/**
 * Tries guessed slugs with plain fetch.
 * @returns {Promise<{url: string, chapter: number|null}|{blocked: true}|null>}
 */
async function guessSeries(site, family, slugs) {
  for (const slug of slugs) {
    let page;
    try {
      page = await fetchPage(site.base + family.seriesPath.replace('{slug}', slug));
    } catch {
      return null; // Site down or unreachable
    }
    const { response, finalUrl } = page;

    if ([403, 503].includes(response.status)) {
      response.body?.cancel();
      return { blocked: true };
    }
    // A redirect away from the slug (e.g. to the homepage) means "not found"
    if (!response.ok || !finalUrl.replace(/\/$/, '').endsWith('/' + slug)) {
      response.body?.cancel();
      continue;
    }

    const seriesUrl = finalUrl.replace(/\/$/, '');
    const html = await response.text().catch(() => '');
    return { url: seriesUrl, chapter: newestChapter(extractHrefs(html), seriesUrl) };
  }
  return null;
}

/**
 * Scrapes the site's search page through Firecrawl and picks the matching series.
 * @returns {Promise<{url: string, chapter: number|null}|null>}
 */
async function searchSeries(site, family, slugs, query) {
  const searchQuery = slugify(query).replace(/-/g, '_');
  const data = await firecrawlService.scrape(site.base + family.searchPath.replace('{query}', searchQuery), ['links']);
  if (!data || !data.links || !data.metadata) return null;

  const origin = new URL(data.metadata.url || data.metadata.sourceURL).origin;
  const seriesUrl = pickSeriesLink(data.links, origin, family.seriesPath, slugs);
  if (!seriesUrl) return null;

  // Search results list each title's latest chapter links right after it
  return { url: seriesUrl, chapter: newestChapter(data.links, seriesUrl) };
}

async function lookupSite(site, family, slugs, query, title) {
  try {
    let found = await guessSeries(site, family, slugs);
    if (!found || found.blocked) {
      found = await searchSeries(site, family, slugs, query);
    }
    if (!found) return null;

    return {
      title,
      site: site.name,
      url: found.url,
      language: 'English',
      free: true,
      official: false,
      status: null,
      chaptersAvailable: found.chapter,
      notes: 'Unofficial aggregator, found by direct site lookup.',
      valid: true,
      source: 'site-lookup'
    };
  } catch (err) {
    console.error(`Site lookup failed for ${site.name}:`, err.message);
    return null;
  }
}

/**
 * Looks the title up on every configured site in parallel.
 * @param {string} query What the user typed
 * @param {Object|null} metadata MangaDex metadata
 * @returns {Promise<Object[]>} Results in the same shape as validated Gemini candidates
 */
async function findOnSites(query, metadata) {
  const titles = candidateTitles(query, metadata);
  const slugs = [...new Set(titles.map(slugify).filter(Boolean))].slice(0, MAX_SLUG_GUESSES);
  if (!slugs.length) return [];

  const searchTitle = metadata ? metadata.title : query;
  const lookups = SITE_FAMILIES.flatMap(family =>
    family.sites.map(site => lookupSite(site, family, slugs, query, searchTitle))
  );
  return (await Promise.all(lookups)).filter(Boolean);
}

module.exports = {
  SITE_FAMILIES,
  slugify,
  candidateTitles,
  newestChapter,
  pickSeriesLink,
  findOnSites
};
