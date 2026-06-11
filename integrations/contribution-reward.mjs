// contribution-reward.mjs — data-contribution reward POINTS calculator (backlog c0c59243fa;
// queues "Token rewards for data contributions" / "Reward community engagement").
//
// PURE, deterministic, off-chain. This module computes a POINTS score for each accepted data
// contribution and splits a reward pool pro-rata. It is the SCORING input that FEEDS a later
// vote/grant decision — it is NOT itself an on-chain op. The chain side (a standard Graphene
// `vote`/`transfer`/`comment`, broadcast elsewhere) consumes these numbers; this file never
// touches the chain, never signs, never holds a key, never hits the network.
//
// The score rewards substance (words written), citation (sources linked), and originality
// (novelty), with a per-accepted-contribution base. Rejected contributions score ZERO — we never
// pay for what the reviewers turned down. Everything soft-fails to 0 / [] and NEVER throws.
//
//   import { scoreContribution, rankContributions, poolSplit, WEIGHTS } from './contribution-reward.mjs'
//   node integrations/contribution-reward.mjs        # prints a worked example
//
// The DEFAULT weights below are documented inline and overridable per-call via an `opts` arg, so a
// curation-rules change is a one-object override, not a code edit.

// --- HTML escape (house rule: esc() any interpolation; the CLI prints plain text but we keep the
//     helper exported so any future render path is escaped) ------------------------------------
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- numeric coercion: anything non-finite (NaN, Infinity, null, "abc") -> a safe fallback ------
function num(x, fallback = 0) {
  const n = Number(x);
  return Number.isFinite(n) ? n : fallback;
}
// Clamp to a [lo, hi] range after coercion.
function clamp(x, lo, hi, fallback = 0) {
  const n = num(x, fallback);
  return n < lo ? lo : n > hi ? hi : n;
}

// --- DEFAULT weights (the curation policy floor) ------------------------------------------------
// All overridable via the `opts` arg to scoreContribution. Documented inline:
export const WEIGHTS = {
  base: 10,            // flat points for ANY accepted contribution — showing up counts.
  perWord: 0.1,        // points per word of substance...
  wordCap: 50,         // ...but capped, so length alone can't farm the pool (max wordCap points).
  perSource: 5,        // points per CITED source — citation is rewarded (Cheetah-style credit-first).
  sourceCap: 30,       // cap on citation points, so link-spam can't farm the pool either.
  // novelty in [0..1] becomes a MULTIPLIER applied to the (word + source + base) subtotal:
  //   multiplier = noveltyFloor + noveltyRange * novelty
  // novelty=0 -> noveltyFloor (a duplicate still earns its floor, never negative); novelty=1 -> full.
  noveltyFloor: 0.5,   // a fully-unoriginal-but-accepted contribution keeps half its points.
  noveltyRange: 0.5,   // the remaining half is earned by novelty (floor + range = 1.0 at novelty=1).
};

// Resolve effective weights = DEFAULT WEIGHTS overlaid with any caller opts. Unknown/garbage opt
// values fall back to the default for that key (soft, never throws).
function resolveWeights(opts) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const w = { ...WEIGHTS };
  for (const k of Object.keys(WEIGHTS)) {
    if (o[k] !== undefined) w[k] = num(o[k], WEIGHTS[k]);
  }
  return w;
}

// --- scoreContribution: one contribution -> a non-negative points number ------------------------
//
// contribution: { words, sources, novelty, accepted }
//   words    : count of words of substance (number; or an array — its .length is used).
//   sources  : count of cited sources    (number; or an array — its .length is used).
//   novelty  : originality in [0..1]      (clamped; out-of-range coerced into range).
//   accepted : boolean — REJECTED (or missing/false) => 0 points, always.
//
// Returns a finite number >= 0 (never NaN, never negative, never throws). `opts` overrides WEIGHTS.
export function scoreContribution(contribution, opts) {
  try {
    const c = (contribution && typeof contribution === 'object') ? contribution : {};
    // Rejected, or not explicitly accepted, pays nothing.
    if (c.accepted !== true) return 0;

    const w = resolveWeights(opts);

    // words/sources may be given as a count OR as an array (we take its length). Negatives -> 0.
    const words = Math.max(0, num(Array.isArray(c.words) ? c.words.length : c.words, 0));
    const sources = Math.max(0, num(Array.isArray(c.sources) ? c.sources.length : c.sources, 0));
    const novelty = clamp(c.novelty, 0, 1, 0);

    const wordPts = Math.min(words * w.perWord, w.wordCap);
    const sourcePts = Math.min(sources * w.perSource, w.sourceCap);
    const subtotal = w.base + wordPts + sourcePts;

    const multiplier = w.noveltyFloor + w.noveltyRange * novelty;
    const points = subtotal * multiplier;

    return Number.isFinite(points) && points > 0 ? points : 0;
  } catch {
    return 0;
  }
}

