// cross-platform.mjs — karma across chains: a per-platform score for EACH system (Hive/Steem/Blurt/MELEK)
// plus ONE composite that aggregates them onto the MELEK account.
//
// Why this works cheaply: scoreActivity() (karma.mjs) is already chain-agnostic — posts/comments/votes
// exist on every Graphene chain — so "karma on chain X" = read X's history (activity-reader) + score it.
// The composite combines the per-platform scores via NOISY-OR: reputation AGGREGATES — being strong on any
// one platform lifts you, and being strong across several lifts you further toward 100. A MELEK account's
// cross-platform karma is then the union of everywhere its owner has earned standing.
//
// §9 still holds: social, not economic. This is a display/curation signal, never on-chain vote weight.
// Pure + injectable read → offline-testable.

import { scoreActivity } from './karma.mjs';
import { readActivity } from './activity-reader.mjs';

const clamp100 = (x) => Math.min(100, Math.max(0, Number(x) || 0));

/**
 * Combine per-platform 0..100 karma into one cross-platform 0..100 score (noisy-OR).
 *   composite = 100 · (1 − ∏(1 − sᵢ/100))
 * One platform at 50 → 50. Two at 50 → 75. The more places you've earned standing, the closer to 100.
 */
export function combineKarma(scores = []) {
  const ss = (Array.isArray(scores) ? scores : []).map((s) => clamp100(s) / 100).filter((s) => s > 0);
  if (!ss.length) return 0;
  const noneVouch = ss.reduce((p, s) => p * (1 - s), 1);
  return Math.round((1 - noneVouch) * 1000) / 10; // 0..100, 1 decimal
}

/** Karma for ONE (account on a chain), using that chain's RPC. Read injectable for tests. */
export async function karmaOnChain({ account, rpcUrl } = {}, { read = readActivity } = {}) {
  const acc = String(account || '').trim().toLowerCase();
  const activity = await read(acc, { rpcUrl });
  const { score, components } = scoreActivity(activity);
  return { account: acc, score, components };
}

/**
 * Cross-platform karma for a MELEK identity: score every linked (account, chain) and combine.
 * @param {Array<{chain:string, account:string, rpcUrl:string}>} links  the identity's accounts per chain
 * @param {{read?:Function}} [deps]
 * @returns {Promise<{composite:number, platforms:Array<{chain, account, score}>}>}
 */
export async function crossPlatformKarma(links = [], deps = {}) {
  const platforms = await Promise.all((Array.isArray(links) ? links : []).map(async (l) => {
    try {
      const k = await karmaOnChain({ account: l.account, rpcUrl: l.rpcUrl }, deps);
      return { chain: l.chain, account: k.account, score: k.score };
    } catch {
      return { chain: l.chain, account: String(l.account || '').toLowerCase(), score: 0 };
    }
  }));
  return { composite: combineKarma(platforms.map((p) => p.score)), platforms };
}
