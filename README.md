# MangaFinder Pro

> Find where to read any manga, manhwa, or manhua in English. Official sources first, every link checked.

![CI](https://github.com/Inward17/ComicFinder/actions/workflows/ci.yml/badge.svg)
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
| **Verified links** | Each link is fetched and checked: dead pages, homepages, search pages, non-English pages and pages about a different series are dropped. |
| **Official first** | Results are split into *Official* and *Other sources*, with licensed publishers ranked at the top. An *Official only* switch hides everything unofficial. |
| **Right series** | Titles are matched on MangaDex across English, romanized and alternate names, skipping fan works. A "Not this one?" row lets you switch to a related series. |
| **Series details** | Cover, author, year, status, genres, synopsis and the latest chapter. |
| **Watchlist** | Save series in your browser and check them all for new chapters in one click. Export it to a file and import it in another browser. No account needed. |
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

### Continuous integration

GitHub Actions runs the tests, a frontend syntax check and a server smoke test on every push and pull request (Node 20 and 22). A separate workflow checks the aggregator sites every Monday; add `FIRECRAWL_API_KEY` as a repository secret to have Cloudflare-protected sites verified too.

---

## ⚙️ Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Google Gemini API key from [AI Studio](https://aistudio.google.com/app/apikey). |
| `FIRECRAWL_API_KEY` | Optional | Lets the app read sites protected by Cloudflare challenges, both for direct lookups and for checking links. Uses about 1–3 credits per new search. Without it, those sites are skipped or left unchecked. |
| `PORT` | Optional | Server port. Defaults to `3000`. |

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

Search routes share a limit of 10 requests per minute per IP; suggestions allow 60.

---

## 🔒 Privacy and Security

- **Your data stays in your browser.** The watchlist, search history and theme are stored in `localStorage` under a single key (`mangafinder.v1`). Nothing is sent to the server, and clearing site data removes it.
- **API keys stay on the server.** They are read from `.env` and never sent to the browser.
- **Abuse protection.** Requests are rate limited per IP, and the server refuses to fetch private or internal network addresses.

---

## 🏗️ Project Structure

```
ComicFinder/
├── backend/
│   ├── server.js                 # Express entry point; serves public/ and the API
│   ├── routes/
│   │   └── api.js                # Search, streaming search and suggest endpoints
│   └── services/
│       ├── geminiService.js      # Search pipeline: Gemini, site lookups, ranking, cache
│       ├── mangadexService.js    # Series matching and metadata from MangaDex
│       ├── siteFamilyService.js  # Direct lookups on aggregator sites
│       ├── validationService.js  # Link checks, language check, SSRF guard
│       ├── firecrawlService.js   # Optional Firecrawl client
│       └── cacheService.js       # 24h file cache for search results
├── public/
│   ├── index.html
│   ├── script.js                 # UI: search, results, watchlist
│   ├── store.mjs                 # Browser storage (watchlist, history, theme, cache)
│   └── style.css
├── scripts/
│   └── check-sites.js            # Aggregator site health check
├── test/                         # node:test suites
├── .github/workflows/            # CI and the weekly site check
├── .env.example
└── package.json
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

## 🗺️ Roadmap

- [ ] Lighter watchlist updates using MangaDex chapter feeds instead of full searches
- [ ] Search by image (manga page, cover or panel)
- [ ] Installable app (PWA) with offline watchlist
- [ ] Configurable Gemini model

---

## ⚠️ Disclaimer

MangaFinder Pro only links to third-party websites; it does not host any content. Results marked *Other sources* may be unofficial. Please support creators by reading on official platforms where available.

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
