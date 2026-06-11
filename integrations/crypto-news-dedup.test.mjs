import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTitle,
  dedupe,
  withinHours,
  recencyFilter,
  pipeline,
  groupBySource,
  renderMarkdown,
} from './crypto-news-dedup.mjs';

const NOW = Date.parse('2026-06-11T12:00:00Z');
const hAgo = (h) => new Date(NOW - h * 3600 * 1000).toISOString();

test('normalizeTitle: lowercases, strips punctuation, collapses whitespace', () => {
  assert.equal(normalizeTitle('Bitcoin Surges Past $X!'), 'bitcoin surges past x');
  assert.equal(normalizeTitle('  Hello,   World!!! '), 'hello world');
  // case + punctuation variants collapse to the same key
  assert.equal(normalizeTitle('ETH: To The Moon?'), normalizeTitle('eth to the moon'));
  // soft-fail on non-strings
  assert.equal(normalizeTitle(null), '');
  assert.equal(normalizeTitle(undefined), '');
  assert.equal(normalizeTitle(123), '123');
});

test('dedupe: collapses by normalized title, keeps earliest publishedAt', () => {
  const arts = [
    { title: 'Bitcoin Surges Past $X!', url: 'https://a/1', source: 's', publishedAt: hAgo(2) },
    { title: 'bitcoin surges past x', url: 'https://a/2', source: 's', publishedAt: hAgo(5) },
  ];
  const { kept, removed } = dedupe(arts);
  assert.equal(kept.length, 1);
  assert.equal(removed, 1);
  // earliest (5h ago) wins
  assert.equal(kept[0].url, 'https://a/2');
});

test('dedupe: collapses by same url even with different titles, keeps earliest', () => {
  const arts = [
    { title: 'Title One', url: 'https://x/same', source: 's', publishedAt: hAgo(1) },
    { title: 'Totally Different', url: 'https://x/same', source: 's', publishedAt: hAgo(3) },
  ];
  const { kept, removed } = dedupe(arts);
  assert.equal(kept.length, 1);
  assert.equal(removed, 1);
  assert.equal(kept[0].title, 'Totally Different'); // earlier one
});

test('dedupe: url match is case-insensitive', () => {
  const arts = [
    { title: 'A', url: 'https://X/Path', publishedAt: hAgo(1) },
    { title: 'B', url: 'https://x/path', publishedAt: hAgo(2) },
  ];
  const { kept, removed } = dedupe(arts);
  assert.equal(kept.length, 1);
  assert.equal(removed, 1);
});

test('dedupe: undated never displaces a dated article in the group', () => {
  const arts = [
    { title: 'Same Story', url: '', publishedAt: hAgo(4) },
    { title: 'same story', url: '', publishedAt: 'garbage' },
  ];
  const { kept } = dedupe(arts);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].publishedAt, hAgo(4)); // dated one kept
});

test('dedupe: distinct articles preserved in first-appearance order', () => {
  const arts = [
    { title: 'Alpha', url: 'u1', publishedAt: hAgo(1) },
    { title: 'Beta', url: 'u2', publishedAt: hAgo(2) },
    { title: 'Gamma', url: 'u3', publishedAt: hAgo(3) },
  ];
  const { kept, removed } = dedupe(arts);
  assert.deepEqual(kept.map((a) => a.title), ['Alpha', 'Beta', 'Gamma']);
  assert.equal(removed, 0);
});

test('dedupe: empty / non-array input → {kept:[],removed:0}', () => {
  assert.deepEqual(dedupe([]), { kept: [], removed: 0 });
  assert.deepEqual(dedupe(null), { kept: [], removed: 0 });
  assert.deepEqual(dedupe(undefined), { kept: [], removed: 0 });
  assert.deepEqual(dedupe('nope'), { kept: [], removed: 0 });
});

test('dedupe: skips non-object entries without throwing', () => {
  const arts = [null, 'x', 42, { title: 'Real', url: 'u', publishedAt: hAgo(1) }];
  const { kept } = dedupe(arts);
  assert.equal(kept.length, 1);
  assert.equal(kept[0].title, 'Real');
});

test('withinHours: 48h boundary inclusive / exclusive', () => {
  // exactly 48h ago → inclusive → recent
  assert.equal(withinHours({ publishedAt: hAgo(48) }, { hours: 48, now: NOW }), true);
  // 48h + 1ms ago → just outside
  const justOver = new Date(NOW - (48 * 3600 * 1000 + 1)).toISOString();
  assert.equal(withinHours({ publishedAt: justOver }, { hours: 48, now: NOW }), false);
  // well within
  assert.equal(withinHours({ publishedAt: hAgo(1) }, { hours: 48, now: NOW }), true);
  // future-dated still counts as recent
  assert.equal(withinHours({ publishedAt: hAgo(-2) }, { hours: 48, now: NOW }), true);
});

