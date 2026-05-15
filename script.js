// ============================================================
// MangaFinder Pro — Frontend Logic
// ============================================================

document.addEventListener('DOMContentLoaded', () => {

  // --- DOM References ---
  const inp = document.getElementById('inp');
  const btn = document.getElementById('searchBtn');
  const themeBtn = document.getElementById('themeBtn');
  const statusEl = document.getElementById('status');
  const resultsEl = document.getElementById('results');

  // Phase 3 Elements
  const tabSearch = document.getElementById('tabSearch');
  const tabBookmarks = document.getElementById('tabBookmarks');
  const searchView = document.getElementById('searchView');
  const bookmarksView = document.getElementById('bookmarksView');
  const bookmarksGrid = document.getElementById('bookmarksGrid');
  const bookmarkCount = document.getElementById('bookmarkCount');
  const checkAllBtn = document.getElementById('checkAllBtn');

  // --- State ---
  let history = JSON.parse(localStorage.getItem('mf_history') || '[]');
  let bookmarks = JSON.parse(localStorage.getItem('mf_bookmarks') || '{}');
  let currentSearchResult = null;
  let currentMetadataMap = {};

  // --- Dark Mode ---
  if (localStorage.getItem('mf_theme') === 'dark') {
    document.body.classList.add('dark-mode');
    themeBtn.innerHTML = '<i class="ti ti-sun-filled"></i>';
  }

  // --- Event Listeners ---
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(); });
  btn.addEventListener('click', () => doSearch());
  themeBtn.addEventListener('click', toggleTheme);
  tabSearch.addEventListener('click', () => switchView('search'));
  tabBookmarks.addEventListener('click', () => switchView('bookmarks'));
  checkAllBtn.addEventListener('click', () => checkAllUpdates());

  // --- Init ---
  renderHistory();
  updateBookmarkBadge();

  // ============================================================
  // UTILITY FUNCTIONS
  // ============================================================

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

  function switchView(view) {
    if (view === 'search') {
      tabSearch.classList.add('active');
      tabBookmarks.classList.remove('active');
      searchView.style.display = 'block';
      bookmarksView.style.display = 'none';
    } else {
      tabSearch.classList.remove('active');
      tabBookmarks.classList.add('active');
      searchView.style.display = 'none';
      bookmarksView.style.display = 'block';
      renderBookmarks();
    }
  }

  // ============================================================
  // SEARCH
  // ============================================================

  async function doSearch(forceRefresh = false) {
    const q = inp.value.trim();
    if (!q) return;

    // Smart frontend caching
    const cacheKey = `mf_cache_v2_${q.toLowerCase()}`;

    if (!forceRefresh) {
      const cachedData = localStorage.getItem(cacheKey);
      if (cachedData) {
        showStatus('');
        const data = JSON.parse(cachedData);
        currentSearchResult = data;
        renderResults(data, q, false, true);
        addHistory(q);
        return;
      }
    }

    setLoading(true);
    resultsEl.innerHTML = '';
    showStatus('Scanning the web and validating links...', true);

    try {
      const resp = await fetch('/api/search', {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, forceRefresh: forceRefresh })
      });

      const data = await resp.json();
      if (data.error) throw new Error(data.error);

      localStorage.setItem(cacheKey, JSON.stringify(data));

      currentSearchResult = data;
      showStatus('');
      renderResults(data, q, data.fromCache, false);
      addHistory(q);
    } catch (err) {
      console.error(err);
      showStatus('');
      resultsEl.innerHTML = `<div class="empty"><i class="ti ti-alert-circle"></i>Error: ${err.message || 'Check console for details.'}</div>`;
    }

    setLoading(false);
  }

  // Expose doSearch globally so inline onclick="doSearch(true)" works
  window.doSearch = doSearch;

  // ============================================================
  // RENDER RESULTS
  // ============================================================

  function renderResults(data, query, fromBackendCache = false, fromLocalCache = false) {
    resultsEl.innerHTML = '';

    if (fromBackendCache || fromLocalCache) {
      resultsEl.innerHTML += `<div class="cache-notice">
        <span><i class="ti ti-bolt"></i> Loaded from cache ⚡</span>
        <button class="btn-refresh" onclick="doSearch(true)"><i class="ti ti-refresh"></i> Force Refresh</button>
      </div>`;
    }

    // Render Metadata Card
    if (data.metadata) {
      const md = data.metadata;

      // Store metadata for bookmarking
      let bestUrl = null;
      let bestSite = null;
      if (data.results && data.results.length > 0) {
        bestUrl = data.results[0].url;
        bestSite = data.results[0].site;
      }
      currentMetadataMap[md.id] = { ...md, bestUrl, bestSite };

      let mdHtml = `<div class="metadata-card">`;
      if (md.coverUrl) {
        mdHtml += `<img class="metadata-cover" src="${md.coverUrl}" alt="Cover art">`;
      }
      mdHtml += `<div class="metadata-info">`;
      mdHtml += `<div class="metadata-title">${md.title}</div>`;

      if (md.tags && md.tags.length) {
        mdHtml += `<div class="genre-tags">`;
        md.tags.slice(0, 6).forEach(tag => {
          mdHtml += `<span class="genre-tag">${tag}</span>`;
        });
        mdHtml += `</div>`;
      }

      if (md.synopsis) {
        mdHtml += `<div class="metadata-synopsis collapsed" id="synopsisText">${md.synopsis}</div>`;
        mdHtml += `<button class="synopsis-toggle" onclick="document.getElementById('synopsisText').classList.toggle('collapsed')">Show more/less</button>`;
      }

      // Bookmark Toggle Button
      const isBookmarked = !!bookmarks[md.id];
      mdHtml += `<div><button class="btn-bookmark-toggle ${isBookmarked ? 'active' : ''}" onclick="toggleBookmark('${md.id}')" id="btn-toggle-${md.id}">`;
      mdHtml += isBookmarked ? `<i class="ti ti-star-filled"></i> Bookmarked` : `<i class="ti ti-star"></i> Bookmark`;
      mdHtml += `</button></div>`;

      mdHtml += `</div></div>`;
      resultsEl.innerHTML += mdHtml;
    }

    const sites = data.results || [];

    if (!sites || !sites.length || (sites.length === 1 && sites[0].site === 'not found')) {
      resultsEl.innerHTML += `<div class="empty"><i class="ti ti-ghost"></i><strong>${data.searchTitle || query}</strong> wasn't found.<br><span style="font-size:13px;margin-top:8px;display:block">Try checking the spelling or use the Japanese/Korean name.</span></div>`;
      return;
    }

    let html = '';
    sites.forEach((s, i) => {
      const isBest = i === 0 && !s.notes?.includes('Unverified');
      html += `<div class="result-card ${isBest ? 'best' : ''}">`;
      if (isBest) html += `<div class="badge"><i class="ti ti-star-filled"></i> Top Recommendation</div>`;
      html += `<div class="result-title">${s.title || data.searchTitle || query}</div>`;
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

      html += `<div class="action-buttons">`;
      html += `<a class="btn-read" href="${s.url}" target="_blank" rel="noopener"><i class="ti ti-book-2"></i> Series Page <i class="ti ti-external-link" style="font-size:14px"></i></a>`;

      const lowerUrl = s.url ? s.url.toLowerCase() : '';
      if (lowerUrl.includes('webtoons.com')) {
        const sep = lowerUrl.includes('?') ? '&' : '?';
        html += `<a class="btn-chapter" href="${s.url}${sep}episode_no=1" target="_blank" rel="noopener"><i class="ti ti-player-play"></i> First Chapter</a>`;
      }

      html += `</div>`;
      html += `</div>`;
    });

    resultsEl.innerHTML += html;
  }

  // ============================================================
  // HISTORY
  // ============================================================

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
      `<span class="chip" onclick="fillAndSearch('${h.replace(/'/g, "\\\'")}')"><i class="ti ti-clock" style="font-size:13px"></i> ${h}</span>`
    ).join('');
  }

  // ============================================================
  // BOOKMARKS
  // ============================================================

  function toggleBookmark(id) {
    try {
      const toggleBtn = document.getElementById(`btn-toggle-${id}`);

      if (bookmarks[id]) {
        // Remove bookmark
        delete bookmarks[id];
        if (toggleBtn) {
          toggleBtn.classList.remove('active');
          toggleBtn.innerHTML = `<i class="ti ti-star"></i> Bookmark`;
        }
      } else {
        // Add bookmark using mapped metadata
        const md = currentMetadataMap[id];
        if (!md) {
          console.error("toggleBookmark: metadata not found for id:", id);
          console.error("Available keys:", Object.keys(currentMetadataMap));
          alert("Bookmark failed: Metadata not found. Try searching again.");
          return;
        }

        bookmarks[id] = {
          id: md.id,
          title: md.title || 'Unknown Title',
          coverUrl: md.coverUrl || '',
          lastChapter: md.lastChapter || '?',
          readingUrl: md.bestUrl,
          readingSite: md.bestSite,
          hasNewChapter: false,
          timestamp: Date.now()
        };

        if (toggleBtn) {
          toggleBtn.classList.add('active');
          toggleBtn.innerHTML = `<i class="ti ti-star-filled"></i> Bookmarked`;
        }
      }

      saveBookmarks();
    } catch (err) {
      console.error("toggleBookmark error:", err);
      alert("Bookmark error: " + err.message);
    }
  }

  function removeBookmark(id) {
    delete bookmarks[id];
    saveBookmarks();
    renderBookmarks();
    const toggleBtn = document.getElementById(`btn-toggle-${id}`);
    if (toggleBtn) {
      toggleBtn.classList.remove('active');
      toggleBtn.innerHTML = `<i class="ti ti-star"></i> Bookmark`;
    }
  }

  function saveBookmarks() {
    localStorage.setItem('mf_bookmarks', JSON.stringify(bookmarks));
    updateBookmarkBadge();
  }

  function updateBookmarkBadge() {
    const count = Object.keys(bookmarks).length;
    if (count > 0) {
      bookmarkCount.textContent = count;
      bookmarkCount.style.display = 'inline-block';
    } else {
      bookmarkCount.style.display = 'none';
    }
  }

  function renderBookmarks() {
    const keys = Object.keys(bookmarks);

    if (keys.length === 0) {
      bookmarksGrid.innerHTML = `
        <div class="empty-state">
          <i class="ti ti-bookmark-off"></i>
          <h3>No bookmarks yet</h3>
          <p style="margin-top: 8px; font-size: 14px;">Search for a manga and click the ⭐ Bookmark button to save it here for easy access.</p>
        </div>`;
      return;
    }

    const sorted = keys.map(k => bookmarks[k]).sort((a, b) => b.timestamp - a.timestamp);

    let html = '';
    sorted.forEach(b => {
      html += `<div class="bookmark-card">`;
      if (b.hasNewChapter) {
        html += `<div class="badge-new"><i class="ti ti-bolt" style="font-size:12px"></i> NEW CHAPTER</div>`;
      }
      if (b.coverUrl) {
        html += `<img class="bookmark-cover" src="${b.coverUrl}" alt="Cover">`;
      }
      html += `<div class="bookmark-info">`;
      html += `<div class="bookmark-title" title="${b.title}">${b.title}</div>`;
      html += `<div class="bookmark-meta">`;
      html += `<div><strong>Status:</strong> ${b.lastChapter !== '?' ? 'Ch. ' + b.lastChapter : 'Ongoing'}</div>`;
      if (b.readingSite) html += `<div style="margin-top:4px"><i class="ti ti-world" style="font-size:12px"></i> ${b.readingSite}</div>`;
      html += `</div>`;

      html += `<div class="bookmark-actions">`;
      if (b.readingUrl) {
        html += `<a class="btn-read" href="${b.readingUrl}" target="_blank" rel="noopener" style="padding: 6px 10px; font-size: 11px;"><i class="ti ti-book-2"></i> Go to Series</a>`;
      } else {
        html += `<button class="btn-read" onclick="fillAndSearch('${b.title.replace(/'/g, "\\\\'")}')" style="padding: 6px 10px; font-size: 11px;"><i class="ti ti-search"></i> Search</button>`;
      }
      html += `<button class="btn-remove" onclick="removeBookmark('${b.id}')" title="Remove bookmark"><i class="ti ti-trash"></i></button>`;
      html += `</div>`;

      html += `</div></div>`;
    });

    bookmarksGrid.innerHTML = html;
  }

  async function checkAllUpdates() {
    const keys = Object.keys(bookmarks);
    if (keys.length === 0) return;

    const originalHtml = checkAllBtn.innerHTML;
    checkAllBtn.disabled = true;
    checkAllBtn.innerHTML = '<i class="ti ti-loader-2 spinner"></i> Checking...';

    let updatedCount = 0;

    for (let i = 0; i < keys.length; i++) {
      const id = keys[i];
      const b = bookmarks[id];

      try {
        const resp = await fetch('/api/search', {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: b.title })
        });
        const data = await resp.json();

        if (data.metadata && data.metadata.lastChapter) {
          const oldCh = parseFloat(b.lastChapter) || 0;
          const newCh = parseFloat(data.metadata.lastChapter) || 0;

          if (newCh > oldCh) {
            bookmarks[id].lastChapter = data.metadata.lastChapter;
            bookmarks[id].hasNewChapter = true;
            updatedCount++;
          }
        }
      } catch (err) {
        console.error(`Failed to update ${b.title}`, err);
      }

      if (i < keys.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    if (updatedCount > 0) {
      saveBookmarks();
      renderBookmarks();
      alert(`Found new chapters for ${updatedCount} manga!`);
    } else {
      alert("No new chapters found.");
    }

    checkAllBtn.disabled = false;
    checkAllBtn.innerHTML = originalHtml;
  }

  // ============================================================
  // EXPOSE FUNCTIONS TO GLOBAL SCOPE (for inline onclick handlers)
  // ============================================================

  window.toggleBookmark = toggleBookmark;
  window.removeBookmark = removeBookmark;
  window.fillAndSearch = function(q) {
    switchView('search');
    inp.value = q;
    doSearch();
  };
  window.checkAllUpdates = checkAllUpdates;

}); // end DOMContentLoaded
