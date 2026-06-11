/**
 * voting_rules/karma-curation-bridge.mjs — bridge karma/dharma → curation power.
 *
 * Hathor's curation budget (a fixed number of daily votes / a fixed weight pool)
 * should not be spread flat across every account it curates: an account that has
 * earned more standing in the commons should weigh more in what the Witness
 * lifts. This module turns each account's karma/dharma score into a CURATION
 * WEIGHT and distributes a daily vote BUDGET across the accounts in proportion
 * to those weights — with a per-account CAP so a single high-karma whale can
 * never swallow the whole budget.
 *
 * Shapes it bridges:
 *  - INPUT karma score: a 0..100 number (e.g. dharma-100.mjs `balance` /
 *    `givenScore`, or karma/karma.mjs activity score). Read off `.karma` first,
 *    then `.dharma`, then `.score`, then `.balance` — whichever a caller hands us.
 *  - OUTPUT: a plan that the same downstream signer consuming
 *    daily-vote-budget.mjs's `planVotes()` plan can act on — pure intents, no
 *    signing, no chain, no I/O.
 *
 * What this module is — and is NOT:
 *  - IS: pure weighting + distribution math. Deterministic, offline, soft-fail.
 *  - IS NOT: a broadcaster, a karma store, or a vote signer. Voting needs
 *    Hathor's posting authority (MELEK-Signer — zero WIF in this repo, per
 *    CLAUDE.md key custody). This module never signs, reads, fetches, or touches
 *    the chain.
 *
 * House style: ESM, soft-fail (never throws on bad input — clamps to 0 / skips),
 * esc() any HTML interpolation, deterministic for the same inputs, injectable IO
 * seams (none needed — pure math, but __setReader is exposed for symmetry/forward
 * use), CLI guarded by process.argv[1]. Offline tests in
 * karma-curation-bridge.test.mjs.
 */

/** Karma scores live on a 0..100 scale (dharma-100 / karma activity score). */
export const KARMA_SCALE = 100;

/** Graphene vote-weight bounds (percent ×100). We only upvote: 0..10000. */
export const MAX_WEIGHT = 10000;

/** Coerce to a finite non-negative number; anything bad -> fallback. */
function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

/** HTML-escape for any interpolation into markup (names in reports). */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* Injectable IO seam (pure module — held for forward use / parity with siblings). */
let _reader = null;
export function __setReader(fn) { _reader = (typeof fn === 'function') ? fn : null; }
export function __getReader() { return _reader; }

/**
 * karmaOf(account) → 0..100 karma/dharma score.
 *
 * Reads the first present, finite field off an account object in priority order:
 *   .karma → .dharma → .score → .balance
 * then clamps to 0..100. A bare number is treated as the score directly.
 *
 * Soft-fail: missing / NaN / non-finite / negative → 0; >100 clamps to 100.
 * Never throws.
 *
 * @param {object|number} account
 * @returns {number} score in [0, 100]
 */
export function karmaOf(account) {
  if (account == null) return 0;
  if (typeof account === 'number') return clamp100(account);
  if (typeof account !== 'object') return 0;
  for (const key of ['karma', 'dharma', 'score', 'balance']) {
    if (account[key] != null && Number.isFinite(Number(account[key]))) {
      return clamp100(account[key]);
    }
  }
  return 0;
}

const clamp100 = (x) => Math.max(0, Math.min(KARMA_SCALE, num(x, 0)));

/** Normalize a raw account into {name, karma, src}. Soft-fail: bad → karma 0. */
function normAccount(a, i) {
  const o = a && typeof a === 'object' ? a : {};
  const name = typeof o.name === 'string'
    ? o.name
    : (o.name == null ? '' : String(o.name));
  return { name, karma: karmaOf(o), src: o, _i: i };
}

