import { test } from 'node:test';
import assert from 'node:assert';
import {
  scoreItem, rank, recommend, kindOf,
  freshnessScore, engagementScore, reliabilityScore,
} from './recommend.mjs';

// OFFLINE only — pure scoring/ranking. A fixed `now` makes everything deterministic.
const NOW = Date.parse('2026-06-03T00:00:00Z');
const DAY = 86_400_000;
const iso = (daysAgo) => new Date(NOW - daysAgo * DAY).toISOString();

// ── kind inference ────────────────────────────────────────────────────────────────────────────────

test('kindOf infers from shape and respects an explicit kind tag', () => {
  assert.equal(kindOf({ channelHandle: 'x' }), 'cam');
  assert.equal(kindOf({ channelId: 'UCx' }), 'cam');
  assert.equal(kindOf({ uuid: 'r1' }), 'radio');
  assert.equal(kindOf({ feedUrl: 'http://x' }), 'podcast');
  assert.equal(kindOf({ episodeCount: 10 }), 'podcast');
  assert.equal(kindOf({ kind: 'cam', uuid: 'r1' }), 'cam', 'explicit kind wins over shape');
  assert.equal(kindOf({}), 'unknown');
  assert.equal(kindOf(null), 'unknown');
});

// ── freshness ───────────────────────────────────────────────────────────────────────────────────

test('freshness: today ~1, one half-life ~0.5, far past →~0, no date →0', () => {
  assert.ok(Math.abs(freshnessScore({ releaseDate: iso(0) }, NOW) - 1) < 1e-9);
  assert.ok(Math.abs(freshnessScore({ releaseDate: iso(90) }, NOW) - 0.5) < 1e-6);
  assert.ok(freshnessScore({ releaseDate: iso(900) }, NOW) < 0.01);
  assert.equal(freshnessScore({}, NOW), 0);
  assert.equal(freshnessScore({ releaseDate: 'not-a-date' }, NOW), 0);
});

test('freshness reads any of the timestamp fields across kinds', () => {
  assert.ok(freshnessScore({ lastChangeIso: iso(0) }, NOW) > 0.99);
  assert.ok(freshnessScore({ startedAt: iso(0) }, NOW) > 0.99);
  assert.ok(freshnessScore({ publishedAt: iso(0) }, NOW) > 0.99);
});

test('fresh item beats a stale one (same engagement/reliability)', () => {
  const fresh = scoreItem({ uuid: 'a', name: 'Fresh', clickCount: 100, votes: 10, lastCheckOk: true, bitrate: 128, lastChangeIso: iso(1) }, undefined, NOW);
  const stale = scoreItem({ uuid: 'b', name: 'Stale', clickCount: 100, votes: 10, lastCheckOk: true, bitrate: 128, lastChangeIso: iso(365) }, undefined, NOW);
  assert.ok(fresh._score > stale._score, 'freshness lifts the recent item');
});

// ── engagement ────────────────────────────────────────────────────────────────────────────────────

test('engagement: more clicks/votes ranks a radio station higher (log-compressed)', () => {
  const big = engagementScore({ uuid: 'a', clickCount: 100000, votes: 5000 });
  const small = engagementScore({ uuid: 'b', clickCount: 10, votes: 1 });
  assert.ok(big > small);
  assert.ok(big <= 1 && small >= 0);
});

test('engagement: more episodes ranks a podcast higher', () => {
  const big = engagementScore({ feedUrl: 'x', episodeCount: 2000 });
  const small = engagementScore({ feedUrl: 'y', episodeCount: 5 });
  assert.ok(big > small);
});

test('engagement: a live cam gets a strong floor over an offline one', () => {
  const live = engagementScore({ channelHandle: 'a', live: true });
  const off = engagementScore({ channelHandle: 'b', live: false });
  assert.ok(live > off);
  assert.ok(live >= 0.6);
});

test('all signal scores stay within [0,1]', () => {
  const wild = { uuid: 'z', clickCount: 1e12, votes: 1e9, bitrate: 100000, lastCheckOk: true, popularity: 999, lastChangeIso: iso(-5) };
  for (const s of [freshnessScore(wild, NOW), engagementScore(wild), reliabilityScore(wild)]) {
    assert.ok(s >= 0 && s <= 1, `score ${s} in range`);
  }
});

// ── reliability ─────────────────────────────────────────────────────────────────────────────────

