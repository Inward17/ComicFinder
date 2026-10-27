// ============================================================
// MangaFinder Pro — Frontend Logic
// All persistence goes through store.mjs (browser-local, one versioned key).
// ============================================================

import { store } from './store.mjs';

const $ = id => document.getElementById(id);
const inp = $('inp');
const searchBtn = $('searchBtn');
const themeBtn = $('themeBtn');
const statusEl = $('status');
const resultsEl = $('results');
const tabSearch = $('tabSearch');
const tabBookmarks = $('tabBookmarks');
const searchView = $('searchView');
const bookmarksView = $('bookmarksView');
const bookmarksGrid = $('bookmarksGrid');
const bookmarkCount = $('bookmarkCount');
const checkAllBtn = $('checkAllBtn');

const SUGGESTIONS = ['Solo Leveling', 'One Piece', 'Omniscient Reader', 'Frieren'];
const LOADING_STEPS = [
  [0, 'Matching the title on MangaDex…'],
  [2, 'Searching the web for reading sites…'],
  [9, 'Checking every link and aggregator site…'],
  [20, 'Still verifying pages, almost there…']
];

// Series shown in the current results, used when bookmarking it
let currentSeries = null;
let loadingTimer = null;

// ============================================================
// UTILITIES
// ============================================================

// Everything rendered via innerHTML comes from Gemini/MangaDex/storage and must be escaped
const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => HTML_ESCAPES[c]);
}

// Only http(s) links may be rendered; blocks javascript: and data: URLs
function safeUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.href : '#';
  } catch {
    return '#';
  }
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  $('toasts').append(el);
  setTimeout(() => el.remove(), 3500);
}

// Highest known chapter: MangaDex's lastChapter or a site lookup's newest chapter
function latestChapter(data) {
  const numbers = [data.metadata && data.metadata.lastChapter]
    .concat((data.results || []).filter(r => r.source === 'site-lookup').map(r => r.chaptersAvailable))
    .map(n => parseFloat(n))
    .filter(n => !Number.isNaN(n));
  return numbers.length ? Math.max(...numbers) : null;
}

// ============================================================
// THEME
// ============================================================

function applyTheme(theme) {
  const dark = theme ? theme === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  // Mobile browser chrome color follows the in-app choice, not just the system setting
  document.querySelectorAll('meta[name="theme-color"]').forEach(m => { m.content = dark ? '#0e0d0c' : '#f6f4ef'; });
  themeBtn.innerHTML = `<i class="ti ${dark ? 'ti-sun' : 'ti-moon'}" aria-hidden="true"></i>`;
  themeBtn.setAttribute('aria-label', dark ? 'Switch to light mode' : 'Switch to dark mode');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  store.setTheme(next);
  applyTheme(next);
}

// ============================================================
// VIEWS
// ============================================================

function switchView(view) {
  const isSearch = view === 'search';
  searchView.hidden = !isSearch;
  bookmarksView.hidden = isSearch;
  tabSearch.classList.toggle('active', isSearch);
  tabBookmarks.classList.toggle('active', !isSearch);
  tabSearch.toggleAttribute('aria-current', isSearch);
  tabBookmarks.toggleAttribute('aria-current', !isSearch);
  if (!isSearch) renderBookmarks();
}

function fillAndSearch(q) {
  switchView('search');
  inp.value = q;
  doSearch();
}

// ============================================================
// SEARCH
// ============================================================

function startLoading() {
  searchBtn.disabled = true;
  document.body.classList.add('searched');
  window.scrollTo({ top: 0 });
  resultsEl.innerHTML = Array.from({ length: 3 }, () =>
    `<div class="skeleton"><div class="bar wide"></div><div class="bar mid"></div><div class="bar short"></div></div>`
  ).join('');

  const started = Date.now();
  const tick = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const step = LOADING_STEPS.filter(([at]) => seconds >= at).pop()[1];
    statusEl.innerHTML = `<div class="spinner"></div><span>${esc(step)}</span><span class="elapsed">${seconds}s</span>`;
  };
  tick();
  loadingTimer = setInterval(tick, 1000);
}

