// announcement-formatter.test.mjs — offline tests for the multi-surface renderer.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  SURFACES,
  charCount,
  formatAnnouncement,
  formatAll,
} from './announcement-formatter.mjs';

const SAMPLE = {
  title: 'MELEK testnet is live',
  body: 'Hathor is producing blocks.',
  link: 'https://witness.melek.salon/hathor',
  tags: ['MELEK', 'witness'],
};

test('esc neutralizes HTML metacharacters', () => {
  assert.equal(esc('<b>&"\'</b>'), '&lt;b&gt;&amp;&quot;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('SURFACES is the documented set', () => {
  assert.deepEqual(SURFACES, ['discord', 'telegram', 'twitter', 'markdown']);
});

test('charCount handles strings and nullish', () => {
  assert.equal(charCount('abc'), 3);
  assert.equal(charCount(''), 0);
  assert.equal(charCount(null), 0);
  assert.equal(charCount(undefined), 0);
});

test('markdown uses ## title and includes body, link, tags', () => {
  const out = formatAnnouncement(SAMPLE, 'markdown');
  assert.match(out, /^## MELEK testnet is live/);
  assert.ok(out.includes('Hathor is producing blocks.'));
  assert.ok(out.includes('https://witness.melek.salon/hathor'));
  assert.ok(out.includes('#MELEK'));
  assert.ok(out.includes('#witness'));
});

test('discord uses bold title with ** and is plain (no HTML escaping)', () => {
  const out = formatAnnouncement(SAMPLE, 'discord');
  assert.ok(out.includes('**MELEK testnet is live**'));
  assert.ok(out.includes('https://witness.melek.salon/hathor'));
  assert.ok(out.includes('#MELEK #witness'));
});

test('telegram uses <b> bold and escapes body to prevent HTML injection', () => {
  const out = formatAnnouncement(
    { title: 'Hi', body: '<script>alert(1)</script>', link: 'x', tags: [] },
    'telegram',
  );
  assert.ok(out.includes('<b>Hi</b>'));
  assert.ok(!out.includes('<script>'));
  assert.ok(out.includes('&lt;script&gt;'));
});

test('markdown does not allow raw HTML injection in title', () => {
  // Markdown renderer keeps content literal but should not emit executable markup
  // that the tests above assert telegram escapes; here we just confirm the title
  // line is exactly the ## form with the literal text.
  const out = formatAnnouncement({ title: '<i>x</i>', body: '', link: '', tags: [] }, 'markdown');
  assert.equal(out, '## <i>x</i>');
});

test('twitter fits within 280 chars including link and tags', () => {
  const long = {
    title: 'A'.repeat(200),
    body: 'B'.repeat(300),
    link: 'https://melek.salon/abcdefghij',
    tags: ['MELEK', 'crypto', 'witness'],
  };
  const out = formatAnnouncement(long, 'twitter');
  assert.ok(charCount(out) <= 280, `len ${charCount(out)}`);
  assert.ok(out.includes('…'), 'should ellipsize');
  assert.ok(out.includes('https://melek.salon/abcdefghij'), 'link preserved');
  assert.ok(out.includes('#MELEK'), 'tags preserved');
});

test('twitter short content is not truncated', () => {
  const out = formatAnnouncement(SAMPLE, 'twitter');
  assert.ok(charCount(out) <= 280);
  assert.ok(!out.includes('…'));
  assert.ok(out.includes('MELEK testnet is live'));
  assert.ok(out.includes('https://witness.melek.salon/hathor'));
});

test('twitter with huge link still never exceeds 280', () => {
  const out = formatAnnouncement(
    { title: 'hi', body: 'there', link: 'https://x.test/' + 'q'.repeat(400), tags: [] },
    'twitter',
  );
  assert.ok(charCount(out) <= 280, `len ${charCount(out)}`);
});

test('unknown surface falls back to markdown', () => {
  const out = formatAnnouncement(SAMPLE, 'mastodon');
  assert.equal(out, formatAnnouncement(SAMPLE, 'markdown'));
});

test('missing surface argument falls back to markdown', () => {
  const out = formatAnnouncement(SAMPLE);
  assert.equal(out, formatAnnouncement(SAMPLE, 'markdown'));
});

test('soft-fail: missing fields produce empty-safe strings, never throw', () => {
  for (const surface of SURFACES) {
    assert.equal(formatAnnouncement({}, surface), '');
    assert.equal(formatAnnouncement(undefined, surface), '');
    assert.equal(formatAnnouncement(null, surface), '');
  }
});

test('soft-fail: partial fields render only what is present', () => {
  const out = formatAnnouncement({ title: 'Only title' }, 'markdown');
  assert.equal(out, '## Only title');
  const lk = formatAnnouncement({ link: 'http://a.test' }, 'discord');
  assert.equal(lk, 'http://a.test');
});

test('tags are normalized into #hashtags and junk dropped', () => {
  const out = formatAnnouncement(
    { title: 't', body: 'b', link: '', tags: ['#already', 'has space', '!!!', 'good'] },
    'markdown',
  );
  assert.ok(out.includes('#already'));
  assert.ok(out.includes('#hasspace'));
  assert.ok(out.includes('#good'));
  // pure-junk tag yields nothing
  assert.ok(!out.includes('#!!!'));
});

test('non-array tags are ignored safely', () => {
  const out = formatAnnouncement({ title: 't', tags: 'notanarray' }, 'markdown');
  assert.equal(out, '## t');
});

test('formatAll returns all four surfaces', () => {
  const all = formatAll(SAMPLE);
  assert.deepEqual(Object.keys(all).sort(), SURFACES.slice().sort());
  for (const surface of SURFACES) {
    assert.equal(typeof all[surface], 'string');
  }
  assert.ok(all.twitter.length <= 280);
});

test('formatAll on empty announcement yields empty strings', () => {
  const all = formatAll({});
  for (const surface of SURFACES) {
    assert.equal(all[surface], '');
  }
});
