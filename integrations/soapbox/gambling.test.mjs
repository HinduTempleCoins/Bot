// OFFLINE tests for the PURE odds/vig/house-edge math in gambling.mjs. No network is touched.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  impliedProbability, impliedFromAmerican, vig, vigOverround,
  tableGameOdds, tableGames,
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
