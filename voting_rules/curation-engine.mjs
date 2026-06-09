/**
 * voting_rules/curation-engine.mjs — Hathor's content-curation SCORING engine.
 *
 * A pure, rule-based curation voter ported from the Steem-FOSSbot voter pattern
 * (Steem-FOSSbot/steem-fossbot-voter — Node, rule-based scoring, dynamic
 * threshold, ~daily vote budget, white/blacklist, dry-run). See
 * `.local/LINKS_TO_BUILDABLES_2026-06-09.md` (HIGH-VALUE BUILD #1) and the
 * policy this implements in `voting_rules/README.md` §2.
 *
 * What this module is — and is NOT:
 *  - IS: pure scoring math + a dry-run vote PLAN. Given a candidate post and a
 *    rules object, it produces {score, weightPct, reason}; given many posts +
 *    daily state it produces a deterministic plan of vote INTENTS.
 *  - IS NOT: a broadcaster. Voting is a `vote` op needing posting authority
 *    (Hathor's posting key, held by MELEK-Signer — zero WIF in this repo, per
 *    CLAUDE.md key custody). This engine never signs, never touches the chain.
 *    The plan it emits is what a key-gated signer step would consume.
 *
 * House style: ESM, injectable (clock via `state.now`/opts), soft-fail (never
 * throws on bad input — clamps/returns a zero-weight skip), CLI guarded by
 * process.argv[1]. Deterministic for the same inputs (curation-engine.test.mjs).
 */

/** Graphene vote-weight bounds (percent ×100). We only upvote: 0..10000. */
export const MAX_WEIGHT = 10000;

/** Clamp a 0..100 percent to a sane curation range. */
function clampPct(p, lo = 0, hi = 100) {
  const n = Number(p);
  if (!Number.isFinite(n)) return lo;
  return Math.max(lo, Math.min(hi, n));
}

/** Lowercase + trim a name; '' for anything non-stringy. */
function norm(s) {
  return typeof s === 'string' ? s.trim().toLowerCase() : '';
}

/** Build a fast lookup Set from an array of names (case-insensitive). */
function nameSet(arr) {
  const s = new Set();
  if (Array.isArray(arr)) for (const a of arr) { const n = norm(a); if (n) s.add(n); }
  return s;
}

/**
 * Default curation rules. Every field is overridable via the `rules` arg.
 * Weights are additive contributions to a 0..1-ish raw score before mapping to
 * a vote weight. Tuned to the README policy: reward genuine participation,
 * never self-deal, never punish — low score just means "skip", not downvote.
 */
export const DEFAULT_RULES = {
  // ── Gating (hard skips, score forced to 0) ───────────────────────────────
  minBodyLen: 280,          // chars; sub-this looks like a one-liner / spam
  minAuthorRep: 25,         // Graphene reputation floor (log-scale-ish, 0..100)
  minAgeMin: 5,             // don't vote in the first N minutes (anti-front-run)
  maxAgeMin: 6.5 * 24 * 60, // and don't vote past the ~6.5d payout window
  // ── Scoring weights (additive; each 0..1 sub-score × its weight) ─────────
  weights: {
    rep: 0.25,              // author reputation, normalized
    body: 0.20,            // body length, saturating
    tags: 0.20,            // overlap with rewardTags
    freshness: 0.15,        // earlier-in-window scores higher
    payoutRoom: 0.20,       // lower current payout = more curation upside
  },
  // Tag policy
  rewardTags: ['melek', 'hathor', 'vankush', 'cryptology', 'convergence', 'introduceyourself', 'witness-school'],
  penalizeTags: ['nsfw', 'spam', 'test'],
  tagPenalty: 0.5,          // multiply final score by this if a penalize-tag present
  // Saturation knobs
  bodyFull: 2500,           // body length (chars) at which the body sub-score = 1
  repFull: 75,              // reputation at which the rep sub-score = 1
  payoutFullRoom: 5,        // a post already past $N payout has ~no curation room
  // ── Vote-weight mapping (score → upvote %) ───────────────────────────────
  voteThreshold: 0.45,      // below this score → no vote (skip)
  minVotePct: 15,           // a passing post gets at least this %
  maxVotePct: 100,          // ...up to this %
  // ── Daily budget ─────────────────────────────────────────────────────────
  dailyVoteBudget: 40,      // ~FOSSbot default: max votes/day
  dailyWeightBudget: 800,   // and a total %-budget/day (e.g. 800% = 40×~20% avg)
  // ── Lists ──────────────────────────────────────────────────────────────
  whitelist: [],            // always pass gating (still scored); blacklist wins
  blacklist: [],            // always skip, regardless of score
  // Self-deal guard: Hathor never curates these (its own / affiliated accounts)
  selfAccounts: ['hathor'],
};

