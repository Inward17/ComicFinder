const express = require('express');
const router = express.Router();
const geminiService = require('../services/geminiService');
const validationService = require('../services/validationService');

// POST /api/search
// Body: { query: "Manga Title" }
router.post('/search', async (req, res) => {
  try {
    const { query, forceRefresh } = req.body;
    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const result = await geminiService.searchManga(query, !!forceRefresh);
    
    // As per the fallback chain, if we have passing results, return those.
    // If not, we still return the structure but results is empty.
    res.json(result);

  } catch (error) {
    console.error("Search Route Error:", error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

// POST /api/check-links
// Body: { urls: ["http://site1.com", "http://site2.com"] }
router.post('/check-links', async (req, res) => {
  try {
    const { urls } = req.body;
    if (!urls || !Array.isArray(urls)) {
      return res.status(400).json({ error: 'Array of URLs is required' });
    }

    const checks = urls.map(url => validationService.checkLinkHealth(url));
    const results = await Promise.all(checks);
    
    res.json({ results });
  } catch (error) {
    console.error("Check-links Route Error:", error);
    res.status(500).json({ error: error.message || 'Internal Server Error' });
  }
});

module.exports = router;