/**
 * curationWeight(karma, opts) → a relative weighting multiplier for an account.
 *
 *   weight = (karma / KARMA_SCALE) ^ gamma
 *
 * `gamma` shapes how steeply karma translates to curation power:
 *   - gamma = 1  → linear (twice the karma ⇒ twice the weight)
 *   - gamma < 1  → compressed (flattens differences; the commons-friendly default
 *                  is 0.5, a sqrt curve — high-karma accounts still lead but the
 *                  gap to newcomers narrows)
 *   - gamma > 1  → steepened (rewards top karma harder)
 *
 * Returns a value in [0, 1]. Soft-fail: bad karma → 0; bad/<=0 gamma → 1 (linear).
 * Never throws.
 *
 * @param {number} karma  0..100
 * @param {{gamma?:number}} [opts]
 * @returns {number} relative weight in [0, 1]
 */
export function curationWeight(karma, { gamma } = {}) {
  const k = clamp100(karma) / KARMA_SCALE; // 0..1
  let g = num(gamma, 0.5);
  if (!(g > 0)) g = 1;
  return Math.pow(k, g);
}

/**
 * rankByCurationPower(accounts, opts) → accounts sorted by curation power, desc.
 *
 * Each returned entry is {name, karma, weight} where `weight` is the
 * curationWeight() of that account. Deterministic ordering: descending weight,
 * then ascending name, then original index (stable).
 *
 * Soft-fail: non-array / empty → []; malformed entries coerce to karma 0.
 * Never throws.
 *
 * @param {Array} accounts  [{name, karma|dharma|score|balance}, ...]
 * @param {{gamma?:number}} [opts]
 * @returns {Array<{name:string, karma:number, weight:number}>}
 */
export function rankByCurationPower(accounts, opts = {}) {
  const list = Array.isArray(accounts) ? accounts : [];
  if (list.length === 0) return [];
  const g = (opts && typeof opts === 'object') ? opts.gamma : undefined;
  return list
    .map(normAccount)
    .map((a) => ({ name: a.name, karma: a.karma, weight: curationWeight(a.karma, { gamma: g }), _i: a._i }))
    .sort((a, b) => {
      if (b.weight !== a.weight) return b.weight - a.weight;
      if (a.name < b.name) return -1;
      if (a.name > b.name) return 1;
      return a._i - b._i;
    })
    .map(({ name, karma, weight }) => ({ name, karma, weight }));
}

/**
 * karmaWeightedBudget(accountsWithKarma, baseBudget, opts) → distribution plan.
 *
 * Distributes a daily vote BUDGET across accounts in proportion to each
 * account's curationWeight(), with a per-account CAP so no single account can
 * take more than `capFraction` of the whole budget. The budget unit is
 * caller-defined (number of vote-slots, a weight pool, RC, …) — the math is unit
 * agnostic.
 *
 * Algorithm (deterministic, terminating):
 *   1. rank accounts by curation power; drop zero-weight accounts (below floor).
 *   2. cap = baseBudget * capFraction  (the most any one account may receive).
 *   3. iteratively distribute baseBudget ∝ weight among not-yet-capped accounts;
 *      any account whose proportional share would exceed `cap` is pinned to
 *      `cap`, its excess is redistributed among the rest. Repeat until stable.
 *   4. shares are reported raw (floats); a rounded integer `votes` is also given
 *      for callers that distribute whole vote-slots, plus a Graphene `weight`.
 *
 * @param {Array}  accountsWithKarma  [{name, karma|dharma|score|balance}, ...]
 * @param {number} baseBudget         total budget to distribute (>=0)
 * @param {object} [opts]
 * @param {number} [opts.gamma=0.5]   curation-power curve (see curationWeight)
 * @param {number} [opts.capFraction=0.25] max share of budget per account (0..1)
 * @param {number} [opts.minKarma=0]  accounts below this karma get nothing
 * @returns {{distribution:Array<{name,karma,weight,share,votes,voteWeight}>,
 *            budget:number, cap:number, distributed:number, skipped:Array<{name,reason}>}}
 *
 * Soft-fail: bad budget → 0 (empty distribution); non-array accounts → empty;
 * malformed entries coerce to karma 0; capFraction out of (0,1] clamps. Never throws.
 */