function stopLoading() {
  clearInterval(loadingTimer);
  statusEl.innerHTML = '';
  searchBtn.disabled = false;
}

async function doSearch(forceRefresh = false) {
  const q = inp.value.trim();
  if (!q) return;

  if (!forceRefresh) {
    const cached = store.getCachedSearch(q);
    if (cached) {
      renderResults(cached, q, true);
      store.addHistory(q);
      renderHistory();
      return;
    }
  }

  startLoading();
  try {
    const resp = await fetch('/api/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, forceRefresh })
    });
    const data = await resp.json();
    if (data.error) throw new Error(data.error);

    store.cacheSearch(q, data);
    stopLoading();
    renderResults(data, q, data.fromCache);
    store.addHistory(q);
    renderHistory();
  } catch (err) {
    console.error(err);
    stopLoading();
    resultsEl.innerHTML = `<div class="empty"><i class="ti ti-alert-circle" aria-hidden="true"></i>${esc(err.message || 'Something went wrong. Check the console for details.')}</div>`;
  }
}

// ============================================================
// RENDER RESULTS
// ============================================================

function renderIntro() {
  resultsEl.innerHTML = `
    <div class="chips" style="justify-content:center">
      <span class="muted" style="align-self:center;margin-right:4px">Try</span>
      ${SUGGESTIONS.map(s => `<button class="chip" data-action="search" data-query="${esc(s)}">${esc(s)}</button>`).join('')}
    </div>`;
}

function renderResults(data, query, cached) {
  let html = '';
  // Compacts the hero on phones so results start near the top
  document.body.classList.add('searched');
  if (cached) window.scrollTo({ top: 0 });

  if (cached) {
    html += `<div class="notice">
      <span><i class="ti ti-bolt" aria-hidden="true"></i> Saved results (last 24 h)</span>
      <button data-action="refresh"><i class="ti ti-refresh" aria-hidden="true"></i> Refresh</button>
    </div>`;
  }

  currentSeries = null;
  if (data.metadata) html += seriesCard(data);

  const results = data.results || [];
  if (!results.length) {
    html += `<div class="empty"><i class="ti ti-ghost" aria-hidden="true"></i>
      No verified reading sites for <strong>${esc(data.searchTitle || query)}</strong>.<br>
      <span class="muted">Try the Japanese/Korean name, or another title above.</span></div>`;
    resultsEl.innerHTML = html;
    return;
  }

  const fallbackTitle = data.searchTitle || query;
  const top = results[0].notes && results[0].notes.includes('Unverified') ? null : results[0];
  const official = results.filter(r => r.official === true);
  const other = results.filter(r => r.official !== true);

  if (official.length) {
    html += resultGroup('Official', 'Licensed publishers and platforms', official, top, fallbackTitle);
  }
  if (other.length) {
    html += resultGroup('Other sources', 'Fan translations and aggregators, unofficial', other, top, fallbackTitle);
  }
  resultsEl.innerHTML = html;
}

