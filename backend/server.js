require('dotenv').config();
const express = require('express');
const path = require('path');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// Image search carries a base64 image (4 MB max, ~5.4 MB encoded); every other route keeps the 100 KB default.
// Registered first: once a body is parsed, the general parser below skips it.
app.use('/api/image-search', express.json({ limit: '6mb' }));
app.use(express.json());

// Serve only the frontend; the project root holds backend source and local files
app.use(express.static(path.join(__dirname, '../public')));

// API Routes
app.use('/api', apiRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
  console.log(`   Gemini model: ${require('./services/geminiService').GEMINI_MODEL}`);
});