/** Merge user rules over defaults (shallow, with weights merged one level). */
export function resolveRules(rules = {}) {
  const r = { ...DEFAULT_RULES, ...rules };
  r.weights = { ...DEFAULT_RULES.weights, ...(rules.weights || {}) };
  return r;
}

/**
 * Score one candidate post against the rules.
 *
 * candidate: {
 *   author, authorRep (0..100), tags (string[]), bodyLen (chars),
 *   payout (current pending payout, number), ageMin (minutes since post),
 *   whitelist?/blacklist? (per-candidate override, optional)
 * }
 * Returns { score (0..1), weightPct (0..100, 0=skip), reason (string),
 *           subscores } — soft-fail: bad input → a clean zero-weight skip.
 */
export function scoreCandidate(candidate = {}, rules = {}) {
  const r = resolveRules(rules);
  const c = candidate || {};
  const author = norm(c.author);

  const wl = nameSet(r.whitelist);
  const bl = nameSet(r.blacklist);
  const self = nameSet(r.selfAccounts);

  // Per-candidate list overrides fold into the global lists.
  if (Array.isArray(c.whitelist)) for (const a of c.whitelist) wl.add(norm(a));
  if (Array.isArray(c.blacklist)) for (const a of c.blacklist) bl.add(norm(a));

  const tags = Array.isArray(c.tags) ? c.tags.map(norm).filter(Boolean) : [];
  const authorRep = Number(c.authorRep);
  const bodyLen = Number(c.bodyLen);
  const payout = Number(c.payout);
  const ageMin = Number(c.ageMin);

  // ── Hard skips ────────────────────────────────────────────────────────────
  if (author && bl.has(author)) return skip('blacklisted author', { author });
  if (author && self.has(author)) return skip('self/affiliated account (no self-deal)', { author });

  const onWhitelist = author && wl.has(author);

  // Whitelist bypasses the quality gates (but is still scored + budgeted).
  if (!onWhitelist) {
    if (Number.isFinite(bodyLen) && bodyLen < r.minBodyLen)
      return skip(`body too short (${bodyLen}<${r.minBodyLen})`, { bodyLen });
    if (Number.isFinite(authorRep) && authorRep < r.minAuthorRep)
      return skip(`author rep too low (${authorRep}<${r.minAuthorRep})`, { authorRep });
  }
  // Age gates apply to everyone (front-run + payout-window safety).
  if (Number.isFinite(ageMin)) {
    if (ageMin < r.minAgeMin) return skip(`too fresh (${round1(ageMin)}min<${r.minAgeMin})`, { ageMin });
    if (ageMin > r.maxAgeMin) return skip(`past payout window (${round1(ageMin)}min>${r.maxAgeMin})`, { ageMin });
  }

  // ── Sub-scores (each 0..1) ──────────────────────────────────────────────
  const sRep = onWhitelist ? 1 : sat(authorRep, r.repFull);
  const sBody = sat(bodyLen, r.bodyFull);
  const sTags = tagScore(tags, r.rewardTags);
  const sFresh = freshnessScore(ageMin, r.minAgeMin, r.maxAgeMin);
  const sPayout = payoutRoomScore(payout, r.payoutFullRoom);

  const w = r.weights;
  let score =
    sRep * w.rep +
    sBody * w.body +
    sTags * w.tags +
    sFresh * w.freshness +
    sPayout * w.payoutRoom;

  // Normalize by total weight so score lands in 0..1 even if weights don't sum to 1.
  const wSum = w.rep + w.body + w.tags + w.freshness + w.payoutRoom;
  if (wSum > 0) score /= wSum;

  // Penalize-tag multiplier (soft demotion, never a downvote).
  const penalized = tags.some((t) => r.penalizeTags.map(norm).includes(t));
  if (penalized) score *= clampPct(r.tagPenalty, 0, 1);

  score = clamp01(score);

  const subscores = { rep: r1(sRep), body: r1(sBody), tags: r1(sTags), freshness: r1(sFresh), payoutRoom: r1(sPayout) };

  if (score < clamp01(r.voteThreshold)) {
    return {
      score: r1(score),
      weightPct: 0,
      reason: `below threshold (${r1(score)}<${clamp01(r.voteThreshold)})`,
      subscores,
    };
  }

  const weightPct = scoreToWeight(score, r);
  return {
    score: r1(score),
    weightPct: r1(weightPct),
    reason: reasonFor(score, subscores, { onWhitelist, penalized }),
    subscores,
  };
}

