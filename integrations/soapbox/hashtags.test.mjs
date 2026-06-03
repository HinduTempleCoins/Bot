// hashtags.test.mjs — OFFLINE tests for the SoapBox hashtag aggregator.
// No network: exercises the PURE mergeTrends ranker, the normalizeTag normalization, and the
// load-bearing INVARIANT that every cross-platform view number is labeled estimated.
//
//   node --test integrations/soapbox/hashtags.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { mergeTrends, normalizeTag } from './hashtags.mjs';

test('normalizeTag strips #, lowercases, collapses whitespace', () => {
  assert.equal(normalizeTag('#Bitcoin'), 'bitcoin');
  assert.equal(normalizeTag('  ##Crypto  '), 'crypto');
  assert.equal(normalizeTag('World   Cup'), 'world cup');
  assert.equal(normalizeTag(null), '');
  assert.equal(normalizeTag(undefined), '');
});

test('mergeTrends sums usage across sources and unions source names', () => {
  const out = mergeTrends([
    [{ tag: '#bitcoin', usage: 100, source: 'mastodon' }],
    [{ tag: 'Bitcoin', usage: 50, source: 'bluesky' }],
    [{ tag: 'BITCOIN', usage: 25, source: 'reddit' }],
  ]);
  assert.equal(out.length, 1, 'all three normalize to one tag');
  assert.equal(out[0].tag, 'bitcoin');
  assert.equal(out[0].usage, 175, 'usage summed');
  assert.deepEqual(out[0].sources, ['bluesky', 'mastodon', 'reddit'], 'sources unioned + sorted');
});

test('mergeTrends ranks by total usage descending', () => {
  const out = mergeTrends([
    [{ tag: '#small', usage: 5, source: 'a' }, { tag: '#big', usage: 100, source: 'a' }],
    [{ tag: '#mid', usage: 40, source: 'b' }],
  ]);
  assert.deepEqual(out.map((r) => r.tag), ['big', 'mid', 'small']);
});

test('mergeTrends tie-breaks by number of sources then tag name (stable)', () => {
  const out = mergeTrends([
    [{ tag: '#zeta', usage: 10, source: 'a' }],
    [{ tag: '#alpha', usage: 10, source: 'a' }, { tag: '#alpha', usage: 0, source: 'b' }],
  ]);
  // both total 10; alpha has 2 sources so it ranks first.
  assert.equal(out[0].tag, 'alpha');
  assert.equal(out[1].tag, 'zeta');
});

test('INVARIANT: any merged view number across sources is labeled estimated:true', () => {
  // two engagement-derived view figures contributing → cross-platform estimate.
  const out = mergeTrends([
    [{ tag: '#hot', usage: 10, views: 1000, estimated: true, source: 'mastodon' }],
    [{ tag: '#hot', usage: 20, views: 2000, estimated: true, source: 'bluesky' }],
  ]);
  assert.equal(out[0].views, 3000);
  assert.strictEqual(out[0].viewsEstimated, true, 'cross-platform views MUST be estimated');
});

test('INVARIANT: an estimated view figure mixed with a true one still labels estimated', () => {
  const out = mergeTrends([
    [{ tag: '#hot', usage: 10, views: 5000, estimated: false, source: 'youtube' }], // true count
    [{ tag: '#hot', usage: 20, views: 1000, estimated: true, source: 'mastodon' }], // estimate
  ]);
  assert.strictEqual(out[0].viewsEstimated, true, 'any estimate in the merge taints the figure');
});

test('a LONE true-count source keeps views measured (estimated:false)', () => {
  const out = mergeTrends([
    [{ tag: '#owned', usage: 3, views: 42, estimated: false, source: 'on-chain' }],
  ]);
  assert.strictEqual(out[0].views, 42);
  assert.strictEqual(out[0].viewsEstimated, false, 'on-chain/true counts are not estimates');
});

test('no view data → views null and viewsEstimated null (not a false claim of measured)', () => {
  const out = mergeTrends([
    [{ tag: '#usageonly', usage: 99, source: 'reddit' }],
  ]);
  assert.strictEqual(out[0].views, null);
  assert.strictEqual(out[0].viewsEstimated, null);
});

test('mergeTrends ignores empty/falsy tags and tolerates empty input', () => {
  assert.deepEqual(mergeTrends([]), []);
  assert.deepEqual(mergeTrends([[], null, [{ tag: '', usage: 5, source: 'a' }]]), []);
  const out = mergeTrends([[{ tag: '#real', usage: 1, source: 'a' }, { tag: null, usage: 9, source: 'a' }]]);
  assert.equal(out.length, 1);
  assert.equal(out[0].tag, 'real');
});

test('display form: #word for single tokens, phrase for multiword', () => {
  const out = mergeTrends([
    [{ tag: 'Bitcoin', usage: 1, source: 'a' }, { tag: 'World Cup', usage: 1, source: 'a' }],
  ]);
  const byTag = Object.fromEntries(out.map((r) => [r.tag, r.display]));
  assert.equal(byTag['bitcoin'], '#bitcoin');
  assert.equal(byTag['world cup'], 'world cup');
});

test('non-finite/garbage view values are ignored, not summed as NaN', () => {
  const out = mergeTrends([
    [{ tag: '#x', usage: 1, views: 'lots', source: 'a' }],
    [{ tag: '#x', usage: 1, views: 500, estimated: true, source: 'b' }],
  ]);
  assert.equal(out[0].views, 500, 'the garbage view was dropped');
  assert.strictEqual(out[0].viewsEstimated, true);
});
