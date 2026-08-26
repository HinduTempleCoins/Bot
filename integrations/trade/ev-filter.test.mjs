// ev-filter.test.mjs — OFFLINE tests. No network, no keys. Deterministic.
//   node --test integrations/trade/ev-filter.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scoreCandidate, filterEv, rankEv } from './ev-filter.mjs';

test('scores a +EV candidate positive and a −EV candidate negative', () => {
  const good = scoreCandidate({ fairProb: 0.6, decimalOdds: 2.0 }); // edge = 0.6*1 - 0.4 = 0.2
  assert.ok(good.positiveEv);
  assert.ok(Math.abs(good.edge - 0.2) < 1e-6);
  const bad = scoreCandidate({ fairProb: 0.4, decimalOdds: 2.0 });  // edge = -0.2
  assert.equal(bad.positiveEv, false);
  assert.ok(bad.edge < 0);
});

test('fair coinflip at 2.0 is exactly zero-EV (not positive)', () => {
  const c = scoreCandidate({ fairProb: 0.5, decimalOdds: 2.0 });
  assert.equal(c.edge, 0);
  assert.equal(c.positiveEv, false);
});

test('winFraction/lossFraction form maps to decimal odds and probEdge', () => {
  // win +3% at risk 2% → decimalOdds = 1 + 3/2 = 2.5; implied = 0.4; fair 0.7 → probEdge 0.3
  const c = scoreCandidate({ id: 'peg', fairProb: 0.7, winFraction: 0.03, lossFraction: 0.02 });
  assert.ok(Math.abs(c.decimalOdds - 2.5) < 1e-9);
  assert.ok(Math.abs(c.impliedProb - 0.4) < 1e-6);
  assert.ok(Math.abs(c.probEdge - 0.3) < 1e-6);
  assert.ok(c.positiveEv);
});

test('filterEv keeps only +EV, ranked by edge desc, honors minEdge', () => {
  const cands = [
    { id: 'a', fairProb: 0.55, decimalOdds: 2.0 }, // edge 0.10
    { id: 'b', fairProb: 0.70, decimalOdds: 2.0 }, // edge 0.40
    { id: 'c', fairProb: 0.45, decimalOdds: 2.0 }, // edge -0.10 (dropped)
  ];
  const out = filterEv(cands);
  assert.deepEqual(out.map((c) => c.id), ['b', 'a']);
  const strict = filterEv(cands, { minEdge: 0.2 });
  assert.deepEqual(strict.map((c) => c.id), ['b']);
});

test('rankEv keeps all valid scored (incl. −EV), sorted by edge', () => {
  const out = rankEv([
    { id: 'x', fairProb: 0.45, decimalOdds: 2.0 },
    { id: 'y', fairProb: 0.60, decimalOdds: 2.0 },
  ]);
  assert.deepEqual(out.map((c) => c.id), ['y', 'x']);
});

test('soft-fail: junk candidates dropped, never throws', () => {
  assert.equal(scoreCandidate(null), null);
  assert.equal(scoreCandidate({ fairProb: 2, decimalOdds: 2 }), null);   // prob out of range
  assert.equal(scoreCandidate({ fairProb: 0.5, decimalOdds: 'x' }), null);
  assert.equal(scoreCandidate({ fairProb: 0.5, decimalOdds: 1 }), null); // odds must be > 1
  const out = filterEv([{ bad: true }, { fairProb: 0.6, decimalOdds: 2 }]);
  assert.equal(out.length, 1);
});
