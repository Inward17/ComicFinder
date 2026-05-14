// The API key is now loaded from config.js
// If config.js is missing, it will fall back to an empty string to trigger the UI notice.
const API_KEY = (typeof CONFIG !== 'undefined') ? CONFIG.GEMINI_API_KEY : "";

const inp = document.getElementById('inp');
const btn = document.getElementById('searchBtn');
const themeBtn = document.getElementById('themeBtn');
const statusEl = document.getElementById('status');
const resultsEl = document.getElementById('results');
let history = JSON.parse(localStorage.getItem('mf_history') || '[]');

// Setup Dark Mode from saved preference
if (localStorage.getItem('mf_theme') === 'dark') {
  document.body.classList.add('dark-mode');
  themeBtn.innerHTML = '<i class="ti ti-sun-filled"></i>';
}

if (!API_KEY || API_KEY.includes("YOUR_NEW")) {
  document.getElementById('apiNotice').style.display = 'block';
}

inp.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
btn.addEventListener('click', doSearch);
themeBtn.addEventListener('click', toggleTheme);

renderHistory();

function toggleTheme() {
  const isDark = document.body.classList.toggle('dark-mode');
  themeBtn.innerHTML = isDark ? '<i class="ti ti-sun-filled"></i>' : '<i class="ti ti-moon-filled"></i>';
  localStorage.setItem('mf_theme', isDark ? 'dark' : 'light');
}

function showStatus(msg, spin = false) {
  statusEl.innerHTML = (spin ? '<div class="spinner"></div>' : '') + `<span>${msg}</span>`;
}

function setLoading(on) {
  btn.disabled = on;
  btn.innerHTML = on ? '<i class="ti ti-loader-2"></i> Searching…' : '<i class="ti ti-search"></i> Find';
}

async function doSearch() {
  const q = inp.value.trim();
  if (!q) return;

  // 1. SMART CACHING: Check if we already searched this recently
  const cacheKey = `mf_cache_${q.toLowerCase()}`;
  const cachedData = localStorage.getItem(cacheKey);
  
  if (cachedData) {
    showStatus('Loaded from local cache instantly! ⚡');
    renderResults(JSON.parse(cachedData), q);
    addHistory(q);
    return;
  }

  if (!API_KEY || API_KEY.includes("YOUR_NEW")) {
    showStatus("Please add your Gemini API key in the script section.");
    return;
  }

  setLoading(true);
  resultsEl.innerHTML = '';
  showStatus('Gemini is scanning the web...', true);

  const prompt = `You are a manga/manhwa reading assistant. Search the web to find the best working English reading sites for: "${q}".
  
  Return ONLY a JSON array of objects with these keys: title, site, url, language, free, official, status, chaptersAvailable, notes.
  
  CRITICAL URL RULES:
  - The "url" MUST be the exact, direct deep-link to the manga's main series page (e.g., domain.com/manga/exact-title).
  - NEVER return a root domain or homepage URL. If you cannot confidently find the direct deep-link, DO NOT include that site.
  
  Do not include any introductory text or explanations.`;

  try {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${API_KEY}`;
    
    const resp = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        tools: [{ googleSearch: {} }], 
        generationConfig: { temperature: 0.2 }
      })
    });

    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);

    let textResponse = data.candidates[0].content.parts[0].text;
    const jsonStart = textResponse.indexOf('[');
    const jsonEnd = textResponse.lastIndexOf(']');
    if (jsonStart !== -1 && jsonEnd !== -1) {
        textResponse = textResponse.slice(jsonStart, jsonEnd + 1);
    }

    const sites = JSON.parse(textResponse);

    // 2. SAVE TO CACHE: Save the result so we don't have to fetch it next time
    localStorage.setItem(cacheKey, JSON.stringify(sites));

    showStatus('');
    renderResults(sites, q);
    addHistory(q);
  } catch (err) {
    console.error(err);
    showStatus('');
    resultsEl.innerHTML = `<div class="empty"><i class="ti ti-alert-circle"></i>Error: ${err.message || 'Check console for details.'}</div>`;
  }

  setLoading(false);
}

function renderResults(sites, query) {
  if (!sites || !sites.length || (sites.length === 1 && sites[0].site === 'not found')) {
    resultsEl.innerHTML = `<div class="empty"><i class="ti ti-ghost"></i><strong>${query}</strong> wasn't found.<br><span style="font-size:13px;margin-top:8px;display:block">Try checking the spelling or use the Japanese/Korean name.</span></div>`;
    return;
  }

  let html = '';
  sites.forEach((s, i) => {
    const isBest = i === 0;
    html += `<div class="result-card ${isBest ? 'best' : ''}">`;
    if (isBest) html += `<div class="badge"><i class="ti ti-star-filled"></i> Top Recommendation</div>`;
    html += `<div class="result-title">${s.title || query}</div>`;
    html += `<div class="result-site"><i class="ti ti-world" style="font-size:14px;vertical-align:-2px;margin-right:4px"></i>${s.site}</div>`;
    html += `<div class="result-meta">`;
    html += `<span class="pill good"><i class="ti ti-language" style="font-size:13px;vertical-align:-2px;margin-right:3px"></i>${s.language || 'English'}</span>`;
    html += s.free
      ? `<span class="pill good"><i class="ti ti-currency-dollar-off" style="font-size:13px;vertical-align:-2px;margin-right:3px"></i>Free</span>`
      : `<span class="pill warn">Paid / Sub</span>`;
    if (s.official) html += `<span class="pill good"><i class="ti ti-shield-check" style="font-size:13px;vertical-align:-2px;margin-right:3px"></i>Official</span>`;
    if (s.status) html += `<span class="pill">${s.status}</span>`;
    if (s.chaptersAvailable) html += `<span class="pill">${s.chaptersAvailable} ch.</span>`;
    html += `</div>`;
    if (s.notes) html += `<div class="result-note">${s.notes}</div>`;
    if (s.url) html += `<a class="btn-read" href="${s.url}" target="_blank" rel="noopener"><i class="ti ti-book-2"></i> Read now <i class="ti ti-external-link" style="font-size:14px"></i></a>`;
    html += `</div>`;
  });

  resultsEl.innerHTML = html;
}

function addHistory(q) {
  history = [q, ...history.filter(h => h.toLowerCase() !== q.toLowerCase())].slice(0, 8);
  localStorage.setItem('mf_history', JSON.stringify(history));
  renderHistory();
}

function renderHistory() {
  const sec = document.getElementById('historySection');
  const chips = document.getElementById('historyChips');
  if (!history.length) { sec.style.display = 'none'; return; }
  sec.style.display = 'block';
  chips.innerHTML = history.map(h =>
    `<span class="chip" onclick="fillAndSearch('${h.replace(/'/g, "\\'")}')"><i class="ti ti-clock" style="font-size:13px"></i> ${h}</span>`
  ).join('');
}

// Make globally available for inline onclick generated by renderHistory
window.fillAndSearch = function(q) {
  inp.value = q;
  doSearch();
}
