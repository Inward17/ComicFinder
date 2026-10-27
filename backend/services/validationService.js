/**
 * Validation Service
 * 1. Link Health Checker
 * 2. Unicode Language Detection (Filtering out CJK dominant sites falsely claiming English)
 * 3. SSRF guard: candidate URLs come from the LLM, so never fetch private/internal addresses
 */

const net = require('net');
const dns = require('dns').promises;
const firecrawlService = require('./firecrawlService');

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
const CJK_THRESHOLD = 0.15;
const MIN_TEXT_FOR_TITLE_CHECK = 300; // non-whitespace chars
const CJK_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;

const blockedRanges = new net.BlockList();
[
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]
].forEach(([addr, prefix]) => blockedRanges.addSubnet(addr, prefix, 'ipv4'));
[
  // BlockList matches IPv4-mapped IPv6 (::ffff:a.b.c.d) against the IPv4 ranges above
  ['::', 127], ['64:ff9b::', 96], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8]
].forEach(([addr, prefix]) => blockedRanges.addSubnet(addr, prefix, 'ipv6'));

function blockedError(message) {
  const err = new Error(message);
  err.code = 'BLOCKED_URL';
  return err;
}

/**
 * Throws a BLOCKED_URL error unless the URL is http(s) and every address its host resolves to is public.
 * ponytail: resolve-then-fetch leaves a DNS-rebinding window; pin the resolved IP via an undici dispatcher if that matters.
 * @param {string} rawUrl
 */
async function assertPublicUrl(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw blockedError('Invalid URL');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw blockedError(`Unsupported protocol ${url.protocol}`);
  }

  const host = url.hostname.replace(/^\[|\]$/g, '');
  const addresses = net.isIP(host)
    ? [{ address: host, family: net.isIP(host) }]
    : await dns.lookup(host, { all: true });

  for (const { address, family } of addresses) {
    if (blockedRanges.check(address, family === 6 ? 'ipv6' : 'ipv4')) {
      throw blockedError(`Blocked address ${address}`);
    }
  }
}

/**
 * GETs a URL, following redirects manually so every hop passes the SSRF guard.
 * @param {string} url
 * @returns {Promise<{response: Response, finalUrl: string}>}
 */
async function fetchPage(url) {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublicUrl(current);
    const response = await fetch(current, {
      method: 'GET', // Some sites block HEAD
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' }
    });

    const location = response.headers.get('location');
    if (response.status >= 300 && response.status < 400 && location) {
      response.body?.cancel();
      current = new URL(location, current).toString();
      continue;
    }
    return { response, finalUrl: current };
  }
  throw new Error('Too many redirects');
}

/**
 * Strips HTML down to visible-ish text.
 * @param {string} html
 */
function extractText(html) {
  return html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
             .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
             .replace(/<[^>]+>/g, '');
}

/**
 * True unless more than 15% of non-whitespace characters are CJK.
 * @param {string} text
 */
function isEnglishText(text) {
  const nonWhitespaceCount = text.replace(/\s+/g, '').length;
  if (nonWhitespaceCount === 0) return true; // No text (e.g. JS-rendered page), can't fail the check
  const cjkCount = (text.match(CJK_RE) || []).length;
  return cjkCount / nonWhitespaceCount <= CJK_THRESHOLD;
}

/**
 * Lowercase, accent-free, punctuation-free text for title matching ("Reader's" -> "readers").
 * @param {string} s
 */
function normalizeForMatch(s) {
  return String(s || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * True if any title appears as a whole phrase in the text.
 * @param {string} text
 * @param {string[]} titles
 */
function mentionsTitle(text, titles) {
  const haystack = ` ${normalizeForMatch(text)} `;
  return titles.some(t => {
    const needle = normalizeForMatch(t);
    return needle && haystack.includes(` ${needle} `);
  });
}

/**
 * Why a URL can't be a series page (homepage or search results), or null if it might be one.
 * @param {string} rawUrl
 * @returns {string|null}
 */
function seriesUrlProblem(rawUrl) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return 'Invalid URL';
  }
  if (/\/(search|keyword)(\/|$)/i.test(url.pathname) || /[?&](q|s|query|keyword|search)=/i.test(url.search)) {
    return 'Search page, not a series page';
  }
  const path = url.pathname.replace(/\/+$/, '');
  if (!path || /^\/(en|home|index(\.\w+)?)$/i.test(path)) return 'Homepage, not a series page';
  return null;
}