function seriesCard(data) {
  const md = data.metadata;
  const latest = latestChapter(data);
  const best = (data.results || [])[0];
  currentSeries = { ...md, latest, bestUrl: best && best.url, bestSite: best && best.site };

  const facts = [
    md.author && md.author !== 'Unknown Author' ? `<span><i class="ti ti-user" aria-hidden="true"></i>${esc(md.author)}</span>` : '',
    md.year ? `<span><i class="ti ti-calendar" aria-hidden="true"></i>${esc(md.year)}</span>` : '',
    md.status ? `<span><i class="ti ti-progress" aria-hidden="true"></i>${esc(md.status[0].toUpperCase() + md.status.slice(1))}</span>` : '',
    latest !== null ? `<span><i class="ti ti-book" aria-hidden="true"></i>Ch. ${esc(latest)}</span>` : ''
  ].join('');

  const isBookmarked = store.hasBookmark(md.id);
  let html = `<article class="series">`;
  html += md.coverUrl
    ? `<img class="series-cover" src="${esc(safeUrl(md.coverUrl))}" alt="Cover of ${esc(md.title)}">`
    : `<div class="series-cover"></div>`;
  html += `<div class="series-info">`;
  html += `<h2 class="series-title">${esc(md.title)}</h2>`;
  html += `<div class="series-facts">${facts}</div>`;
  if (md.tags && md.tags.length) {
    html += `<div class="tags">${md.tags.slice(0, 6).map(t => `<span class="tag">${esc(t)}</span>`).join('')}</div>`;
  }
  if (md.synopsis) {
    html += `<p class="synopsis collapsed" id="synopsisText">${esc(md.synopsis)}</p>`;
  }
  html += `<div class="series-actions">`;
  html += `<button class="btn btn-secondary btn-sm btn-bookmark" data-action="toggle-bookmark" data-id="${esc(md.id)}" id="btn-toggle-${esc(md.id)}" aria-pressed="${isBookmarked}">${bookmarkLabel(isBookmarked)}</button>`;
  if (md.synopsis) html += `<button class="link-btn" data-action="toggle-synopsis">Show more</button>`;
  html += `</div>`;

  // Other MangaDex matches, in case the pick was the wrong series
  if (md.alternatives && md.alternatives.length) {
    html += `<div class="alternatives"><span class="alternatives-label">Not this one?</span>`;
    md.alternatives.forEach(alt => {
      const label = alt.year ? `${alt.title} (${alt.year})` : alt.title;
      html += `<button class="chip" data-action="search" data-query="${esc(alt.title)}">${esc(label)}</button>`;
    });
    html += `</div>`;
  }
  html += `</div></article>`;
  return html;
}

function bookmarkLabel(isBookmarked) {
  return isBookmarked
    ? `<i class="ti ti-bookmark-filled" aria-hidden="true"></i> In watchlist`
    : `<i class="ti ti-bookmark" aria-hidden="true"></i> Add to watchlist`;
}

function resultGroup(title, subtitle, results, top, fallbackTitle) {
  return `<section class="group">
    <div class="group-head"><h2>${esc(title)}</h2><span class="muted">${esc(subtitle)} · ${results.length}</span></div>
    <div class="result-list">${results.map(r => resultCard(r, r === top, fallbackTitle)).join('')}</div>
  </section>`;
}

function resultCard(s, isTop, fallbackTitle) {
  const url = safeUrl(s.url);
  const host = hostOf(url);
  const name = s.site || host || fallbackTitle;
  const unverified = !!(s.notes && s.notes.includes('Unverified'));
  const note = (s.notes || '').replace('⚠️ (Unverified link)', '').trim();

  const pills = [];
  pills.push(unverified
    ? `<span class="pill warn"><i class="ti ti-alert-triangle" aria-hidden="true"></i>Unverified</span>`
    : `<span class="pill ok"><i class="ti ti-circle-check" aria-hidden="true"></i>Link checked</span>`);
  if (s.official) pills.push(`<span class="pill ok"><i class="ti ti-shield-check" aria-hidden="true"></i>Official</span>`);
  if (s.free === true) pills.push(`<span class="pill ok">Free</span>`);
  if (s.free === false) pills.push(`<span class="pill warn">Paid / subscription</span>`);
  if (s.language && !/^english$/i.test(s.language)) pills.push(`<span class="pill">${esc(s.language)}</span>`);
  // Gemini sometimes writes prose here ("Latest 3 chapters free…"); only numbers make a useful pill
  if (/^\d+(\.\d+)?\+?$/.test(String(s.chaptersAvailable ?? '').trim())) {
    pills.push(`<span class="pill">Ch. ${esc(String(s.chaptersAvailable).trim())}</span>`);
  }
  if (s.status) pills.push(`<span class="pill">${esc(s.status)}</span>`);

  let html = `<article class="result${isTop ? ' top' : ''}">`;
  if (isTop) html += `<span class="top-badge"><i class="ti ti-star-filled" aria-hidden="true"></i> Top pick</span>`;
  html += `<div class="result-head"><span class="avatar" aria-hidden="true">${esc(name[0].toUpperCase())}</span>`;
  html += `<div><div class="result-site">${esc(name)}</div><div class="result-host">${esc(host)}</div></div></div>`;
  html += `<div class="pills">${pills.join('')}</div>`;
  if (note) html += `<p class="result-note">${esc(note)}</p>`;

  html += `<div class="result-actions">`;
  html += `<a class="btn btn-primary btn-sm" href="${esc(url)}" target="_blank" rel="noopener">Read on ${esc(name)} <i class="ti ti-external-link" aria-hidden="true"></i></a>`;
  if (host.endsWith('webtoons.com')) {
    const sep = url.includes('?') ? '&' : '?';
    html += `<a class="btn btn-secondary btn-sm" href="${esc(url + sep + 'episode_no=1')}" target="_blank" rel="noopener"><i class="ti ti-player-play" aria-hidden="true"></i> Episode 1</a>`;
  }
  html += `</div></article>`;
  return html;
}

