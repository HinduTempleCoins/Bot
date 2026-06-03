// market-entry.test.mjs — OFFLINE tests. No network: rankEntries is pure, and recommendEntries is
// exercised with INJECTED fake sources so the real scanners are never imported-and-called over the wire.
//   node --test integrations/market-entry.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { rankEntries, recommendEntries } from './market-entry.mjs';

// helper: build a uniform candidate with sane defaults
function cand(over = {}) {
  return {
    market: 'X', venue: 'V', chain: 'C', kind: 'k',
    edgePct: 0.05, executableDepth: 100, reason: 'r', action: 'a',
    usJurisdictionOK: true, confidence: 'high',
    provenance: { source: 'fake', fetched_at: '2026-06-03T00:00:00.000Z' },
    ...over,
  };
}

// ── rankEntries: ordering ───────────────────────────────────────────────────────────────────────
test('rankEntries orders by risk-adjusted score (edge × conf × depth × jurisdiction)', () => {
  const low = cand({ market: 'LOW', venue: 'a', edgePct: 0.03, confidence: 'low', executableDepth: 0, usJurisdictionOK: true });
  const high = cand({ market: 'HIGH', venue: 'b', edgePct: 0.10, confidence: 'high', executableDepth: 500, usJurisdictionOK: true });
  const mid = cand({ market: 'MID', venue: 'c', edgePct: 0.06, confidence: 'medium', executableDepth: 200, usJurisdictionOK: true });
  const ranked = rankEntries([low, high, mid]);
  assert.deepEqual(ranked.map((r) => r.market), ['HIGH', 'MID', 'LOW']);
  // scores are populated and strictly descending
  assert.ok(ranked[0].score > ranked[1].score && ranked[1].score > ranked[2].score);
});

test('rankEntries penalizes (but does not drop) non-US-jurisdiction entries', () => {
  const usOk = cand({ market: 'A', venue: 'us', edgePct: 0.06, confidence: 'high', usJurisdictionOK: true });
  const notUs = cand({ market: 'B', venue: 'off', edgePct: 0.06, confidence: 'high', usJurisdictionOK: false });
  const ranked = rankEntries([notUs, usOk]);
  // both survive
  assert.equal(ranked.length, 2);
  // identical except jurisdiction → US-OK ranks first, and the non-US score is exactly half
  assert.equal(ranked[0].market, 'A');
  assert.equal(ranked[1].market, 'B');
  assert.ok(Math.abs(ranked[1].score - ranked[0].score / 2) < 1e-9);
});

test('rankEntries gives depth-having candidates an edge over no-depth ones', () => {
  const withDepth = cand({ market: 'D', venue: 'x', edgePct: 0.05, confidence: 'high', executableDepth: 100 });
  const noDepth = cand({ market: 'N', venue: 'y', edgePct: 0.05, confidence: 'high', executableDepth: 0 });
  const ranked = rankEntries([noDepth, withDepth]);
  assert.equal(ranked[0].market, 'D');
  assert.ok(ranked[0].score > ranked[1].score);
});

// ── rankEntries: dedup ──────────────────────────────────────────────────────────────────────────
test('rankEntries dedups by market+venue, keeping the stronger signal', () => {
  const weak = cand({ market: 'BTC', venue: 'Coinbase', edgePct: 0.02, confidence: 'low' });
  const strong = cand({ market: 'BTC', venue: 'Coinbase', edgePct: 0.09, confidence: 'high' });
  const other = cand({ market: 'BTC', venue: 'Kraken', edgePct: 0.04, confidence: 'medium' });
  const ranked = rankEntries([weak, strong, other]);
  // BTC|Coinbase collapses to one (the strong one); BTC|Kraken is a distinct key
  assert.equal(ranked.length, 2);
  const coinbase = ranked.find((r) => r.venue === 'Coinbase');
  assert.equal(coinbase.edgePct, 0.09);
  assert.equal(coinbase.confidence, 'high');
});

test('rankEntries dedup is case-insensitive on market+venue', () => {
  const a = cand({ market: 'Eth', venue: 'Kraken', edgePct: 0.05 });
  const b = cand({ market: 'ETH', venue: 'kraken', edgePct: 0.08 });
  const ranked = rankEntries([a, b]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].edgePct, 0.08);
});

