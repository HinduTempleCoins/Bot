// kula-farm.mjs — KULA yield-farm ECONOMICS model (pure math, no chain). KULA is the heart of the farm
// (MasterChef/ve pattern): EmissionScheduler mints KULA → GaugeController splits it across pools →
// LPs/stakers earn → veKULA boosts + votes → sinks (lottery + burn-mine) keep it sustainable.
//
// This module is the off-chain tuner for the on-chain config: pick emission split, see pool APRs, the
// ve-boost curve, the SBD-peg backing safety, and the lottery pot — BEFORE pinning Solidity params.
// PURE arithmetic, soft-fail to 0, never throws. Mirrors cp-amm.mjs's role for the AMM.

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };
const BPS = 10000;

// The reward surfaces KULA emits to (operator: mine/provide/use/contribute/hold/play). Weights in bps.
export const DEFAULT_SPLIT = Object.freeze({
  miners: 4000,    // PRANA GPU / AI-useful-work (the SBD-floored miner pay) — the biggest sink
  lp: 3000,        // KulaSwap liquidity providers (LiquidityGauge)
  stakers: 1500,   // single-stake KULA / veKULA boost pool
  lottery: 500,    // NoLossLotto prize seed (also fed by fees, see lotteryPot)
  dividend: 700,   // Token A real-yield buffer
  contributors: 300, // Proof-of-Brain / tasks / games
});

/** Validate + normalize an emission split to exactly 10000 bps. Returns {bps, ok, sumBps}. */
export function normalizeSplit(split = DEFAULT_SPLIT) {
  const bps = {}; let sum = 0;
  for (const [k, v] of Object.entries(split)) { bps[k] = Math.max(0, Math.round(nn(v))); sum += bps[k]; }
  return { bps, sumBps: sum, ok: sum === BPS };
}

/** Split a per-epoch KULA emission across the surfaces (bps weights). */
export function emissionSplit({ emission, split = DEFAULT_SPLIT } = {}) {
  const e = nn(emission); const { bps } = normalizeSplit(split);
  const out = {}; for (const [k, w] of Object.entries(bps)) out[k] = round(e * w / BPS);
  return out;
}

/** Pool APR from a yearly KULA emission directed to it, vs the pool's staked USD TVL.
 *  aprPct = (poolEmissionPerYear * kulaPriceUsd) / poolTvlUsd * 100. */
export function poolApr({ yearlyEmissionToPool, kulaPriceUsd, poolTvlUsd } = {}) {
  const tvl = nn(poolTvlUsd); if (tvl <= 0) return 0;
  return round(nn(yearlyEmissionToPool) * nn(kulaPriceUsd) / tvl * 100, 4);
}

/** veCRV-style lock boost: lock KULA for `lockWeeks` (cap `maxWeeks`) → multiplier in [1, maxBoost].
 *  Longer lock → bigger share of the same rewards. Linear in lock time (anti-whale: boost is per-position,
 *  capped, not n²). */
export function veBoost({ lockWeeks, maxWeeks = 208, maxBoost = 2.5 } = {}) {
  const w = Math.min(nn(lockWeeks), nn(maxWeeks) || 208);
  const mw = nn(maxWeeks) || 208; if (mw <= 0) return 1;
  return round(1 + (Math.max(1, maxBoost) - 1) * (w / mw), 6);
}

/** No-loss lottery pot for an epoch = a cut of swap fees + a cut of the emission (operator: BOTH). */
export function lotteryPot({ swapFeesUsd, emissionToLottery, kulaPriceUsd, feeCutBps = 2000 } = {}) {
  const fromFees = round(nn(swapFeesUsd) * Math.min(BPS, Math.max(0, feeCutBps)) / BPS, 6);
  const fromEmission = round(nn(emissionToLottery) * nn(kulaPriceUsd), 6);
  return { fromFeesUsd: fromFees, fromEmissionUsd: fromEmission, potUsd: round(fromFees + fromEmission, 6) };
}

/** SBD-model peg safety. backingRatio = KULA market-cap claimable / treasury backing value.
 *  Steem's SBD broke when the debt ratio blew past its cap → apply a HAIRCUT above `capRatio`
 *  (the post-mortem fix). Returns the $ a unit of KULA can convert to, honoring the haircut. */
