// OFFLINE tests for the PURE odds/vig/house-edge math in gambling.mjs. No network is touched.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  impliedProbability, impliedFromAmerican, vig, vigOverround,
  tableGameOdds, tableGames,
  impliedFromDecimal, decimalFromAmerican, americanFromDecimal, decimalFromFractional,
  expectedValue, evFromDecimal, arbitrage, triangularArb,
} from './gambling.mjs';

const close = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('impliedProbability: negative (favorite) odds', () => {
  close(impliedProbability(-150), 150 / 250); // 0.6
  close(impliedProbability(-110), 110 / 210);
  close(impliedProbability(-200), 200 / 300);
});

test('impliedProbability: positive (underdog) odds', () => {
  close(impliedProbability(+150), 100 / 250); // 0.4
  close(impliedProbability(+100), 0.5);       // even money
  close(impliedProbability(+200), 100 / 300);
});

test('impliedProbability: bad input returns null', () => {
  assert.equal(impliedProbability(0), null);
  assert.equal(impliedProbability('abc'), null);
  assert.equal(impliedProbability(NaN), null);
  assert.equal(impliedProbability(undefined), null);
});

test('impliedFromAmerican is an alias of impliedProbability', () => {
  assert.strictEqual(impliedFromAmerican, impliedProbability);
});

test('vig(impliedA, impliedB): two-way overround + de-vigged fair probs', () => {
  const a = impliedProbability(-110), b = impliedProbability(-110);
  const v = vig(a, b);
  close(v.overround, a + b - 1);
  close(v.marginPct, (a + b - 1) * 100);
  // standard -110/-110 market overround ≈ 4.76%
  assert.ok(Math.abs(v.marginPct - 4.7619) < 0.01, `~4.76% got ${v.marginPct}`);
  close(v.fairA, 0.5); // symmetric market → fair is 50/50
  close(v.fairB, 0.5);
  close(v.fairA + v.fairB, 1);
});

test('vig: bad input returns null', () => {
  assert.equal(vig(NaN, 0.5), null);
  assert.equal(vig(0, 0), null);
  assert.equal(vig('x', 'y'), null);
});

test('vigOverround(list): N-way market', () => {
  const v = vigOverround([-110, -110]);
  assert.equal(v.runners, 2);
  close(v.bookedProbability, impliedProbability(-110) * 2);
  assert.ok(v.overround > 0);
  close(v.fair.reduce((s, p) => s + p, 0), 1); // fair probs normalize to 1
});

test('vigOverround: 3-way soccer market sums fair to 1', () => {
  const v = vigOverround([+135, +230, +190]);
  assert.equal(v.runners, 3);
  assert.equal(v.implied.length, 3);
  close(v.fair.reduce((s, p) => s + p, 0), 1);
  assert.ok(v.marginPct > 0);
});

test('vigOverround: empty / invalid lists return null', () => {
  assert.equal(vigOverround([]), null);
  assert.equal(vigOverround('nope'), null);
  assert.equal(vigOverround([0]), null);     // 0 odds → invalid implied
  assert.equal(vigOverround([-110, 'x']), null);
});

test('tableGameOdds: roulette double-zero (American) = 5.26% edge', () => {
  const r = tableGameOdds('roulette'); // alias → double-zero
  assert.equal(r.pockets, 38);
  close(r.houseEdge, 2 / 38);
  assert.ok(Math.abs(r.houseEdgePct - 5.263) < 0.01);
  close(r.rtp, 1 - 2 / 38);
});

test('tableGameOdds: roulette single-zero (European) = 2.70% edge', () => {
  const r = tableGameOdds('roulette-single-zero');
  assert.equal(r.pockets, 37);
  close(r.houseEdge, 1 / 37);
  assert.ok(Math.abs(r.houseEdgePct - 2.702) < 0.01);
});

test('tableGameOdds: blackjack basic strategy ≈ 0.5% edge', () => {
  const b = tableGameOdds('blackjack');
  close(b.houseEdge, 0.005);
  close(b.rtp, 0.995);
  assert.match(b.note, /basic strategy|rules/i);
});

test('tableGameOdds: craps pass line ≈ 1.41% edge, dont-pass lower', () => {
  const pass = tableGameOdds('craps');           // alias → pass
  const dont = tableGameOdds('craps-dont-pass');
  assert.ok(Math.abs(pass.houseEdgePct - 1.414) < 0.01);
  assert.ok(dont.houseEdge < pass.houseEdge, "don't pass edge is lower");
});

test('tableGameOdds: aliases and case-insensitivity', () => {
  assert.equal(tableGameOdds('21').game, 'blackjack');
  assert.equal(tableGameOdds('ROULETTE-EUROPEAN').game, 'roulette-single-zero');
});

test('tableGameOdds: unknown / bad game returns null', () => {
  assert.equal(tableGameOdds('keno'), null);
  assert.equal(tableGameOdds(''), null);
  assert.equal(tableGameOdds(null), null);
  assert.equal(tableGameOdds(42), null);
});

