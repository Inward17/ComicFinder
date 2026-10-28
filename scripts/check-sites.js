/**
 * Site health check: confirms every configured aggregator site still serves series pages
 * in the layout the site lookups expect. Aggregator domains move and change often, so this
 * runs weekly in CI (.github/workflows/site-check.yml) and can be run by hand:
 *
 *   npm run check-sites
 *
 * Exits 1 if any site is down or its layout changed. Cloudflare-blocked sites are re-checked
 * through Firecrawl when FIRECRAWL_API_KEY is set (1 credit each), otherwise reported as warnings.
 */

require('dotenv').config({ quiet: true });
const fs = require('fs');
const { SITE_FAMILIES, newestChapter } = require('../backend/services/siteFamilyService');
const { fetchPage } = require('../backend/services/validationService');
const firecrawlService = require('../backend/services/firecrawlService');

/**
 * @returns {Promise<{site: string, status: 'ok'|'warn'|'fail', detail: string, movedTo: string|null}>}
 */
async function checkSite(site, family) {
  const probeUrl = site.base + family.seriesPath.replace('{slug}', family.probeSlug);
  const movedFrom = url => {
    const host = new URL(url).host;
    return host !== new URL(site.base).host ? host : null;
  };

  let page;
  try {
    page = await fetchPage(probeUrl);
  } catch (err) {
    return { site: site.name, status: 'fail', detail: `unreachable (${err.message})`, movedTo: null };
  }
  const { response, finalUrl } = page;
  const movedTo = movedFrom(finalUrl);

  if (response.ok) {
    const html = await response.text();
    const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
    const chapter = newestChapter(hrefs, finalUrl.replace(/\/$/, ''));
    return chapter === null
      ? { site: site.name, status: 'fail', detail: 'page loads but has no chapter links (layout changed?)', movedTo }
      : { site: site.name, status: 'ok', detail: `newest chapter ${chapter}`, movedTo };
  }

  response.body?.cancel();
  if (![401, 403, 503].includes(response.status)) {
    return { site: site.name, status: 'fail', detail: `HTTP ${response.status}`, movedTo };
  }

  // Cloudflare challenge: plain fetch can't tell, Firecrawl can
  if (!firecrawlService.isEnabled()) {
    return { site: site.name, status: 'warn', detail: `Cloudflare-blocked (HTTP ${response.status}); set FIRECRAWL_API_KEY to verify`, movedTo };
  }
  const scraped = await firecrawlService.scrape(finalUrl, ['links']);
  const statusCode = scraped && scraped.metadata ? scraped.metadata.statusCode : 0;
  if (statusCode !== 200) {
    return { site: site.name, status: 'fail', detail: `Firecrawl got HTTP ${statusCode || 'no response'}`, movedTo };
  }
  const chapter = newestChapter(scraped.links || [], (scraped.metadata.url || finalUrl).replace(/\/$/, ''));
  return chapter === null
    ? { site: site.name, status: 'fail', detail: 'page loads (via Firecrawl) but has no chapter links (layout changed?)', movedTo }
    : { site: site.name, status: 'ok', detail: `newest chapter ${chapter} (via Firecrawl)`, movedTo };
}

async function main() {
  const checks = SITE_FAMILIES.flatMap(family => family.sites.map(site => checkSite(site, family)));
  const results = await Promise.all(checks);

  const icon = { ok: '✅', warn: '⚠️', fail: '❌' };
  for (const r of results) {
    console.log(`${icon[r.status]} ${r.site.padEnd(14)} ${r.detail}${r.movedTo ? `  (now at ${r.movedTo})` : ''}`);
  }

  // Shown on the workflow run page in GitHub Actions
  if (process.env.GITHUB_STEP_SUMMARY) {
    const rows = results.map(r => `| ${icon[r.status]} | ${r.site} | ${r.detail} | ${r.movedTo || ''} |`);
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY,
      ['### Aggregator site check', '', '| | Site | Result | Now at |', '|---|---|---|---|', ...rows, ''].join('\n'));
  }

  const failed = results.filter(r => r.status === 'fail');
  if (failed.length) {
    console.error(`\n${failed.length} site(s) need attention: update SITE_FAMILIES in backend/services/siteFamilyService.js`);
    process.exit(1);
  }
}

main();
