// cross-post-formatter.test.mjs — offline, node:test. Happy + edge/soft-fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  PLATFORM_LIMITS,
  truncate,
  renderTags,
  formatFor,
  formatAll,
} from './cross-post-formatter.mjs';

const POST = {
  title: 'Introducing Hathor on MELEK',
  body: 'A founding witness joins the chain and produces blocks. '.repeat(120),
  tags: ['melek', 'witness', 'hathor', 'crypto', 'blockchain', 'dpos'],
  url: 'https://melek.salon/@hathor/introducing-hathor-on-melek',
};

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(42), '42');
});

test('PLATFORM_LIMITS are the spec values', () => {
  assert.equal(PLATFORM_LIMITS.twitter, 280);
  assert.equal(PLATFORM_LIMITS.telegram, 4096);
  assert.equal(PLATFORM_LIMITS.discord, 2000);
  assert.equal(PLATFORM_LIMITS.hive, 0);
});

test('truncate: fits unchanged -> truncated:false', () => {
  const r = truncate('short text', 280);
  assert.equal(r.text, 'short text');
  assert.equal(r.truncated, false);
});

test('truncate: word-boundary-safe and within limit', () => {
  const r = truncate('alpha beta gamma delta', 12);
  assert.equal(r.truncated, true);
  assert.ok(r.text.length <= 12, `len ${r.text.length}`);
  // does not cut a word in half (everything before the suffix is whole words)
  const body = r.text.replace(/…$/, '').trim();
  assert.ok('alpha beta gamma delta'.startsWith(body), `"${body}"`);
});

test('truncate: boundary exactly at limit is NOT truncated', () => {
  const text = 'x'.repeat(50);
  assert.equal(truncate(text, 50).truncated, false);
  assert.equal(truncate(text, 49).truncated, true);
});

test('truncate: limit<=0 means no limit', () => {
  const r = truncate('anything at all here', 0);
  assert.equal(r.truncated, false);
  assert.equal(r.text, 'anything at all here');
});

test('truncate: non-string / nullish coerce, never throws', () => {
  assert.equal(truncate(undefined, 10).text, '');
  assert.equal(truncate(12345, 3).text.length <= 3, true);
});

test('renderTags: chat platforms use #hashtags', () => {
  assert.equal(renderTags(['a', 'b'], 'telegram'), '#a #b');
  assert.equal(renderTags(['a', 'b'], 'discord'), '#a #b');
});

test('renderTags: hive uses plain bare tags', () => {
  assert.equal(renderTags(['a', 'b'], 'hive'), 'a b');
});

test('renderTags: twitter caps the count at 3', () => {
  const out = renderTags(['a', 'b', 'c', 'd', 'e'], 'twitter');
  assert.equal(out, '#a #b #c');
});

test('renderTags: normalises (#, case, dupes, junk, string input)', () => {
  assert.equal(renderTags('#Melek, melek WITNESS', 'hive'), 'melek witness');
  assert.equal(renderTags(['#a!', 'a'], 'telegram'), '#a'); // dupe dropped
  assert.equal(renderTags(undefined, 'hive'), '');
});

test('formatAll returns one shaped variant per platform', () => {
  const all = formatAll(POST);
  for (const k of ['twitter', 'telegram', 'discord', 'hive']) {
    assert.ok(all[k], `missing ${k}`);
    assert.equal(typeof all[k].text, 'string');
    assert.equal(typeof all[k].truncated, 'boolean');
    assert.equal(all[k].length, all[k].text.length);
  }
});

test('each platform respects its length limit', () => {
  const all = formatAll(POST);
  assert.ok(all.twitter.length <= PLATFORM_LIMITS.twitter, `tw ${all.twitter.length}`);
  assert.ok(all.telegram.length <= PLATFORM_LIMITS.telegram, `tg ${all.telegram.length}`);
  assert.ok(all.discord.length <= PLATFORM_LIMITS.discord, `dc ${all.discord.length}`);
  // hive: no limit, full body present
  assert.ok(all.hive.length > PLATFORM_LIMITS.discord);
});

test('twitter: url ALWAYS preserved and within 280 (short title)', () => {
  const v = formatFor('twitter', POST);
  assert.equal(v.length <= 280, true);
  assert.ok(v.text.includes(POST.url), 'url must survive');
});

test('twitter: title truncates (truncated:true) but url survives', () => {
  const v = formatFor('twitter', { ...POST, title: 'word '.repeat(80) });
  assert.equal(v.length <= 280, true);
  assert.equal(v.truncated, true);
  assert.ok(v.text.includes(POST.url), 'url must survive truncation');
});

test('twitter: url preserved even with an absurdly long title', () => {
  const v = formatFor('twitter', { title: 'word '.repeat(200), url: POST.url, tags: ['x'] });
  assert.ok(v.length <= 280);
  assert.ok(v.text.includes(POST.url));
});

test('hive: full markdown body + tag footer, not truncated', () => {
  const v = formatFor('hive', POST);
  assert.equal(v.truncated, false);
  assert.ok(v.text.startsWith('# ' + POST.title));
  assert.ok(v.text.includes('Tags: melek witness hathor crypto blockchain dpos'));
  assert.ok(v.text.includes(POST.url));
});

test('telegram/discord: title emphasised + url present', () => {
  const tg = formatFor('telegram', POST);
  const dc = formatFor('discord', POST);
  assert.ok(tg.text.startsWith('*' + POST.title + '*'));
  assert.ok(tg.text.includes(POST.url));
  assert.ok(dc.text.includes(POST.url));
  assert.equal(dc.truncated, true); // big body forces an excerpt on 2000-cap
  assert.ok(dc.length <= 2000);
});

test('soft-fail: empty post yields empty-ish variants, no throw', () => {
  const all = formatAll({});
  assert.equal(all.twitter.text, '');
  assert.equal(all.twitter.truncated, false);
  assert.equal(all.hive.text, '');
  assert.equal(all.telegram.length, 0);
});

test('soft-fail: undefined / non-object post, unknown platform', () => {
  assert.equal(formatFor('twitter', undefined).text, '');
  assert.equal(formatFor('twitter', 'not-an-object').text, '');
  assert.equal(formatFor('myspace', POST).text, '');
  assert.equal(formatAll(null).discord.text, '');
});

test('soft-fail: non-string fields coerce', () => {
  const v = formatFor('hive', { title: 123, body: true, tags: 'a b', url: 7 });
  assert.equal(typeof v.text, 'string');
  assert.ok(v.text.includes('# 123'));
});
