import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gate, normalize, DEFAULT_GATE } from './risk-gate.mjs';

const cfg = { bankrollUsd: 100, maxOrderUsd: 5, minOrderUsd: 1 };

test('passes a healthy buy edge and sizes it under the caps', () => {
  const r = gate({ symbol: 'SPS', side: 'buy', edgePct: 5, priceUsd: 0.02, depthUsd: 50, verdict: 'ACT' }, cfg);
  assert.equal(r.pass, true);
  assert.ok(r.sizeUsd > 0 && r.sizeUsd <= 5, `sized within cap, got ${r.sizeUsd}`);
});

test('rejects an upstream trap (verdict REJECT)', () => {
  const r = gate({ symbol: 'X', side: 'buy', edgePct: 5, verdict: 'REJECT' }, cfg);
  assert.equal(r.pass, false);
  assert.equal(r.reason, 'upstream-reject');
});

test('rejects a dead/stale book (edge above believable ceiling)', () => {
  const r = gate({ symbol: 'SWAP.ETH', side: 'buy', edgePct: 164, priceUsd: 3000 }, cfg);
  assert.equal(r.pass, false);
  assert.match(r.reason, /dead-book/);
});

test('rejects sub-min-edge', () => {
  const r = gate({ symbol: 'X', side: 'buy', edgePct: 0.3, priceUsd: 1 }, cfg);
  assert.equal(r.pass, false);
  assert.match(r.reason, /below-min-edge/);
});

test('BUY-FIRST: a naked sell is blocked', () => {
  const r = gate({ symbol: 'SPS', side: 'sell', edgePct: 6, priceUsd: 0.02 }, cfg);
  assert.equal(r.pass, false);
  assert.match(r.reason, /buy-first/);
});

test('a sell that closes a prior buy (round-trip) is allowed', () => {
  const r = gate({ symbol: 'SPS', side: 'sell', edgePct: 6, priceUsd: 0.02, depthUsd: 50, isRoundTrip: true }, cfg);
  assert.equal(r.pass, true);
});

test('dust orders below the floor are rejected', () => {
  const r = gate({ symbol: 'X', side: 'buy', edgePct: 2, priceUsd: 1, depthUsd: 0.5 }, cfg);
  assert.equal(r.pass, false);
  assert.match(r.reason, /dust|unsized/);
});

test('normalize copes with edge/edgeFrac variants and junk', () => {
  assert.equal(normalize({ symbol: 'A', side: 'BUY', edge: 4 }).edgePct, 4);
  assert.ok(Number.isNaN(normalize({ symbol: 'A' }).edgePct));
  assert.doesNotThrow(() => gate(null, cfg));
  assert.equal(gate(null, cfg).pass, false);
});

test('DEFAULT_GATE is frozen doctrine', () => {
  assert.equal(DEFAULT_GATE.maxBelievableEdgePct, 30);
  assert.equal(DEFAULT_GATE.allowNakedSell, false);
});
