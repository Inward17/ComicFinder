# Changelog

All notable changes to MangaFinder are listed here, newest first.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versions follow [Semantic Versioning](https://semver.org/):

- **Major** (`4.0.0`): something that used to work changes or goes away (API routes, `.env` settings, the watchlist file format).
- **Minor** (`3.2.0`): new features, nothing existing breaks.
- **Patch** (`3.1.1`): bug fixes only.

Each version has a [GitHub release](https://github.com/Inward17/ComicFinder/releases) with these same notes.

## [Unreleased]

## [3.1.0] - 2026-10-29

### Added
- **Export for AniList**: Export → *Download for AniList* saves a MyAnimeList-format `.xml` file that AniList's importer reads. Series MangaDex has no MyAnimeList link for are left out and listed.
- `POST /api/export/mal-ids` looks up MyAnimeList IDs for MangaDex series (used by the AniList export).
- Image search asks before uploading: choosing, pasting or dropping an image shows a preview with *Search* / *Cancel*.
- Versioned releases: this changelog, git tags, GitHub releases made automatically from a version tag, and `version` in `GET /api/health`.

### Changed
- **Import** opens one dialog with both sources: a MangaFinder backup file and AniList. The separate *From AniList* button is gone.
- **Export** opens a dialog: MangaFinder backup (`.json`) or the AniList file.

### Fixed
- The import help text broke into narrow columns on phones; it now lives inside the Import dialog.

## [3.0.1] - 2026-10-29

### Fixed
- Without a search server (for example on GitHub Pages before the backend is set up), searches showed "Search failed (HTTP 405)". The site now says it isn't connected to a search server, both as a banner on load and when searching.

## [3.0.0] - 2026-10-29

### Added
- **Direct site lookups** on aggregator site families (mangakakalot and its clones), with an optional Firecrawl fallback for Cloudflare-protected pages (`FIRECRAWL_API_KEY`).
- **Instant results**: search results stream in as each source answers (`POST /api/search/stream`).
- **Autocomplete** of titles from MangaDex while typing (`GET /api/suggest`).
- **Search by image**: upload, paste or drop a page, panel, cover or photo; identified with SauceNAO (`SAUCENAO_API_KEY`) and Gemini vision (`POST /api/image-search`).
- **Official only** toggle for search results.
- **Watchlist export and import** as a JSON backup file, and **import from AniList** by username (`POST /api/import/anilist`).
- Configurable Gemini model (`GEMINI_MODEL`).
- Redesigned, mobile-friendly UI with light and dark themes; the watchlist moved to a single versioned browser store (`mangafinder.v1`), migrating the old keys.
- CI on every push and pull request, a weekly aggregator site check, GitHub Pages deployment of the frontend and a Render blueprint for the backend (`ALLOWED_ORIGINS`, `TRUST_PROXY`, `GET /api/health`).

### Changed
- Link checks reject homepages, search pages, non-English pages and pages about a different series; Google Search grounding ranks results; MangaDex picks the right series among similar titles.
- Static files are served from `public/`.
- The Gemini API key is sent in a request header instead of the URL.

### Removed
- `POST /api/check-links` (it could be used to make the server fetch arbitrary URLs).

### Security
- Server-side fetches are restricted to public addresses, including after redirects (SSRF guard).
- All rendered text is escaped; only `http(s)` links are rendered.
- Per-IP rate limits on every API route.

## [2.0.0] - 2026-05-16

### Added
- Node.js/Express backend with Gemini 2.5 search; the API key stays on the server.
- Link validation, MangaDex metadata (cover, synopsis, genres), a 24-hour result cache, a local watchlist with update checks, dark mode and search history.

### Removed
- The single-file `comicfinder.html` app and `config.example.js`.

## [1.0.0] - 2026-05-14

### Added
- First version: a single-page manga reading-site finder.

[Unreleased]: https://github.com/Inward17/ComicFinder/compare/v3.1.0...HEAD
[3.1.0]: https://github.com/Inward17/ComicFinder/compare/v3.0.1...v3.1.0
[3.0.1]: https://github.com/Inward17/ComicFinder/compare/v3.0.0...v3.0.1
[3.0.0]: https://github.com/Inward17/ComicFinder/compare/v2.0.0...v3.0.0
[2.0.0]: https://github.com/Inward17/ComicFinder/compare/v1.0.0...v2.0.0
[1.0.0]: https://github.com/Inward17/ComicFinder/releases/tag/v1.0.0