test('reliability: a working high-bitrate station beats a dead low-bitrate one', () => {
  const good = reliabilityScore({ uuid: 'a', lastCheckOk: true, bitrate: 256, popularity: 90 });
  const bad = reliabilityScore({ uuid: 'b', lastCheckOk: false, bitrate: 32, popularity: 10 });
  assert.ok(good > bad);
});

test('reliability: neutral 0.5 prior when nothing is known', () => {
  assert.equal(reliabilityScore({ kind: 'podcast' }), 0.5);
});

// ── scoreItem ────────────────────────────────────────────────────────────────────────────────────

test('scoreItem returns kind, parts, _score (0..1) and score (0..100), without mutating input', () => {
  const input = { uuid: 'a', name: 'X', clickCount: 100, votes: 10, lastCheckOk: true, bitrate: 128, lastChangeIso: iso(1) };
  const snapshot = JSON.stringify(input);
  const out = scoreItem(input, undefined, NOW);
  assert.equal(out.kind, 'radio');
  assert.ok(out.parts && typeof out.parts.freshness === 'number');
  assert.ok(out._score >= 0 && out._score <= 1);
  assert.ok(out.score >= 0 && out.score <= 100);
  assert.equal(out.score, Math.round(out._score * 100), 'score is _score*100 rounded');
  assert.equal(JSON.stringify(input), snapshot, 'input not mutated');
});

test('scoreItem weight overrides change the blend and are renormalized', () => {
  const item = { uuid: 'a', name: 'X', clickCount: 100000, votes: 5000, lastCheckOk: true, bitrate: 256, lastChangeIso: iso(300) };
  const freshHeavy = scoreItem(item, { freshness: 1, engagement: 0, reliability: 0 }, NOW);
  const engHeavy = scoreItem(item, { engagement: 1, freshness: 0, reliability: 0 }, NOW);
  // item is stale but very engaged → engagement-weighted score should be much higher.
  assert.ok(engHeavy._score > freshHeavy._score);
  // unnormalized weights (sum 4) give the same result as normalized (sum 1) for the same ratios.
  const a = scoreItem(item, { freshness: 1, engagement: 1, reliability: 2 }, NOW);
  const b = scoreItem(item, { freshness: 0.25, engagement: 0.25, reliability: 0.5 }, NOW);
  assert.ok(Math.abs(a._score - b._score) < 1e-12, 'weights are renormalized');
});

test('scoreItem falls back to default weights when given all-zero or bogus weights', () => {
  const item = { uuid: 'a', name: 'X', clickCount: 100, votes: 10, lastCheckOk: true, lastChangeIso: iso(1) };
  const def = scoreItem(item, undefined, NOW);
  const zero = scoreItem(item, { freshness: 0, engagement: 0, reliability: 0 }, NOW);
  assert.ok(Math.abs(def._score - zero._score) < 1e-12, 'zero weights → default blend');
});

// ── rank ──────────────────────────────────────────────────────────────────────────────────────────

test('rank orders by blended score desc, returns new array, does not mutate input', () => {
  const items = [
    { uuid: 'a', name: 'Dead old', clickCount: 1, votes: 0, lastCheckOk: false, bitrate: 32, lastChangeIso: iso(400) },
    { uuid: 'b', name: 'Hot fresh', clickCount: 200000, votes: 9000, lastCheckOk: true, bitrate: 256, lastChangeIso: iso(1) },
    { uuid: 'c', name: 'Middle', clickCount: 500, votes: 50, lastCheckOk: true, bitrate: 128, lastChangeIso: iso(45) },
  ];
  const before = items.map((i) => i.name);
  const ranked = rank(items, { now: NOW });
  assert.deepEqual(ranked.map((r) => r.name), ['Hot fresh', 'Middle', 'Dead old']);
  assert.deepEqual(items.map((i) => i.name), before, 'input untouched');
});

test('rank tiebreaks by engagement then name when scores are equal', () => {
  // craft items that score identically except engagement / name
  const base = { lastCheckOk: true, lastChangeIso: iso(10), bitrate: 128 };
  const items = [
    { ...base, uuid: 'z', name: 'Zeta', clickCount: 10, votes: 1 },
    { ...base, uuid: 'a', name: 'Alpha', clickCount: 10, votes: 1 },
    { ...base, uuid: 'm', name: 'More clicks', clickCount: 100000, votes: 5000 },
  ];
  const ranked = rank(items, { now: NOW });
  assert.equal(ranked[0].name, 'More clicks', 'higher engagement first');
  // Alpha before Zeta among the equal-score pair (name asc).
  const names = ranked.map((r) => r.name);
  assert.ok(names.indexOf('Alpha') < names.indexOf('Zeta'));
});

