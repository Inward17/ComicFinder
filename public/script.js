// ============================================================
// MangaFinder Pro — Frontend Logic
// All persistence goes through store.mjs (browser-local, one versioned key).
// ============================================================

import { store } from './store.mjs';

const $ = id => document.getElementById(id);
const inp = $('inp');
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
const suggestEl = $('suggestions');
const imageBtn = $('imageBtn');
const imageFile = $('imageFile');
const imageNotice = $('imageNotice');

const SUGGESTIONS = ['Solo Leveling', 'One Piece', 'Omniscient Reader', 'Frieren'];
const SLOW_SEARCH_SECONDS = 20;
const SUGGEST_MIN_LENGTH = 2;
const SUGGEST_DELAY_MS = 200;
const IMAGE_MAX_SIDE = 1280; // Downscaled in the browser before upload; plenty for recognition

// Series shown in the current results, used when bookmarking it
let currentSeries = null;
let loadingTimer = null;
let loadingStage = ''; // Status text, advanced by stream events
// Arguments of the last renderResults call, so filters can re-render without searching again
let lastRender = null;
let searchController = null;

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
  // Find stays enabled: a new search cancels this one, and a disabled submit button would block Enter
  document.body.classList.add('searched');
  window.scrollTo({ top: 0 });
  resultsEl.innerHTML = Array.from({ length: 3 }, () =>
    `<div class="skeleton"><div class="bar wide"></div><div class="bar mid"></div><div class="bar short"></div></div>`
  ).join('');

  loadingStage = 'Matching the title on MangaDex…';
  clearInterval(loadingTimer);
  const started = Date.now();
  const tick = () => {
    const seconds = Math.floor((Date.now() - started) / 1000);
    const step = seconds >= SLOW_SEARCH_SECONDS ? 'Still verifying pages, almost there…' : loadingStage;
    statusEl.innerHTML = `<div class="spinner"></div><span>${esc(step)}</span><span class="elapsed">${seconds}s</span>`;
  };
  tick();
  loadingTimer = setInterval(tick, 1000);
}

function stopLoading() {
  clearInterval(loadingTimer);
  statusEl.innerHTML = '';
}

// Cancels a search that is still streaming. Its own error handler returns early on abort,
// so the loading state (status timer) has to be cleared here.
function cancelSearch() {
  if (!searchController) return;
  searchController.abort();
  searchController = null;
  stopLoading();
}

/**
 * @param {boolean} [forceRefresh] Skip both caches
 * @param {{fromImage?: boolean}} [options] fromImage: keep the "identified from your image" notice
 */
async function doSearch(forceRefresh = false, { fromImage = false } = {}) {
  closeSuggestions();
  if (!fromImage) imageNotice.innerHTML = '';
  const q = inp.value.trim();
  if (!q) return;
  cancelSearch();

  if (!forceRefresh) {
    const cached = store.getCachedSearch(q);
    if (cached) {
      renderResults(cached, q, true);
      store.addHistory(q);
      renderHistory();
      return;
    }
  }

  const controller = searchController = new AbortController();

  startLoading();
  try {
    const resp = await fetch('/api/search/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: q, forceRefresh }),
      signal: controller.signal
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `Search failed (HTTP ${resp.status})`);

    // Show the series and direct site lookups as soon as they arrive; Gemini's ranked result comes last
    const partial = { results: [] };
    for await (const event of readEvents(resp)) {
      if (event.type === 'metadata') {
        loadingStage = 'Searching official publishers and checking links…';
        Object.assign(partial, event.data);
        renderResults(partial, q, false, true);
      } else if (event.type === 'site') {
        partial.results = [...partial.results, event.data];
        renderResults(partial, q, false, true);
      } else if (event.type === 'error') {
        throw new Error(event.data.message);
      } else if (event.type === 'done') {
        // Partial results (official sources unavailable) aren't worth keeping for a day
        if (!event.data.warning) store.cacheSearch(q, event.data);
        stopLoading();
        renderResults(event.data, q, event.data.fromCache);
        store.addHistory(q);
        renderHistory();
        return;
      }
    }
    throw new Error('The search ended early. Please try again.');
  } catch (err) {
    if (controller.signal.aborted) return; // superseded by a newer search
    console.error(err);
    stopLoading();
    resultsEl.innerHTML = `<div class="empty"><i class="ti ti-alert-circle" aria-hidden="true"></i>${esc(err.message || 'Something went wrong. Check the console for details.')}</div>`;
  } finally {
    if (searchController === controller) searchController = null; // finished, nothing left to cancel
  }
}

/**
 * Parses a newline-delimited JSON response body into events as chunks arrive.
 * @param {Response} resp
 */
