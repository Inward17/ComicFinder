const test = require('node:test');
const assert = require('node:assert');
const { isEnglishText, assertPublicUrl } = require('../backend/services/validationService');

test('English text passes the language check', () => {
  assert.ok(isEnglishText('Read One Piece chapter 1100 online in English'));
  assert.ok(isEnglishText('Solo Leveling — Sung Jin-woo (성진우) returns')); // incidental CJK is fine
});

test('CJK-dominant text fails the language check', () => {
  assert.ok(!isEnglishText('ワンピース 第1100話 尾田栄一郎'));
  assert.ok(!isEnglishText('나 혼자만 레벨업 1화 무료 보기'));
});

test('SSRF guard rejects private, loopback and non-http URLs', async () => {
  for (const url of [
    'http://127.0.0.1/',
    'http://localhost:3000/',
    'http://169.254.169.254/latest/meta-data/',
    'http://10.0.0.5/',
    'http://192.168.1.1/',
    'http://[::1]/',
    'http://[::ffff:127.0.0.1]/',
    'http://2130706433/', // decimal 127.0.0.1
    'file:///etc/passwd',
    'javascript:alert(1)',
    'not a url'
  ]) {
    await assert.rejects(assertPublicUrl(url), { code: 'BLOCKED_URL' }, url);
  }
});

test('SSRF guard allows public addresses', async () => {
  await assertPublicUrl('https://93.184.216.34/');
});