test('withinHours: bad / missing dates treated as not-recent', () => {
  assert.equal(withinHours({ publishedAt: 'not-a-date' }, { hours: 48, now: NOW }), false);
  assert.equal(withinHours({ publishedAt: '' }, { hours: 48, now: NOW }), false);
  assert.equal(withinHours({}, { hours: 48, now: NOW }), false);
  assert.equal(withinHours(null, { hours: 48, now: NOW }), false);
});

test('withinHours: accepts epoch ms, epoch seconds, and Date', () => {
  assert.equal(withinHours({ publishedAt: NOW - 3600 * 1000 }, { hours: 48, now: NOW }), true);
  assert.equal(withinHours({ publishedAt: (NOW - 3600 * 1000) / 1000 }, { hours: 48, now: NOW }), true);
  assert.equal(withinHours({ publishedAt: new Date(NOW - 3600 * 1000) }, { hours: 48, now: NOW }), true);
});

test('recencyFilter: drops stale + bad-dated, keeps recent', () => {
  const arts = [
    { title: 'recent', publishedAt: hAgo(2) },
    { title: 'stale', publishedAt: hAgo(100) },
    { title: 'bad', publishedAt: 'xyz' },
  ];
  const out = recencyFilter(arts, { hours: 48, now: NOW });
  assert.deepEqual(out.map((a) => a.title), ['recent']);
});

test('recencyFilter: non-array → []', () => {
  assert.deepEqual(recencyFilter(null, { now: NOW }), []);
});

test('pipeline: stats reflect input → afterDedupe → afterRecency', () => {
  const arts = [
    { title: 'Big News!', url: 'u1', source: 'CoinDesk', publishedAt: hAgo(2) },
    { title: 'big news', url: 'u2', source: 'CoinDesk', publishedAt: hAgo(3) }, // title dup
    { title: 'Old', url: 'u3', source: 'Block', publishedAt: hAgo(100) },       // stale
    { title: 'Fresh', url: 'u4', source: 'Decrypt', publishedAt: hAgo(1) },
  ];
  const { articles, stats } = pipeline(arts, { hours: 48, now: NOW });
  assert.equal(stats.input, 4);
  assert.equal(stats.afterDedupe, 3); // one title dup collapsed
  assert.equal(stats.afterRecency, 2); // stale dropped
  // earliest-dated member of the title-dup group survives ('big news' at 3h beats 'Big News!' at 2h)
  assert.deepEqual(articles.map((a) => a.title).sort(), ['Fresh', 'big news']);
});

test('pipeline: empty input → empty articles + zeroed stats', () => {
  const { articles, stats } = pipeline([], { now: NOW });
  assert.deepEqual(articles, []);
  assert.deepEqual(stats, { input: 0, afterDedupe: 0, afterRecency: 0 });
});

test('pipeline: non-array input soft-fails to empty', () => {
  const { articles, stats } = pipeline(undefined, { now: NOW });
  assert.deepEqual(articles, []);
  assert.deepEqual(stats, { input: 0, afterDedupe: 0, afterRecency: 0 });
});

test('groupBySource: groups by source, blank → (unknown)', () => {
  const arts = [
    { title: 'a', source: 'CoinDesk' },
    { title: 'b', source: 'CoinDesk' },
    { title: 'c', source: '' },
    { title: 'd' },
  ];
  const g = groupBySource(arts);
  assert.equal(g['CoinDesk'].length, 2);
  assert.equal(g['(unknown)'].length, 2);
});

test('groupBySource: non-array → {}', () => {
  assert.deepEqual(groupBySource(null), {});
});

test('renderMarkdown: grouped digest with links; empty → placeholder', () => {
  const md = renderMarkdown([
    { title: 'Hello', url: 'https://x/1', source: 'CoinDesk' },
    { title: 'No Link', source: 'CoinDesk' },
  ]);
  assert.match(md, /### CoinDesk/);
  assert.match(md, /\[Hello\]\(https:\/\/x\/1\)/);
  assert.match(md, /- No Link/);
  assert.equal(renderMarkdown([]), '_No articles._');
  assert.equal(renderMarkdown(null), '_No articles._');
});

test('end-to-end: dedupe + recency + render never throws on junk', () => {
  const junk = [null, {}, { title: 42 }, 'x', { url: 'u', publishedAt: {} }];
  assert.doesNotThrow(() => {
    const { articles, stats } = pipeline(junk, { now: NOW });
    renderMarkdown(articles);
    groupBySource(articles);
    assert.ok(typeof stats.input === 'number');
  });
});
