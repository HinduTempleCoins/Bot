// karma-curation-runner.mjs — the engine's karma-curation loop: turn the merit QUEUE into actual votes.
//
// One round: rank candidate accounts (karma-curation), take the top N, find each one's most-recent eligible
// post, and cast the curator's vote on it — respecting a per-round cap and a dedupe set so the same post is
// never voted twice. Every external action (rank, post lookup, vote broadcast) is an INJECTED seam, so this
// is pure control-flow and fully offline-testable. §9-safe: it only DECIDES what to curate; the vote weight
// is the curator's own stake, not karma. Soft-fail per candidate — one bad lookup never stops the round.

import { rankAccountsForCuration } from './karma-curation.mjs';

/**
 * @param {object} cfg
 * @param {{account:string, chain?:string}} cfg.curator           the curating account
 * @param {string[]} cfg.candidates                               accounts to consider this round
 * @param {(author:string)=>Promise<{permlink:string}|null>} cfg.recentPostOf  most-recent eligible post lookup
 * @param {(v:{voter,author,permlink,weight})=>Promise<any>} cfg.castVote      broadcast the vote (signer/engine)
 * @param {object} [cfg.rankOpts]   { rpcUrl, weights, limit, minScore } for the ranker
 * @param {number} [cfg.weight=5000]  vote weight (curator's own stake %, 10000 = 100%)
 * @param {number} [cfg.topN=5]       max posts to lift this round
 * @param {Set<string>} [cfg.alreadyVoted]  dedupe set of "author/permlink" keys (persist across rounds)
 * @param {Function} [cfg.rank]       injectable ranker (default rankAccountsForCuration)
 * @returns {Promise<{curator:string, considered:number, cast:Array}>}
 */
export async function runCurationRound({
  curator, candidates = [], recentPostOf, castVote,
  rankOpts = {}, weight = 5000, topN = 5, alreadyVoted = new Set(),
  rank = rankAccountsForCuration,
} = {}) {
  if (!curator || !curator.account || typeof castVote !== 'function' || typeof recentPostOf !== 'function') {
    return { curator: curator && curator.account, considered: 0, cast: [] };
  }
  const ranked = (await rank(candidates, rankOpts)) || [];
  const top = ranked.slice(0, Math.max(0, Number(topN) || 0));
  const cast = [];
  for (const r of top) {
    let post;
    try { post = await recentPostOf(r.author); } catch { continue; }
    if (!post || !post.permlink) continue;
    const key = `${r.author}/${post.permlink}`;
    if (alreadyVoted.has(key)) continue;
    try {
      const res = await castVote({ voter: curator.account, author: r.author, permlink: post.permlink, weight });
      alreadyVoted.add(key);
      cast.push({ author: r.author, permlink: post.permlink, score: r.score, weight, id: (res && (res.id || res.hash)) || true });
    } catch { /* soft: skip this one, keep curating */ }
  }
  return { curator: curator.account, considered: ranked.length, cast };
}
