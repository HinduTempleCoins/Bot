// activity-reader.mjs — the deeper karma signal reader (the "until that reader lands" gap karma.mjs flags).
//
// scoreActivity() wants real behaviour — posts, comments, upvotes GIVEN to others, self-votes, flags. The
// default fetcher only had get_accounts (tenure + reputation), so every account scored ~the same. This reads
// a bounded window of the account's on-chain history (condenser_api.get_account_history) and COUNTS those
// signals, role-filtered (the account as AUTHOR for posts/comments, as VOTER for votes). Read-only, injectable
// fetch, soft-fail-never-throw — a flaky RPC yields a partial/zero snapshot, never an exception.

import { normalizeReputation } from './karma.mjs';

async function rpc(rpcUrl, f, method, params) {
  const r = await f(rpcUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }) });
  const j = await r.json().catch(() => null);
  return j && j.result;
}

/**
 * Read an account's activity snapshot for scoreActivity(). Bounded to the most-recent `maxOps` history ops.
 * @param {string} account
 * @param {{rpcUrl:string, fetch?:Function, maxOps?:number}} cfg
 * @returns {Promise<{account, postCount, commentCount, upvotesGiven, selfVotes, flagsGiven, accountAgeDays, reputation}>}
 */
export async function readActivity(account, { rpcUrl, fetch: f = globalThis.fetch, maxOps = 1000 } = {}) {
  const acc = String(account || '').trim().toLowerCase();
  // activity (scoreActivity) + neediness (needinessWeight) inputs from one read.
  const out = { account: acc, postCount: 0, commentCount: 0, upvotesGiven: 0, selfVotes: 0, flagsGiven: 0, repliesToNewcomers: 0, accountAgeDays: 0, reputation: null, bp: 0, lastActiveDaysAgo: 0, followerCount: 0 };
  if (!acc || !rpcUrl) return out;
  const daysSince = (ts) => { const t = ts ? new Date(`${ts}Z`).getTime() : NaN; return Number.isFinite(t) ? Math.max(0, (Date.now() - t) / 86400000) : 0; };
  try {
    const accts = await rpc(rpcUrl, f, 'condenser_api.get_accounts', [[acc]]);
    const a = accts && accts[0];
    if (a) {
      if (a.created || a.created_at) out.accountAgeDays = daysSince(a.created || a.created_at);
      if (a.reputation != null) out.reputation = normalizeReputation(a.reputation);
      out.bp = parseFloat(a.vesting_shares) || 0;                          // VESTS as a stake/BP proxy
      const last = [a.last_post, a.last_vote_time].filter(Boolean).sort().pop();
      out.lastActiveDaysAgo = daysSince(last);                            // dormancy signal
    }
  } catch { /* soft */ }
  try {                                                                    // reach signal (low followers = newcomer)
    const fc = await rpc(rpcUrl, f, 'condenser_api.get_follow_count', [acc]);
    if (fc && Number.isFinite(Number(fc.follower_count))) out.followerCount = Number(fc.follower_count);
  } catch { /* soft */ }
  try {
    const limit = Math.min(Math.max(1, Number(maxOps) || 1000), 1000);
    const hist = await rpc(rpcUrl, f, 'condenser_api.get_account_history', [acc, -1, limit]);
    if (Array.isArray(hist)) {
      for (const entry of hist) {
        const item = Array.isArray(entry) ? entry[1] : null;
        const op = item && item.op;
        if (!op) continue;
        const type = op[0]; const d = op[1] || {};
        if (type === 'comment' && d.author === acc) {
          if (!d.parent_author) out.postCount++; else out.commentCount++;
        } else if (type === 'vote' && d.voter === acc) {
          const w = Number(d.weight) || 0;
          if (d.author === acc) out.selfVotes++;
          else if (w > 0) out.upvotesGiven++;
          if (w < 0) out.flagsGiven++;
        }
      }
    }
  } catch { /* soft */ }
  return out;
}
