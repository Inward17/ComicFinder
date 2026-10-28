const test = require('node:test');
const assert = require('node:assert');
const { parseImage } = require('../backend/services/imageSearchService');

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
