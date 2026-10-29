// liquidity-ratios.test.mjs — OFFLINE. Pure arithmetic, no chain, no network.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  TOKENOMICS, ANCHOR_POOL, impliedPrice, scarcityPrice, ratioFor, seedPlan, triangleCheck,
  driftFromTokenomics,
} from './liquidity-ratios.mjs';

const LIVE = [
  { name: 'KULA/WPRANA', a: 'KULA', b: 'WPRANA', reserveA: 8828.7438, reserveB: 5668.3937 },
  { name: 'KULA/wVKBT', a: 'KULA', b: 'wVKBT', reserveA: 1002.8990, reserveB: 17555.7132 },
];

test('implied price is reserves, and a zero reserve is 0 rather than Infinity', () => {
  assert.equal(impliedPrice({ reserveA: 10, reserveB: 5 }), 2);
  assert.equal(impliedPrice({ reserveA: 10, reserveB: 0 }), 0);
  assert.equal(impliedPrice({}), 0);
});

test('implied price handles raw integer reserves with mixed decimals', () => {
  // 1,000 of an 18-dec token against 500 of an 8-dec token is a price of 2
  const p = impliedPrice({ reserveA: '1000000000000000000000', reserveB: '50000000000', decA: 18, decB: 8, raw: true });
  assert.equal(p, 2);
});

test('scarcity: the scarcer token costs more', () => {
  const t = { A: { lifetime: 1000, circulating: 1000, basis: 'scarcity' },
              B: { lifetime: 100, circulating: 100, basis: 'scarcity' },
              KULA: { lifetime: 1000, circulating: 1000, basis: 'scarcity' } };
  // B is 10x scarcer than A, so one B costs 10 A
  const r = ratioFor('A', 'B', { tokenomics: t });
  assert.equal(r.basis, 'scarcity');
  assert.equal(r.priceOfBInA, 10);
});

test('⚠ lifetime is the default basis, and it is NOT the same answer as circulating', () => {
  const byLife = scarcityPrice('wMELEK', 'KULA', { useLifetime: true });
  const byCirc = scarcityPrice('wMELEK', 'KULA', { useLifetime: false });
  // Lifetime: 10M KULA against 2.5M MELEK => about 4 KULA per wMELEK. Sane.
  assert.ok(byLife > 3 && byLife < 5, `lifetime basis ${byLife}`);
  // Circulating: only 0.9 wMELEK has ever been bridged, so it looks almost infinitely scarce and
  // prices at ~287,000 KULA each. That is the absurdity the lifetime default exists to avoid.
  assert.ok(byCirc > 100000, `circulating basis ${byCirc}`);
  assert.ok(byCirc / byLife > 1000, 'the two bases differ by orders of magnitude');
});

test('⚠ a market-priced token REFUSES rather than falling back to a supply ratio', () => {
  // the regression: wVKBT came out at 429 KULA on scarcity while its live pool said 0.057
  const r = ratioFor('KULA', 'wVKBT', {});          // no market price, no live pool
  assert.equal(r.ok, false);
  assert.equal(r.basis, 'market');
  assert.deepEqual(r.missing, ['wVKBT']);
  assert.match(r.reason, /do not substitute a supply ratio/);
});

test('given a real market price, the market basis is used', () => {
  const r = ratioFor('KULA', 'wVKBT', { marketPrices: { KULA: 1, wVKBT: 0.05 } });
  assert.equal(r.basis, 'market');
  assert.equal(r.priceOfBInA, 0.05);
});

test('a live pool anchors the pair and beats scarcity', () => {
  const r = ratioFor('KULA', 'wVKBT', { livePools: LIVE });
  assert.equal(r.basis, 'anchor');
  assert.ok(Math.abs(r.priceOfBInA - 0.05712665) < 1e-6);
  assert.match(r.reason, /do not re-price it/);
});

test('the anchor works whichever way round the pair is stored', () => {
  const fwd = ratioFor('KULA', 'WPRANA', { livePools: LIVE });
  const rev = ratioFor('WPRANA', 'KULA', { livePools: LIVE });
  assert.equal(fwd.basis, 'anchor');
  assert.equal(rev.basis, 'anchor');
  assert.ok(Math.abs(fwd.priceOfBInA * rev.priceOfBInA - 1) < 1e-6, 'the two directions are reciprocal');
});

test('⚠ a token that has never been issued gets NO ratio', () => {
  const r = ratioFor('KULA', 'MWALI', { livePools: LIVE });
  assert.equal(r.ok, false);
  assert.match(r.reason, /never been issued/);
});

test('unknown tokens are refused, not guessed', () => {
  assert.equal(ratioFor('KULA', 'NOPE', {}).ok, false);
  assert.match(ratioFor('NOPE', 'KULA', {}).reason, /unknown token/);
});

