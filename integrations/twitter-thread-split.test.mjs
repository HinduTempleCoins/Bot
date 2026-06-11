// twitter-thread-split.test.mjs — OFFLINE tests for the cross-post thread splitter (#43d92af995).
// No network. Asserts: thread chunks never exceed limit and never break mid-word; counters fit
// the limit after re-check; numbering off => no counters; per-platform caps + t.co URL weighting;
// hashtag/mention dedupe + order; graceful word-boundary truncation; soft-fail on empty/oversized
// single word + junk inputs; toHtmlPreview escapes a malicious chunk.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc, splitThread, formatFor, extractHashtags, extractMentions,
  truncateGraceful, weightedLength, twitterLength, toHtmlPreview,
  PLATFORMS, listPlatforms,
} from './twitter-thread-split.mjs';

test('splitThread: every chunk fits the limit and nothing breaks mid-word', () => {
  const words = Array.from({ length: 80 }, (_, i) => 'word' + i);
  const text = words.join(' ');
  const chunks = splitThread(text, { limit: 60, numbering: true });
  assert.ok(chunks.length > 1, 'should split into multiple parts');
  for (const c of chunks) {
    assert.ok([...c].length <= 60, `chunk over limit: "${c}" (${[...c].length})`);
  }
  // every original word survives intact somewhere (no mid-word break)
  const joined = chunks.join(' ');
  for (const w of words) assert.ok(joined.includes(w), `lost word ${w}`);
});

test('splitThread: numbering appends (i/n) and the counter itself fits the limit', () => {
  const text = Array.from({ length: 40 }, (_, i) => 'alpha' + i).join(' ');
  const chunks = splitThread(text, { limit: 50, numbering: true });
  const n = chunks.length;
  chunks.forEach((c, i) => {
    assert.match(c, new RegExp(`\\(${i + 1}/${n}\\)$`), `bad counter on chunk ${i}: ${c}`);
    assert.ok([...c].length <= 50, `chunk+counter over limit: ${c}`);
  });
});

test('splitThread: numbering:false produces no counters', () => {
  const text = 'one two three four five six seven eight nine ten';
  const chunks = splitThread(text, { limit: 20, numbering: false });
  for (const c of chunks) assert.doesNotMatch(c, /\(\d+\/\d+\)$/);
});

test('splitThread: short text returns a single numbered chunk', () => {
  const chunks = splitThread('hello world', { limit: 280 });
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0], 'hello world (1/1)');
});

test('splitThread: empty / whitespace / null -> [] (soft-fail, no throw)', () => {
  assert.deepEqual(splitThread(''), []);
  assert.deepEqual(splitThread('   '), []);
  assert.deepEqual(splitThread(null), []);
  assert.deepEqual(splitThread(undefined), []);
});

test('splitThread: a single oversized word is hard-split, not thrown', () => {
  const giant = 'x'.repeat(700);
  const chunks = splitThread(giant, { limit: 100, numbering: true });
  assert.ok(chunks.length > 1);
  for (const c of chunks) assert.ok([...c].length <= 100, `hard-split chunk over limit: ${[...c].length}`);
});

test('splitThread: bad limit falls back to 280', () => {
  const chunks = splitThread('hi there friend', { limit: -5 });
  assert.equal(chunks.length, 1);
  assert.ok([...chunks[0]].length <= 280);
});

test('weightedLength / twitterLength: twitter counts every URL as 23 chars', () => {
  const longUrl = 'https://example.com/' + 'a'.repeat(200);
  const text = 'see ' + longUrl + ' now';
  // 'see ' (4) + 23 + ' now' (4) = 31 under twitter weighting
  assert.equal(twitterLength(text), 4 + 23 + 4);
  // non-twitter (null weight) counts the real length
  assert.equal(weightedLength(text, null), [...text].length);
});

test('formatFor: twitter fits under 280 with weighted URL', () => {
  const longUrl = 'https://example.com/' + 'a'.repeat(400);
  const r = formatFor('twitter', 'check ' + longUrl);
  assert.equal(r.cap, 280);
  assert.equal(r.length, 6 + 23); // 'check ' + t.co weight
  assert.equal(r.ok, true);
  assert.equal(r.overflow, false);
  assert.deepEqual(r.chunks.length, 1);
});

test('formatFor: telegram cap is huge, discord 2000, mastodon 500', () => {
  assert.equal(formatFor('telegram', 'x').cap, 4096);
  assert.equal(formatFor('discord', 'x').cap, 2000);
  assert.equal(formatFor('mastodon', 'x').cap, 500);
});

test('formatFor: overflow splits into multiple chunks each under cap', () => {
  const text = Array.from({ length: 200 }, (_, i) => 'tok' + i).join(' ');
  const r = formatFor('mastodon', text);
  assert.equal(r.overflow, true);
  assert.ok(r.chunks.length > 1);
  for (const c of r.chunks) assert.ok([...c].length <= 500);
});

test('formatFor: unknown platform soft-fails', () => {
  const r = formatFor('myspace', 'hello');
  assert.equal(r.cap, null);
  assert.equal(r.ok, false);
  assert.equal(r.note, 'unknown platform');
  assert.deepEqual(r.chunks, ['hello']);
});

test('listPlatforms returns the four supported platforms', () => {
  const p = listPlatforms();
  assert.deepEqual(new Set(p), new Set(['twitter', 'telegram', 'discord', 'mastodon']));
});

test('extractHashtags: deduped, order-preserving, case-insensitive dedupe', () => {
  const tags = extractHashtags('#MELEK rules #melek again #Bitcoin #MELEK');
  assert.deepEqual(tags, ['#MELEK', '#Bitcoin']);
});

test('extractMentions: deduped, order-preserving', () => {
  const m = extractMentions('hey @hathor and @cheetah and @hathor again');
  assert.deepEqual(m, ['@hathor', '@cheetah']);
});

test('extract*: empty / null inputs -> [] (soft-fail)', () => {
  assert.deepEqual(extractHashtags(''), []);
  assert.deepEqual(extractMentions(null), []);
  assert.deepEqual(extractHashtags(undefined), []);
});

test('truncateGraceful: breaks at a word boundary and appends ellipsis within n', () => {
  const t = truncateGraceful('the quick brown fox jumps', 12);
  assert.ok([...t].length <= 12, `over n: ${t}`);
  assert.ok(t.endsWith('…'));
  assert.ok(!t.includes('bro')); // did not break mid-word into "brow"
});

test('truncateGraceful: text already short is returned unchanged', () => {
  assert.equal(truncateGraceful('hi', 10), 'hi');
});

test('truncateGraceful: degenerate n soft-fails', () => {
  assert.equal(truncateGraceful('hello', 0), '');
  assert.equal(truncateGraceful('hello', 1), '…');
  assert.equal(truncateGraceful(null, 5), '');
});

test('toHtmlPreview: escapes a malicious chunk', () => {
  const html = toHtmlPreview(['<script>alert(1)</script>', 'safe & sound']);
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('safe &amp; sound'));
  assert.ok(html.startsWith('<ol'));
});

test('esc: escapes the five HTML metacharacters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});

test('PLATFORMS twitter urlWeight is 23 (t.co)', () => {
  assert.equal(PLATFORMS.twitter.urlWeight, 23);
});
