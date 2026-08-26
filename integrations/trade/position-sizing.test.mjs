// position-sizing.test.mjs — OFFLINE tests. No network, no keys. Deterministic.
//   node --test integrations/trade/position-sizing.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kellyFraction, sizePosition } from './position-sizing.mjs';

test('kellyFraction matches the closed form f* = (p·b − (1−p))/b', () => {
  // p=0.6, b=1 → (0.6 - 0.4)/1 = 0.20
  assert.ok(Math.abs(kellyFraction({ p: 0.6, b: 1 }) - 0.2) < 1e-9);
  // p=0.6, b=2 → (1.2 - 0.4)/2 = 0.40
  assert.ok(Math.abs(kellyFraction({ p: 0.6, b: 2 }) - 0.4) < 1e-9);
});

test('kellyFraction ≤ 0 when there is no edge', () => {
  assert.ok(kellyFraction({ p: 0.4, b: 1 }) <= 0);
  assert.equal(kellyFraction({ p: 0.5, b: 1 }), 0);
});

test('sizePosition applies the kelly fraction and stays within bounds', () => {
  // full kelly 0.2, quarter-kelly 0.05 → 0.05*1000 = $50, but bounded by maxFraction 0.10 (=$100)
  // and maxOrderUsd default $2 → capped to $2.
  const r = sizePosition({ p: 0.6, b: 1, bankrollUsd: 1000 });
  assert.equal(r.sizeUsd, 2);
  assert.equal(r.cappedBy, 'maxOrderUsd');
  // raise the per-order cap → quarter-Kelly $50 binds
  const r2 = sizePosition({ p: 0.6, b: 1, bankrollUsd: 1000, maxOrderUsd: 1000, maxFraction: 1 });
  assert.equal(r2.sizeUsd, 50);
  assert.equal(r2.cappedBy, 'kelly');
});

test('maxFraction binds before the dollar cap when smaller', () => {
  // full kelly 0.8 (p .9 b 1), quarter 0.2 → but maxFraction 0.10 caps to $100 on $1000 bankroll.
  const r = sizePosition({ p: 0.9, b: 1, bankrollUsd: 1000, maxOrderUsd: 10000, maxFraction: 0.10 });
  assert.equal(r.sizeUsd, 100);
  assert.equal(r.cappedBy, 'maxFraction');
});

test('availableUsd (dry-powder) caps the size', () => {
  const r = sizePosition({ p: 0.9, b: 1, bankrollUsd: 1000, maxOrderUsd: 10000, maxFraction: 1, availableUsd: 30 });
  assert.equal(r.sizeUsd, 30);
  assert.equal(r.cappedBy, 'availableUsd');
});

test('no edge ⇒ size 0', () => {
  const r = sizePosition({ p: 0.45, b: 1, bankrollUsd: 1000 });
  assert.equal(r.sizeUsd, 0);
  assert.equal(r.cappedBy, 'no-edge');
});

test('BUY-FIRST: a naked sell is never sized; a round-trip close is', () => {
  const naked = sizePosition({ p: 0.7, b: 1, bankrollUsd: 1000, side: 'sell' });
  assert.equal(naked.sizeUsd, 0);
  assert.equal(naked.cappedBy, 'buy-first');
  const close = sizePosition({ p: 0.7, b: 1, bankrollUsd: 1000, side: 'sell', isRoundTrip: true, maxOrderUsd: 1000, maxFraction: 1 });
  assert.ok(close.sizeUsd > 0);
});

test('soft-fail: bad input returns size 0, never throws', () => {
  assert.equal(kellyFraction({ p: 2, b: 1 }), null);
  assert.equal(kellyFraction({ p: 0.5, b: -1 }), null);
  assert.equal(sizePosition({ p: 0.6, b: 1, bankrollUsd: 0 }).cappedBy, 'bad-input');
  assert.equal(sizePosition({ p: 'x', b: 1, bankrollUsd: 1000 }).cappedBy, 'bad-input');
  assert.equal(sizePosition().sizeUsd, 0);
});
