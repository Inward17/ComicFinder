/**
 * Firecrawl Service
 * Optional: only used when FIRECRAWL_API_KEY is set. Fetches pages that sit behind
 * Cloudflare challenges which plain fetch can't get past. 1 credit per scrape.
 */

const API_URL = 'https://api.firecrawl.dev/v2/scrape';
const TIMEOUT_MS = 30 * 1000;
const MAX_AGE_MS = 60 * 60 * 1000; // Accept Firecrawl's own cached copy if under 1h old (chapter lists change)

function isEnabled() {
  return !!process.env.FIRECRAWL_API_KEY;
}

/**
 * Scrapes a URL through Firecrawl.
 * @param {string} url
 * @param {string[]} formats e.g. ['markdown'] or ['links']
 * @returns {Promise<Object|null>} Firecrawl `data` ({ markdown?, links?, metadata }) or null if disabled/failed
 */
async function scrape(url, formats = ['markdown']) {
  if (!isEnabled()) return null;

  try {
    const resp = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.FIRECRAWL_API_KEY}`
      },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      body: JSON.stringify({ url, formats, onlyMainContent: true, maxAge: MAX_AGE_MS })
    });

    const data = await resp.json();
    if (!resp.ok || !data.success) {
      console.error(`Firecrawl scrape failed for ${url}: HTTP ${resp.status} ${data.error || ''}`);
      return null;
    }
    return data.data;
  } catch (err) {
    console.error(`Firecrawl scrape error for ${url}:`, err.message);
    return null;
  }
}

module.exports = {
  isEnabled,
  scrape
};
