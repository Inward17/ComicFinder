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
const mangadexService = require('./mangadexService');

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
 * Series and chapter for a MangaDex chapter ID (SauceNAO's md_id), preferring the English title.
 * @returns {Promise<{title: string, chapter: string|null}|null>}
 */
async function seriesFromChapter(chapterId) {
  try {
    const resp = await fetch(`https://api.mangadex.org/chapter/${encodeURIComponent(chapterId)}?includes[]=manga`, {
      headers: { 'User-Agent': 'MangaFinderBot/2.0' },
      signal: AbortSignal.timeout(8000)
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    const manga = data.data.relationships.find(r => r.type === 'manga');
    if (!manga || !manga.attributes) return null;
    // Japanese/Korean works keep a romanized title.en; the English name is usually an alt title
    const englishAlt = (manga.attributes.altTitles || []).find(alt => alt.en);
    const titles = manga.attributes.title;
    return {
      title: (englishAlt && englishAlt.en) || titles.en || Object.values(titles)[0],
      chapter: data.data.attributes.chapter || null
    };
  } catch {
    return null;
  }
}

// MangaDex lists colored releases as separate series; the user wants the series itself.
// "One Piece - Digital Colored Comics" / "Berserk (Official Colored)" -> "One Piece" / "Berserk"
function baseSeriesTitle(title) {
  return title
    .replace(/\s*[-–:]\s*(digital\s+)?colou?red(\s+comics)?\s*$/i, '')
    .replace(/\s*\((official\s+|fan\s+)?colou?red\)\s*$/i, '')
    .trim() || title;
}

// "One Piece - Digital Colored Comics v01 c001-008 (JPG)" -> "One Piece"
function madokamiTitle(part) {
  return String(part || '').split(' - ')[0].trim() || null;
}

// "Chapter 12" or a single "c012"; ranges like "c001-008" are whole volumes, so no chapter
function chapterFromPart(part) {
  const match = String(part || '').match(/chapter\s*(\d+(?:\.\d+)?)/i) || String(part || '').match(/\bc(\d{1,4})\b(?!-)/i);
  return match ? String(Number(match[1])) : null;
}

/**
 * Best manga match from SauceNAO, or null (no key, no confident match, limit reached, or the service failed).
 * Response shape (verified): results[].header {similarity, index_name}, results[].data with
 * MangaDex hits carrying md_id (a chapter ID), source (title) and part (" - Chapter 1");
 * Madokami hits carry the real title in part (their source can be a fragment like "ONE").
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

    const hits = (data.results || [])
      .filter(r => r.header && MANGA_INDEX_RE.test(r.header.index_name || ''))
      .filter(r => parseFloat(r.header.similarity) >= SAUCENAO_MIN_SIMILARITY)
      .sort((a, b) => parseFloat(b.header.similarity) - parseFloat(a.header.similarity));
    // MangaDex hits pin down the exact series, so prefer them over Madokami at a similar score
    const best = hits.find(r => /mangadex/i.test(r.header.index_name)) || hits[0];
    if (!best) return null;

    const d = best.data || {};
    const isMangaDex = /mangadex/i.test(best.header.index_name);
    const series = isMangaDex && d.md_id ? await seriesFromChapter(d.md_id) : null;
    const title = series ? series.title : isMangaDex ? d.source : madokamiTitle(d.part);
    if (!title) return null;

    return {
      source: 'saucenao',
      title: baseSeriesTitle(String(title).trim()),
      chapter: (series && series.chapter) || chapterFromPart(d.part),
      confidence: `${Math.round(parseFloat(best.header.similarity))}% match`,
      reason: `Matched a ${isMangaDex ? 'MangaDex' : 'Madokami'} page`
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
    alternativeTitles: Array.isArray(answer.alternativeTitles) ? answer.alternativeTitles.filter(t => typeof t === 'string') : [],
    chapter: answer.chapter ? String(answer.chapter) : null,
    confidence: ['high', 'medium', 'low'].includes(answer.confidence) ? `${answer.confidence} confidence` : null,
    reason: typeof answer.reason === 'string' ? clip(answer.reason, 160) : null
  };
}

/**
 * The real series name for a Gemini guess, or null if no known series matches it.
 * Gemini can name series that don't exist, with "high confidence", when it reads character
 * names off a page; checking against MangaDex catches that.
 */
async function verifyTitle(titles) {
  for (const title of titles.slice(0, 3)) {
    const metadata = await mangadexService.searchManga(title);
    if (metadata) return metadata.title;
  }
  return null;
}

/**
 * @param {string} dataUrl Image as a base64 data URL
 * @returns {Promise<{match: Object|null, guess: string|null}>} match: { source, title, chapter, confidence, reason };
 *   guess: a Gemini answer that matched no known series (shown to the user, not searched)
 */
async function identifyImage(dataUrl) {
  const image = parseImage(dataUrl);
  const sauce = await searchSauceNao(image);
  if (sauce) return { match: sauce, guess: null };

  const gemini = await identifyWithGemini(image);
  if (!gemini) return { match: null, guess: null };
  const verified = await verifyTitle([gemini.title, ...gemini.alternativeTitles]);
  if (!verified) return { match: null, guess: gemini.title };
  const { alternativeTitles, ...match } = gemini;
  return { match: { ...match, title: verified }, guess: null };
}

module.exports = {
  baseSeriesTitle,
  madokamiTitle,
  chapterFromPart,
  parseImage,
  identifyImage
};
