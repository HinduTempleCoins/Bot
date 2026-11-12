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
//   import { moveBudgetForEpoch, moveWeight, settle } from './move-economy.mjs';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
const num = (k, d) => { const v = Number(env(k, d)); return Number.isFinite(v) ? v : d; };

// ── emission + pool split (defaults are the live MELEK chain constants; override via env) ──────────
export const BLOCK_REWARD_MELEK = () => num('MELEK_BLOCK_REWARD', 1);          // 1.000 MELEK / block
export const BLOCKS_PER_DAY = () => num('MELEK_BLOCKS_PER_DAY', 21600);        // 86400s / 4s blocks
// The LIVE chain split, read off mainnet 2026-11-12 (dgpo content_reward_percent 5000,
// vesting_reward_percent 1500, sps_fund_percent 1000; move's 15% is MELEK_MOVE_FUND_PERCENT from HF24;
// the witness is paid the residual). The MELEK Drive flip changes three of these — see afterDriveFlip
// in economySummary() and MOVE_HARDFORK.md.
export const POOL_SPLIT = () => ({
  content: num('MELEK_CONTENT_PCT', 0.50),   // blog pool (authors + curators)
  move: num('MELEK_MOVE_PCT', 0.15),         // the chain-level "move" reward fund — walking
  vesting: num('MELEK_VESTING_PCT', 0.15),   // stakers' interest
  witness: num('MELEK_WITNESS_PCT', 0.10),   // block production ("mining")
  proposal: num('MELEK_PROPOSAL_PCT', 0.10), // the DAO (@melek.dao / SPS)
});
export const EPOCH_SEC = () => num('GEO_EPOCH_SEC', 3600);                     // hourly, matches the attester

export const dailyEmission = () => BLOCK_REWARD_MELEK() * BLOCKS_PER_DAY();
/** The blog pool's own daily size — what writers and curators split. 10,800.000 MELEK/day. */
export const blogPoolDaily = () => dailyEmission() * POOL_SPLIT().content;

// ── the walk lane's REAL budget ────────────────────────────────────────────────────────────────────
// This module used to compute "15% of the blog pool" = 87.75 MELEK/hour, which was the pre-HF24
// design. HF24 made Move its OWN chain-level reward fund at 15% of EMISSION, and HF25 pays it out
// through the `move_pay` attested op, where the chain draws up to
// MELEK_MOVE_EPOCH_PAY_CAP_AMOUNT = 150.000 MELEK per closed hour and splits THAT by walk-weight.
// The old number understated the pool a walker is splitting by 41.5%, so it is gone.
/** The move fund's share of emission (chain: MELEK_MOVE_FUND_PERCENT). */
export const MOVE_FUND_PCT = () => num('MOVE_FUND_PCT', 0.15);
/** What the chain draws from the move fund per closed hour (chain: MELEK_MOVE_EPOCH_PAY_CAP_AMOUNT). */
export const MOVE_EPOCH_CAP = () => num('MOVE_EPOCH_CAP', 150);
/** What flows INTO the move fund: 3,240.000 MELEK/day, 135.000/hour. */
export const moveFundInflowDaily = () => dailyEmission() * MOVE_FUND_PCT();
export const moveFundInflowPerHour = () => moveFundInflowDaily() / 24;
/** The most the walk lane can pay in a day: the cap, 24 times. 3,600.000 MELEK. */
export const moveBudgetDaily = () => MOVE_EPOCH_CAP() * 24;
/**
 * The pool one closed hour splits — the chain's per-epoch cap, which is what `move_pay` actually
 * draws while the fund is in funds (it held 315,877.950 MELEK on 2026-11-12, never once drawn).
 */
export const moveBudgetForEpoch = () => MOVE_EPOCH_CAP() * (EPOCH_SEC() / 3600);

// ── the move-weight (rshares analog) — STAKE-WEIGHTED, like vote weight ───────────────────────────
// A new walker with zero MELEK would otherwise earn nothing (0 stake = 0 rshares), which kills
// onboarding — so an effective-stake FLOOR gives everyone a baseline weight (mirrors the small
// delegation new chain accounts get). Walk more (boost) + hold more (stake) → bigger share.
export const STAKE_FLOOR = () => num('MOVE_STAKE_FLOOR', 100); // effective MELEK floor for new users

// ── the walk lane's reward shape, shared ──────────────────────────────────────────────────────────
// These three lived inside site/move-miner/server.mjs, which meant a second caller had to copy the
// tier table to pay anything into the walk lane. MELEK Ride credits a RIDER's trip distance into this
// same lane (operator, 2026-11-12: getting a ride counts as walking distance too), so the curve moved
// here — one definition, one env name, no drift between two servers.
/** Base weight granted for claiming a zone (env GEO_REWARD). */
export const GEO_REWARD = () => Math.max(0, Math.floor(num('GEO_REWARD', 10)));
/** How fast repeat claims inside one hour diminish (env GEO_DIMINISH_K). */
export const GEO_DIMINISH_K = () => num('GEO_DIMINISH_K', 1);
/** Step-count tiers → boost multiplier. A serious walker (50k steps) is worth 15x a standing one. */
export const STEP_BOOST_TIERS = [[1000, 1.2], [2000, 1.5], [5000, 2], [10000, 3], [15000, 4], [20000, 5], [25000, 6.5], [30000, 8], [40000, 11], [50000, 15]];
/** The boost a step count earns — the highest tier it reaches. */
export function stepBoost(steps) {
  const s = Number(steps) || 0;
  let m = 1;
  for (const [t, x] of STEP_BOOST_TIERS) { if (s >= t) m = x; else break; }
  return m;
}
/** The nth claim in an hour is worth 1/(1+k·n) of the first. */
export function diminishFor(mineIndex) {
  return 1 / (1 + GEO_DIMINISH_K() * Math.max(0, Number(mineIndex) || 0));
}

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
    // What the MELEK Drive flip changes (MOVE_HARDFORK.md §1). Walking and vesting do not move.
    afterDriveFlip: { content: 0.47, move: 0.15, vesting: 0.15, witness: 0.05, proposal: 0.03, drive: 0.15 },
    blogPoolDaily: blogPoolDaily(),
    moveFundPct: MOVE_FUND_PCT(),
    moveFundInflowPerHour: moveFundInflowPerHour(),
    moveFundInflowDaily: moveFundInflowDaily(),
    moveCapPerHour: MOVE_EPOCH_CAP(),
    moveBudgetDaily: moveBudgetDaily(),
    moveBudgetPerHour: moveBudgetForEpoch(),
    stakeWeighted: true,
    note: 'Move is 15% of EMISSION in the chain\'s own "move" reward fund — not a share of the blog pool. Each closed hour the chain draws up to 150.000 MELEK from that fund and splits it by stake-weighted move-weight, paid by the move_pay attested op.',
    capNote: 'The cap (150.000/hour, 3,600.000/day) is above the fund\'s inflow (135.000/hour, 3,240.000/day), so a fully-subscribed day draws the banked balance down by 360.000 MELEK.',
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
