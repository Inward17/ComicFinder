/**
 * Image Search Service
 * Identifies which series an image comes from (a page, panel, cover, character art,
 * or a photo of a volume), then the normal search finds where to read it.
 *
 * 1. SauceNAO (optional, SAUCENAO_API_KEY): exact matches against its MangaDex and Madokami
 *    page indexes; best for scanned pages and often gives the chapter.
 * 2. Gemini vision: always available; recognizes covers, art and well-known pages.
 * Images are only forwarded to those services, never stored.
 */

const { generateContent } = require('./geminiService');

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
const SAUCENAO_TIMEOUT_MS = 15 * 1000;
const SAUCENAO_MIN_SIMILARITY = 70;
// Keep only manga page indexes. Matching by name rather than index number means a renumbered
// index can't silently let other databases (including adult ones) through.
const MANGA_INDEX_RE = /mangadex|madokami/i;

function badImage(message) {
  const err = new Error(message);
  err.code = 'BAD_IMAGE';
  return err;
}

/**
 * Validates a base64 data URL from the browser.
 * @param {string} dataUrl
 * @returns {{mimeType: string, base64: string, buffer: Buffer}}
 */
function parseImage(dataUrl) {
  const match = typeof dataUrl === 'string' && dataUrl.match(/^data:([\w/+.-]+);base64,([A-Za-z0-9+/=]+)$/);
  if (!match) throw badImage('Send the image as a base64 data URL');
  const [, mimeType, base64] = match;
  if (!ALLOWED_TYPES.has(mimeType)) throw badImage('Use a JPEG, PNG or WebP image');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > MAX_IMAGE_BYTES) throw badImage('Image is too large (4 MB max)');
  return { mimeType, base64, buffer };
}

/**
 * Best manga match from SauceNAO, or null (no key, no confident match, or the service failed).
 * ponytail: response fields (source, part, ext_urls) follow SauceNAO's JSON output and are read
 * defensively; verified shape only with a key, which the project did not have when this was written.
 */
async function searchSauceNao({ mimeType, buffer }) {
  const apiKey = process.env.SAUCENAO_API_KEY;
  if (!apiKey) return null;

  const form = new FormData();
  form.append('file', new Blob([buffer], { type: mimeType }), 'image');
  const url = `https://saucenao.com/search.php?output_type=2&numres=8&db=999&api_key=${encodeURIComponent(apiKey)}`;

  try {
    const resp = await fetch(url, { method: 'POST', body: form, signal: AbortSignal.timeout(SAUCENAO_TIMEOUT_MS) });
    const data = await resp.json();
    if (!data.header || data.header.status < 0) {
      console.error('SauceNAO error:', data.header && data.header.message);
      return null;
    }

    const best = (data.results || [])
      .filter(r => r.header && MANGA_INDEX_RE.test(r.header.index_name || ''))
      .filter(r => parseFloat(r.header.similarity) >= SAUCENAO_MIN_SIMILARITY)
      .sort((a, b) => parseFloat(b.header.similarity) - parseFloat(a.header.similarity))[0];
    if (!best) return null;

    const d = best.data || {};
    const title = d.source || d.title || d.eng_name || d.jp_name;
    if (!title) return null;
    const chapter = String(d.part || '').match(/(?:ch(?:apter)?\.?\s*)(\d+(?:\.\d+)?)/i);
    return {
      source: 'saucenao',
      title: String(title).trim(),
      chapter: chapter ? chapter[1] : null,
      confidence: `${Math.round(parseFloat(best.header.similarity))}% match`,
      reason: `Matched a ${best.header.index_name.replace(/^Index #\d+:\s*/, '').split(' - ')[0]} page`
    };
  } catch (err) {
    console.error('SauceNAO request failed:', err.message);
    return null;
  }
}

const VISION_PROMPT = `Identify which manga, manhwa, manhua or webtoon this image comes from. It may be a page, a panel, a cover, character art, or a photo of a printed volume.
Reply with ONLY a JSON object, no other text:
{"title": "the best-known English title, or null if you cannot tell", "alternativeTitles": ["other names"], "chapter": "chapter number if a chapter (not volume) number is printed in the image, else null", "confidence": "high" | "medium" | "low", "reason": "one short sentence on what you recognized"}
Do not guess: if you are not reasonably sure, set "title" to null.`;

// Shortens at a word boundary with an ellipsis
function clip(text, max) {
  const t = text.trim();
  return t.length <= max ? t : `${t.slice(0, t.lastIndexOf(' ', max)).replace(/[,.;:]$/, '')}…`;
}

/** Gemini vision identification, or null when it can't tell. */
async function identifyWithGemini({ mimeType, base64 }) {
  const { text } = await generateContent([
    { inline_data: { mime_type: mimeType, data: base64 } },
    { text: VISION_PROMPT }
  ]);
  const json = text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  let answer;
  try {
    answer = JSON.parse(json);
  } catch {
    return null;
  }
  if (!answer || typeof answer.title !== 'string' || !answer.title.trim()) return null;
  return {
    source: 'gemini',
    title: answer.title.trim(),
    chapter: answer.chapter ? String(answer.chapter) : null,
    confidence: ['high', 'medium', 'low'].includes(answer.confidence) ? `${answer.confidence} confidence` : null,
    reason: typeof answer.reason === 'string' ? clip(answer.reason, 160) : null
  };
}

/**
 * @param {string} dataUrl Image as a base64 data URL
 * @returns {Promise<Object|null>} { source, title, chapter, confidence, reason } or null if unidentified
 */
async function identifyImage(dataUrl) {
  const image = parseImage(dataUrl);
  return (await searchSauceNao(image)) || (await identifyWithGemini(image));
}

module.exports = {
  parseImage,
  identifyImage
};
