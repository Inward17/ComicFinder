/**
 * MangaDex Service
 * Handles fetching metadata and normalizing titles.
 */

// Simple in-memory cache to respect MangaDex rate limits (5 req/s)
const cache = new Map();

/**
 * Searches MangaDex for a title and returns normalized metadata
 * @param {string} query User's raw search query
 * @returns {Promise<Object|null>} Metadata object or null if not found
 */
async function searchManga(query) {
  const normalizedQuery = query.trim().toLowerCase();
  
  if (cache.has(normalizedQuery)) {
    return cache.get(normalizedQuery);
  }

  try {
    // We include cover_art in the includes array to get the cover relationship
    // order by relevance
    const url = new URL('https://api.mangadex.org/manga');
    url.searchParams.append('title', normalizedQuery);
    url.searchParams.append('limit', '1');
    url.searchParams.append('includes[]', 'cover_art');
    url.searchParams.append('includes[]', 'author');
    url.searchParams.append('order[relevance]', 'desc');

    const response = await fetch(url.toString(), {
      headers: { 'User-Agent': 'MangaFinderBot/2.0' }
    });

    if (!response.ok) {
      console.error(`MangaDex API error: ${response.status}`);
      return null;
    }

    const data = await response.json();
    
    if (!data.data || data.data.length === 0) {
      cache.set(normalizedQuery, null);
      return null;
    }

    const manga = data.data[0];
    const attrs = manga.attributes;

    // Find canonical English title or fallback to romaji/first available
    let canonicalTitle = attrs.title.en || Object.values(attrs.title)[0];
    
    // Find English synopsis
    let synopsis = attrs.description.en || '';

    // Extract tags
    const tags = attrs.tags.map(t => t.attributes.name.en).filter(Boolean);

    // Extract Cover Art filename from relationships
    let coverUrl = null;
    const coverRel = manga.relationships.find(r => r.type === 'cover_art');
    if (coverRel && coverRel.attributes && coverRel.attributes.fileName) {
      coverUrl = `https://uploads.mangadex.org/covers/${manga.id}/${coverRel.attributes.fileName}.256.jpg`;
    }

    // Extract Author
    let author = 'Unknown Author';
    const authorRel = manga.relationships.find(r => r.type === 'author');
    if (authorRel && authorRel.attributes && authorRel.attributes.name) {
      author = authorRel.attributes.name;
    }

    const metadata = {
      id: manga.id,
      title: canonicalTitle,
      altTitles: attrs.altTitles,
      synopsis: synopsis,
      status: attrs.status,
      year: attrs.year,
      tags: tags,
      coverUrl: coverUrl,
      author: author,
      lastChapter: attrs.lastChapter,
      contentRating: attrs.contentRating
    };

    cache.set(normalizedQuery, metadata);
    return metadata;

  } catch (error) {
    console.error("MangaDex fetch error:", error);
    return null;
  }
}

module.exports = {
  searchManga
};
