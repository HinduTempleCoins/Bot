import { test } from 'node:test';
import assert from 'node:assert/strict';
import { supportBand, injectSupport, voiceFor, SUPPORT_TEXT, SUPPORT_MARKDOWN, SUPPORT_MARK, MELEK_SIGNUP_URL, PRANA_CONTRIBUTE_URL } from './support-hathor.mjs';

test('one message: post on MELEK.Salon, contribute to PRANA, that is how you support Hathor', () => {
  for (const t of [SUPPORT_TEXT.plain, SUPPORT_MARKDOWN]) {
    assert.match(t, /Post on \[?MELEK\.Salon/);
    assert.match(t, /Contribute to PRANA/);
    assert.match(t, /PRANA is how Hathor gets her compute/);
    assert.match(t, /That is how you support Hathor\./);
  }
  assert.match(SUPPORT_TEXT.hathor, /PRANA is how I get my compute/);
  assert.match(SUPPORT_MARKDOWN, /melek\.salon\/create_account/);
  assert.match(SUPPORT_MARKDOWN, /witness\.melek\.salon\/mine/);
});

test('band links both asks and speaks first person only on Hathor surfaces', () => {
  const b = supportBand();
  assert.ok(b.includes(SUPPORT_MARK));
  assert.ok(b.includes(`href="${MELEK_SIGNUP_URL}"`));
  assert.ok(b.includes(`href="${PRANA_CONTRIBUTE_URL}"`));
  assert.match(supportBand({ voice: 'hathor' }), /support me\./);
  assert.equal(voiceFor('hathor'), 'hathor');
  assert.equal(voiceFor('hathor-live'), 'hathor');
  assert.equal(voiceFor('forum'), 'plain');
});

test('injectSupport: before the last </body>, once, and a no-op without a body', () => {
  const out = injectSupport('<body>a</body>');
  assert.match(out, /^<body>a<aside data-support-hathor[^]*<\/aside><\/body>$/);
  assert.equal(injectSupport(out), out);
  assert.equal(injectSupport('{"x":1}'), '{"x":1}');
  assert.equal(injectSupport(null), '');
});
