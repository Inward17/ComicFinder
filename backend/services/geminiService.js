const { validateCandidate } = require('./validationService');
const mangadexService = require('./mangadexService');
const cacheService = require('./cacheService');

// Built-in fetch is available in Node.js 18+

const GEMINI_TIMEOUT_MS = 60 * 1000; // Grounded search routinely takes 10-30s

/**
 * Searches Gemini for candidate links and runs them through the fallback chain
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

  const prompt = `You are a manga/manhwa reading assistant. Search the web to find the best working English reading sites for: "${searchTitle}".
  
  Return ONLY a JSON array of objects with these keys: title, site, url, language, free, official, status, chaptersAvailable, notes.
  
  CRITICAL URL RULES:
  - The "url" MUST be the exact, direct deep-link to the manga's main series page (e.g., domain.com/manga/exact-title).
  - NEVER return a root domain or homepage URL. If you cannot confidently find the direct deep-link, DO NOT include that site.
  - Prioritize sites that actually have English translations.
  
  Do not include any introductory text or explanations.`;

  const endpoint = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

  try {
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": API_KEY },
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

    // Fallback Chain Logic
    // Validate candidates concurrently
    const validationPromises = candidates.map(c => validateCandidate(c));
    const validatedResults = await Promise.all(validationPromises);
    
    // Filter and sort results
    const passingResults = validatedResults.filter(r => r.valid);
    const failingResults = validatedResults.filter(r => !r.valid);
    
    let finalResults;

    // If no results passed our strict validation (e.g., all blocked by Cloudflare),
    // it's better UX to return the unverified results than an empty screen.
    if (passingResults.length === 0) {
      finalResults = validatedResults.map(r => ({
        ...r,
        notes: (r.notes ? r.notes + ' ' : '') + '⚠️ (Unverified link)'
      }));
    } else {
      finalResults = passingResults;
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
    
  } catch (err) {
    console.error("Gemini Search Error:", err);
    throw new Error(err.message || 'Failed to search Gemini');
  }
}

module.exports = {
  searchManga
};
