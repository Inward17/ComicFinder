const test = require('node:test');
const assert = require('node:assert');
const { fetchList } = require('../backend/services/anilistService');

test('AniList import rejects invalid usernames before calling AniList', async () => {
  for (const bad of [undefined, '', 'a', 'has space', 'semi;colon', 'x'.repeat(31)]) {
    await assert.rejects(fetchList(bad), { code: 'IMPORT_USER' }, String(bad));
  }
});