test('rank honors limit', () => {
  const items = Array.from({ length: 10 }, (_, i) => ({ uuid: String(i), name: `S${i}`, clickCount: i, lastCheckOk: true, lastChangeIso: iso(1) }));
  assert.equal(rank(items, { now: NOW, limit: 3 }).length, 3);
  assert.equal(rank(items, { now: NOW }).length, 10);
});

test('rank handles empty / non-array input safely', () => {
  assert.deepEqual(rank([]), []);
  assert.deepEqual(rank(null), []);
  assert.deepEqual(rank(undefined), []);
});

// ── recommend (cross-kind merge) ───────────────────────────────────────────────────────────────────

test('recommend merges cams/podcasts/radio into one ranked list with kind tags + 0..100 score', () => {
  const byKind = {
    cams: [{ name: 'Live Bear Cam', channelHandle: 'exploreorg', channelId: 'UCx', popularity: 95, live: true, watchTime: 80000, startedAt: iso(0) }],
    podcasts: [{ title: 'Daily Pod', feedUrl: 'http://f', episodeCount: 1500, releaseDate: iso(1) }],
    radio: [{ uuid: 'r1', name: 'Top FM', clickCount: 90000, votes: 3000, bitrate: 256, lastCheckOk: true, lastChangeIso: iso(2) }],
  };
  const out = recommend(byKind, { now: NOW });
  assert.equal(out.length, 3);
  assert.deepEqual(new Set(out.map((o) => o.kind)), new Set(['cam', 'podcast', 'radio']));
  for (const o of out) {
    assert.ok(o.score >= 0 && o.score <= 100, 'normalized 0..100 score');
    assert.ok(typeof o.kind === 'string');
  }
});

test('recommend: a hot fresh item of one kind outranks a stale dead item of another', () => {
  const byKind = {
    cams: [{ name: 'Offline cam', channelHandle: 'dead', live: false, startedAt: iso(500) }],
    radio: [{ uuid: 'r1', name: 'Hot FM', clickCount: 150000, votes: 8000, bitrate: 256, lastCheckOk: true, lastChangeIso: iso(1) }],
  };
  const out = recommend(byKind, { now: NOW });
  assert.equal(out[0].name, 'Hot FM', 'cross-kind: the strong radio station ranks first');
});

test('recommend tolerates missing kinds and empty input', () => {
  assert.deepEqual(recommend({}), []);
  assert.deepEqual(recommend({ podcasts: [] }), []);
  const out = recommend({ radio: [{ uuid: 'r', name: 'Solo', clickCount: 5, lastCheckOk: true, lastChangeIso: iso(1) }] }, { now: NOW });
  assert.equal(out.length, 1);
  assert.equal(out[0].kind, 'radio');
});

test('recommend preserves an explicit per-item kind over the bucket default', () => {
  const out = recommend({ cams: [{ kind: 'radio', name: 'Weird', uuid: 'x', clickCount: 1, lastCheckOk: true, lastChangeIso: iso(1) }] }, { now: NOW });
  assert.equal(out[0].kind, 'radio');
});

test('recommend respects weight overrides across the merged list', () => {
  const byKind = {
    radio: [{ uuid: 'r', name: 'Stale but huge', clickCount: 500000, votes: 20000, bitrate: 256, lastCheckOk: true, lastChangeIso: iso(300) }],
    podcasts: [{ title: 'Tiny fresh', feedUrl: 'http://f', episodeCount: 3, releaseDate: iso(0) }],
  };
  const engHeavy = recommend(byKind, { now: NOW, weights: { engagement: 1, freshness: 0, reliability: 0 } });
  assert.equal(engHeavy[0].name, 'Stale but huge', 'engagement-weighted favors the huge station');
  const freshHeavy = recommend(byKind, { now: NOW, weights: { freshness: 1, engagement: 0, reliability: 0 } });
  assert.equal(freshHeavy[0].title, 'Tiny fresh', 'freshness-weighted favors the new podcast');
});
