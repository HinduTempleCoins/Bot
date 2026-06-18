// move-economy.mjs — the MELEK Move reward economy (operator-set).
//
// DECISIONS encoded here (2026-06-18):
//   • Currency = MELEK (same coin as blogging — Move shares the blog pool, it is NOT a new token).
//   • Move budget = 15% OF THE BLOG POOL. The chain emits a FIXED 1 MELEK/block (Blurt-style linear
//     emission, 21,600 MELEK/day). Split: 65% content(blog) / 10% witness / 15% vesting / 10% DAO.
//     → blog pool = 14,040 MELEK/day; Move = 15% of that = 2,106 MELEK/day (~87.75/hour).
//   • Earnings are STAKE-WEIGHTED, like vote weight: a player's "move-weight" (the rshares analog) is
//     their MELEK stake × their activity (geo base × exponential step-boost × hourly diminishing).
//   • The fixed Move budget for an epoch is split PROPORTIONALLY to everyone's move-weight that epoch
//     (exactly how the content pool splits by rshares). Bounded: total payouts ≤ the budget. Hourly.
//
// This module is the PURE economic engine — emission/split math, the move-weight formula, and the
// proportional settlement. No network, no keys, no state (the daemon holds the per-epoch ledger and
// resolves each player's on-chain stake). Tested offline.
//
//   import { moveBudgetDaily, moveBudgetForEpoch, moveWeight, settle } from './move-economy.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const num = (k, d) => { const v = Number(env(k, d)); return Number.isFinite(v) ? v : d; };

// ── emission + pool split (defaults are the live MELEK chain constants; override via env) ──────────
export const BLOCK_REWARD_MELEK = () => num('MELEK_BLOCK_REWARD', 1);          // 1.000 MELEK / block
export const BLOCKS_PER_DAY = () => num('MELEK_BLOCKS_PER_DAY', 21600);        // 86400s / 4s blocks
export const POOL_SPLIT = () => ({
  content: num('MELEK_CONTENT_PCT', 0.65),   // blog pool (authors + curators)
  witness: num('MELEK_WITNESS_PCT', 0.10),   // block production ("mining")
  vesting: num('MELEK_VESTING_PCT', 0.15),   // stakers' interest
  proposal: num('MELEK_PROPOSAL_PCT', 0.10), // DAO / SPS
});
// Move takes this fraction OF the blog pool (operator: 15%).
export const MOVE_CARVE = () => num('MOVE_CARVE_PCT', 0.15);
export const EPOCH_SEC = () => num('GEO_EPOCH_SEC', 3600);                     // hourly, matches the attester

export const dailyEmission = () => BLOCK_REWARD_MELEK() * BLOCKS_PER_DAY();
export const blogPoolDaily = () => dailyEmission() * POOL_SPLIT().content;
/** The Move daily budget = 15% of the blog pool. ~2,106 MELEK/day at defaults. */
export const moveBudgetDaily = () => blogPoolDaily() * MOVE_CARVE();
/** The Move budget for one epoch (hour). ~87.75 MELEK/hour at defaults. */
export const moveBudgetForEpoch = () => moveBudgetDaily() * (EPOCH_SEC() / 86400);

// ── the move-weight (rshares analog) — STAKE-WEIGHTED, like vote weight ───────────────────────────
// A new walker with zero MELEK would otherwise earn nothing (0 stake = 0 rshares), which kills
// onboarding — so an effective-stake FLOOR gives everyone a baseline weight (mirrors the small
// delegation new chain accounts get). Walk more (boost) + hold more (stake) → bigger share.
export const STAKE_FLOOR = () => num('MOVE_STAKE_FLOOR', 100); // effective MELEK floor for new users

/**
 * A player's move-weight for one mine — the rshares analog the budget is split by.
 *   weight = (stake + floor) × geoBase × stepBoost × diminish
 * @param {{ stake?:number, geoBase?:number, stepBoost?:number, diminish?:number }} p
 */
export function moveWeight({ stake = 0, geoBase = 10, stepBoost = 1, diminish = 1 } = {}) {
  const effStake = Math.max(0, Number(stake) || 0) + STAKE_FLOOR();
  return effStake * (Number(geoBase) || 0) * (Number(stepBoost) || 0) * (Number(diminish) || 0);
}

/**
 * Settle an epoch: split the fixed Move budget across claims PROPORTIONALLY to move-weight (exactly
 * how the content pool divides by rshares). Bounded — Σ amounts ≤ budget. Pure.
 * @param {Array<{player:string, weight:number}>} claims
 * @param {number} [budget]  defaults to moveBudgetForEpoch()
 * @returns {{ budget:number, totalWeight:number, payouts:Array<{player,weight,amount,share}> }}
 */
export function settle(claims = [], budget = moveBudgetForEpoch()) {
  const valid = (Array.isArray(claims) ? claims : []).filter((c) => c && Number(c.weight) > 0);
  const totalWeight = valid.reduce((s, c) => s + Number(c.weight), 0);
  if (totalWeight <= 0) return { budget, totalWeight: 0, payouts: [] };
  const payouts = valid.map((c) => {
    const share = Number(c.weight) / totalWeight;
    return { player: c.player, weight: Number(c.weight), share, amount: budget * share };
  });
  return { budget, totalWeight, payouts };
}

/** A plain breakdown of the whole economy at current params — for /economy endpoints + the report. */
export function economySummary() {
  const split = POOL_SPLIT();
  return {
    blockRewardMelek: BLOCK_REWARD_MELEK(),
    dailyEmission: dailyEmission(),
    split,
    blogPoolDaily: blogPoolDaily(),
    moveCarvePct: MOVE_CARVE(),
    moveBudgetDaily: moveBudgetDaily(),
    moveBudgetPerHour: moveBudgetForEpoch(),
    stakeWeighted: true,
    note: 'Move = 15% of the blog pool, in MELEK, split by stake-weighted move-weight (like vote weight).',
  };
}

if (process.argv[1] && process.argv[1].endsWith('move-economy.mjs')) {
  console.log(JSON.stringify(economySummary(), null, 2));
  console.log('\nexample settlement (hourly budget, 3 walkers):');
  const claims = [
    { player: 'whale', weight: moveWeight({ stake: 10000, stepBoost: 3, diminish: 1 }) },
    { player: 'midstake', weight: moveWeight({ stake: 1000, stepBoost: 5, diminish: 1 }) },
    { player: 'newbie', weight: moveWeight({ stake: 0, stepBoost: 15, diminish: 1 }) },
  ];
  for (const p of settle(claims).payouts) console.log(`  ${p.player.padEnd(9)} ${p.amount.toFixed(3)} MELEK  (${(p.share * 100).toFixed(1)}%)`);
}
