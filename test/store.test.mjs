import test from 'node:test';
import assert from 'node:assert';

// Minimal Web Storage stand-in
function fakeStorage(initial = {}) {
  const items = new Map(Object.entries(initial));
  return {
    get length() { return items.size; },
    key: i => [...items.keys()][i] ?? null,
    getItem: k => (items.has(k) ? items.get(k) : null),
    setItem: (k, v) => { items.set(k, String(v)); },
    removeItem: k => { items.delete(k); },
    items
  };
}

const { store, STORAGE_KEY } = await import('../public/store.mjs');

test('migrates legacy mf_* keys once, drops malformed bookmarks, removes old keys', () => {
  globalThis.localStorage = fakeStorage({
    mf_bookmarks: JSON.stringify({
      a: { id: 'a', title: 'One Piece', timestamp: 5 },
      bad: { title: 'no id' }
    }),
    mf_history: JSON.stringify(['one piece', 42]),
    mf_theme: 'dark',
    'mf_cache_v3_one piece': '{}',
    unrelated: 'keep'
  });

  assert.deepStrictEqual(store.listBookmarks().map(b => [b.id, b.addedAt]), [['a', 5]]);
  assert.deepStrictEqual(store.listHistory(), ['one piece']);
  assert.strictEqual(store.getTheme(), 'dark');
  assert.deepStrictEqual([...localStorage.items.keys()].sort(), [STORAGE_KEY, 'unrelated']);
});

test('corrupted storage reads as empty instead of throwing', () => {
  globalThis.localStorage = fakeStorage({ [STORAGE_KEY]: '{not json' });
  assert.deepStrictEqual(store.listBookmarks(), []);
  assert.strictEqual(store.getTheme(), null);
});

test('bookmarks round-trip, update and remove', () => {
  globalThis.localStorage = fakeStorage();
  store.addBookmark({ id: 'x', title: 'Solo Leveling', lastChapter: 200 });
  assert.ok(store.hasBookmark('x'));
  store.updateBookmark('x', { hasNewChapter: true });
  assert.strictEqual(store.getBookmark('x').hasNewChapter, true);
  store.removeBookmark('x');
  assert.strictEqual(store.hasBookmark('x'), false);
  assert.strictEqual(store.getOfficialOnly(), false);
  store.setOfficialOnly(true);
  assert.strictEqual(store.getOfficialOnly(), true);
  assert.throws(() => store.addBookmark({ id: 'y' }), /no title/);
});

test('export/import round-trips and merges without overwriting', () => {
  globalThis.localStorage = fakeStorage();
  store.addBookmark({ id: 'a', title: 'One Piece', lastChapter: 1196 });
  store.addBookmark({ id: 'b', title: 'Berserk' });
  const backup = JSON.parse(JSON.stringify(store.exportBookmarks()));
  assert.strictEqual(backup.app, 'mangafinder');
  assert.strictEqual(backup.bookmarks.length, 2);

  globalThis.localStorage = fakeStorage();
  store.addBookmark({ id: 'a', title: 'One Piece', lastChapter: 1200 }); // newer local copy wins
  const result = store.importBookmarks({ ...backup, bookmarks: [...backup.bookmarks, { title: 'no id' }] });
  assert.deepStrictEqual(result, { added: 1, skipped: 2 });
  assert.strictEqual(store.getBookmark('a').lastChapter, 1200);
  assert.ok(store.hasBookmark('b'));
  assert.throws(() => store.importBookmarks({ hello: 'world' }), /Not a MangaFinder watchlist/);
});

test('search cache keeps only the 30 most recent entries', () => {
  globalThis.localStorage = fakeStorage();
  for (let i = 0; i < 35; i++) store.cacheSearch(`q${i}`, { i });
  assert.strictEqual(store.getCachedSearch('q0'), null);
  assert.deepStrictEqual(store.getCachedSearch('Q34 '), { i: 34 });
});

test('quota errors drop the search cache but keep bookmarks', () => {
  const ls = fakeStorage();
  globalThis.localStorage = ls;
  store.addBookmark({ id: 'keep', title: 'Berserk' });
  const realSet = ls.setItem;
  ls.setItem = (k, v) => {
    if (JSON.parse(v).searchCache && Object.keys(JSON.parse(v).searchCache).length) throw new Error('QuotaExceededError');
    realSet(k, v);
  };
  store.cacheSearch('huge', { big: true });
  assert.ok(store.hasBookmark('keep'));
  assert.strictEqual(store.getCachedSearch('huge'), null);
});