// --- rankContributions: list -> same list sorted desc by points, each with {rank} ---------------
//
// STABLE: ties are broken by ORIGINAL input order (so rank is deterministic and reproducible).
// Each returned element is the ORIGINAL contribution object augmented with:
//   { points, rank }   (rank is 1-based; equal points get sequential ranks in input order).
// Non-array / empty input -> []. Never throws. `opts` is forwarded to scoreContribution.
export function rankContributions(list, opts) {
  try {
    const arr = Array.isArray(list) ? list : [];
    const scored = arr.map((c, i) => ({
      original: c,
      idx: i,
      points: scoreContribution(c, opts),
    }));
    // Sort by points desc; ties -> original index asc (stable).
    scored.sort((a, b) => (b.points - a.points) || (a.idx - b.idx));
    return scored.map((s, i) => ({
      ...(s.original && typeof s.original === 'object' ? s.original : {}),
      points: s.points,
      rank: i + 1,
    }));
  } catch {
    return [];
  }
}

// --- poolSplit: distribute a reward pool pro-rata to points -------------------------------------
//
// poolSplit({ scores, pool }):
//   scores : array of point numbers (or objects with a .points field — both accepted).
//   pool   : total reward to distribute (number).
// Returns an array (aligned with `scores`) of payouts, each = pool * (points_i / sum_points).
//   - sum of points <= 0  -> every payout is 0 (we never divide by zero, never invent value).
//   - any non-finite / negative point -> treated as 0 for its share.
//   - pool non-finite/negative -> treated as 0 (all payouts 0).
// Payouts are always finite numbers >= 0 — NEVER NaN. Never throws.
export function poolSplit({ scores, pool } = {}) {
  try {
    const arr = Array.isArray(scores) ? scores : [];
    const pts = arr.map((s) => {
      const v = (s && typeof s === 'object') ? s.points : s;
      return Math.max(0, num(v, 0));
    });
    const total = pts.reduce((a, b) => a + b, 0);
    const poolAmt = Math.max(0, num(pool, 0));

    if (!(total > 0) || !(poolAmt > 0)) return pts.map(() => 0);

    return pts.map((p) => {
      const share = poolAmt * (p / total);
      return Number.isFinite(share) && share > 0 ? share : 0;
    });
  } catch {
    return Array.isArray(scores) ? scores.map(() => 0) : [];
  }
}

// --- CLI (guarded; worked example) --------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('contribution-reward.mjs')) {
  const sample = [
    { id: 'alice', words: 800, sources: 5, novelty: 0.9, accepted: true },
    { id: 'bob', words: 120, sources: 1, novelty: 0.4, accepted: true },
    { id: 'carol', words: 2000, sources: 12, novelty: 0.2, accepted: true },
    { id: 'dave', words: 500, sources: 3, novelty: 0.7, accepted: false }, // rejected -> 0
  ];

  console.log('Data-contribution reward points — worked example\n');
  console.log('Default weights:', JSON.stringify(WEIGHTS));
  console.log('');

  const ranked = rankContributions(sample);
  console.log('Ranked contributions:');
  for (const r of ranked) {
    console.log(`  #${r.rank}  ${String(r.id).padEnd(6)} points=${r.points.toFixed(2)}  (accepted=${r.accepted === true})`);
  }

  const pool = 1000;
  const payouts = poolSplit({ scores: ranked, pool });
  console.log(`\nPool split of ${pool} points pro-rata:`);
  ranked.forEach((r, i) => {
    console.log(`  ${String(r.id).padEnd(6)} -> ${payouts[i].toFixed(2)}`);
  });
  const distributed = payouts.reduce((a, b) => a + b, 0);
  console.log(`  (total distributed: ${distributed.toFixed(2)} — rejected contributions get 0)`);

  console.log('\nNote: these are OFF-CHAIN points that feed a later vote/grant. Not an on-chain op.');
}
