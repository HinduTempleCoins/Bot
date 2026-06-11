// staked-vote-weight.mjs — Backlog 5103031115 (items 343 / 348):
//   "staking mechanics with curation" / "build voting logic based on staked tokens".
//
// A PURE resolver that converts staked tokens → a vote weight (a 0..1 share of the pool)
// and tallies a set of weighted votes into a for/against/abstain outcome with quorum
// gating. No IO, no network, no chain calls — give it numbers, get numbers back.
//
// DISTINCT FROM:
//   • voting_rules/curation-engine.mjs — that scores POSTS for curation reward.
//   • engine/lib/reward-split.mjs       — that splits a PAYOUT among parties.
// This module does neither. It answers one question: given how much someone has staked,
// how much should their vote count, and what is the collective outcome?
//
// THE THREE WEIGHTING MODELS (encoded, not configured-by-policy-text):
//   • 'linear' — vote weight ∝ stake. One token, one vote. Whales dominate.
//   • 'sqrt'   — vote weight ∝ √stake. Quadratic-voting damping: large holders get
//                proportionally less marginal weight, spreading influence toward smaller
//                stakers without disenfranchising size.
//   • 'log'    — vote weight ∝ ln(1 + stake). Even stronger damping than sqrt; the long
//                tail of small stakers matters most.
//
// SOFT-FAIL: never throws. Negative / non-finite stake is clamped to 0. An unknown model
// falls back to 'linear'. An empty tally returns a well-formed zeroed result with
// quorumMet:false, passed:false.
//
//   import { voteWeight, tally, effectiveStake, normalizeWeights, MODELS }
//     from './staked-vote-weight.mjs'
//   node integrations/staked-vote-weight.mjs demo

export const MODELS = Object.freeze(['linear', 'sqrt', 'log']);

