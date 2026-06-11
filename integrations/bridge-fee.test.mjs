// bridge-fee.test.mjs — offline tests for the cross-chain bridge fee calculator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bridgeQuote,
  roundTripCost,
  compareRoutes,
  breakEvenAmount,
  esc,
} from './bridge-fee.mjs';

test('bridgeQuote: flat + pct fee, received and effectiveBps', () => {
  const q = bridgeQuote({ amount: 1000, flatFee: 10, pctFeeBps: 50 }); // 10 + 5 = 15
  assert.equal(q.ok, true);
  assert.equal(q.sent, 1000);
  assert.equal(q.fee, 15);
  assert.equal(q.received, 985);
  assert.equal(q.effectiveBps, 150); // 15/1000*10000
});

test('bridgeQuote: zero fees -> full received, 0 bps', () => {
  const q = bridgeQuote({ amount: 500 });
  assert.equal(q.fee, 0);
  assert.equal(q.received, 500);
  assert.equal(q.effectiveBps, 0);
});

test('bridgeQuote: amount 0 yields 0 bps (no divide-by-zero)', () => {
  const q = bridgeQuote({ amount: 0, flatFee: 5, minFee: 0 });
  assert.equal(q.ok, true);
  assert.equal(q.fee, 0); // fee can't exceed amount
  assert.equal(q.received, 0);
  assert.equal(q.effectiveBps, 0);
});

test('bridgeQuote: minFee clamps the fee UP', () => {
  // raw fee = 0 + 1000*1bps/10000 = 0.1, clamped up to minFee 5
  const q = bridgeQuote({ amount: 1000, pctFeeBps: 1, minFee: 5 });
  assert.equal(q.fee, 5);
  assert.equal(q.received, 995);
});

test('bridgeQuote: maxFee clamps the fee DOWN', () => {
  // raw = 0 + 1000*200bps/10000 = 20, capped to maxFee 4
  const q = bridgeQuote({ amount: 1000, pctFeeBps: 200, maxFee: 4 });
  assert.equal(q.fee, 4);
  assert.equal(q.received, 996);
});

test('bridgeQuote: fee never exceeds amount', () => {
  const q = bridgeQuote({ amount: 3, flatFee: 100 });
  assert.equal(q.fee, 3);
  assert.equal(q.received, 0);
});

test('bridgeQuote: soft-fail on negative amount', () => {
  const q = bridgeQuote({ amount: -1 });
  assert.equal(q.ok, false);
  assert.match(q.error, /non-negative/);
});

test('bridgeQuote: soft-fail when maxFee < minFee', () => {
  const q = bridgeQuote({ amount: 100, minFee: 10, maxFee: 5 });
  assert.equal(q.ok, false);
  assert.match(q.error, /maxFee/);
});

test('bridgeQuote: soft-fail on missing/garbage input, never throws', () => {
  assert.equal(bridgeQuote().ok, false);
  assert.equal(bridgeQuote({ amount: 'lots' }).ok, false);
  assert.equal(bridgeQuote({ amount: Infinity }).ok, false);
  assert.equal(bridgeQuote({ amount: 100, pctFeeBps: -1 }).ok, false);
});

test('roundTripCost: composes outbound then inbound on arrived amount', () => {
  const rt = roundTripCost({
    amount: 1000,
    outbound: { flatFee: 0, pctFeeBps: 100 }, // fee 10 -> 990
    inbound: { flatFee: 0, pctFeeBps: 100 }, // fee 9.9 on 990 -> 980.1
  });
  assert.equal(rt.ok, true);
  assert.equal(rt.outbound.received, 990);
  assert.ok(Math.abs(rt.inbound.fee - 9.9) < 1e-9);
  assert.ok(Math.abs(rt.received - 980.1) < 1e-9);
  assert.ok(Math.abs(rt.totalFee - 19.9) < 1e-9);
  assert.ok(Math.abs(rt.effectiveBps - 199) < 1e-9);
});

test('roundTripCost: soft-fail on missing leg', () => {
  assert.equal(roundTripCost({ amount: 100, outbound: { flatFee: 0 } }).ok, false);
  assert.equal(roundTripCost({ amount: 100, inbound: { flatFee: 0 } }).ok, false);
  const bad = roundTripCost({ amount: 100, outbound: { flatFee: -1 }, inbound: {} });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /outbound/);
});