/**
 * Checks a loaded page: still a series page after redirects, English, and about the right title.
 * @param {string} text Visible text plus <title>/meta content
 * @param {string} url Final URL after redirects
 * @param {string[]} titles Acceptable titles; empty skips the title check
 * @returns {string|null} Rejection reason, or null if the page passes
 */
function contentProblem(text, url, titles) {
  const urlProblem = seriesUrlProblem(url);
  if (urlProblem) return `Redirected away from series page (${urlProblem})`;
  if (!isEnglishText(text)) return 'Failed Unicode language check (Contains CJK)';
  // JS-rendered pages carry almost no text, so only judge pages with enough of it
  // ponytail: phrase match also accepts pages that merely mention the title (e.g. a "related" sidebar)
  if (titles.length && text.replace(/\s+/g, '').length >= MIN_TEXT_FOR_TITLE_CHECK && !mentionsTitle(text, titles)) {
    return 'Page does not mention this title';
  }
  return null;
}

/**
 * Text used for checks: <title> and <meta content> values (SPAs put the series name there) plus body text.
 * @param {string} html
 */
function pageText(html) {
  const metas = [...html.matchAll(/<meta[^>]+content="([^"]*)"/gi)].map(m => m[1]).join(' ');
  return metas + ' ' + extractText(html);
}

/**
 * Runs URL-shape, health, language and title checks on a candidate with a single fetch
 * @param {Object} candidate From Gemini API
 * @param {string[]} [titles] Acceptable titles for the page-mentions-title check
 * @returns {Promise<Object>} Candidate with validation result
 */
async function validateCandidate(candidate, titles = []) {
  if (!candidate.url) {
    return { ...candidate, valid: false, reason: 'No URL provided' };
  }

  const urlProblem = seriesUrlProblem(candidate.url);
  if (urlProblem) {
    return { ...candidate, valid: false, reason: urlProblem };
  }

  let page;
  try {
    page = await fetchPage(candidate.url);
  } catch (err) {
    const reason = err.code === 'BLOCKED_URL' ? `Blocked URL: ${err.message}` : 'Dead link or timeout';
    return { ...candidate, valid: false, reason };
  }

  const { response, finalUrl } = page;

  // Many manga sites use Cloudflare (503) or return 403 for bots.
  // Only consider it dead if it's a 404, 410, etc. or a network timeout.
  if (!response.ok && ![401, 403, 503].includes(response.status)) {
    response.body?.cancel();
    return { ...candidate, valid: false, reason: `Dead link (HTTP ${response.status})` };
  }

  // Cloudflare-style block: let Firecrawl load the page for a real verdict (only when FIRECRAWL_API_KEY is set)
  if (!response.ok && firecrawlService.isEnabled()) {
    response.body?.cancel();
    const page = await firecrawlService.scrape(finalUrl, ['markdown']);
    const status = page && page.metadata ? page.metadata.statusCode : 0;
    if ([404, 410].includes(status)) {
      return { ...candidate, valid: false, reason: `Dead link (HTTP ${status}, via Firecrawl)` };
    }
    if (status >= 200 && status < 300) {
      const url = page.metadata.url || finalUrl;
      const text = `${page.metadata.title || ''} ${page.metadata.description || ''} ${page.markdown || ''}`;
      const problem = contentProblem(text, url, titles);
      if (problem) return { ...candidate, valid: false, reason: `${problem} (via Firecrawl)` };
      return { ...candidate, valid: true, url };
    }
    // Firecrawl failed or was blocked too: fall through and keep the link, as without Firecrawl
  }

  // Blocked pages (403/503) can't be content-checked; assume fine to avoid falsely dropping them.
  const isHtml = (response.headers.get('content-type') || '').includes('html');
  if (response.ok && isHtml) {
    try {
      const html = await response.text();
      const problem = contentProblem(pageText(html), finalUrl, titles);
      if (problem) return { ...candidate, valid: false, reason: problem };
    } catch {
      // Body read failed or timed out; the link itself is alive, so keep it.
    }
  } else {
    response.body?.cancel();
  }

  return { ...candidate, valid: true, url: finalUrl }; // Update URL in case of safe redirects
}

module.exports = {
  assertPublicUrl,
  fetchPage,
  isEnglishText,
  mentionsTitle,
  normalizeForMatch,
  seriesUrlProblem,
  validateCandidate
};
