// kula-farm.test.mjs — OFFLINE. KULA yield-farm economics: emission split, pool APR, ve-boost + lock,
// SBD-peg haircut, burn-SOMA→KULA redeem, and burn-SOMA→lotto tickets (veKULA-boosted). Pure math, soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_SPLIT, normalizeSplit, emissionSplit, poolApr, veBoost, veVoteWeight, lockPosition,
  lotteryPot, sbdConvert, burnSomaForKula, burnSomaForTickets, lottoWinChance, veKulaLottoBoost,
} from './kula-farm.mjs';

test('DEFAULT_SPLIT sums to 10000 bps (miners are the biggest sink)', () => {
  const { sumBps, ok, bps } = normalizeSplit(DEFAULT_SPLIT);
  assert.equal(sumBps, 10000);
  assert.equal(ok, true);
  assert.ok(bps.miners >= bps.lp, 'miners (GPU) get the largest share');
});

test('emissionSplit divides an epoch emission by the bps weights', () => {
  const s = emissionSplit({ emission: 1_000_000 });
  assert.equal(s.miners, 400000);   // 4000 bps
  assert.equal(s.lp, 300000);       // 3000 bps
  const total = Object.values(s).reduce((a, b) => a + b, 0);
  assert.ok(Math.abs(total - 1_000_000) < 1, 'splits sum back to the emission');
});

test('poolApr scales with emission×price and inversely with TVL; 0 TVL → 0', () => {
  const apr = poolApr({ yearlyEmissionToPool: 15_000_000, kulaPriceUsd: 0.1, poolTvlUsd: 2_000_000 });
  assert.equal(apr, 75, '15M*$0.10 / $2M = 75%');
  assert.equal(poolApr({ yearlyEmissionToPool: 1, kulaPriceUsd: 1, poolTvlUsd: 0 }), 0);
});

test('veBoost + lock: longer lock → bigger boost and vote weight (linear, capped)', () => {
  assert.equal(veBoost({ lockWeeks: 0 }), 1);
  assert.equal(veBoost({ lockWeeks: 208, maxWeeks: 208 }), 2.5, 'max lock → max boost');
  assert.equal(veBoost({ lockWeeks: 104, maxWeeks: 208 }), 1.75, 'half lock → half-way boost');
  const pos = lockPosition({ amount: 1000, lockWeeks: 208, maxWeeks: 208 });
  assert.equal(pos.boost, 2.5);
  assert.equal(pos.voteWeight, 1000, 'full lock → full vote weight');
  assert.equal(veVoteWeight({ amount: 1000, lockWeeks: 52, maxWeeks: 208 }), 250);
});

test('lotteryPot draws from BOTH swap fees and emission (operator: both)', () => {
  const p = lotteryPot({ swapFeesUsd: 10_000, emissionToLottery: 50_000, kulaPriceUsd: 0.1, feeCutBps: 2000 });
  assert.equal(p.fromFeesUsd, 2000, '20% of $10k fees');
  assert.equal(p.fromEmissionUsd, 5000, '50k KULA * $0.10');
  assert.equal(p.potUsd, 7000);
});

test('sbdConvert honors the peg when healthy and HAIRCUTS above the debt cap (the SBD fix)', () => {
  // healthy: 50k supply * $1 / $1M backing = 0.05 debt ratio < 0.10 cap → full $1 peg
  const ok = sbdConvert({ kulaAmount: 100, treasuryUsd: 1_000_000, kulaSupply: 50_000 });
  assert.equal(ok.haircut, 1);
  assert.equal(ok.perUnitUsd, 1);
  assert.equal(ok.capped, false);
  // over-cap: 5M supply * $1 / $1M = 5.0 ratio >> 0.10 cap → haircut = 0.10/5.0 = 0.02 → $0.02/KULA
  const bad = sbdConvert({ kulaAmount: 100, treasuryUsd: 1_000_000, kulaSupply: 5_000_000 });
  assert.equal(bad.capped, true);
  assert.equal(bad.perUnitUsd, 0.02, 'haircut keeps total claims <= cap*treasury — peg cannot run away');
});

test('burnSomaForKula is a fixed-ratio redeem (BurnMine model)', () => {
  assert.deepEqual(burnSomaForKula({ somaIn: 100, num: 3, den: 2 }), { kulaOut: 150, ratio: 1.5, somaBurned: 100 });
  assert.equal(burnSomaForKula({ somaIn: 0, num: 1, den: 1 }).kulaOut, 0);
});

test('veKulaLottoBoost: TerraCore-SCRAP DR curve toward a cap', () => {
  assert.equal(veKulaLottoBoost({ veKula: 0, maxBoost: 3, k: 1000 }), 1);            // no lock → 1x
  assert.equal(veKulaLottoBoost({ veKula: 1000, maxBoost: 3, k: 1000 }), 2);          // veKula=k → midpoint (1 + 2*0.5)
  assert.ok(veKulaLottoBoost({ veKula: 1_000_000, maxBoost: 3, k: 1000 }) > 2.99);    // →cap (3x)
  assert.ok(veKulaLottoBoost({ veKula: 1_000_000, maxBoost: 3, k: 1000 }) <= 3);      // never exceeds cap
});

test('burnSomaForTickets buys whole tickets, burns only spent SOMA; veKULA boosts ticket count', () => {
  const base = burnSomaForTickets({ somaIn: 25, somaPerTicket: 10 }); // no veKULA
  assert.equal(base.baseTickets, 2);
  assert.equal(base.tickets, 2);
  assert.equal(base.somaBurned, 20);
  assert.equal(base.refund, 5);
  // with veKULA at k → 2x boost → floor(2*2)=4 tickets for the SAME 20 SOMA burned
  const boosted = burnSomaForTickets({ somaIn: 25, somaPerTicket: 10, veKula: 1000, maxBoost: 3, k: 1000 });
  assert.equal(boosted.baseTickets, 2);
  assert.equal(boosted.boost, 2);
  assert.equal(boosted.tickets, 4);
  assert.equal(boosted.somaBurned, 20);
});

test('lottoWinChance = my tickets / total, clamped [0,1]', () => {
  assert.equal(lottoWinChance({ myTickets: 5, totalTickets: 100 }), 0.05);
  assert.equal(lottoWinChance({ myTickets: 0, totalTickets: 100 }), 0);
  assert.equal(lottoWinChance({ myTickets: 5, totalTickets: 0 }), 0);
});
