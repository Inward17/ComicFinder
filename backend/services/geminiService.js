const { validateCandidate } = require('./validationService');
const mangadexService = require('./mangadexService');
const cacheService = require('./cacheService');
const siteFamilyService = require('./siteFamilyService');

// Built-in fetch is available in Node.js 18+

const GEMINI_TIMEOUT_MS = 60 * 1000; // Grounded search routinely takes 10-30s

/**
 * Asks Gemini (with grounded Google Search) for candidate reading sites.
 * @param {string} searchTitle
 * @param {string} apiKey
 * @returns {Promise<Object[]>} Raw, unvalidated candidates
 */
async function fetchGeminiCandidates(searchTitle, apiKey) {
  const prompt = `You are a manga/manhwa reading assistant. Search the web to find the best working English reading sites for: "${searchTitle}".

  Return ONLY a JSON array of objects with these keys: title, site, url, language, free, official, status, chaptersAvailable, notes.

  CRITICAL URL RULES:
  - The "url" MUST be the exact, direct deep-link to the manga's main series page (e.g., domain.com/manga/exact-title).
  - NEVER return a root domain or homepage URL. If you cannot confidently find the direct deep-link, DO NOT include that site.
  - Prioritize sites that actually have English translations.

  Do not include any introductory text or explanations.`;

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  const resp = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ googleSearch: {} }],
      generationConfig: { temperature: 0.2 }
    })
  });

  const data = await resp.json();
  if (data.error) throw new Error(data.error.message);

  // Grounded responses can be split across several parts; a safety block returns no content at all.
  const candidate = data.candidates && data.candidates[0];
  const parts = (candidate && candidate.content && candidate.content.parts) || [];
  let textResponse = parts.map(p => p.text || '').join('');
  if (!textResponse) {
    throw new Error(`Gemini returned no content${candidate && candidate.finishReason ? ` (${candidate.finishReason})` : ''}`);
  }

  // Extract JSON array
  const jsonStart = textResponse.indexOf('[');
  const jsonEnd = textResponse.lastIndexOf(']');
  if (jsonStart !== -1 && jsonEnd !== -1) {
      textResponse = textResponse.slice(jsonStart, jsonEnd + 1);
  }

  const candidates = JSON.parse(textResponse);
  if (!Array.isArray(candidates)) throw new Error('Gemini did not return a JSON array');
  return candidates;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

/**
 * Searches Gemini and known aggregator sites in parallel, then runs Gemini's links through the fallback chain
 * @param {string} query
 * @param {boolean} forceRefresh
 */
async function searchManga(query, forceRefresh = false) {
  const API_KEY = process.env.GEMINI_API_KEY;
  if (!API_KEY) {
    throw new Error('GEMINI_API_KEY is not set in the environment');
  }

  // Phase 2: Title Normalization via MangaDex
  const metadata = await mangadexService.searchManga(query);
  const searchTitle = metadata ? metadata.title : query;

  // Phase 4: Backend Caching
  if (!forceRefresh) {
    const cachedResults = await cacheService.getCache(searchTitle);
    if (cachedResults) {
      return {
        success: true,
        query: query,
        searchTitle: searchTitle,
        metadata: metadata,
        results: cachedResults,
        failedCandidates: [],
        fromCache: true // Flag to let the frontend know it was cached backend-side
      };
    }
  }

  // Validate Gemini candidates concurrently while the direct site lookups run
  const [geminiOutcome, siteResults] = await Promise.all([
    fetchGeminiCandidates(searchTitle, API_KEY)
      .then(candidates => Promise.all(candidates.map(c => validateCandidate(c))))
      .catch(err => ({ error: err })),
    siteFamilyService.findOnSites(query, metadata)
  ]);

  if (geminiOutcome.error) {
    console.error("Gemini Search Error:", geminiOutcome.error);
    // Direct site lookups still give the user something when Gemini fails
    if (siteResults.length === 0) {
      throw new Error(geminiOutcome.error.message || 'Failed to search Gemini');
    }
  }
  const validatedResults = geminiOutcome.error ? [] : geminiOutcome;

  // Fallback Chain Logic
  // Direct lookups are already verified and point at the series page, so they replace Gemini's link for the same site
  const siteHosts = new Set(siteResults.map(r => hostOf(r.url)));
  const passingResults = validatedResults.filter(r => r.valid && !siteHosts.has(hostOf(r.url)));
  const failingResults = validatedResults.filter(r => !r.valid);

  let finalResults;

  // If nothing passed our strict validation (e.g., all blocked by Cloudflare),
  // it's better UX to return the unverified results than an empty screen.
  if (passingResults.length === 0 && siteResults.length === 0) {
    finalResults = validatedResults.map(r => ({
      ...r,
      notes: (r.notes ? r.notes + ' ' : '') + '⚠️ (Unverified link)'
    }));
  } else {
    finalResults = [...passingResults, ...siteResults];
  }

  // Phase 4: Save to cache
  await cacheService.setCache(searchTitle, finalResults);

  return {
    success: true,
    query: query,
    searchTitle: searchTitle,
    metadata: metadata,
    results: finalResults,
    failedCandidates: failingResults,
    fromCache: false
  };
}

module.exports = {
  searchManga
};