// ============================================================
// HISTORY
// ============================================================

function renderHistory() {
  const history = store.listHistory();
  $('historySection').hidden = !history.length;
  $('historyChips').innerHTML = history.map(h =>
    `<button class="chip" data-action="search" data-query="${esc(h)}"><i class="ti ti-clock" aria-hidden="true"></i> ${esc(h)}</button>`
  ).join('');
}

// ============================================================
// WATCHLIST
// ============================================================

function updateBookmarkBadge() {
  const count = store.listBookmarks().length;
  bookmarkCount.textContent = count;
  bookmarkCount.hidden = count === 0;
}

function setBookmarkButton(id, isBookmarked) {
  const btn = document.getElementById(`btn-toggle-${id}`);
  if (!btn) return;
  btn.setAttribute('aria-pressed', String(isBookmarked));
  btn.innerHTML = bookmarkLabel(isBookmarked);
}

function toggleBookmark(id) {
  if (store.hasBookmark(id)) {
    removeBookmark(id);
    return;
  }
  if (!currentSeries || currentSeries.id !== id) {
    toast('Search for this title again to add it.');
    return;
  }
  store.addBookmark({
    id,
    title: currentSeries.title || 'Unknown title',
    coverUrl: currentSeries.coverUrl || '',
    lastChapter: currentSeries.latest ?? currentSeries.lastChapter ?? null,
    readingUrl: currentSeries.bestUrl || null,
    readingSite: currentSeries.bestSite || null,
    hasNewChapter: false
  });
  setBookmarkButton(id, true);
  updateBookmarkBadge();
  toast(`Added ${currentSeries.title} to your watchlist`);
}

function removeBookmark(id) {
  const bookmark = store.getBookmark(id);
  store.removeBookmark(id);
  setBookmarkButton(id, false);
  updateBookmarkBadge();
  if (!bookmarksView.hidden) renderBookmarks();
  if (bookmark) toast(`Removed ${bookmark.title}`);
}

function renderBookmarks() {
  const bookmarks = store.listBookmarks();

  if (!bookmarks.length) {
    bookmarksGrid.innerHTML = `
      <div class="empty" style="grid-column:1/-1">
        <i class="ti ti-bookmark-off" aria-hidden="true"></i>
        <strong>Nothing saved yet</strong>
        <p class="muted" style="margin:6px 0 14px">Search a title and press “Add to watchlist”.</p>
        <button class="btn btn-primary btn-sm" data-action="go-search">Start searching</button>
      </div>`;
    return;
  }

  bookmarksGrid.innerHTML = bookmarks.map(b => {
    const chapter = b.lastChapter !== null && b.lastChapter !== undefined && b.lastChapter !== '?' ? `Ch. ${esc(b.lastChapter)}` : 'Chapter unknown';
    let html = `<article class="poster">`;
    if (b.hasNewChapter) html += `<span class="new-badge"><i class="ti ti-bolt" aria-hidden="true"></i> New chapter</span>`;
    html += b.coverUrl
      ? `<img class="poster-cover" src="${esc(safeUrl(b.coverUrl))}" alt="" loading="lazy">`
      : `<div class="poster-cover placeholder"><i class="ti ti-book-2" aria-hidden="true"></i></div>`;
    html += `<div class="poster-body">`;
    html += `<button class="poster-title" data-action="search" data-query="${esc(b.title)}" title="Search ${esc(b.title)}">${esc(b.title)}</button>`;
    html += `<div class="poster-meta">${chapter}${b.readingSite ? ` · ${esc(b.readingSite)}` : ''}</div>`;
    html += `<div class="poster-actions">`;
    html += b.readingUrl
      ? `<a class="btn btn-primary btn-sm" href="${esc(safeUrl(b.readingUrl))}" target="_blank" rel="noopener" data-action="open-bookmark" data-id="${esc(b.id)}">Read</a>`
      : `<button class="btn btn-primary btn-sm" data-action="search" data-query="${esc(b.title)}">Find</button>`;
    html += `<button class="btn btn-secondary btn-sm btn-icon btn-danger" data-action="remove-bookmark" data-id="${esc(b.id)}" aria-label="Remove ${esc(b.title)}"><i class="ti ti-trash" aria-hidden="true"></i></button>`;
    html += `</div></div></article>`;
    return html;
  }).join('');
}

