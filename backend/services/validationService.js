/**
 * Validation Service
 * 1. Link Health Checker
 * 2. Unicode Language Detection (Filtering out CJK dominant sites falsely claiming English)
 * 3. SSRF guard: candidate URLs come from the LLM, so never fetch private/internal addresses
 */

const net = require('net');
const dns = require('dns').promises;

const TIMEOUT_MS = 5000;
const MAX_REDIRECTS = 5;
const CJK_THRESHOLD = 0.15;
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
 * Runs health and language checks on a candidate with a single fetch
 * @param {Object} candidate From Gemini API
 * @returns {Promise<Object>} Candidate with validation result
 */
async function validateCandidate(candidate) {
  if (!candidate.url) {
    return { ...candidate, valid: false, reason: 'No URL provided' };
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

  // Blocked pages (403/503) can't be language-checked; assume English to avoid falsely dropping them.
  const isHtml = (response.headers.get('content-type') || '').includes('html');
  if (response.ok && isHtml) {
    try {
      const html = await response.text();
      if (!isEnglishText(extractText(html))) {
        return { ...candidate, valid: false, reason: 'Failed Unicode language check (Contains CJK)' };
      }
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
  isEnglishText,
  validateCandidate
};
