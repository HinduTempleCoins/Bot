// scot-earnings.test.mjs — offline tests for the per-post cross-tribe earnings projector.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tribesForTags, applyCurve, tribeEarning, earningsForPost, projectPostEarnings, __setFetch,
} from './scot-earnings.mjs';

const RULES = [
  { symbol: 'ALPHA', tag: 'alphatribe', enabled: true, emission: 1000, authorPct: 60, curve: 'linear' },
  { symbol: 'BETA', tag: 'betatribe', enabled: true, emission: 500, authorPct: 50, curve: 'sqrt' },
  { symbol: 'GAMMA', tag: 'gammatribe', enabled: false, emission: 999, authorPct: 50, curve: 'linear' }, // disabled
  { symbol: 'DELTA', enabled: true, emission: 200, authorPct: 50, curve: 'linear' }, // tag defaults to 'delta'
];

test('tribesForTags matches enabled rules by tag (default tag = symbol)', () => {
  const m = tribesForTags(RULES, ['alphatribe', 'delta', 'gammatribe', 'random']);
  assert.deepEqual(m.map((r) => r.symbol).sort(), ['ALPHA', 'DELTA']); // GAMMA disabled, BETA not tagged
  assert.equal(tribesForTags(RULES, []).length, 0);
  assert.equal(tribesForTags(null, ['x']).length, 0);
});

test('applyCurve: linear/quadratic/sqrt + guards', () => {
  assert.equal(applyCurve('linear', 100), 100);
  assert.equal(applyCurve('sqrt', 144), 12);
  assert.equal(applyCurve('quadratic', 2000), (2000 * 2000) / 1e6);
  assert.equal(applyCurve('linear', -5), 0);
  assert.equal(applyCurve('linear', 'abc'), 0);
});

test('tribeEarning: emission × share, author/curator split', () => {
  // post has 1/4 of the window weight -> 250 of 1000 ALPHA, author 60%
  const e = tribeEarning(RULES[0], { postWeight: 250, windowTotalWeight: 1000 });
  assert.equal(e.symbol, 'ALPHA');
  assert.equal(e.share, 0.25);
  assert.equal(e.total, 250);
  assert.equal(e.author, 150);
  assert.equal(e.curators, 100);
});

test('tribeEarning: share never exceeds 1 (postWeight floor on total)', () => {
  const e = tribeEarning(RULES[0], { postWeight: 500, windowTotalWeight: 100 });
  assert.equal(e.share, 1); // 500 vs max(500,100)=500
  assert.equal(e.total, 1000);
});

test('tribeEarning: zero window -> zero', () => {
  const e = tribeEarning(RULES[0], { postWeight: 0, windowTotalWeight: 0 });
  assert.equal(e.total, 0);
  assert.equal(e.share, 0);
});

test('earningsForPost: across ALL tribes a post is in', () => {
  const r = earningsForPost({
    post: { author: 'sol', permlink: 'p1', tags: ['alphatribe', 'delta'] },
    rules: RULES,
    weights: { ALPHA: { postWeight: 250, windowTotalWeight: 1000 }, DELTA: { postWeight: 50, windowTotalWeight: 200 } },
  });
  assert.equal(r.totalTokens, 2);
  const syms = r.earnings.map((e) => e.symbol).sort();
  assert.deepEqual(syms, ['ALPHA', 'DELTA']);
  const alpha = r.earnings.find((e) => e.symbol === 'ALPHA');
  assert.equal(alpha.total, 250);
});

test('earningsForPost: post in no tribe -> empty', () => {
  const r = earningsForPost({ post: { tags: ['nothing'] }, rules: RULES, weights: {} });
  assert.equal(r.totalTokens, 0);
  assert.deepEqual(r.earnings, []);
});

test('projectPostEarnings: fetch-based, soft-fails clean on no engineApi', async () => {
  const r = await projectPostEarnings({ author: 'a', permlink: 'b', tags: ['alphatribe'] }, {});
  assert.equal(r.totalTokens, 0); // no engineApi -> empty
});

test('projectPostEarnings: pulls rules + payouts from injected engine API', async () => {
  __setFetch(async (url) => {
    if (url.includes('/contracts/rewards')) {
      return { ok: true, json: async () => ({ rules: RULES }) };
    }
    if (url.includes('/contracts/payouts')) {
      const sym = new URL(url).searchParams.get('symbol');
      const posts = sym === 'ALPHA'
        ? [{ author: 'a', permlink: 'b', weight: 250 }, { author: 'x', permlink: 'y', weight: 750 }]
        : [];
      return { ok: true, json: async () => ({ posts }) };
    }
    return { ok: false, json: async () => ({}) };
  });
  const r = await projectPostEarnings({ author: 'a', permlink: 'b', tags: ['alphatribe'] }, { engineApi: 'http://engine' });
  __setFetch();
  assert.equal(r.totalTokens, 1);
  const alpha = r.earnings[0];
  assert.equal(alpha.symbol, 'ALPHA');
  assert.equal(alpha.share, 0.25); // 250 / (250+750)
  assert.equal(alpha.total, 250);
  assert.equal(alpha.author, 150);
});