// ── numeric hygiene ────────────────────────────────────────────────────────────────────
function num(v, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
// stake is never negative; clamp and coerce non-finite → 0.
function cleanStake(v) {
  const n = num(v, 0);
  return n > 0 ? n : 0;
}
function pickModel(model) {
  return MODELS.includes(model) ? model : 'linear';
}

// The model "curve" — maps a raw stake to an un-normalized weight.
function curve(stake, model) {
  const s = cleanStake(stake);
  switch (pickModel(model)) {
    case 'sqrt': return Math.sqrt(s);
    case 'log':  return Math.log1p(s); // ln(1 + s): 0 at s=0, monotonic
    case 'linear':
    default:     return s;
  }
}

// ── voteWeight: a single staker's 0..1 share of the pool ─────────────────────────────────
// share = curve(stake) / curve(totalStake-as-if-one-holder is NOT meaningful), so we
// normalize against the curve of the total pool measured the SAME way the individual is
// measured. That keeps a lone staker at 1.0 and is monotonic per model.
export function voteWeight({ stake, totalStake, model = 'linear' } = {}) {
  const m = pickModel(model);
  const mine = curve(stake, m);
  const totalRaw = cleanStake(totalStake);
  // If no/total invalid, fall back to mine vs mine (lone staker → 1, none → 0).
  const denom = totalRaw > 0 ? curve(totalRaw, m) : mine;
  if (!(denom > 0)) return 0;
  const share = mine / denom;
  if (!Number.isFinite(share) || share <= 0) return 0;
  return share > 1 ? 1 : share;
}

// ── effectiveStake: linear stake-age maturation ─────────────────────────────────────────
// Newly-staked tokens count less; weight ramps linearly from 0→full over maxAgeDays.
// effective = stake * clamp(ageDays / maxAgeDays, 0..1).  maxAgeDays<=0 → fully mature.
export function effectiveStake({ stake, ageDays, maxAgeDays = 30 } = {}) {
  const s = cleanStake(stake);
  const max = num(maxAgeDays, 0);
  if (s === 0) return 0;
  if (!(max > 0)) return s; // no maturation window → already mature
  const age = cleanStake(ageDays);
  const frac = age >= max ? 1 : age / max;
  return s * frac;
}

// ── normalizeWeights: scale a set of weights so they sum to 1 ────────────────────────────
// Accepts votes[] of { weight } (or bare numbers) and returns a same-length array of the
// normalized 0..1 shares. All-zero / empty → array of zeros (no division blow-up).
export function normalizeWeights(votes) {
  const arr = Array.isArray(votes) ? votes : [];
  const raw = arr.map((v) => {
    const w = typeof v === 'number' ? v : (v && typeof v === 'object' ? v.weight : 0);
    return cleanStake(w);
  });
  const sum = raw.reduce((a, b) => a + b, 0);
  if (!(sum > 0)) return raw.map(() => 0);
  return raw.map((w) => w / sum);
}

const CHOICES = Object.freeze(['for', 'against', 'abstain']);
function pickChoice(c) {
  const s = typeof c === 'string' ? c.toLowerCase().trim() : '';
  if (s === 'yes' || s === 'for' || s === 'yea') return 'for';
  if (s === 'no' || s === 'against' || s === 'nay') return 'against';
  if (s === 'abstain' || s === 'present') return 'abstain';
  return 'abstain'; // unknown → counts toward turnout but neither side
}

// ── tally: weighted for/against/abstain outcome with quorum gating ───────────────────────
// votes: [{ stake, choice, ageDays? }, ...]  — each voter's stake + their choice.
// opts:
//   model      — weighting model applied to each voter's stake (default 'linear')
//   quorum     — 0..1 fraction of total weight that must participate (non-abstain) for the
//                vote to be valid. default 0 (no quorum). Abstentions count as turnout but
//                NOT toward the for/against decision.
//   maxAgeDays — if set (>0), each stake is matured via effectiveStake() before weighting.
//   threshold  — 0..1 share of (for+against) needed to PASS. default 0.5 (simple majority).
//   countAbstainInQuorum — if true, abstain votes count toward quorum turnout. default true.
// Returns { forPct, againstPct, abstainPct, totalWeight, quorumMet, passed }.
//   forPct/againstPct/abstainPct are 0..1 shares of TOTAL weight (sum to ~1 when any votes).
export function tally(votes, opts = {}) {
  const out = {
    forPct: 0, againstPct: 0, abstainPct: 0,
    totalWeight: 0, quorumMet: false, passed: false,
  };
  const arr = Array.isArray(votes) ? votes : [];
  if (arr.length === 0) return out;

  const model = pickModel(opts.model);
  const quorum = Math.min(Math.max(num(opts.quorum, 0), 0), 1);
  const threshold = Math.min(Math.max(num(opts.threshold, 0.5), 0), 1);
  const maxAgeDays = num(opts.maxAgeDays, 0);
  const countAbstainInQuorum = opts.countAbstainInQuorum !== false;

  let wFor = 0, wAgainst = 0, wAbstain = 0;
  for (const v of arr) {
    if (!v || typeof v !== 'object') continue;
    const matured = maxAgeDays > 0
      ? effectiveStake({ stake: v.stake, ageDays: v.ageDays, maxAgeDays })
      : cleanStake(v.stake);
    const w = curve(matured, model);
    if (!(w > 0)) continue;
    switch (pickChoice(v.choice)) {
      case 'for':     wFor += w; break;
      case 'against': wAgainst += w; break;
      default:        wAbstain += w; break;
    }
  }

  const total = wFor + wAgainst + wAbstain;
  out.totalWeight = total;
  if (!(total > 0)) return out;

  out.forPct = wFor / total;
  out.againstPct = wAgainst / total;
  out.abstainPct = wAbstain / total;

  // Quorum: participating weight as a fraction of total weight.
  const participating = countAbstainInQuorum ? total : (wFor + wAgainst);
  const turnoutFrac = total > 0 ? participating / total : 0;
  out.quorumMet = quorum <= 0 ? true : turnoutFrac >= quorum;

  // Pass: decided among for+against only; needs quorum AND share >= threshold.
  const decided = wFor + wAgainst;
  const forOfDecided = decided > 0 ? wFor / decided : 0;
  out.passed = out.quorumMet && decided > 0 && forOfDecided >= threshold;

  return out;
}

// ── CLI demo (guarded) ───────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const sample = [
    { stake: 1000, choice: 'for' },
    { stake: 250, choice: 'for' },
    { stake: 400, choice: 'against' },
    { stake: 100, choice: 'abstain' },
  ];
  for (const model of MODELS) {
    const r = tally(sample, { model, quorum: 0.5, threshold: 0.5 });
    process.stdout.write(`${model.padEnd(7)} → for ${(r.forPct * 100).toFixed(1)}%  `
      + `against ${(r.againstPct * 100).toFixed(1)}%  passed=${r.passed}\n`);
  }
}