/** A clean, structured "we won't vote" result. */
function skip(reason, extra = {}) {
  return { score: 0, weightPct: 0, reason, subscores: null, ...extra };
}

/** Saturating ramp: value → 0..1, hitting 1 at `full`. */
function sat(v, full) {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (!Number.isFinite(full) || full <= 0) return 1;
  return Math.min(1, n / full);
}

/** Tag overlap: fraction of reward-tags present, with a bonus for any match. */
function tagScore(tags, rewardTags) {
  const reward = new Set(rewardTags.map(norm).filter(Boolean));
  if (reward.size === 0) return 0;
  let hits = 0;
  for (const t of tags) if (reward.has(t)) hits++;
  if (hits === 0) return 0;
  // First match is worth a lot (it's on-topic); extra matches add diminishingly.
  const frac = hits / reward.size;          // 0..1 coverage
  return clamp01(0.6 + 0.4 * frac);          // any hit ≥0.6, full coverage = 1
}

/**
 * Freshness: earlier within the votable window scores higher (more curation
 * reward to capture), but the very-fresh region was already gated out. Linear
 * decay from minAgeMin (1.0) to maxAgeMin (0.0).
 */
function freshnessScore(ageMin, lo, hi) {
  const a = Number(ageMin);
  if (!Number.isFinite(a)) return 0.5;       // unknown age → neutral
  if (hi <= lo) return 1;
  const t = (a - lo) / (hi - lo);            // 0 at lo, 1 at hi
  return clamp01(1 - t);
}

/** Curation room: a post with low pending payout has more upside to reward. */
function payoutRoomScore(payout, fullRoom) {
  const p = Number(payout);
  if (!Number.isFinite(p) || p < 0) return 0.5; // unknown → neutral
  if (!Number.isFinite(fullRoom) || fullRoom <= 0) return p <= 0 ? 1 : 0;
  return clamp01(1 - p / fullRoom);
}

/** Map a 0..1 score to minVotePct..maxVotePct, linearly above the threshold. */
function scoreToWeight(score, r) {
  const thr = clamp01(r.voteThreshold);
  const lo = clampPct(r.minVotePct);
  const hi = clampPct(r.maxVotePct);
  if (score <= thr) return 0;
  const t = (score - thr) / (1 - thr || 1); // 0 at threshold → 1 at score=1
  return clampPct(lo + (hi - lo) * t);
}

function reasonFor(score, sub, { onWhitelist, penalized }) {
  const bits = [];
  if (onWhitelist) bits.push('whitelisted');
  // name the strongest contributor
  const top = Object.entries(sub).sort((a, b) => b[1] - a[1])[0];
  if (top) bits.push(`strongest: ${top[0]} (${top[1]})`);
  if (penalized) bits.push('penalize-tag demotion');
  return `pass (score ${r1(score)})${bits.length ? ' — ' + bits.join(', ') : ''}`;
}

const clamp01 = (n) => Math.max(0, Math.min(1, Number.isFinite(Number(n)) ? Number(n) : 0));
const r1 = (n) => Math.round(Number(n) * 1000) / 1000;   // 3dp for scores
const round1 = (n) => Math.round(Number(n) * 10) / 10;    // 1dp for minutes

/**
 * voteplan — produce a deterministic DRY-RUN plan of vote intents for a batch
 * of posts, honoring the daily vote-count and total-weight budgets.
 *
 * posts: candidate[] (same shape as scoreCandidate's arg).
 * rules: curation rules (see DEFAULT_RULES).
 * state: { now?, votesToday?, weightSpentToday? } — the day's running tally,
 *         so a scheduler can call voteplan repeatedly and stay within budget.
 *
 * Returns {
 *   intents: [{ author, permlink, weightPct, score, reason }],  // would-be votes
 *   skipped: [{ author, permlink, reason }],                    // scored, not voted
 *   budget: { votesUsed, votesLeft, weightUsed, weightLeft, dailyVoteBudget, dailyWeightBudget },
 *   broadcast: false,  // ALWAYS — this engine never broadcasts (signer-gated)
 * }
 *
 * Ordering is deterministic: highest score first, ties broken by author/permlink,
 * so the same batch + state always yields the same plan (test-stable).
 */
