const test = require('node:test');
const assert = require('node:assert');
const { seriesUrlProblem, mentionsTitle } = require('../backend/services/validationService');
const { titleScore } = require('../backend/services/mangadexService');

test('seriesUrlProblem rejects homepages and search pages only', () => {
  for (const url of ['https://asurascans.com/', 'https://www.webnovel.com', 'https://site.com/en/', 'https://site.com/index.html']) {
    assert.match(seriesUrlProblem(url), /Homepage/, url);
  }
  for (const url of [
    'https://www.tappytoon.com/en/search/all?q=solo%20leveling',
    'https://site.com/?s=one+piece',
    'https://www.webcomicsapp.com/en/keyword/solo-leveling'
  ]) {
    assert.match(seriesUrlProblem(url), /Search page/, url);
  }
  for (const url of [
    'https://tapas.io/series/solo-leveling/info',
    'https://www.webtoons.com/en/action/solo-leveling/list?title_no=1234',
    'https://mangaplus.shueisha.co.jp/titles/100020'
  ]) {
    assert.strictEqual(seriesUrlProblem(url), null, url);
  }
});

test('mentionsTitle matches whole phrases, ignoring case and punctuation', () => {
  assert.ok(mentionsTitle('Read SOLO LEVELING — Chapter 200', ['solo leveling']));
  assert.ok(mentionsTitle("Omniscient Reader's Viewpoint | Tapas", ["Omniscient Reader's Viewpoint"]));
  assert.ok(!mentionsTitle('Midnight Rain | WEBTOON', ['solo leveling', 'Na Honjaman Level-Up']));
  assert.ok(!mentionsTitle('one pieces of cake', ['one piece']));
});

test('titleScore prefers exact, then prefix, then word overlap', () => {
  assert.strictEqual(titleScore('one piece', 'One Piece'), 1);
  assert.strictEqual(titleScore('omniscient reader', "Omniscient Reader's Viewpoint"), 0.9);
  assert.ok(titleScore('solo leveling', 'Solo Leveling: Ragnarok') < 1);
  assert.ok(titleScore('zzqx not a manga', 'A story about a woman who moved to Tokyo') < 0.3);
});