async function* readEvents(resp) {
  const reader = resp.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += value;
    const lines = buffer.split('\n');
    buffer = lines.pop();
    for (const line of lines) if (line.trim()) yield JSON.parse(line);
  }
  if (buffer.trim()) yield JSON.parse(buffer);
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

/**
 * @param {Object} data /api/search result, or the partial one built while streaming
 * @param {string} query
 * @param {boolean} cached Show the "saved results" notice
 * @param {boolean} [pending] Still streaming: official sources aren't in yet, so show a placeholder for them
 */
function renderResults(data, query, cached, pending = false) {
  lastRender = [data, query, cached, pending];
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
  if (data.warning) {
    html += `<div class="notice notice-warn"><span><i class="ti ti-alert-triangle" aria-hidden="true"></i> ${esc(data.warning)}</span></div>`;
  }

  currentSeries = null;
  if (data.metadata) html += seriesCard(data);

  const results = data.results || [];
  if (!results.length && !pending) {
    html += `<div class="empty"><i class="ti ti-ghost" aria-hidden="true"></i>
      No verified reading sites for <strong>${esc(data.searchTitle || query)}</strong>.<br>
      <span class="muted">Try the Japanese/Korean name, or another title above.</span></div>`;
    resultsEl.innerHTML = html;
    return;
  }

  const fallbackTitle = data.searchTitle || query;
  const officialOnly = store.getOfficialOnly();
  const official = results.filter(r => r.official === true);
  const other = results.filter(r => r.official !== true);
  const shown = officialOnly ? official : results;
  // No "Top pick" until the final ranking is in
  const top = !pending && shown[0] && !(shown[0].notes && shown[0].notes.includes('Unverified')) ? shown[0] : null;

  html += `<div class="results-bar">
    <span class="muted">${pending ? `${shown.length} found so far` : `${shown.length} of ${results.length} sources`}</span>
    <label class="switch"><input type="checkbox" id="officialOnly" ${officialOnly ? 'checked' : ''}><span class="switch-track" aria-hidden="true"></span> Official only</label>
  </div>`;

  if (pending) {
    html += `<section class="group">
      <div class="group-head"><h2>Official</h2><span class="muted">Searching publishers and checking links…</span></div>
      <div class="result-list"><div class="skeleton"><div class="bar wide"></div><div class="bar mid"></div><div class="bar short"></div></div></div>
    </section>`;
  } else if (official.length) {
    html += resultGroup('Official', 'Licensed publishers and platforms', official, top, fallbackTitle);
  }
  if (officialOnly) {
    if (!official.length && !pending) {
      html += `<div class="empty"><i class="ti ti-shield-off" aria-hidden="true"></i>No official sources found for this title.<br>
        <span class="muted">Turn off “Official only” to see ${other.length} other source${other.length === 1 ? '' : 's'}.</span></div>`;
    }
  } else if (other.length) {
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
// AUTOCOMPLETE
// ============================================================

let suggestions = [];
let activeSuggestion = -1;
let suggestTimer = null;
let suggestController = null;

function closeSuggestions() {
  clearTimeout(suggestTimer);
  if (suggestController) suggestController.abort();
  suggestions = [];
  activeSuggestion = -1;
  suggestEl.hidden = true;
  suggestEl.innerHTML = '';
  inp.setAttribute('aria-expanded', 'false');
  inp.removeAttribute('aria-activedescendant');
}

function renderSuggestions() {
  if (!suggestions.length) {
    closeSuggestions();
    return;
  }
  suggestEl.innerHTML = suggestions.map((s, i) => {
    const meta = [s.year, s.status && s.status[0].toUpperCase() + s.status.slice(1)].filter(Boolean).join(' · ');
    return `<li class="suggestion" role="option" id="suggestion-${i}" data-index="${i}" aria-selected="${i === activeSuggestion}">
      ${s.coverUrl ? `<img src="${esc(safeUrl(s.coverUrl))}" alt="" loading="lazy">` : '<span class="thumb"></span>'}
      <span><span class="suggestion-title">${esc(s.title)}</span><br><span class="suggestion-meta">${esc(meta)}</span></span>
    </li>`;
  }).join('');
  suggestEl.hidden = false;
  inp.setAttribute('aria-expanded', 'true');
  if (activeSuggestion >= 0) {
    inp.setAttribute('aria-activedescendant', `suggestion-${activeSuggestion}`);
    $(`suggestion-${activeSuggestion}`).scrollIntoView({ block: 'nearest' });
  } else {
    inp.removeAttribute('aria-activedescendant');
  }
}

async function loadSuggestions(q) {
  if (suggestController) suggestController.abort();
  const controller = suggestController = new AbortController();
  try {
    const resp = await fetch(`/api/suggest?q=${encodeURIComponent(q)}`, { signal: controller.signal });
    if (!resp.ok) return;
    const data = await resp.json();
    // Ignore answers for text the user has since changed, or after they left the box
    if (inp.value.trim() !== q || document.activeElement !== inp) return;
    suggestions = data;
    activeSuggestion = -1;
    renderSuggestions();
  } catch {
    // Aborted or offline: just no suggestions
  }
}

function chooseSuggestion(index) {
  const s = suggestions[index];
  if (!s) return;
  inp.value = s.title;
  doSearch();
}

inp.addEventListener('input', () => {
  clearTimeout(suggestTimer);
  const q = inp.value.trim();
  if (q.length < SUGGEST_MIN_LENGTH) {
    closeSuggestions();
    return;
  }
  suggestTimer = setTimeout(() => loadSuggestions(q), SUGGEST_DELAY_MS);
});

inp.addEventListener('keydown', e => {
  if (suggestEl.hidden) return;
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    e.preventDefault();
    const n = suggestions.length;
    activeSuggestion = e.key === 'ArrowDown' ? (activeSuggestion + 1) % n : (activeSuggestion - 1 + n) % n;
    renderSuggestions();
  } else if (e.key === 'Enter' && activeSuggestion >= 0) {
    e.preventDefault();
    chooseSuggestion(activeSuggestion);
  } else if (e.key === 'Escape') {
    closeSuggestions();
  }
});

// mousedown rather than click, so the input doesn't blur (and close the list) before the choice registers
suggestEl.addEventListener('mousedown', e => {
  const item = e.target.closest('.suggestion');
  if (!item) return;
  e.preventDefault();
  chooseSuggestion(Number(item.dataset.index));
});
inp.addEventListener('blur', closeSuggestions);

// ============================================================
// IMAGE SEARCH
// ============================================================

// Re-encodes as a downscaled JPEG: smaller upload, and strips metadata such as photo location
async function imageToDataUrl(file) {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, IMAGE_MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.85);
}

