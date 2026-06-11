// account-trust.mjs — PURE, deterministic per-account trust score (0..100) for the MELEK witness.
// No network, no chain calls, no keys, no I/O, no LLM. Backlog 533284e198.
//
// PURPOSE (read before changing numbers):
//   Hathor and Cheetah need to rank repliers and gate karma WITHOUT an LLM and WITHOUT touching
//   any private info. This module turns a handful of OBSERVABLE, non-PII chain signals into a
//   single 0..100 trust score plus a coarse band. It is descriptive, deterministic and monotonic.
//
//   This is NOT karma and NOT scarcity-score:
//     - karma/                tracks accumulated XP / reward (how much you've earned).
//     - integrations/scarcity-score.mjs  scores a TOKEN's supply defensibility.
//     - account-trust         scores a PERSON/peer's *trustworthiness* from their account shape,
//                             so we know how much weight to give their reply and whether to gate
//                             an autonomous grant. Different inputs, different question.
//
// SIGNALS (all observable, no PII):
//     1. ACCOUNT AGE   — older accounts are harder to spin up at scale. Saturating curve.
//     2. ACTIVITY      — real posts/comments/votes. Log-saturating (a few is good, spam plateaus).
//     3. ENDORSEMENTS  — distinct accounts that vouched. Saturating.
//   − 4. REPORTS       — distinct flags against the account. A PENALTY subtracted at the end.
//     5. STAKE         — fraction of self-held stake (0..1): skin in the game.
//
// MODEL: score = 100 * ( w.accountAge*ageScore + w.activity*activityScore
//                        + w.endorsements*endorsementScore + w.stake*clamp01(stakeFraction)
//                        − w.reports*reportPenalty ).
//   Weights sum to 1. Monotonic: more age/activity/endorsements/stake never lowers the score;
//   more reports never raises it. Rounded to 2dp, clamped to [0,100].
//
// SOFT-FAIL, NEVER THROW: NaN / negative / missing / wrong-type inputs collapse to 0 (or safe
//   defaults). The functions always return a well-formed value.
//
//   import { trustScore, band, compare, renderBadge } from './integrations/account-trust.mjs';
//   const r = trustScore({ accountAgeDays: 365, posts: 40, comments: 200, votes: 900,
//                          endorsements: 12, reports: 0, stakeFraction: 0.2 });
//   // -> { score, band, components:{...} }
//
// CLI:  node integrations/account-trust.mjs        # print a worked example

// ── HTML escape: used by renderBadge for any interpolated value ─────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── weights (sum to 1; tune here, monotonicity preserved) ───────────────────────────────────────
export const DEFAULT_WEIGHTS = Object.freeze({
  accountAge: 0.2,
  activity: 0.25,
  endorsements: 0.25,
  reports: 0.15,
  stake: 0.15,
});

// ── safe numeric coercion: anything non-finite or < 0 → 0 ───────────────────────────────────────
function num(x) {
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isFinite(n) || n < 0) return 0;
  return n;
}