test('compareRoutes: ranks by received amount, flags best', () => {
  const res = compareRoutes(1000, [
    { name: 'cheap', flatFee: 1, pctFeeBps: 10 }, // fee 2 -> 998
    { name: 'expensive', flatFee: 0, pctFeeBps: 100 }, // fee 10 -> 990
    { name: 'mid', flatFee: 5, pctFeeBps: 0 }, // fee 5 -> 995
  ]);
  assert.equal(res.ok, true);
  assert.deepEqual(res.ranked.map((r) => r.name), ['cheap', 'mid', 'expensive']);
  assert.equal(res.best.name, 'cheap');
  assert.equal(res.ranked[0].best, true);
  assert.equal(res.ranked[1].best, false);
});

test('compareRoutes: tie keeps input order (stable)', () => {
  const res = compareRoutes(1000, [
    { name: 'a', flatFee: 10 },
    { name: 'b', flatFee: 10 },
  ]);
  assert.deepEqual(res.ranked.map((r) => r.name), ['a', 'b']);
  assert.equal(res.best.name, 'a');
});

test('compareRoutes: skips invalid routes rather than throwing', () => {
  const res = compareRoutes(1000, [
    { name: 'ok', flatFee: 1 },
    { name: 'bad', minFee: 10, maxFee: 1 },
  ]);
  assert.equal(res.ok, true);
  assert.equal(res.ranked.length, 1);
  assert.equal(res.skipped.length, 1);
  assert.equal(res.skipped[0].name, 'bad');
});

test('compareRoutes: soft-fail on empty/invalid routes', () => {
  assert.equal(compareRoutes(1000, []).ok, false);
  assert.equal(compareRoutes(1000, 'nope').ok, false);
  assert.equal(compareRoutes(-5, [{ flatFee: 0 }]).ok, false);
  const allBad = compareRoutes(100, [{ minFee: 5, maxFee: 1 }]);
  assert.equal(allBad.ok, false);
  assert.match(allBad.error, /no valid routes/);
});

test('breakEvenAmount: higher-flat/lower-pct route overtakes', () => {
  // A: flat 10, 10 bps (0.001) ; B: flat 0, 110 bps (0.011)
  // crossover x = (10-0)/(0.011-0.001) = 10/0.01 = 1000
  const r = breakEvenAmount(
    { flatFee: 10, pctFeeBps: 10 },
    { flatFee: 0, pctFeeBps: 110 },
  );
  assert.equal(r.ok, true);
  assert.equal(r.crossover, 'positive');
  assert.ok(Math.abs(r.amount - 1000) < 1e-6);
  assert.equal(r.cheaperBelow, 'B'); // lower flat below break-even
  assert.equal(r.cheaperAbove, 'A'); // lower pct above break-even

  // verify the crossover with actual quotes just under/over 1000
  const below = 500;
  const above = 1500;
  const aBelow = bridgeQuote({ amount: below, flatFee: 10, pctFeeBps: 10 }).fee;
  const bBelow = bridgeQuote({ amount: below, flatFee: 0, pctFeeBps: 110 }).fee;
  assert.ok(bBelow < aBelow); // B cheaper below
  const aAbove = bridgeQuote({ amount: above, flatFee: 10, pctFeeBps: 10 }).fee;
  const bAbove = bridgeQuote({ amount: above, flatFee: 0, pctFeeBps: 110 }).fee;
  assert.ok(aAbove < bAbove); // A cheaper above
});

test('breakEvenAmount: parallel fees -> no crossover, lower flat wins', () => {
  const r = breakEvenAmount(
    { flatFee: 5, pctFeeBps: 30 },
    { flatFee: 8, pctFeeBps: 30 },
  );
  assert.equal(r.ok, true);
  assert.equal(r.amount, null);
  assert.equal(r.crossover, 'none');
  assert.match(r.note, /route A is cheaper/);
});

test('breakEvenAmount: identical routes', () => {
  const r = breakEvenAmount({ flatFee: 2, pctFeeBps: 10 }, { flatFee: 2, pctFeeBps: 10 });
  assert.equal(r.crossover, 'identical');
  assert.equal(r.amount, null);
});

test('breakEvenAmount: crossover at negative amount -> dominance', () => {
  // A: flat 0, 10 bps ; B: flat 10, 100 bps. x = (0-10)/(0.01-0.001) = negative
  const r = breakEvenAmount({ flatFee: 0, pctFeeBps: 10 }, { flatFee: 10, pctFeeBps: 100 });
  assert.equal(r.ok, true);
  assert.equal(r.crossover, 'none');
  assert.ok(r.amount < 0);
  assert.match(r.note, /route A is cheaper/);
});

test('breakEvenAmount: soft-fail on invalid leg', () => {
  const r = breakEvenAmount({ flatFee: -1 }, { flatFee: 0 });
  assert.equal(r.ok, false);
  assert.match(r.error, /routeA/);
});

test('esc: escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});
