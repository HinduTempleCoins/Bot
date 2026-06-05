/**
 * autovote/rules.js — PURE rule-matching + scheduling logic.
 *
 * No chain access, no I/O. Everything here is deterministic and unit-tested
 * (rules.test.js). The engine wires these decisions to dhive broadcasts.
 */

/** Clamp a weight to the valid Graphene range (-10000..10000). */
export function clampWeight(w) {
  const n = Math.round(Number(w));
  if (!Number.isFinite(n)) return 0;
  return Math.max(-10000, Math.min(10000, n));
}

/**
 * Does a fanbase rule match a new post/comment op?
 * op: { author, permlink, parent_author } — parent_author === '' means top-level post.
 * Returns true only for top-level posts by a tracked author (not comments).
 */
export function fanbaseMatches(rule, op) {
  if (rule.paused) return false;
  if (op.parent_author && op.parent_author !== '') return false; // posts only
  return rule.authors.includes(String(op.author).toLowerCase());
}

/**
 * Does a curation-trail rule match an observed vote op by the trailed account?
 * voteOp: { voter, author, permlink, weight }
 * We only trail positive (upvote) actions; downvotes are ignored.
 */
export function trailMatches(rule, voteOp) {
  if (rule.paused) return false;
  if (String(voteOp.voter).toLowerCase() !== rule.target) return false;
  if (Number(voteOp.weight) <= 0) return false; // upvotes only
  if (String(voteOp.author).toLowerCase() === rule.owner) return false; // don't trail-vote your own posts via a leader
  return true;
}

/**
 * Effective weight for a trail vote. A trail rule's `weight` is a percentage
 * (0..100) applied to 10000-scale full weight. Optionally scale by the leader's
 * own weight so a leader's 50% vote becomes a proportionally smaller follow.
 */
export function trailVoteWeight(rule, leaderWeight) {
  const base = clampWeight((Number(rule.weight) / 100) * 10000);
  if (rule.scaleToLeader && Number.isFinite(leaderWeight)) {
    return clampWeight((base * leaderWeight) / 10000);
  }
  return base;
}

/** Fanbase weight is also a 0..100 percentage. */
export function fanbaseVoteWeight(rule) {
  return clampWeight((Number(rule.weight) / 100) * 10000);
}

/**
 * Is a scheduled vote due to fire at time `now` (ms)?
 * Not due if already done, paused, or voteAt is in the future.
 */
export function scheduleDue(rule, now) {
  if (rule.done || rule.paused) return false;
  return now >= Number(rule.voteAt);
}

/**
 * Daily-cap gate. `count` is how many successful votes the owner has cast today
 * (for this rule kind/scope as the caller chooses). cap<=0 means unlimited.
 */
export function underDailyCap(cap, count) {
  const c = Number(cap);
  if (!Number.isFinite(c) || c <= 0) return true;
  return count < c;
}

/**
 * Compute the earliest time (ms) an account may broadcast its next vote,
 * given the timestamp of its last vote and the configured interval.
 */
export function nextAllowedVoteTime(lastVoteAt, intervalMs) {
  if (!lastVoteAt) return 0;
  return lastVoteAt + intervalMs;
}

/**
 * Decide the action for a matched rule: when to fire and at what weight.
 * Returns { fireAt, weight }. fireAt = postTime/eventTime + rule.delayMs.
 */
export function plannedVote({ eventTimeMs, delayMs, weight }) {
  return { fireAt: Number(eventTimeMs) + Number(delayMs || 0), weight: clampWeight(weight) };
}