export function clamp01(x) {
  const n = typeof x === 'number' ? x : Number(x);
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

function round2(x) {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

// ── component curves (each returns 0..1, monotonic non-decreasing in its input) ─────────────────

// Account age: saturating. 0 days → 0; ~90 days → 0.5; grows toward 1, never reaches it.
export function ageScore(accountAgeDays) {
  const d = num(accountAgeDays);
  return clamp01(1 - 1 / (1 + d / 90));
}

// Activity: log-saturating over a weighted blend of posts/comments/votes. A handful matters;
// spam volume plateaus. ~ this many weighted actions → 0.5; grows toward 1.
const ACTIVITY_HALF = 50; // weighted actions at which activityScore ≈ 0.5
export function activityScore({ posts, comments, votes } = {}) {
  // Posts are the strongest signal of real participation, then comments, then votes.
  const weighted = 3 * num(posts) + 2 * num(comments) + 1 * num(votes);
  // log curve: ln(1+x) / ln(1+x + HALF) style — monotonic, saturating in [0,1).
  const v = Math.log1p(weighted);
  const half = Math.log1p(ACTIVITY_HALF);
  return clamp01(v / (v + half));
}

// Endorsements: distinct vouches. Saturating; ~10 → 0.5.
const ENDORSE_HALF = 10;
export function endorsementScore(endorsements) {
  const e = num(endorsements);
  return clamp01(e / (e + ENDORSE_HALF));
}

// Reports: distinct flags. Returns a 0..1 PENALTY magnitude (NOT a trust contribution).
// 0 reports → 0 penalty; grows toward 1; ~5 → 0.5. The caller subtracts (weight * penalty).
const REPORT_HALF = 5;
export function reportPenalty(reports) {
  const r = num(reports);
  return clamp01(r / (r + REPORT_HALF));
}

// ── bands ───────────────────────────────────────────────────────────────────────────────────────
// 0–20 new, 20–40 low, 40–60 medium, 60–80 high, 80–100 trusted.
// Boundaries assigned to the UPPER band (e.g. exactly 20 → 'low', exactly 80 → 'trusted').
export function band(score) {
  const s = num(score);
  if (s >= 80) return 'trusted';
  if (s >= 60) return 'high';
  if (s >= 40) return 'medium';
  if (s >= 20) return 'low';
  return 'new';
}

// ── normalize weights: drop bad entries, fall back to defaults, renormalize to sum 1 ────────────
function resolveWeights(weights) {
  if (!weights || typeof weights !== 'object') return DEFAULT_WEIGHTS;
  const keys = ['accountAge', 'activity', 'endorsements', 'reports', 'stake'];
  const w = {};
  let total = 0;
  for (const k of keys) {
    const v = num(weights[k]);
    w[k] = v;
    total += v;
  }
  if (total <= 0) return DEFAULT_WEIGHTS; // all garbage → defaults
  for (const k of keys) w[k] = w[k] / total; // renormalize so they sum to 1
  return w;
}

// ── main: 0..100 trust score ────────────────────────────────────────────────────────────────────
export function trustScore(input = {}) {
  const src = input && typeof input === 'object' ? input : {};
  const w = resolveWeights(src.weights);

  const age = ageScore(src.accountAgeDays);
  const activity = activityScore({ posts: src.posts, comments: src.comments, votes: src.votes });
  const endorse = endorsementScore(src.endorsements);
  const stake = clamp01(src.stakeFraction);
  const penalty = reportPenalty(src.reports);

  const positive = w.accountAge * age + w.activity * activity + w.endorsements * endorse + w.stake * stake;
  const negative = w.reports * penalty;
  let score = 100 * (positive - negative);
  if (!Number.isFinite(score) || score < 0) score = 0;
  if (score > 100) score = 100;
  score = round2(score);

  return {
    score,
    band: band(score),
    components: {
      ageScore: round2(age),
      activityScore: round2(activity),
      endorsementScore: round2(endorse),
      stakeScore: round2(stake),
      reportPenalty: round2(penalty),
    },
  };
}

// ── comparator for Array.prototype.sort: higher trust first ─────────────────────────────────────
// Accepts either trustScore results ({score}) or raw inputs (scored on the fly). Soft-fails:
// missing/garbage → score 0. Stable-friendly: equal scores compare 0.
export function compare(a, b) {
  const sa = scoreOf(a);
  const sb = scoreOf(b);
  return sb - sa; // descending
}

function scoreOf(x) {
  if (x && typeof x === 'object') {
    if (typeof x.score === 'number' && Number.isFinite(x.score)) return x.score;
    return trustScore(x).score;
  }
  return 0;
}

// ── one-line HTML badge (all interpolation esc()'d) ─────────────────────────────────────────────
export function renderBadge(account, result) {
  const name = esc(account);
  const r = result && typeof result === 'object' ? result : {};
  const score = round2(num(r.score));
  const bnd = esc(r.band || band(score));
  return `<span class="trust-badge trust-${bnd}" title="${name}: ${score}/100 trust">${name} — ${score}/100 (${bnd})</span>`;
}

// ── CLI demo (guarded; stdout only) ─────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const samples = [
    { account: 'veteran', accountAgeDays: 900, posts: 120, comments: 800, votes: 5000, endorsements: 40, reports: 0, stakeFraction: 0.4 },
    { account: 'newcomer', accountAgeDays: 3, posts: 0, comments: 2, votes: 5, endorsements: 0, reports: 0, stakeFraction: 0 },
    { account: 'flagged', accountAgeDays: 200, posts: 30, comments: 100, votes: 400, endorsements: 5, reports: 12, stakeFraction: 0.1 },
  ];
  const ranked = samples
    .map((s) => ({ account: s.account, ...trustScore(s) }))
    .sort(compare);
  for (const r of ranked) console.log(renderBadge(r.account, r));
}
