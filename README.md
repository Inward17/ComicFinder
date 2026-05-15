# MangaFinder Pro

> A smart web application that uses AI to find the best English reading sites for any manga, manhwa, or manhua — powered by Google Gemini 2.5.

![License](https://img.shields.io/badge/license-MIT-blue)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)

---

## ✨ Features

| Feature | Description |
|---|---|
| **AI-Powered Search** | Uses Gemini 2.5 with grounded web search to find direct links to manga series pages — not generic Google results. |
| **Link Validation** | Every result is verified: dead links, non-English pages, and Cloudflare-blocked sites are automatically filtered out. |
| **Rich Metadata** | Displays cover art, synopsis, genre tags, chapter count, and author info via the MangaDex API. |
| **Title Normalization** | Typos and alternate names (e.g. "solo leveling" → "Solo Leveling") are auto-corrected before searching. |
| **Watchlist** | Bookmark your favourite manga locally. Check for new chapters with a single click. |
| **Backend Caching** | Repeated searches return instantly from a local file cache (24h TTL), saving API tokens and time. |
| **Dark Mode** | Toggle between light and dark themes. Your preference is saved. |
| **Search History** | Recent searches are saved as quick-access chips. |

---

## 🏗️ Architecture

```
mangafinder-pro/
├── backend/
│   ├── server.js              # Express entry point, serves static files
│   ├── routes/
│   │   └── api.js             # /api/search and /api/check-links endpoints
│   └── services/
│       ├── geminiService.js   # Gemini API orchestration + cache integration
│       ├── validationService.js # Link health checks & Unicode detection
│       ├── mangadexService.js # MangaDex title normalization & metadata
│       └── cacheService.js    # File-based JSON cache with lockfile safety
├── index.html                 # Main UI
├── script.js                  # Frontend logic (search, bookmarks, rendering)
├── style.css                  # Design system & responsive layout
├── .env.example               # Environment variable template
├── package.json
└── README.md
```

---

## 🚀 Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or higher
- A free [Google Gemini API Key](https://aistudio.google.com/app/apikey)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/Inward17/ComicFinder.git
cd ComicFinder

# 2. Install dependencies
npm install

# 3. Create your environment file
cp .env.example .env
# Then open .env and paste your Gemini API key

# 4. Start the server
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## ⚙️ Environment Variables

| Variable | Required | Description |
|---|---|---|
| `GEMINI_API_KEY` | ✅ | Your Google Gemini API key from [AI Studio](https://aistudio.google.com/app/apikey) |

---

## 🔧 Tech Stack

| Layer | Technology |
|---|---|
| **Frontend** | HTML5, Vanilla CSS, Vanilla JS |
| **Backend** | Node.js, Express 5 |
| **AI** | Google Gemini 2.5 Flash (with grounded search) |
| **Metadata** | MangaDex API v5 |
| **Caching** | File-based JSON with `proper-lockfile` |
| **Icons** | [Tabler Icons](https://tabler-icons.io/) |
| **Fonts** | Bebas Neue, DM Sans (Google Fonts) |

---

## 📖 How It Works

1. **User searches** for a manga title (e.g. "One Piece").
2. **MangaDex API** normalizes the title and fetches metadata (cover, synopsis, tags, chapter count).
3. **Backend cache** is checked — if a valid result exists (< 24h old), it's returned instantly.
4. On cache miss, **Gemini 2.5** searches the web for reading sites and returns structured JSON.
5. **Validation service** checks each link for liveness, correct language, and Cloudflare blocks.
6. Results are returned to the frontend with a `fromCache` flag so the UI can show a cache notice.
7. Users can **bookmark** manga to a local watchlist and check for new chapters later.

---

## 🗺️ Roadmap

- [x] **Phase 1** — Node.js backend, API key security, link validation, fallback chain
- [x] **Phase 2** — Metadata cards, title normalization, collapsible synopsis
- [x] **Phase 3** — Watchlist with localStorage, sequential update checks
- [x] **Phase 4** — Backend file caching with TTL, cache pruning, lockfile safety
- [ ] **Phase 5** — User accounts, cross-device sync, Redis caching at scale

---

## 📄 License

This project is licensed under the [MIT License](LICENSE).
