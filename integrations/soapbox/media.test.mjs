// media.test.mjs — OFFLINE tests for the PURE pieces of media.mjs: normalization + the ranker.
// No network: every input is injected. Run: node --test integrations/soapbox/media.test.mjs
import { test } from 'node:test';
import assert from 'node:assert';
import {
  normStation, normApplePodcast, normPiPodcast,
  freshnessScore, popularityScore, recommend,
} from './media.mjs';

const NOW = Date.parse('2026-06-03T00:00:00Z');

test('normStation keys on stationuuid and splits tags; drops uuid-less rows', () => {
  const raw = {
    stationuuid: 'abc-123', id: 999, name: '  Radio Paradise  ', url: 'http://x/s',
    url_resolved: 'http://x/resolved', tags: 'rock, eclectic ,', countrycode: 'US',
    bitrate: '128', votes: '50', clickcount: '4000', lastcheckok: 1,
    lastchangetime_iso8601: '2026-05-01T00:00:00Z',
  };
  const s = normStation(raw);
  assert.equal(s.uuid, 'abc-123');
  assert.ok(!('id' in s), 'legacy numeric id is not surfaced');
  assert.equal(s.name, 'Radio Paradise', 'trimmed');
  assert.equal(s.url, 'http://x/resolved', 'prefers url_resolved');
  assert.deepEqual(s.tags, ['rock', 'eclectic'], 'split + trimmed + empties dropped');
  assert.equal(s.bitrate, 128);
  assert.equal(s.clickCount, 4000);
  assert.equal(s.lastCheckOk, true);
  assert.equal(normStation({ name: 'no uuid' }), null);
  assert.equal(normStation(null), null);
});

test('normApplePodcast maps fields and falls back across artwork/name keys', () => {
  const p = normApplePodcast({
    collectionId: 42, collectionName: 'The Pod', artistName: 'Host',
    feedUrl: 'http://feed', artworkUrl600: 'http://img600', primaryGenreName: 'History',
    trackCount: 120, releaseDate: '2026-06-01T00:00:00Z',
  });
  assert.equal(p.id, '42');
  assert.equal(p.title, 'The Pod');
  assert.equal(p.author, 'Host');
  assert.equal(p.image, 'http://img600');
  assert.deepEqual(p.genres, ['History']);
  assert.equal(p.episodeCount, 120);
  assert.equal(p.source, 'apple');
  assert.equal(normApplePodcast(null), null);
});

test('normPiPodcast converts unix newestItemPubdate to ISO and categories to array', () => {
  const p = normPiPodcast({
    id: 7, title: 'PI Show', author: 'A', url: 'http://feed',
    categories: { 1: 'News', 2: 'Tech' }, episodeCount: 9, newestItemPubdate: 1748908800,
  });
  assert.equal(p.id, '7');
  assert.deepEqual(p.genres, ['News', 'Tech']);
  assert.equal(p.source, 'podcastindex');
  assert.match(p.releaseDate, /^2025-/, 'pubdate became an ISO string');
  assert.equal(normPiPodcast(null), null);
});

test('freshnessScore: today ~1, one half-life ~0.5, unparseable → 0', () => {
  assert.ok(Math.abs(freshnessScore({ lastChangeIso: '2026-06-03T00:00:00Z' }, NOW) - 1) < 1e-6);
  const halfLifeAgo = new Date(NOW - 90 * 86400000).toISOString();
  assert.ok(Math.abs(freshnessScore({ lastChangeIso: halfLifeAgo }, NOW) - 0.5) < 1e-3);
  assert.equal(freshnessScore({ releaseDate: 'not-a-date' }, NOW), 0);
  assert.equal(freshnessScore({}, NOW), 0);
});

test('popularityScore: more clicks/votes ranks higher and saturates at 1', () => {
  const small = popularityScore({ uuid: 'a', clickCount: 10, votes: 2 });
  const big = popularityScore({ uuid: 'b', clickCount: 100000, votes: 5000 });
  assert.ok(big > small);
  assert.ok(big <= 1 && small >= 0);
  // positive trend gives a small boost over an identical no-trend station
  const noTrend = popularityScore({ uuid: 'c', clickCount: 1000, votes: 100, clickTrend: 0 });
  const upTrend = popularityScore({ uuid: 'd', clickCount: 1000, votes: 100, clickTrend: 5 });
  assert.ok(upTrend > noTrend);
});

test('recommend ranks by freshness+popularity blend, is pure, and respects limit', () => {
  const stale = new Date(NOW - 400 * 86400000).toISOString();
  const items = [
    { uuid: 'old-popular', clickCount: 5000, votes: 200, lastChangeIso: stale },
    { uuid: 'fresh-quiet', clickCount: 50, votes: 5, lastChangeIso: new Date(NOW).toISOString() },
    { uuid: 'fresh-popular', clickCount: 5000, votes: 200, lastChangeIso: new Date(NOW).toISOString() },
  ];
  const before = JSON.stringify(items);
  const ranked = recommend(items, { now: NOW });
  assert.equal(JSON.stringify(items), before, 'input not mutated');
  assert.equal(ranked[0].uuid, 'fresh-popular', 'fresh AND popular wins');
  assert.ok(ranked.every((r) => typeof r._score === 'number'));
  assert.equal(recommend(items, { now: NOW, limit: 2 }).length, 2, 'limit honored');
  assert.deepEqual(recommend(null), [], 'non-array input → []');
});

test('recommend weighting: heavy freshness weight floats the fresh-quiet station up', () => {
  const stale = new Date(NOW - 400 * 86400000).toISOString();
  const items = [
    { uuid: 'old-popular', clickCount: 5000, votes: 200, lastChangeIso: stale },
    { uuid: 'fresh-quiet', clickCount: 50, votes: 5, lastChangeIso: new Date(NOW).toISOString() },
  ];
  const popWeighted = recommend(items, { now: NOW, wFresh: 0.1, wPop: 0.9 });
  const freshWeighted = recommend(items, { now: NOW, wFresh: 0.95, wPop: 0.05 });
  assert.equal(popWeighted[0].uuid, 'old-popular');
  assert.equal(freshWeighted[0].uuid, 'fresh-quiet');
});
