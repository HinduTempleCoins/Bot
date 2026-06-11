/**
 * voting_rules/daily-vote-budget.mjs — Hathor's daily vote budget / RC-aware cap.
 *
 * A pure PLANNER enforcing Surface-3's "daily vote cap" and "respect
 * bandwidth/RC" policy WITHOUT touching the chain. Given a set of merit-scored
 * candidates, a per-day vote cap, and an RC (Resource Credits) budget, it
 * selects the highest-merit candidates until either the day-cap or the RC
 * budget is exhausted, and reports why everything else was skipped.
 *
 * What this module is — and is NOT:
 *  - IS: pure selection math. Deterministic, offline, soft-fail. Emits a plan
 *    of vote INTENTS plus a clamped Graphene vote weight per approved vote.
 *  - IS NOT: a broadcaster. Voting is a `vote` op needing posting authority
 *    (Hathor's posting key, held by MELEK-Signer — zero WIF in this repo, per
 *    CLAUDE.md key custody). This module never signs, never reads, never
 *    touches the chain. The plan it emits is what a key-gated signer consumes.
 *
 * House style: ESM, soft-fail (never throws on bad input — clamps to 0 / skips),
 * esc() any HTML interpolation, deterministic for the same inputs, CLI guarded
 * by process.argv[1]. Offline tests in daily-vote-budget.test.mjs.
 */

/** Graphene vote-weight bounds (percent ×100). We only upvote: 0..10000. */
export const MAX_WEIGHT = 10000;

/** Coerce to a finite non-negative number; anything bad -> 0. */
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** HTML-escape for any interpolation into markup (reasons, names in reports). */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Clamp a merit score to a Graphene vote weight (percent ×100), integer.
 * merit is treated as a 0..100 percent; min/max bound the *weight* in 0..10000.
 * Soft-fail: NaN/missing merit -> min; out-of-range merit clamps to the bounds.
 */
export function voteWeightFor(merit, { min = 1, max = MAX_WEIGHT } = {}) {
  let lo = Math.trunc(num(min, 1));
  let hi = Math.trunc(num(max, MAX_WEIGHT));
  // Hard clamp the bounds themselves into the legal Graphene range.
  lo = Math.max(0, Math.min(MAX_WEIGHT, lo));
  hi = Math.max(0, Math.min(MAX_WEIGHT, hi));
  if (lo > hi) [lo, hi] = [hi, lo];
  const pct = Math.max(0, Math.min(100, num(merit, 0)));
  const weight = Math.round(pct * 100); // percent -> percent×100
  return Math.max(lo, Math.min(hi, weight));
}

/**
 * Normalize a raw candidate into {name, merit}. Soft-fail: missing/NaN merit
 * clamps to 0; missing name -> ''. Original object is preserved as `src`.
 */
function normCandidate(c, i) {
  const o = c && typeof c === 'object' ? c : {};
  const name = typeof o.name === 'string' ? o.name : (o.name == null ? '' : String(o.name));
  return { name, merit: Math.max(0, num(o.merit, 0)), src: o, _i: i };
}

/**
 * Deterministic ordering: descending merit, then ascending name (tie-break).
 * Stable final tiebreak on original index so equal name+merit keep input order.
 */
function meritThenName(a, b) {
  if (b.merit !== a.merit) return b.merit - a.merit;
  if (a.name < b.name) return -1;
  if (a.name > b.name) return 1;
  return a._i - b._i;
}

/**
 * planVotes — select highest-merit candidates until the day-cap or RC budget
 * is exhausted.
 *
 * @param {object} args
 * @param {Array}  args.candidates       — [{name, merit}, ...]
 * @param {number} args.maxVotesPerDay   — hard cap on number of votes (>=0)
 * @param {number} args.rcAvailable      — RC budget available this run (>=0)
 * @param {number} args.rcPerVote        — RC cost per vote (>=0)
 * @param {number} args.minMerit         — candidates below this are skipped
 * @returns {{approved:Array, skipped:Array<{name,reason}>}}
 *
 * Soft-fail: missing/NaN numeric fields clamp to 0; empty/non-array candidates
 * -> empty plan; never throws.
 */
export function planVotes({
  candidates,
  maxVotesPerDay,
  rcAvailable,
  rcPerVote,
  minMerit,
} = {}) {
  const cap = Math.max(0, Math.trunc(num(maxVotesPerDay, 0)));
  const rcBudget = Math.max(0, num(rcAvailable, 0));
  const cost = Math.max(0, num(rcPerVote, 0));
  const floor = Math.max(0, num(minMerit, 0));

  const approved = [];
  const skipped = [];

  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return { approved, skipped };

  const ranked = list.map(normCandidate).sort(meritThenName);

  let rcLeft = rcBudget;
  for (const c of ranked) {
    const entry = { name: c.name, merit: c.merit };
    if (c.merit < floor) {
      skipped.push({ name: c.name, reason: 'below-min-merit' });
      continue;
    }
    if (approved.length >= cap) {
      skipped.push({ name: c.name, reason: 'daily-cap' });
      continue;
    }
    if (cost > rcLeft) {
      skipped.push({ name: c.name, reason: 'rc-exhausted' });
      continue;
    }
    rcLeft -= cost;
    approved.push({
      name: c.name,
      merit: c.merit,
      weight: voteWeightFor(c.merit),
      rcCost: cost,
    });
  }

  return { approved, skipped, rcCap: cap, rcPerVote: cost, rcAfter: rcLeft };
}

/**
 * rcAfter — remaining RC after executing a plan from planVotes(). Pure: sums
 * the per-vote rcCost of approved entries against the plan's known budget if
 * present, else recomputes from approved entries. Soft-fail: bad plan -> 0.
 */
export function rcAfter(plan, rcAvailable) {
  if (!plan || typeof plan !== 'object') return 0;
  const approved = Array.isArray(plan.approved) ? plan.approved : [];
  const spent = approved.reduce((s, a) => s + Math.max(0, num(a && a.rcCost, 0)), 0);
  // Prefer an explicit budget arg; else use the value planVotes recorded.
  const budget = rcAvailable != null
    ? Math.max(0, num(rcAvailable, 0))
    : Math.max(0, num(plan.rcAfter, 0)) + spent;
  return Math.max(0, budget - spent);
}

/* CLI: tiny demo, guarded so importing for tests does nothing. */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const demo = planVotes({
    candidates: [
      { name: 'alice', merit: 80 },
      { name: 'bob', merit: 95 },
      { name: 'carol', merit: 95 },
      { name: 'dave', merit: 10 },
    ],
    maxVotesPerDay: 2,
    rcAvailable: 1000,
    rcPerVote: 300,
    minMerit: 20,
  });
  console.log(JSON.stringify(demo, null, 2));
}