// ── rankEntries: robustness ───────────────────────────────────────────────────────────────────────
test('rankEntries is safe on empty / junk input', () => {
  assert.deepEqual(rankEntries([]), []);
  assert.deepEqual(rankEntries(null), []);
  assert.deepEqual(rankEntries(undefined), []);
  // rows missing a market are dropped; non-numeric edge treated as 0
  const ranked = rankEntries([{ venue: 'v' }, cand({ market: 'OK', edgePct: 'nope' })]);
  assert.equal(ranked.length, 1);
  assert.equal(ranked[0].market, 'OK');
  assert.equal(ranked[0].score, 0);
});

// ── recommendEntries: fusion with INJECTED fake sources (NO network) ──────────────────────────────
function fakeSource(name, rows) {
  return { name, run: async () => rows };
}

test('recommendEntries fuses multiple injected sources and ranks them', async () => {
  const sources = [
    fakeSource('s1', [cand({ market: 'AAA', venue: 'v1', edgePct: 0.10, confidence: 'high', executableDepth: 500 })]),
    fakeSource('s2', [cand({ market: 'BBB', venue: 'v2', edgePct: 0.04, confidence: 'medium', executableDepth: 50 })]),
    fakeSource('s3', [cand({ market: 'CCC', venue: 'v3', edgePct: 0.07, confidence: 'low', executableDepth: 10 })]),
  ];
  const out = await recommendEntries({ minEdge: 0.03, max: 20, sources });
  assert.equal(out.length, 3);
  assert.equal(out[0].market, 'AAA'); // highest score
  // every entry carries the uniform shape
  for (const e of out) {
    assert.ok('edgePct' in e && 'executableDepth' in e && 'usJurisdictionOK' in e);
    assert.ok(e.provenance && e.provenance.source && e.provenance.fetched_at);
    assert.equal(typeof e.score, 'number');
  }
});

test('recommendEntries filters out entries below minEdge', async () => {
  const sources = [
    fakeSource('s1', [
      cand({ market: 'KEEP', venue: 'v', edgePct: 0.06 }),
      cand({ market: 'DROP', venue: 'v', edgePct: 0.01 }),
    ]),
  ];
  const out = await recommendEntries({ minEdge: 0.03, sources });
  assert.equal(out.length, 1);
  assert.equal(out[0].market, 'KEEP');
});

test('recommendEntries respects max', async () => {
  const rows = Array.from({ length: 30 }, (_, i) =>
    cand({ market: `M${i}`, venue: `v${i}`, edgePct: 0.05 + i * 0.001 }));
  const out = await recommendEntries({ minEdge: 0.03, max: 5, sources: [fakeSource('s', rows)] });
  assert.equal(out.length, 5);
});

test('recommendEntries soft-fails a throwing source without breaking the others', async () => {
  const bad = { name: 'bad', run: async () => { throw new Error('boom'); } };
  const good = fakeSource('good', [cand({ market: 'GOOD', venue: 'v', edgePct: 0.08 })]);
  const out = await recommendEntries({ minEdge: 0.03, sources: [bad, good] });
  assert.equal(out.length, 1);
  assert.equal(out[0].market, 'GOOD');
});

test('recommendEntries returns [] when every source is empty or down', async () => {
  const empty = fakeSource('empty', []);
  const bad = { name: 'bad', run: async () => { throw new Error('x'); } };
  const out = await recommendEntries({ minEdge: 0.03, sources: [empty, bad] });
  assert.deepEqual(out, []);
});

test('recommendEntries dedups across fused sources', async () => {
  const sources = [
    fakeSource('s1', [cand({ market: 'DUP', venue: 'SameVenue', edgePct: 0.04, confidence: 'low' })]),
    fakeSource('s2', [cand({ market: 'DUP', venue: 'SameVenue', edgePct: 0.09, confidence: 'high' })]),
  ];
  const out = await recommendEntries({ minEdge: 0.03, sources });
  assert.equal(out.length, 1);
  assert.equal(out[0].edgePct, 0.09);
});