// ── seeding ───────────────────────────────────────────────────────────────────────────────────────
test('a seed plan splits the budget in half by value, and lands on the intended price', () => {
  const p = seedPlan({ tokenA: 'KULA', tokenB: 'WPRANA', budget: 2000, budgetToken: 'KULA', livePools: LIVE });
  assert.equal(p.ok, true);
  assert.equal(p.amountA, 1000);
  // the resulting pool price must equal the ratio we targeted
  const resulting = impliedPrice({ reserveA: p.amountA, reserveB: p.amountB });
  assert.ok(Math.abs(resulting - p.impliedPriceOfBInA) < 1e-6, `${resulting} vs ${p.impliedPriceOfBInA}`);
});

test('a budget in the other side of the pair also works', () => {
  const p = seedPlan({ tokenA: 'wCURE', tokenB: 'KULA', budget: 1000, budgetToken: 'KULA',
                       livePools: [{ name: 'wCURE/KULA', a: 'wCURE', b: 'KULA', reserveA: 393.4344, reserveB: 922.1010 }] });
  assert.equal(p.ok, true);
  assert.equal(p.amountB, 500);
  assert.ok(p.amountA > 0);
});

test('a budget in a token that is not in the pair is refused', () => {
  const p = seedPlan({ tokenA: 'KULA', tokenB: 'WPRANA', budget: 100, budgetToken: 'wCURE', livePools: LIVE });
  assert.equal(p.ok, false);
  assert.match(p.reason, /not in this pair/);
});

test('a non-positive budget is refused rather than producing a zero pool', () => {
  for (const b of [0, -5, NaN, undefined]) {
    assert.equal(seedPlan({ tokenA: 'KULA', tokenB: 'WPRANA', budget: b, livePools: LIVE }).ok, false);
  }
});

// ── the triangle ──────────────────────────────────────────────────────────────────────────────────
test('⚠ the three live pools form a loop with real, extractable arbitrage', () => {
  // KULA -> wVKBT -> wCURE -> KULA, using the reserves read on-chain 2026-10-28
  const kulaPerVkbt = 1002.8990 / 17555.7132;
  const vkbtPerCure = 3650.0 / 90.4381;
  const kulaPerCure = 922.1010 / 393.4344;
  const r = triangleCheck([
    { from: 'KULA', to: 'wVKBT', price: kulaPerVkbt },
    { from: 'wVKBT', to: 'wCURE', price: vkbtPerCure },
    { from: 'wCURE', to: 'KULA', price: 1 / kulaPerCure },
  ]);
  assert.equal(r.ok, true);
  assert.equal(r.arbitrageFree, false, 'the loop does not close inside the fee band');
  assert.ok(r.netArbitragePct > 0.5 && r.netArbitragePct < 1.0, `net ${r.netArbitragePct}%`);
});

test('a loop that closes exactly is arbitrage free', () => {
  const r = triangleCheck([
    { from: 'A', to: 'B', price: 2 }, { from: 'B', to: 'C', price: 3 }, { from: 'C', to: 'A', price: 1 / 6 },
  ]);
  assert.equal(r.arbitrageFree, true);
  assert.ok(Math.abs(r.product - 1) < 1e-9);
});

test('a malformed triangle is refused, not thrown', () => {
  assert.equal(triangleCheck([]).ok, false);
  assert.equal(triangleCheck([{ from: 'A', to: 'B', price: 0 }, { from: 'B', to: 'C', price: 1 }, { from: 'C', to: 'A', price: 1 }]).ok, false);
});

// ── drift ─────────────────────────────────────────────────────────────────────────────────────────
test('drift measures a live pool against what tokenomics would say', () => {
  const d = driftFromTokenomics({ tokenA: 'KULA', tokenB: 'wMELEK', reserveA: 100, reserveB: 25 });
  assert.equal(d.ok, true);
  assert.equal(d.basis, 'scarcity');
  assert.ok(Number.isFinite(d.driftPct));
});

test('the anchor pool is internally consistent with its stated price', () => {
  const p = impliedPrice({ reserveA: ANCHOR_POOL.reserveA, reserveB: ANCHOR_POOL.reserveB });
  assert.ok(Math.abs(p - 1.55753892) < 1e-6);
});

test('every token declares a basis the model knows how to honour', () => {
  for (const [name, t] of Object.entries(TOKENOMICS)) {
    assert.ok(['market', 'anchor', 'scarcity'].includes(t.basis), `${name} basis ${t.basis}`);
    assert.ok(Number.isFinite(t.decimals) && t.decimals > 0, `${name} decimals`);
  }
});
