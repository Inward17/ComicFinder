# MangaFinder Pro

A smart web application to automatically find the best English reading sites for any manga, manhwa, or manhua. Powered by Google's Gemini 2.5 API.

## Features
- **Smart Search:** Uses AI to find direct links to manga reading pages instead of generic search results.
- **Caching:** Instantly loads recent searches from local storage.
- **Dark Mode:** Easy on the eyes for late-night reading.
- **History:** Keeps track of your recent searches for quick access.

## Setup Instructions

1. Clone the repository.
2. Rename `config.example.js` to `config.js`.
3. Obtain a free [Google Gemini API Key](https://aistudio.google.com/app/apikey).
4. Open `config.js` and paste your API key:
   ```javascript
   const CONFIG = {
     GEMINI_API_KEY: "YOUR_API_KEY_HERE"
   };
   ```
5. Open `index.html` in your web browser.

## Tech Stack
- HTML5
- CSS3 (Vanilla)
- JavaScript (Vanilla)
- [Tabler Icons](https://tabler-icons.io/)
