const test = require('node:test');
const assert = require('node:assert');
const { parseImage, madokamiTitle, chapterFromPart, baseSeriesTitle } = require('../backend/services/imageSearchService');

test('colored editions map back to the series', () => {
  assert.strictEqual(baseSeriesTitle('One Piece - Digital Colored Comics'), 'One Piece');
  assert.strictEqual(baseSeriesTitle('Berserk (Official Colored)'), 'Berserk');
  assert.strictEqual(baseSeriesTitle('Shingeki no Kyojin (Fan Coloured)'), 'Shingeki no Kyojin');
  assert.strictEqual(baseSeriesTitle('Colored'), 'Colored'); // never strips to nothing
  assert.strictEqual(baseSeriesTitle('The Eminence in Shadow'), 'The Eminence in Shadow');
});

test('SauceNAO part strings give the title and a single chapter only', () => {
  // Shapes taken from real SauceNAO responses
  assert.strictEqual(madokamiTitle('One Piece - Digital Colored Comics v01 c001-008 (JPG)'), 'One Piece');
  assert.strictEqual(chapterFromPart(' - Chapter 1'), '1');
  assert.strictEqual(chapterFromPart(' - Chapter 10.5'), '10.5');
  assert.strictEqual(chapterFromPart('Berserk c012 (JPG)'), '12');
  assert.strictEqual(chapterFromPart('One Piece - Digital Colored Comics v01 c001-008 (JPG)'), null);
  assert.strictEqual(madokamiTitle(''), null);
});

const PNG_1PX = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

test('parseImage accepts JPEG/PNG/WebP data URLs', () => {
  const image = parseImage(`data:image/png;base64,${PNG_1PX}`);
  assert.strictEqual(image.mimeType, 'image/png');
  assert.ok(image.buffer.length > 0);
});

test('parseImage rejects other types, malformed input and oversized images', () => {
  for (const bad of [undefined, 'hello', 'data:image/gif;base64,R0lGOD', `data:text/html;base64,${PNG_1PX}`, 'data:image/png;base64,<script>']) {
    assert.throws(() => parseImage(bad), { code: 'BAD_IMAGE' }, String(bad));
  }
  const huge = 'A'.repeat(Math.ceil((4 * 1024 * 1024 + 10) / 3) * 4);
  assert.throws(() => parseImage(`data:image/jpeg;base64,${huge}`), /too large/);
});