test('tableGames: sorted by house edge ascending, all valid', () => {
  const all = tableGames();
  assert.ok(all.length >= 6);
  for (let i = 1; i < all.length; i++) {
    assert.ok(all[i].houseEdge >= all[i - 1].houseEdge, 'ascending edge');
  }
  // best for the player should be blackjack (lowest edge here)
  assert.equal(all[0].game, 'blackjack');
  for (const g of all) {
    assert.ok(Number.isFinite(g.houseEdge));
    close(g.rtp, 1 - g.houseEdge);
  }
});

// ── §4.7 Odds converters ─────────────────────────────────────────────────────────────────────────
const near = (a, b, eps = 1e-4) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b}`);

test('impliedFromDecimal: p = 1/dec', () => {
  near(impliedFromDecimal(2.0), 0.5);
  near(impliedFromDecimal(4.0), 0.25);
  near(impliedFromDecimal(1.909), 1 / 1.909);
});

test('impliedFromDecimal: bad input → null', () => {
  assert.equal(impliedFromDecimal(1), null);   // no profit line
  assert.equal(impliedFromDecimal(0.9), null);
  assert.equal(impliedFromDecimal(0), null);
  assert.equal(impliedFromDecimal(-2), null);
  assert.equal(impliedFromDecimal(NaN), null);
  assert.equal(impliedFromDecimal('x'), null);
});

test('decimalFromAmerican: both signs', () => {
  near(decimalFromAmerican(+100), 2.0);
  near(decimalFromAmerican(+150), 2.5);
  near(decimalFromAmerican(-110), 1.9091);
  near(decimalFromAmerican(-200), 1.5);
});

test('decimalFromAmerican: bad input → null', () => {
  assert.equal(decimalFromAmerican(0), null);
  assert.equal(decimalFromAmerican(NaN), null);
  assert.equal(decimalFromAmerican('x'), null);
});

test('americanFromDecimal: both branches', () => {
  assert.equal(americanFromDecimal(2.0), 100);
  assert.equal(americanFromDecimal(2.5), 150);
  assert.equal(americanFromDecimal(1.5), -200);
  assert.equal(americanFromDecimal(1.9091), -110);
});

test('americanFromDecimal: bad input → null', () => {
  assert.equal(americanFromDecimal(1), null);
  assert.equal(americanFromDecimal(0.5), null);
  assert.equal(americanFromDecimal(NaN), null);
});

test('decimal ↔ american round-trips', () => {
  for (const a of [+100, +150, +250, -110, -200, -150]) {
    assert.equal(americanFromDecimal(decimalFromAmerican(a)), a);
  }
});

test('american ↔ decimal ↔ implied consistency', () => {
  // -110 → decimal ≈ 1.909 → implied ≈ 0.524, same as impliedProbability(-110)
  const d = decimalFromAmerican(-110);
  near(impliedFromDecimal(d), impliedProbability(-110), 1e-3);
  near(impliedFromDecimal(decimalFromAmerican(+100)), impliedProbability(+100));
});

test('decimalFromFractional: string and array', () => {
  near(decimalFromFractional('7/2'), 4.5);
  near(decimalFromFractional([7, 2]), 4.5);
  near(decimalFromFractional('1/1'), 2.0);   // evens
  near(decimalFromFractional('5/1'), 6.0);
});

test('decimalFromFractional: bad input → null', () => {
  assert.equal(decimalFromFractional('7/0'), null);   // zero denominator
  assert.equal(decimalFromFractional('abc'), null);
  assert.equal(decimalFromFractional([7]), null);
  assert.equal(decimalFromFractional('-1/2'), null);
  assert.equal(decimalFromFractional(7), null);
  assert.equal(decimalFromFractional(null), null);
});

// ── §4.7 Expected Value (+EV) ────────────────────────────────────────────────────────────────────
test('expectedValue: textbook +EV (fair 0.55, payout 1.0 = decimal 2.0)', () => {
  const r = expectedValue({ fairProb: 0.55, payout: 1.0 });
  near(r.edge, 0.10);
  near(r.ev, 0.10);
  near(r.evPct, 10);
  assert.ok(r.ev > 0, '+EV');
});

test('expectedValue: −EV case (fair 0.45, payout 1.0)', () => {
  const r = expectedValue({ fairProb: 0.45, payout: 1.0 });
  near(r.edge, -0.10);
  assert.ok(r.ev < 0, '−EV');
});

test('expectedValue: stake scales ev but not edge/evPct', () => {
  const r = expectedValue({ fairProb: 0.55, payout: 1.0, stake: 100 });
  near(r.ev, 10);       // 0.10 × 100
  near(r.evPct, 10);    // still per-unit %
  near(r.edge, 0.10);
});

test('evFromDecimal: matches expectedValue via decimal−1', () => {
  const r = evFromDecimal(2.0, 0.55);
  near(r.ev, 0.10);
  assert.ok(r.ev > 0);
  const neg = evFromDecimal(2.0, 0.45);
  assert.ok(neg.ev < 0);
});

test('expectedValue / evFromDecimal: bad input → null', () => {
  assert.equal(expectedValue({ fairProb: 0, payout: 1 }), null);
  assert.equal(expectedValue({ fairProb: 1, payout: 1 }), null);
  assert.equal(expectedValue({ fairProb: 1.5, payout: 1 }), null);
  assert.equal(expectedValue({ fairProb: 0.5, payout: 0 }), null);
  assert.equal(expectedValue({ fairProb: 0.5, payout: -1 }), null);
  assert.equal(expectedValue({ fairProb: 0.5, payout: 1, stake: 0 }), null);
  assert.equal(expectedValue({ fairProb: NaN, payout: 1 }), null);
  assert.equal(expectedValue(), null);
  assert.equal(evFromDecimal(1, 0.5), null);
  assert.equal(evFromDecimal(2.0, NaN), null);
});

// ── §4.7 Arbitrage / Surebet ─────────────────────────────────────────────────────────────────────
test('arbitrage: classic 2-way surebet (2.10 & 2.10 → ~5% profit)', () => {
  const r = arbitrage([2.10, 2.10]);
  assert.equal(r.isArb, true);
  near(r.impliedSum, 0.95238, 1e-4);
  assert.ok(r.impliedSum < 1);
  near(r.guaranteedProfitPct, 5.0, 1e-2);
  near(r.stakes[0], 0.5);
  near(r.stakes[1], 0.5);
  near(r.stakes.reduce((s, x) => s + x, 0), 1);   // stake split sums to 1
});

test('arbitrage: non-arb (1.8 & 1.8 → positive margin, isArb false)', () => {
  const r = arbitrage([1.8, 1.8]);
  assert.equal(r.isArb, false);
  assert.ok(r.impliedSum > 1);
  assert.ok(r.marginPct > 0, 'positive bookmaker margin');
  near(r.marginPct, 11.111, 1e-2);
  assert.ok(r.guaranteedProfitPct < 0, 'guaranteed loss if you tried');
});

test('arbitrage: N-way (3-way) arb splits stake and locks profit', () => {
  const r = arbitrage([3.20, 3.20, 3.20]); // sum 1/3.2 ×3 = 0.9375 < 1
  assert.equal(r.isArb, true);
  near(r.impliedSum, 0.9375, 1e-4);
  near(r.stakes.reduce((s, x) => s + x, 0), 1);
  assert.ok(r.guaranteedProfitPct > 0);
  // equal return each way = 1/impliedSum
  const ret0 = r.stakes[0] * 3.20;
  const ret1 = r.stakes[1] * 3.20;
  near(ret0, ret1);
});

test('arbitrage: bad input → null', () => {
  assert.equal(arbitrage([]), null);
  assert.equal(arbitrage('nope'), null);
  assert.equal(arbitrage([2.0, 1]), null);   // 1 is not > 1
  assert.equal(arbitrage([2.0, 0]), null);
  assert.equal(arbitrage([2.0, -3]), null);
  assert.equal(arbitrage([2.0, NaN]), null);
});

// ── §4.7 Triangular ForEx arbitrage ──────────────────────────────────────────────────────────────
test('triangularArb: balanced cross-rates → no arb (ratio 1.0)', () => {
  // EUR/USD 1.10, GBP/USD 1.25, EUR/GBP = 1.10/1.25 = 0.88 → consistent
  const r = triangularArb({ ab: 1.10, bc: 1.25, ac: 0.88 });
  near(r.ratio, 1.0, 1e-3);
  assert.equal(r.isArb, false);
  assert.ok(Math.abs(r.profitPct) < 1e-2);
});

test('triangularArb: profitable cycle detected', () => {
  // Mispriced EUR/GBP (0.85 instead of 0.88) opens ~3.5% edge
  const r = triangularArb({ ab: 1.10, bc: 1.25, ac: 0.85 });
  assert.equal(r.isArb, true);
  assert.ok(r.profitPct > 3 && r.profitPct < 4, `~3.5% got ${r.profitPct}`);
  assert.equal(r.cycle, 'A→B→C→A');
});

test('triangularArb: reverse-direction arb reports A→C→B→A', () => {
  // ratio < 1 → the reverse cycle is the profitable one
  const r = triangularArb({ ab: 1.10, bc: 1.25, ac: 0.92 });
  assert.ok(r.ratio < 1);
  assert.equal(r.cycle, 'A→C→B→A');
});

test('triangularArb: fee threshold can erase a thin edge', () => {
  // ~3.5% gross edge, but 2% per-leg fee (×3 legs) wipes it out
  const r = triangularArb({ ab: 1.10, bc: 1.25, ac: 0.85 }, 2);
  assert.equal(r.isArb, false, 'fees eat the edge');
});

test('triangularArb: bad input → null', () => {
  assert.equal(triangularArb({ ab: 0, bc: 1.25, ac: 0.88 }), null);
  assert.equal(triangularArb({ ab: 1.1, bc: -1, ac: 0.88 }), null);
  assert.equal(triangularArb({ ab: 1.1, bc: 1.25, ac: NaN }), null);
  assert.equal(triangularArb({ ab: 1.1, bc: 1.25, ac: 0.88 }, -1), null);
  assert.equal(triangularArb(), null);
});
