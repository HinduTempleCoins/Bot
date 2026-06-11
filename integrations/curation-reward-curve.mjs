// curation-reward-curve.mjs — Backlog 3a63abf4e5:
//   "Curation-reward time-decay curve calculator".
//
// A PURE calculator for the Graphene curation-reward split of a single vote, based on WHEN
// the vote landed within the post's curation window — the early-voter reverse-auction
// penalty. Vote too early and a fraction of your curation reward is forfeited (redistributed
// to the reward pool / author on most forks). Vote at or after the window boundary and you
// keep full weight. No IO, no network, no chain calls — give it numbers, get numbers back.
//
// DISTINCT FROM:
//   • integrations/staked-vote-weight.mjs — stake → vote weight (how much a vote counts).
//   • engine/contracts/rewards.mjs        — author/curator POOL split (who gets which pool).
//   • engine/lib/reward-split.mjs         — splits a payout among parties.
// This module answers one narrow question: given a vote's rshares and its timing, what is
// its EFFECTIVE curation rshares (after the reverse-auction penalty), and what pro-rata
// slice of the curator pool does that earn?
//
// THE CURVE (linear reverse-auction, the classic Steem/Graphene model):
//   Let f = secondsSincePost / windowSeconds, clamped to 0..1.
//   effectiveRshares = voteRshares * f.
//   penaltyFraction  = 1 - f  (the share forfeited for voting early).
//   At the window boundary and beyond, f = 1 → no penalty, full weight.
//   Voting at t=0 (the instant of posting) forfeits everything (f=0).
//
// CURATION WINDOW (configurable constant, both historical values noted):
//   • Early Steem used a 30-minute reverse-auction window.
//   • Later forks shortened it to 5 minutes.
//   The default below is overridable per call via the windowSeconds argument.
//
// SOFT-FAIL: never throws. Non-finite / negative inputs are clamped to 0. A non-positive
// windowSeconds means "no penalty window" → every vote gets full weight. curationShare
// returns 0 when the total effective rshares is <= 0 (no division blow-up).
//
//   import { curationWeight, curationShare, optimalVoteDelay,
//            DEFAULT_WINDOW_SECONDS, WINDOW_SECONDS_STEEM_30M, WINDOW_SECONDS_5M }
//     from './curation-reward-curve.mjs'
//   node integrations/curation-reward-curve.mjs demo

// ── curation-window constants (configurable; both historical values documented) ──────────
export const WINDOW_SECONDS_STEEM_30M = 30 * 60; // 1800 — early Steem reverse-auction window
export const WINDOW_SECONDS_5M = 5 * 60;         //  300 — later-fork shortened window
// Default window is overridable per call. We default to the later, shorter 5-minute window;
// pass windowSeconds: WINDOW_SECONDS_STEEM_30M to model the early-Steem behavior.
export const DEFAULT_WINDOW_SECONDS = WINDOW_SECONDS_5M;

// ── numeric hygiene ──────────────────────────────────────────────────────────────────────
function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
// non-negative coercion: clamp NaN/negatives to 0.
function nonNeg(v) {
  const n = num(v, 0);
  return n > 0 ? n : 0;
}
function clamp01(n) {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

// ── curationWeight: effective rshares + forfeited fraction for one vote's timing ─────────
// { voteRshares, secondsSincePost, windowSeconds } → { effectiveRshares, penaltyFraction }
//   effectiveRshares = voteRshares * clamp(secondsSincePost / windowSeconds, 0..1)
//   penaltyFraction  = 1 - that clamped fraction (0 = full weight, 1 = everything forfeited)
// windowSeconds <= 0 (or non-finite) ⇒ no penalty window ⇒ full weight, zero penalty.
export function curationWeight({ voteRshares, secondsSincePost, windowSeconds = DEFAULT_WINDOW_SECONDS } = {}) {
  const rshares = nonNeg(voteRshares);
  const elapsed = nonNeg(secondsSincePost);
  const window = num(windowSeconds, 0);

  // No (or invalid) window → reverse-auction disabled → full credit.
  if (!(window > 0)) {
    return { effectiveRshares: rshares, penaltyFraction: 0 };
  }
  const frac = clamp01(elapsed / window);
  const effectiveRshares = rshares * frac;
  return { effectiveRshares, penaltyFraction: 1 - frac };
}

// ── curationShare: pro-rata slice of the curator pool this vote earns ─────────────────────
// { yourEffective, totalEffective, curatorPool } → tokens
//   tokens = curatorPool * (yourEffective / totalEffective)
// total <= 0 ⇒ 0 (no division by zero). yourEffective is clamped to totalEffective so a
// single vote can never claim more than the whole pool.
export function curationShare({ yourEffective, totalEffective, curatorPool } = {}) {
  const yours = nonNeg(yourEffective);
  const total = nonNeg(totalEffective);
  const pool = nonNeg(curatorPool);
  if (!(total > 0) || !(pool > 0) || yours <= 0) return 0;
  const capped = yours > total ? total : yours;
  return pool * (capped / total);
}

// ── optimalVoteDelay: the no-penalty boundary (seconds to wait to forfeit nothing) ────────
// { windowSeconds } → windowSeconds. Voting at or after this many seconds incurs zero
// penalty. A non-positive/invalid window ⇒ 0 (vote whenever; no window to wait out).
export function optimalVoteDelay({ windowSeconds = DEFAULT_WINDOW_SECONDS } = {}) {
  const window = num(windowSeconds, 0);
  return window > 0 ? window : 0;
}

// ── CLI worked example (guarded) ──────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const window = DEFAULT_WINDOW_SECONDS; // 5 minutes
  const rshares = 1_000_000;
  process.stdout.write(`Curation reverse-auction window: ${window}s (${window / 60} min)\n`);
  process.stdout.write(`Optimal vote delay (no penalty after): ${optimalVoteDelay({ windowSeconds: window })}s\n\n`);

  // One voter at varying delays, against a fixed field of "everyone else".
  const othersEffective = 4_000_000; // combined effective rshares of all other curators
  const pool = 100; // curator-pool tokens to split
  for (const t of [0, 60, 150, 300, 600]) {
    const { effectiveRshares, penaltyFraction } = curationWeight({
      voteRshares: rshares, secondsSincePost: t, windowSeconds: window,
    });
    const total = effectiveRshares + othersEffective;
    const tokens = curationShare({ yourEffective: effectiveRshares, totalEffective: total, curatorPool: pool });
    process.stdout.write(
      `t=${String(t).padStart(3)}s  eff=${effectiveRshares.toFixed(0).padStart(9)}  `
      + `penalty=${(penaltyFraction * 100).toFixed(0).padStart(3)}%  `
      + `reward=${tokens.toFixed(3)} tokens\n`,
    );
  }
}