export function karmaWeightedBudget(accountsWithKarma, baseBudget, opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  const budget = Math.max(0, num(baseBudget, 0));
  const gamma = o.gamma;
  let capFraction = num(o.capFraction, 0.25);
  if (!(capFraction > 0)) capFraction = 1;
  if (capFraction > 1) capFraction = 1;
  const minKarma = Math.max(0, num(o.minKarma, 0));

  const skipped = [];
  const ranked = rankByCurationPower(accountsWithKarma, { gamma });

  // Partition: eligible (karma >= minKarma AND weight > 0) vs skipped.
  const eligible = [];
  for (const a of ranked) {
    if (a.karma < minKarma) {
      skipped.push({ name: a.name, reason: 'below-min-karma' });
    } else if (!(a.weight > 0)) {
      skipped.push({ name: a.name, reason: 'zero-weight' });
    } else {
      eligible.push(a);
    }
  }

  const cap = budget * capFraction;

  if (budget <= 0 || eligible.length === 0) {
    return {
      distribution: eligible.map((a) => ({
        name: a.name, karma: a.karma, weight: a.weight, share: 0, votes: 0, voteWeight: 0,
      })),
      budget, cap, distributed: 0, skipped,
    };
  }

  // Water-filling: cap accounts whose proportional share exceeds `cap`,
  // redistribute the remainder among the uncapped, repeat until stable.
  const shares = new Map(eligible.map((a) => [a, 0]));
  const capped = new Set();
  let remaining = budget;

  // Guard the loop count by the number of accounts (each pass caps >=1, or stops).
  for (let pass = 0; pass <= eligible.length; pass++) {
    const active = eligible.filter((a) => !capped.has(a));
    if (active.length === 0) break;
    const wSum = active.reduce((s, a) => s + a.weight, 0);
    if (!(wSum > 0) || remaining <= 0) {
      // No weight to distribute against — split nothing further.
      break;
    }
    let newlyCapped = false;
    for (const a of active) {
      const share = remaining * (a.weight / wSum);
      if (share > cap + 1e-12) {
        shares.set(a, cap);
        capped.add(a);
        newlyCapped = true;
      }
    }
    if (newlyCapped) {
      // Recompute remaining = budget - sum(capped shares); redistribute next pass.
      const cappedSum = eligible
        .filter((a) => capped.has(a))
        .reduce((s, a) => s + shares.get(a), 0);
      remaining = Math.max(0, budget - cappedSum);
      continue;
    }
    // Stable: assign proportional shares to the remaining active accounts.
    for (const a of active) {
      shares.set(a, remaining * (a.weight / wSum));
    }
    break;
  }

  const distribution = eligible.map((a) => {
    const share = Math.max(0, num(shares.get(a), 0));
    return {
      name: a.name,
      karma: a.karma,
      weight: a.weight,
      share,
      votes: Math.round(share),
      voteWeight: Math.max(0, Math.min(MAX_WEIGHT, Math.round((a.karma / KARMA_SCALE) * MAX_WEIGHT))),
    };
  });

  const distributed = distribution.reduce((s, d) => s + d.share, 0);

  return { distribution, budget, cap, distributed, skipped };
}

/* CLI: tiny demo, guarded so importing for tests does nothing. */
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const demo = karmaWeightedBudget(
    [
      { name: 'whale', karma: 100 },
      { name: 'alice', karma: 80 },
      { name: 'bob', dharma: 50 },
      { name: 'newcomer', karma: 5 },
      { name: 'lurker', karma: 0 },
    ],
    100,
    { gamma: 0.5, capFraction: 0.25, minKarma: 1 },
  );
  console.log(JSON.stringify(demo, null, 2));
}