function showImageNotice(dataUrl, html) {
  imageNotice.innerHTML = `<div class="notice image-notice"><img src="${esc(dataUrl)}" alt="Your image"><span>${html}</span></div>`;
}

async function searchByImage(file) {
  if (!file || !/^image\/(jpeg|png|webp)$/.test(file.type)) {
    toast('Choose a JPEG, PNG or WebP image.');
    return;
  }
  closeSuggestions();
  switchView('search');
  if (searchController) searchController.abort();

  let dataUrl;
  try {
    dataUrl = await imageToDataUrl(file);
  } catch {
    toast("Couldn't read that image.");
    return;
  }

  showImageNotice(dataUrl, `<span class="spinner"></span>Identifying your image…
    <span class="muted">Sent to Google Gemini (and SauceNAO, if set up) to identify it. Not stored.</span>`);
  imageBtn.disabled = true;

  try {
    const resp = await fetch('/api/image-search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: dataUrl })
    });
    const data = await resp.json().catch(() => ({}));
    if (!resp.ok) throw new Error(data.error || `Image search failed (HTTP ${resp.status})`);

    const m = data.match;
    if (!m) {
      const guess = data.guess ? ` Gemini guessed “${esc(data.guess)}”, but no series by that name exists.` : '';
      showImageNotice(dataUrl, `Couldn't identify this image.
        <span class="muted">${guess} Try a clearer page, a cover, or type the title instead.</span>`);
      return;
    }

    const via = m.source === 'saucenao' ? 'SauceNAO' : 'Gemini';
    const details = [m.chapter ? `chapter ${m.chapter}` : '', `via ${via}`, m.confidence].filter(Boolean).join(' · ');
    showImageNotice(dataUrl, `Looks like <strong>${esc(m.title)}</strong> <span class="muted">${esc(details)}${m.reason ? ` — ${esc(m.reason)}` : ''}</span>`);
    inp.value = m.title;
    doSearch(false, { fromImage: true });
  } catch (err) {
    showImageNotice(dataUrl, `${esc(err.message)}`);
  } finally {
    imageBtn.disabled = false;
  }
}

imageBtn.addEventListener('click', () => imageFile.click());
imageFile.addEventListener('change', () => {
  const file = imageFile.files[0];
  imageFile.value = ''; // allow choosing the same image again
  if (file) searchByImage(file);
});

