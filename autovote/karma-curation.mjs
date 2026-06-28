// karma-curation.mjs — the AutoVote upgrade's targeting brain. Ranks candidate vote-targets by MERIT using
// the karma toolkit (karma/), so the AutoNetwork curates quality AND lifts newcomers — instead of only
// "vote for the authors you follow" (fanbases/trails).
//
// §9-SAFE: this is OFF-CHAIN targeting ONLY. It produces a ranked list the engine chooses what to curate
// from; it never sets economic on-chain vote weight and never touches the reward pool. Karma stays social.
//
// The merit blend (all signals normalized 0..1):
//   quality = scoreActivity(author)            — curate genuine contributors (teaches/helps/generosity/tenure)
//   lift    = quality × neediness              — the SIRING mission: a QUALITY newcomer lifted counts MOST
//   balance = dharma symmetry (gives≈receives) — small tiebreaker, rewards real two-way participation
//
//   curationScore = wq·quality + wl·lift + wb·balance     (weights configurable)
//
// LIFT is the dominant term ON PURPOSE: the AutoNetwork's marginal value is lifting QUALITY newcomers, not
// re-voting whales the crowd already rewards. So raw `quality` is a small floor (keeps established good
// authors curated, above spam) while `lift = quality × neediness` drives the ranking — a quality newcomer
// outranks an equally-good established account. `balance` is a light tiebreaker.
//
// Pure + deterministic + soft-fail (per-candidate errors drop to null; never throws). Composes the existing
// karma/karma.mjs, karma/neediness-weight.mjs, karma/dharma-100.mjs — no network, no keys, no chain writes.

import { scoreActivity } from '../karma/karma.mjs';
import { needinessWeight } from '../karma/neediness-weight.mjs';
import { dharmaScore } from '../karma/dharma-100.mjs';

const clamp01 = (x) => Math.min(1, Math.max(0, Number(x) || 0));

export const CURATION_WEIGHTS = Object.freeze({ quality: 0.15, lift: 0.75, balance: 0.10 });

/** Pure merit blend from already-normalized 0..1 signals. */
export function curationScore({ quality = 0, lift = 0, balance = 0 } = {}, weights = CURATION_WEIGHTS) {
  const w = { ...CURATION_WEIGHTS, ...(weights || {}) };
  return clamp01(w.quality * clamp01(quality) + w.lift * clamp01(lift) + w.balance * clamp01(balance));
}

/**
 * Score ONE candidate into a curation record. A candidate carries whatever signals we have:
 *   { author, activity?, need?, dharma? }
 *     activity → scoreActivity input  (postCount, commentCount, repliesToNewcomers, upvotesGiven, …)
 *     need     → needinessWeight input ({ bp, postCount, lastActiveDaysAgo, followerCount })
 *     dharma   → dharmaScore input     ({ given, received })
 * @returns {{author, score, quality, neediness, lift, balance}}
 */
export function scoreCandidate(candidate = {}, weights) {
  const author = String(candidate.author || '').trim().toLowerCase();
  const quality = candidate.activity ? clamp01(scoreActivity(candidate.activity).score / 100) : 0;
  const neediness = candidate.need ? clamp01(needinessWeight(candidate.need)) : 0;
  let balance = 0;
  try { if (candidate.dharma) balance = clamp01(dharmaScore(candidate.dharma).balance / 100); } catch { /* soft */ }
  const lift = quality * neediness; // lifting a QUALITY newcomer is the highest-value curation act (siring)
  const score = curationScore({ quality, lift, balance }, weights);
  return { author, score: Math.round(score * 1000) / 1000, quality, neediness, lift, balance };
}

/**
 * Rank candidates for curation, highest merit first. Soft-fails per-candidate; never throws.
 * @param {Array} candidates
 * @param {{weights?:object, limit?:number, minScore?:number}} [opts]
 * @returns {Array<{author, score, quality, neediness, lift, balance}>}
 */
export function rankForCuration(candidates = [], { weights, limit, minScore = 0 } = {}) {
  const rows = (Array.isArray(candidates) ? candidates : [])
    .map((c) => { try { return scoreCandidate(c, weights); } catch { return null; } })
    .filter((r) => r && r.author && r.score >= minScore)
    .sort((a, b) => b.score - a.score || a.author.localeCompare(b.author));
  const n = Number(limit);
  return n > 0 ? rows.slice(0, Math.floor(n)) : rows;
}

/**
 * Rank LIVE accounts for curation — the bridge from the ranker to the chain. Reads each account's real
 * activity + neediness signals (karma/activity-reader.mjs) and ranks them by merit. This is the "who should
 * the AutoNetwork lift next" queue the engine consumes. Read-only; soft-fails per-account.
 * @param {string[]} accounts
 * @param {{readActivity:Function, rpcUrl:string, fetch?:Function, weights?:object, limit?:number, minScore?:number}} cfg
 *   readActivity is injected (default import) so this stays offline-testable.
 */
export async function rankAccountsForCuration(accounts = [], cfg = {}) {
  const { rpcUrl, fetch: f, weights, limit, minScore } = cfg;
  let read = cfg.readActivity;
  if (!read) ({ readActivity: read } = await import('../karma/activity-reader.mjs'));
  const candidates = await Promise.all((Array.isArray(accounts) ? accounts : []).map(async (account) => {
    try {
      const a = await read(account, { rpcUrl, fetch: f });
      return {
        author: account,
        activity: a, // scoreActivity reads postCount/commentCount/upvotesGiven/selfVotes/reputation/age
        need: { bp: a.bp, postCount: a.postCount, lastActiveDaysAgo: a.lastActiveDaysAgo, followerCount: a.followerCount },
      };
    } catch { return { author: account }; }
  }));
  return rankForCuration(candidates, { weights, limit, minScore });
}
