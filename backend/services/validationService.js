/**
 * Validation Service
 * Implements Phase 1 improvements:
 * 1. Link Health Checker
 * 2. Unicode Language Detection (Filtering out CJK dominant sites falsely claiming English)
 */

/**
 * Checks if a URL is alive (returns 200-class status and isn't a dead link)
 * @param {string} url 
 * @returns {Promise<{alive: boolean, url: string, statusCode: number, error?: string}>}
 */
async function checkLinkHealth(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000); // 5-second timeout

    const response = await fetch(url, {
      method: 'GET', // Some sites block HEAD
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'
      }
    });

    clearTimeout(timeoutId);

    // Many manga sites use Cloudflare (503) or return 403 for bots.
    // We should only consider it dead if it's a 404, 410, or a network timeout.
    const isAlive = response.ok || [401, 403, 503].includes(response.status);

    return {
      alive: isAlive,
      url: response.url, // In case of redirects
      statusCode: response.status
    };
  } catch (error) {
    return { alive: false, url, statusCode: 0, error: error.message };
  }
}

/**
 * Strips HTML tags and checks if the text contains > 5% CJK characters
 * Returns false if the content is mostly CJK (not English)
 * @param {string} url
 * @returns {Promise<boolean>} True if it seems to be English, False if it fails the check
 */
async function checkIsEnglish(url) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0' }
    });
    
    clearTimeout(timeoutId);

    // If blocked by Cloudflare (403/503) or other errors, assume it's English to avoid falsely dropping it.
    if (!response.ok) return true;

    const html = await response.text();
    
    // Simple text extraction (remove script/style blocks, then remove HTML tags)
    const bodyContent = html.replace(/<script[^>]*>([\s\S]*?)<\/script>/gi, '')
                            .replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, '')
                            .replace(/<[^>]+>/g, '');
    
    if (!bodyContent || bodyContent.length === 0) return true; // If no text, can't fail the check

    // Count CJK characters
    // Ranges: Japanese (Hiragana/Katakana), CJK Unified Ideographs, Korean Hangul
    const cjkRegex = /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FFF\uAC00-\uD7A3\u1100-\u11FF\u3400-\u4DBF\u20000-\u2A6DF]/g;
    const cjkMatch = bodyContent.match(cjkRegex);
    const cjkCount = cjkMatch ? cjkMatch.length : 0;
    
    // Only count non-whitespace characters for the ratio
    const nonWhitespaceCount = bodyContent.replace(/\s+/g, '').length;
    
    if (nonWhitespaceCount === 0) return true;

    const cjkRatio = cjkCount / nonWhitespaceCount;
    
    // If more than 15% of non-whitespace characters are CJK, flag it
    return cjkRatio <= 0.15;
  } catch (err) {
    // If we fail to fetch or parse, assume it's okay to not block the fallback chain completely,
    // though a dead link would have been caught by health check.
    return true; 
  }
}

/**
 * Runs both health and language checks on a candidate
 * @param {Object} candidate From Gemini API
 * @returns {Promise<Object>} Candidate with validation result
 */
async function validateCandidate(candidate) {
  if (!candidate.url) {
    return { ...candidate, valid: false, reason: "No URL provided" };
  }

  // 1. Check Link Health
  const health = await checkLinkHealth(candidate.url);
  if (!health.alive) {
    return { ...candidate, valid: false, reason: "Dead link or timeout" };
  }

  // 2. Check Language (Only if it claims to be English, though we always want English)
  const isEnglish = await checkIsEnglish(candidate.url);
  if (!isEnglish) {
    return { ...candidate, valid: false, reason: "Failed Unicode language check (Contains CJK)" };
  }

  return { ...candidate, valid: true, url: health.url }; // Update URL in case of safe redirects
}

module.exports = {
  checkLinkHealth,
  checkIsEnglish,
  validateCandidate
};