// Paste an image anywhere (including into the search box)
document.addEventListener('paste', e => {
  const file = [...((e.clipboardData && e.clipboardData.files) || [])].find(f => f.type.startsWith('image/'));
  if (!file) return;
  e.preventDefault();
  searchByImage(file);
});

// Drop an image anywhere on the page
const hero = document.querySelector('.hero');
document.addEventListener('dragover', e => {
  if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
  e.preventDefault();
  hero.classList.add('dragging');
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget) hero.classList.remove('dragging'); // left the window
});
document.addEventListener('drop', e => {
  hero.classList.remove('dragging');
  const file = [...((e.dataTransfer && e.dataTransfer.files) || [])][0];
  if (!file) return;
  e.preventDefault();
  searchByImage(file);
});

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

function exportWatchlist() {
  const backup = store.exportBookmarks();
  if (!backup.bookmarks.length) {
    toast('Your watchlist is empty, nothing to export.');
    return;
  }
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `mangafinder-watchlist-${backup.exportedAt.slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(link.href);
  toast(`Exported ${backup.bookmarks.length} series`);
}

async function importWatchlist(file) {
  try {
    const { added, skipped } = store.importBookmarks(JSON.parse(await file.text()));
    updateBookmarkBadge();
    renderBookmarks();
    toast(`Imported ${added} series${skipped ? `, skipped ${skipped} already saved or invalid` : ''}`);
  } catch (err) {
    toast(err instanceof SyntaxError ? 'That file is not valid JSON.' : err.message);
  }
}

const anilistDialog = $('anilistDialog');
let anilistController = null;

function openAniListImport() {
  $('anilistStatus').innerHTML = '';
  $('anilistClose').textContent = 'Cancel';
  anilistDialog.showModal();
  $('anilistUser').focus();
}

function closeAniListImport() {
  if (anilistController) anilistController.abort();
  anilistController = null;
  anilistDialog.close();
}

async function importFromAniList() {
  const statusBox = $('anilistStatus');
  const submit = $('anilistSubmit');
  const controller = anilistController = new AbortController();
  submit.disabled = true;
  statusBox.textContent = 'Reading your AniList list…';

  try {
    const resp = await fetch('/api/import/anilist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: $('anilistUser').value.trim(), includeCompleted: $('anilistCompleted').checked }),
      signal: controller.signal
    });
    if (!resp.ok) throw new Error((await resp.json().catch(() => ({}))).error || `Import failed (HTTP ${resp.status})`);

    for await (const event of readEvents(resp)) {
      if (event.type === 'progress') {
        statusBox.textContent = `Matching ${event.data.done} of ${event.data.total} on MangaDex…`;
      } else if (event.type === 'error') {
        throw new Error(event.data.message);
      } else if (event.type === 'done') {
        const { bookmarks, notFound, truncated } = event.data;
        const { added, skipped } = store.importBookmarks(bookmarks);
        updateBookmarkBadge();
        renderBookmarks();
        let html = `Added ${added} series${skipped ? `, ${skipped} already in your watchlist` : ''}.`;
        if (truncated) html += ' Only the first 300 series were imported.';
        if (notFound.length) {
          html += `<details><summary>${notFound.length} not found on MangaDex</summary>
            <ul>${notFound.map(t => `<li>${esc(t)}</li>`).join('')}</ul></details>`;
        }
        statusBox.innerHTML = html;
        $('anilistClose').textContent = 'Close';
        return;
      }
    }
    throw new Error('The import ended early. Please try again.');
  } catch (err) {
    if (controller.signal.aborted) return;
    statusBox.textContent = err.message;
  } finally {
    submit.disabled = false;
    if (anilistController === controller) anilistController = null;
  }
}

$('anilistForm').addEventListener('submit', e => {
  e.preventDefault();
  importFromAniList();
});
// Esc closes the dialog; stop an import that is still running
anilistDialog.addEventListener('cancel', () => {
  if (anilistController) anilistController.abort();
});

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
  else if (action === 'export-watchlist') exportWatchlist();
  else if (action === 'import-watchlist') $('importFile').click();
  else if (action === 'open-anilist') openAniListImport();
  else if (action === 'close-anilist') closeAniListImport();
});

resultsEl.addEventListener('change', e => {
  if (e.target.id !== 'officialOnly' || !lastRender) return;
  store.setOfficialOnly(e.target.checked);
  const y = window.scrollY;
  renderResults(...lastRender);
  window.scrollTo({ top: y });
  $('officialOnly').focus();
});

$('importFile').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = ''; // allow re-importing the same file
  if (file) importWatchlist(file);
});

// ============================================================
// INIT
// ============================================================

applyTheme(store.getTheme());
renderHistory();
updateBookmarkBadge();
renderIntro();