export function voteplan(posts = [], rules = {}, state = {}) {
  const r = resolveRules(rules);
  const list = Array.isArray(posts) ? posts : [];

  let votesUsed = Math.max(0, Number(state.votesToday) || 0);
  let weightUsed = Math.max(0, Number(state.weightSpentToday) || 0);

  // Score everything first.
  const scored = list.map((p) => {
    const res = scoreCandidate(p, r);
    return {
      author: norm(p?.author),
      permlink: typeof p?.permlink === 'string' ? p.permlink : '',
      ...res,
    };
  });

  // Sort: votable (weightPct>0) first, by score desc, then stable by author/permlink.
  scored.sort((a, b) => {
    const av = a.weightPct > 0 ? 1 : 0;
    const bv = b.weightPct > 0 ? 1 : 0;
    if (av !== bv) return bv - av;
    if (b.score !== a.score) return b.score - a.score;
    if (a.author !== b.author) return a.author < b.author ? -1 : 1;
    return a.permlink < b.permlink ? -1 : a.permlink > b.permlink ? 1 : 0;
  });

  const intents = [];
  const skipped = [];

  for (const s of scored) {
    if (s.weightPct <= 0) {
      skipped.push({ author: s.author, permlink: s.permlink, reason: s.reason });
      continue;
    }
    if (votesUsed >= r.dailyVoteBudget) {
      skipped.push({ author: s.author, permlink: s.permlink, reason: 'daily vote-count budget exhausted' });
      continue;
    }
    if (weightUsed + s.weightPct > r.dailyWeightBudget) {
      skipped.push({ author: s.author, permlink: s.permlink, reason: 'daily weight budget exhausted' });
      continue;
    }
    intents.push({
      author: s.author,
      permlink: s.permlink,
      weightPct: s.weightPct,
      score: s.score,
      reason: s.reason,
    });
    votesUsed += 1;
    weightUsed += s.weightPct;
  }

  return {
    intents,
    skipped,
    budget: {
      votesUsed,
      votesLeft: Math.max(0, r.dailyVoteBudget - votesUsed),
      weightUsed: r1(weightUsed),
      weightLeft: r1(Math.max(0, r.dailyWeightBudget - weightUsed)),
      dailyVoteBudget: r.dailyVoteBudget,
      dailyWeightBudget: r.dailyWeightBudget,
    },
    broadcast: false, // NEVER true here — voting is posting-auth, signer/key-gated.
  };
}

/**
 * Convert a plan's intents into Graphene `vote` op shapes a signer would
 * broadcast. Still NO broadcast — this only shapes the op (voter required).
 */
export function intentsToVoteOps(intents = [], voter = 'hathor') {
  const v = norm(voter) || 'hathor';
  return (Array.isArray(intents) ? intents : []).map((i) => ({
    voter: v,
    author: norm(i.author),
    permlink: typeof i.permlink === 'string' ? i.permlink : '',
    weight: Math.round(clampPct(i.weightPct) / 100 * MAX_WEIGHT), // % → 0..10000
  }));
}

// ── CLI (guarded) — dry-run a tiny sample so operators can eyeball the math ──
if (process.argv[1] === new URL(import.meta.url).pathname) {
  const sample = [
    { author: 'alice', permlink: 'real-intro', authorRep: 55, tags: ['introduceyourself', 'melek'], bodyLen: 1400, payout: 0.2, ageMin: 30 },
    { author: 'bob', permlink: 'short-spam', authorRep: 40, tags: ['spam'], bodyLen: 90, payout: 0, ageMin: 20 },
    { author: 'carol', permlink: 'good-howto', authorRep: 68, tags: ['witness-school', 'convergence'], bodyLen: 2600, payout: 1.1, ageMin: 120 },
    { author: 'hathor', permlink: 'self-post', authorRep: 80, tags: ['melek'], bodyLen: 3000, payout: 0, ageMin: 60 },
    { author: 'dave', permlink: 'too-fresh', authorRep: 50, tags: ['melek'], bodyLen: 900, payout: 0, ageMin: 1 },
  ];
  const plan = voteplan(sample, {}, { votesToday: 0, weightSpentToday: 0 });
  console.log(JSON.stringify({ plan, voteOps: intentsToVoteOps(plan.intents) }, null, 2));
  console.log('\n(dry-run only — this engine never broadcasts; votes are signer/key-gated.)');
}