async function checkAllUpdates() {
  const bookmarks = store.listBookmarks();
  if (!bookmarks.length) return;

  const originalHtml = checkAllBtn.innerHTML;
  checkAllBtn.disabled = true;
  let updatedCount = 0;
  let rateLimited = false;

  for (let i = 0; i < bookmarks.length; i++) {
    const b = bookmarks[i];
    checkAllBtn.innerHTML = `<div class="spinner"></div> Checking ${i + 1} of ${bookmarks.length}…`;

    try {
      const resp = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: b.title })
      });
      if (resp.status === 429) {
        rateLimited = true;
        break;
      }
      const data = await resp.json();
      const newest = latestChapter(data);
      const known = parseFloat(b.lastChapter) || 0;
      if (newest !== null && newest > known) {
        store.updateBookmark(b.id, { lastChapter: newest, hasNewChapter: true });
        updatedCount++;
      }
    } catch (err) {
      console.error(`Failed to update ${b.title}`, err);
    }

    if (i < bookmarks.length - 1) {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }

  renderBookmarks();
  checkAllBtn.disabled = false;
  checkAllBtn.innerHTML = originalHtml;
  const summary = updatedCount > 0 ? `New chapters for ${updatedCount} series.` : 'No new chapters.';
  toast(rateLimited ? `${summary} Stopped early: search limit reached, try again in a minute.` : summary);
}

// ============================================================
// EVENTS
// ============================================================

$('searchForm').addEventListener('submit', e => {
  e.preventDefault();
  doSearch();
});
themeBtn.addEventListener('click', toggleTheme);
tabSearch.addEventListener('click', () => switchView('search'));
tabBookmarks.addEventListener('click', () => switchView('bookmarks'));
checkAllBtn.addEventListener('click', () => checkAllUpdates());

// "/" jumps to the search box from anywhere except text fields
document.addEventListener('keydown', e => {
  if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
  if (['INPUT', 'TEXTAREA'].includes(document.activeElement.tagName)) return;
  e.preventDefault();
  switchView('search');
  inp.focus();
});

// Follow the system theme until the user picks one
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!store.getTheme()) applyTheme(null);
});

// Rendered markup carries data-action attributes instead of inline onclick handlers
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const { action, id, query } = el.dataset;
  if (action === 'refresh') doSearch(true);
  else if (action === 'toggle-synopsis') {
    const collapsed = $('synopsisText').classList.toggle('collapsed');
    el.textContent = collapsed ? 'Show more' : 'Show less';
  }
  else if (action === 'toggle-bookmark') toggleBookmark(id);
  else if (action === 'remove-bookmark') removeBookmark(id);
  else if (action === 'open-bookmark') {
    // Link still opens; re-render after the click so the "New chapter" badge clears
    store.updateBookmark(id, { hasNewChapter: false });
    setTimeout(renderBookmarks);
  }
  else if (action === 'search') fillAndSearch(query);
  else if (action === 'clear-history') { store.clearHistory(); renderHistory(); }
  else if (action === 'go-search') { switchView('search'); inp.focus(); }
});

// ============================================================
// INIT
// ============================================================

applyTheme(store.getTheme());
renderHistory();
updateBookmarkBadge();
renderIntro();
