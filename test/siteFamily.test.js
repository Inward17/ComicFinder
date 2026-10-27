const test = require('node:test');
const assert = require('node:assert');
const { slugify, newestChapter, pickSeriesLink, candidateTitles } = require('../backend/services/siteFamilyService');

test('slugify matches aggregator slug style', () => {
  assert.strictEqual(slugify('Solo Leveling'), 'solo-leveling');
  assert.strictEqual(slugify('Solo Leveling: Ragnarök!'), 'solo-leveling-ragnarok');
  assert.strictEqual(slugify("The King's Upset"), 'the-kings-upset');
  assert.strictEqual(slugify('  One Piece (Colored) '), 'one-piece-colored');
});

test('candidateTitles puts the query first, then MangaDex English titles', () => {
  const titles = candidateTitles('solo leveling', {
    title: 'Na Honjaman Level-Up',
    altTitles: [{ ko: '나 혼자만 레벨업' }, { en: 'Solo Leveling' }]
  });
  assert.deepStrictEqual(titles, ['solo leveling', 'Na Honjaman Level-Up', 'Solo Leveling']);
});

test('newestChapter takes the highest chapter of this series only', () => {
  const base = 'https://www.kakamanga.com/manga/solo-leveling';
  const links = [
    `${base}/chapter-0`,
    `${base}/chapter-200`,
    `${base}/chapter-7-1`,
    'https://www.kakamanga.com/manga/solo-leveling-ragnarok/chapter-68',
    'https://www.kakamanga.com/manga/one-piece/chapter-1196'
  ];
  assert.strictEqual(newestChapter(links, base), 200);
  assert.strictEqual(newestChapter([`${base}/chapter-7-1`], base), 7.1);
  assert.strictEqual(newestChapter([], base), null);
});

test('pickSeriesLink ignores sidebar titles and near-miss sequels', () => {
  const origin = 'https://www.kakamanga.com';
  const links = [
    `${origin}/manga/mary-psycho`, // "popular" sidebar shown before results
    `${origin}/manga/solo-leveling-ragnarok`,
    `${origin}/manga/solo-leveling`,
    `${origin}/manga/solo-leveling/chapter-200`,
    `${origin}/genre/action`
  ];
  assert.strictEqual(pickSeriesLink(links, origin, '/manga/{slug}', ['solo-leveling']), `${origin}/manga/solo-leveling`);
  assert.strictEqual(pickSeriesLink(links.filter(l => !l.endsWith('/manga/solo-leveling')), origin, '/manga/{slug}', ['solo-leveling']), null);
  assert.strictEqual(pickSeriesLink(links, origin, '/manga/{slug}', ['berserk']), null);
});