export function sbdConvert({ kulaAmount, pegUsd = 1, treasuryUsd, kulaSupply, capRatio = 0.1 } = {}) {
  const amt = nn(kulaAmount), peg = nn(pegUsd) || 1, treas = nn(treasuryUsd), supply = nn(kulaSupply);
  if (supply <= 0 || treas <= 0) return { perUnitUsd: 0, haircut: 1, debtRatio: 0, capped: true };
  const debtRatio = round((supply * peg) / treas, 6);            // claim value / backing
  const cap = Math.max(0.0001, nn(capRatio) || 0.1);
  // within cap → full peg; above cap → scale down so total claims never exceed cap*treasury (SBD haircut).
  const haircut = debtRatio <= cap ? 1 : round(cap / debtRatio, 6);
  const perUnitUsd = round(peg * haircut, 8);
  return { perUnitUsd, payoutUsd: round(amt * perUnitUsd, 6), haircut, debtRatio, capped: debtRatio > cap };
}

// Locking KULA → veKULA. Locking GRANTS three things (operator: "locking KULA does something too"):
//   1. yield boost on farm rewards (veBoost above),
//   2. governance vote weight to steer gauge emissions (GaugeController),
//   3. eligibility for the Token-A fee dividend.
// Vote weight = amount * (lockWeeks / maxWeeks) — linear decay model (veCRV), no n² whale capture.
export function veVoteWeight({ amount, lockWeeks, maxWeeks = 208 } = {}) {
  const mw = nn(maxWeeks) || 208;
  return round(nn(amount) * Math.min(nn(lockWeeks), mw) / mw, 6);
}

/** Lock summary: what a KULA lock yields (boost + vote weight). */
export function lockPosition({ amount, lockWeeks, maxWeeks = 208, maxBoost = 2.5 } = {}) {
  return {
    amount: nn(amount), lockWeeks: nn(lockWeeks),
    boost: veBoost({ lockWeeks, maxWeeks, maxBoost }),
    voteWeight: veVoteWeight({ amount, lockWeeks, maxWeeks }),
  };
}

// Burn PoL → redeem KULA (operator: "burning PoL Token can redeem KULA somehow"). This is PRANA's
// BurnMine model: an immutable fixed-ratio burn-to-mint, kulaOut = polIn * num / den. Burning PoL
// (the liquidity instrument) is a sink for PoL and a mint path for KULA — links the two tokens.
export function burnPolForKula({ polIn, num = 1, den = 1 } = {}) {
  const p = nn(polIn), n = nn(num), d = nn(den);
  if (p <= 0 || n <= 0 || d <= 0) return { kulaOut: 0, ratio: 0 };
  return { kulaOut: round(p * n / d, 8), ratio: round(n / d, 8), polBurned: round(p, 8) };
}

// Burn PoL → KULA LOTTO tickets (operator: "Burn PoL for KULA Lotto"). A deflationary burn-to-enter
// raffle: burn PoL to buy tickets; the prize is KULA (pot from fees + emissions, see lotteryPot). This
// is a PoL SINK + a KULA distribution + chance — distinct from the no-loss lotto (here the burned PoL is
// spent, not returned). Tickets are whole units; remainder PoL is not burned.
export function burnPolForTickets({ polIn, polPerTicket = 1 } = {}) {
  const p = nn(polIn), cost = nn(polPerTicket) || 1;
  const tickets = Math.floor(p / cost);
  return { tickets, polBurned: round(tickets * cost, 8), refund: round(p - tickets * cost, 8) };
}

/** Win chance for `myTickets` of `totalTickets` in the burn-lotto draw (single winner). */
export function lottoWinChance({ myTickets, totalTickets } = {}) {
  const mine = Math.max(0, Math.floor(nn(myTickets))), tot = Math.max(0, Math.floor(nn(totalTickets)));
  if (tot <= 0 || mine <= 0) return 0;
  return round(Math.min(1, mine / tot), 6);
}

if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('kula-farm.mjs')) {
  const split = emissionSplit({ emission: 1_000_000 });
  console.log('KULA epoch emission 1,000,000 split:', split);
  console.log('LP pool APR ($2M TVL, KULA $0.10, 30%/yr to pool of 50M/yr):',
    poolApr({ yearlyEmissionToPool: 50_000_000 * 0.3, kulaPriceUsd: 0.1, poolTvlUsd: 2_000_000 }) + '%');
  console.log('veBoost 1yr / 4yr:', veBoost({ lockWeeks: 52 }), veBoost({ lockWeeks: 208 }));
  console.log('SBD convert (healthy vs over-cap):',
    sbdConvert({ kulaAmount: 100, treasuryUsd: 1_000_000, kulaSupply: 50_000 }),
    sbdConvert({ kulaAmount: 100, treasuryUsd: 1_000_000, kulaSupply: 5_000_000 }));
}
