# MangaFinder Pro

> Find where to read any manga, manhwa, or manhua in English. Official sources first, every link checked.

![CI](https://github.com/Inward17/ComicFinder/actions/workflows/ci.yml/badge.svg)
[![Release](https://img.shields.io/github/v/release/Inward17/ComicFinder)](https://github.com/Inward17/ComicFinder/releases)
![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D20-brightgreen)

MangaFinder Pro takes a title, works out which series you mean, and returns a short list of places to read it, with licensed publishers ranked above fan translations and aggregators. Every link is opened and checked before it is shown, so you don't get dead pages, homepages, or the wrong series.

---

## ✨ Features

| Feature | Description |
|---|---|
| **Smart search** | Google Gemini with grounded web search finds reading sites for the title, and known aggregator sites are queried directly in parallel. |
| **Instant results** | Results stream in as they are found: the series appears in about half a second and the first reading links within a couple of seconds, while official sources are still being checked. |
| **Autocomplete** | Title suggestions with covers appear as you type, so you can pick the exact series before searching. |
| **Search by image** | Upload, paste or drop a manga page, panel, cover or a photo of a volume. The series is identified (SauceNAO for scanned pages, Gemini vision for everything else) and searched once you confirm. On phones the image button opens the camera or gallery. |
| **Verified links** | Each link is fetched and checked: dead pages, homepages, search pages, non-English pages and pages about a different series are dropped. |
| **Official first** | Results are split into *Official* and *Other sources*, with licensed publishers ranked at the top. An *Official only* switch hides everything unofficial. |
| **Right series** | Titles are matched on MangaDex across English, romanized and alternate names, skipping fan works. A "Not this one?" row lets you switch to a related series. |
| **Series details** | Cover, author, year, status, genres, synopsis and the latest chapter. |
| **Watchlist** | Save series in your browser and check them all for new chapters in one click. Import your list from AniList, export it back to AniList, or move it to another browser with a backup file. No account needed. |
| **Fast repeats** | Results are cached for 24 hours on the server and in the browser. |
| **Works on phones** | Responsive layout with a bottom tab bar, large tap targets and dark mode. |

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 20 or newer
- A free [Google Gemini API key](https://aistudio.google.com/app/apikey)
- *(Optional)* A [Firecrawl](https://www.firecrawl.dev) API key (free tier: 1,000 credits a month)

### Installation

```bash
git clone https://github.com/Inward17/ComicFinder.git
cd ComicFinder
npm install
cp .env.example .env    # then add your API key(s)
npm start
```

Open [http://localhost:3000](http://localhost:3000).

### Scripts

| Command | What it does |
|---|---|
| `npm start` | Start the server on port 3000 (override with `PORT`) |
| `npm test` | Run the test suite (`node --test`) |
| `npm run check-sites` | Check that every aggregator site still works and report any that moved |

---

## 🚢 CI/CD and Hosting

| Workflow | When | What |
|---|---|---|
| **CI** (`ci.yml`) | Every push and pull request | Tests on Node 20 and 22, frontend syntax check, server smoke test (pages, API validation, health check, CORS) |
| **Deploy** (`deploy.yml`) | Every push to `main` | Runs the tests, then publishes the frontend to **GitHub Pages** only if they pass |
| **Site check** (`site-check.yml`) | Mondays, or on demand | Checks every aggregator site still works; add `FIRECRAWL_API_KEY` as a repository secret to verify Cloudflare-protected ones |
| **Release** (`release.yml`) | A version tag such as `v3.1.0` is pushed | Runs the tests, checks the tag matches `package.json`, and publishes a GitHub release with that version's `CHANGELOG.md` notes |

GitHub Pages only serves static files, so the app is hosted in two parts:

- **Frontend** (`public/`) on GitHub Pages: `https://inward17.github.io/ComicFinder/`
- **Backend** (the Node server that holds the API keys) on a Node host. A [Render](https://render.com) blueprint (`render.yaml`) is included; Render redeploys it on every push to `main`.

### First-time setup

1. **Backend:** on Render choose *New → Blueprint*, pick this repository, and enter `GEMINI_API_KEY` (plus `FIRECRAWL_API_KEY` / `SAUCENAO_API_KEY` if you use them) when asked. `ALLOWED_ORIGINS` and `TRUST_PROXY` are preset. Note the service URL, e.g. `https://mangafinder-api.onrender.com`. Opening `<url>/api/health` should show `{"ok":true,"version":"…"}` with the version it is running.
2. **Point the frontend at it:** in GitHub, *Settings → Secrets and variables → Actions → Variables*, add `API_BASE_URL` with that URL.
3. **Pages:** *Settings → Pages → Source: GitHub Actions* (already enabled for this repository).
4. Push to `main` (or run *Deploy* from the Actions tab). The site is live when the workflow finishes.

On Render's free plan the server sleeps after about 15 minutes without traffic; the first search after that can take up to a minute while it wakes, and the page says so if it can't reach the server. Running `npm start` locally still serves the frontend and API together, with no extra setup.

---

## ⚙️ Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Google Gemini API key from [AI Studio](https://aistudio.google.com/app/apikey). The free tier allows only about 20 requests a day; each new (uncached) search, and each image Gemini identifies, uses one. When it runs out, searches still show the direct site results, and the app says the limit was reached. Enable billing on the key for more. |
| `FIRECRAWL_API_KEY` | Optional | Lets the app read sites protected by Cloudflare challenges, both for direct lookups and for checking links. Uses about 1–3 credits per new search. Without it, those sites are skipped or left unchecked. |
| `GEMINI_MODEL` | Optional | Gemini model used for search and image identification. Defaults to `gemini-2.5-flash`. Must support Google Search grounding; newer models (e.g. `gemini-3.5-flash`) may need billing enabled on your key. The model in use is printed when the server starts. |
| `SAUCENAO_API_KEY` | Optional | [SauceNAO](https://saucenao.com) key (free account: 100 searches a day, 4 per 30 seconds). Makes image search exact for scanned manga pages and often finds the chapter. Without it, Gemini vision identifies images on its own. |
| `PORT` | Optional | Server port. Defaults to `3000`. |
| `ALLOWED_ORIGINS` | When hosting the frontend separately | Sites allowed to call the API, comma-separated (e.g. `https://inward17.github.io`). Not needed when the server also serves the page. |
| `TRUST_PROXY` | When behind a host's proxy | Number of proxies in front of the server (`1` on Render), so rate limits see real visitor IPs. |

### Other AI providers

Only Google Gemini is supported today. The search needs a model that can **search the web**, **return JSON**, and (for image search) **read images**. Everything else (MangaDex matching, direct site lookups, link checking, ranking) does not depend on the AI provider, so adding one means replacing just the model call in `backend/services/geminiService.js` (`generateContent`).

| Provider | Web search | Images | Effort to add | Notes |
|---|---|---|---|---|
| Google Gemini *(current)* | Google Search grounding | Yes | n/a | Free tier covers `gemini-2.5-flash`, but only about 20 requests a day |
| Anthropic Claude | Server-side web search tool | Yes | Medium | Messages API via `@anthropic-ai/sdk` (e.g. `claude-opus-5-5`); structured JSON output available |
| OpenAI | Web search tool (Responses API) | Yes | Medium | Different request and citation format |
| Perplexity Sonar | Built in (search-first models) | Limited | Easy–medium | Chat-style API that returns citations; image search would still need another model |
| Local models (Ollama etc.) | None | Some | Hard | Needs a separate search step (for example Firecrawl search) whose results are passed to the model |

---

## 📖 How It Works

1. **Identify the series.** The query is matched against MangaDex titles and alternate names to pick the right series and its metadata.
2. **Check the cache.** A result for the same series from the last 24 hours is returned immediately.
3. **Find candidates, in parallel:**
   - **Gemini** searches the web for reading sites and returns them as structured data.
   - **Direct site lookups** try the series' page on known aggregator sites by URL. If a site is behind Cloudflare, its search page is read through Firecrawl instead (when a key is set).
4. **Verify every link.** Each page is fetched and must load, still be a series page after redirects, be in English, and mention the title.
5. **Rank and return.** Official sources first, then other verified links. The result is cached.

Steps 1 and 3 are streamed to the browser as they finish (`POST /api/search/stream`), so the series and direct site links show up long before the slower web search completes.

### API

| Endpoint | Description |
|---|---|
| `POST /api/search` | Body `{ "query": "One Piece", "forceRefresh": false }`. Returns the full ranked result. |
| `POST /api/search/stream` | Same body. Streams newline-delimited JSON events: `metadata`, one `site` per direct lookup, then `done` with the full result (or `error`). |
| `GET /api/suggest?q=one` | Up to 8 title suggestions for autocomplete. |
| `GET /api/health` | `{ "ok": true, "version": "3.1.0" }`. For uptime checks; not rate limited. |
| `POST /api/image-search` | Body `{ "image": "data:image/jpeg;base64,..." }` (JPEG, PNG or WebP, up to 4 MB). Returns `{ "match": { "source", "title", "chapter", "confidence", "reason" } }`, or `{ "match": null }` if the image can't be identified. |
| `POST /api/import/anilist` | Body `{ "username": "name", "includeCompleted": false }`. Streams `progress` events, then `done` with `{ bookmarks, notFound, truncated }` (or `error`). |
| `POST /api/export/mal-ids` | Body `{ "ids": ["<MangaDex ID>", ...] }` (up to 500). Returns `{ "malIds": { "<MangaDex ID>": 2 } }` for series MangaDex links to MyAnimeList; used for the AniList export. |

Search routes share a limit of 10 requests per minute per IP; suggestions allow 60, image searches 6, and imports plus AniList exports 3.

---

## 💾 Importing and Backups

| Source | How | Status |
|---|---|---|
| **MangaFinder** (another browser or device) | *Export* → *Download backup* there, then *Import* → *Choose file* here | ✅ |
| **AniList** | *Import*, then enter your username under AniList. Your manga list must be public; no login or key needed. | ✅ |
| **MyAnimeList** | Import the list export file, or read a list by username | 🗺️ Planned |
| **MangaDex** | Import a public MangaDex list | 🗺️ Planned |

Every import merges into your watchlist: series you already have are left as they are.

### AniList

Reading, re-reading, paused and planned series are imported (completed ones too, if you tick the box); novels and dropped series are skipped. Each series is matched to MangaDex using the AniList and MyAnimeList IDs that MangaDex stores, so a match is always the right series. Series that MangaDex doesn't carry are listed after the import instead of being guessed. Your AniList reading progress becomes the series' chapter, so *Check for new chapters* flags chapters you haven't read. Up to 300 series per import.

**Export → Download for AniList** saves `mangafinder-anilist-YYYY-MM-DD.xml` in MyAnimeList list format, which [AniList imports](https://anilist.co/settings/import) as a manga list. Series are added as Reading with no chapters read, and AniList asks whether to overwrite series already on your list. AniList matches by MyAnimeList ID, so series MangaDex has no MyAnimeList link for are left out and listed.

### Backup files

**Export → Download backup** saves your watchlist as `mangafinder-watchlist-YYYY-MM-DD.json`. **Import** accepts that same file, so you can move your watchlist to another browser or device. Entries without an `id` and `title` are skipped.

The file looks like this (`id` is the series' MangaDex ID):

```json
{
  "app": "mangafinder",
  "version": 1,
  "exportedAt": "2026-10-29T10:00:00.000Z",
  "bookmarks": [
    {
      "id": "a1c7c817-4e59-43b7-9365-09675a149a6f",
      "title": "One Piece",
      "coverUrl": "https://uploads.mangadex.org/covers/…",
      "lastChapter": 1196,
      "readingUrl": "https://mangaplus.shueisha.co.jp/titles/100020",
      "readingSite": "MANGA Plus by Shueisha",
      "hasNewChapter": false,
      "addedAt": 1793128000000
    }
  ]
}
```

A plain JSON array of bookmark objects (without the wrapper) is accepted too.

---

## 🔒 Privacy and Security

- **Your data stays in your browser.** The watchlist, search history and theme are stored in `localStorage` under a single key (`mangafinder.v1`). Nothing is sent to the server, and clearing site data removes it.
- **API keys stay on the server.** They are read from `.env` and never sent to the browser.
- **Images are not stored.** Images for image search are shrunk and re-encoded in your browser (which also removes metadata such as photo location), then sent to Google Gemini (and SauceNAO, if configured) only to identify the series.
- **Abuse protection.** Requests are rate limited per IP, and the server refuses to fetch private or internal network addresses.

---

## 🏗️ Project Structure

```
ComicFinder/
├── backend/
│   ├── server.js                 # Express entry point; serves public/ and the API
│   ├── routes/
│   │   └── api.js                # Search, suggest, image search, import/export endpoints
│   └── services/
│       ├── geminiService.js      # Search pipeline: Gemini, site lookups, ranking, cache
│       ├── mangadexService.js    # Series matching and metadata from MangaDex
│       ├── siteFamilyService.js  # Direct lookups on aggregator sites
│       ├── validationService.js  # Link checks, language check, SSRF guard
│       ├── imageSearchService.js # Identify a series from an image (SauceNAO, Gemini vision)
│       ├── anilistService.js     # AniList list import, matched to MangaDex
│       ├── firecrawlService.js   # Optional Firecrawl client
│       └── cacheService.js       # 24h file cache for search results
├── public/
│   ├── index.html
│   ├── config.js                 # API server address (set by the Pages deploy)
│   ├── script.js                 # UI: search, results, watchlist
│   ├── store.mjs                 # Browser storage (watchlist, history, theme, cache)
│   └── style.css
├── scripts/
│   └── check-sites.js            # Aggregator site health check
├── test/                         # node:test suites
├── .github/workflows/            # CI, Pages deploy (CD), weekly site check, releases
├── render.yaml                   # Render blueprint for the backend
├── CHANGELOG.md                  # What changed in each version
├── .env.example
└── package.json                  # Holds the current version
```

---

## 🔧 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | HTML, CSS, vanilla JavaScript (no build step) |
| **Backend** | Node.js, Express 5 |
| **Search** | Google Gemini 2.5 Flash with Google Search grounding |
| **Metadata** | MangaDex API v5 |
| **Scraping** | Firecrawl (optional) |
| **Icons / fonts** | Tabler Icons, Bebas Neue, DM Sans |

---

## 🏷️ Versions and Releases

MangaFinder uses [Semantic Versioning](https://semver.org/). The current version is in `package.json`, every change is listed in [CHANGELOG.md](CHANGELOG.md), and each version has a [GitHub release](https://github.com/Inward17/ComicFinder/releases). A running server reports its version at `/api/health`.

- **Major** (`4.0.0`): something that used to work changes or goes away, such as an API route, an `.env` setting or the watchlist file format. Read the release notes before updating.
- **Minor** (`3.2.0`): new features; nothing existing breaks.
- **Patch** (`3.1.1`): bug fixes only.

To get notified, use *Watch → Custom → Releases* on the GitHub repository.

### Making a release

1. While working, add each change under `## [Unreleased]` in `CHANGELOG.md` (Added / Changed / Fixed / Removed / Security).
2. When ready, rename that section to `## [X.Y.Z] - YYYY-MM-DD`, add a fresh empty `## [Unreleased]` above it, and update the compare links at the bottom.
3. Set the version without creating a tag yet: `npm version X.Y.Z --no-git-tag-version` (updates `package.json` and `package-lock.json`).
4. Merge to `main`, then tag the merge commit and push the tag:
   ```bash
   git tag vX.Y.Z && git push origin vX.Y.Z
   ```
   The **Release** workflow checks the tag matches `package.json` and publishes the GitHub release with that version's notes.

---

## 🗺️ Roadmap

- [ ] Lighter watchlist updates using MangaDex chapter feeds instead of full searches
- [ ] MyAnimeList import: the list export file (no key), and lists by username (needs a free MAL API client ID)
- [ ] MangaDex list import (public MDLists)
- [ ] Two-way sync with AniList / MyAnimeList (mark chapters read here, update your list there; needs each user to log in)
- [ ] Installable app (PWA) with offline watchlist

---

## ⚠️ Disclaimer

MangaFinder Pro only links to third-party websites; it does not host any content. Results marked *Other sources* may be unofficial. Please support creators by reading on official platforms where available.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
