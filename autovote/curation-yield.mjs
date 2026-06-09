/**
 * autovote/curation-yield.mjs — READ-ONLY curation-reward yield reader.
 *
 * Given an account + chain, reads recent `curation_reward` virtual ops and
 * computes realized curation yield (per-vote + an annualized APR estimate),
 * so we can PROVE the timing engine works and tune it. Read-only, no keys,
 * soft-fail (never throws on bad data / network — returns a typed result with
 * `ok:false`). Offline-testable via injectable fetch (`__setFetch`).
 *
 * The yield number proves out curation-timing.mjs: capture full reward on
 * Steem/Blurt by voting at the 5-min edge, vote promptly on Hive.
 *
 * Mechanic notes:
 *  - `curation_reward` is a Graphene VIRTUAL op (account_history / enum_virtual_ops),
 *    paid in VESTS, for a curator's vote on a post once it pays out (~7 days after
 *    the post). It is the realized curation income.
 *  - APR is annualized from the realized reward over the lookback window against
 *    the curator's staked power (VESTS). We surface it in VESTS by default
 *    (chain-agnostic); pass `vestsToPower` to convert to display power (HP/SP/BP).
 *
 * RPC: condenser_api.get_account_history [account, -1, limit] — most-recent-first
 * paging; filter ops by type `curation_reward`. Per-chain RPC list is injected
 * from autovote/chains.js so we never hard-code a node here.
 */

import { getChain } from './chains.js';

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
const TIMEOUT_MS = Number(process.env.AUTOVOTE_YIELD_TIMEOUT_MS || 12000);

// Injectable transport so parsing is unit-testable without network.
let _fetch = (...a) => fetch(...a);
export function __setFetch(f) { _fetch = f; } // tests only
export function __resetFetch() { _fetch = (...a) => fetch(...a); }

/** Soft-fail JSON-RPC call with per-chain node failover. Returns result or throws. */
async function rpc(rpcs, method, params) {
  let lastErr;
  for (const node of rpcs) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const r = await _fetch(node, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'user-agent': UA },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: ctrl.signal,
      });
      const j = await r.json();
      if (j && j.error) throw new Error(j.error.message || 'rpc error');
      return j ? j.result : null;
    } catch (e) {
      lastErr = e;
    } finally {
      clearTimeout(t);
    }
  }
  throw lastErr || new Error('all chain nodes failed');
}

/** Parse a VESTS-bearing amount string ("123.456789 VESTS") or asset object → number (VESTS). */
export function parseVests(v) {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : 0;
  }
  // NAI asset object { amount, precision, nai } — amount is an integer string.
  if (typeof v === 'object' && v.amount != null) {
    const amount = Number(v.amount);
    const precision = Number(v.precision || 0);
    if (!Number.isFinite(amount)) return 0;
    return amount / Math.pow(10, precision);
  }
  return 0;
}

/**
 * Extract curation_reward entries from a condenser_api.get_account_history result.
 * History entries look like: [seqNum, { timestamp, op: [opName, opPayload] }].
 * Some nodes return op as { type, value } (appbase) instead of [name, payload].
 * Soft: ignores malformed entries.
 */
export function extractCurationRewards(history) {
  const out = [];
  if (!Array.isArray(history)) return out;
  for (const entry of history) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const tx = entry[1];
    if (!tx || !tx.op) continue;
    let opName, payload;
    if (Array.isArray(tx.op)) {
      [opName, payload] = tx.op;
    } else if (tx.op.type) {
      opName = String(tx.op.type).replace(/_operation$/, '');
      payload = tx.op.value;
    }
    if (opName !== 'curation_reward' || !payload) continue;
    const reward = parseVests(payload.reward);
    out.push({
      timestamp: tx.timestamp ? `${tx.timestamp}Z`.replace(/Z+$/, 'Z') : null,
      timeMs: tx.timestamp ? Date.parse(`${tx.timestamp}Z`) : null,
      curator: payload.curator,
      author: payload.comment_author || payload.author,
      permlink: payload.comment_permlink || payload.permlink,
      rewardVests: reward,
    });
  }
  return out;
}

/**
 * Compute yield stats from a set of curation_reward entries.
 *   entries        — from extractCurationRewards()
 *   stakedVests    — the curator's vesting_shares (VESTS) backing the votes (optional)
 *   windowDays     — lookback window in days the entries cover (for APR annualization)
 *   nowMs          — clock injection for pure/deterministic tests
 *   vestsToPower   — optional multiplier VESTS→display power (HP/SP/BP)
 *
 * Returns realized totals + per-vote average + an APR estimate (if stake known).
 */
export function computeYield(entries, {
  stakedVests = 0,
  windowDays = 30,
  nowMs = Date.now(),
  vestsToPower = null,
} = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const cutoff = windowDays > 0 ? nowMs - windowDays * 86400 * 1000 : -Infinity;
  const inWindow = list.filter((e) => e.timeMs == null || e.timeMs >= cutoff);

  const totalVests = inWindow.reduce((s, e) => s + (Number(e.rewardVests) || 0), 0);
  const voteCount = inWindow.length;
  const perVoteVests = voteCount > 0 ? totalVests / voteCount : 0;

  // Annualize: reward over windowDays scaled to a year, as a fraction of stake.
  let aprPct = null;
  const stake = Number(stakedVests) || 0;
  const days = Number(windowDays) || 0;
  if (stake > 0 && days > 0) {
    const annualVests = totalVests * (365 / days);
    aprPct = (annualVests / stake) * 100;
  }

  const conv = (v) => (typeof vestsToPower === 'number' && Number.isFinite(vestsToPower) ? v * vestsToPower : null);

  return {
    ok: true,
    windowDays: days,
    voteCount,
    totalVests,
    perVoteVests,
    aprPct,                       // null if stake unknown
    totalPower: conv(totalVests), // null unless vestsToPower given
    perVotePower: conv(perVoteVests),
  };
}

/**
 * High-level: read recent curation rewards for (chain, account) and compute yield.
 * Soft-fail — returns { ok:false, error } instead of throwing. Read-only.
 *
 * opts:
 *   limit        — account-history page size (default 1000, the node max)
 *   windowDays   — lookback for APR (default 30)
 *   stakedVests  — curator stake (VESTS) for APR; if omitted, we try to read it
 *   nowMs        — clock injection
 *   vestsToPower — VESTS→power multiplier for display
 *   rpcs         — override the per-chain node list (tests)
 */
export async function readCurationYield(chain, account, opts = {}) {
  const acct = String(account || '').trim().toLowerCase();
  if (!acct) return { ok: false, error: 'no account' };

  const entry = getChain(chain);
  const rpcs = opts.rpcs || (entry && entry.rpcs) || [];
  if (!rpcs.length) return { ok: false, error: `no rpc nodes for chain ${chain}` };

  const limit = Math.min(Number(opts.limit) || 1000, 1000);
  const windowDays = opts.windowDays != null ? Number(opts.windowDays) : 30;
  const nowMs = opts.nowMs || Date.now();

  let history;
  try {
    history = await rpc(rpcs, 'condenser_api.get_account_history', [acct, -1, limit]);
  } catch (e) {
    return { ok: false, error: String(e?.message || e), chain, account: acct };
  }

  const entries = extractCurationRewards(history);

  // If stake not supplied, try a best-effort read (still soft-fail).
  let stakedVests = Number(opts.stakedVests) || 0;
  if (!stakedVests && opts.readStake !== false) {
    try {
      const accts = await rpc(rpcs, 'condenser_api.get_accounts', [[acct]]);
      const a = Array.isArray(accts) ? accts[0] : null;
      if (a && a.vesting_shares) stakedVests = parseVests(a.vesting_shares);
    } catch {
      // soft — leave stake at 0, APR stays null
    }
  }

  const stats = computeYield(entries, {
    stakedVests,
    windowDays,
    nowMs,
    vestsToPower: opts.vestsToPower ?? null,
  });

  return {
    ...stats,
    chain,
    account: acct,
    stakedVests,
    sampleSize: entries.length,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
// node autovote/curation-yield.mjs <chain> <account> [windowDays]
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const [, , chain = 'hive', account, windowDays = '30'] = process.argv;
  if (!account) {
    console.error('usage: node autovote/curation-yield.mjs <chain> <account> [windowDays]');
    process.exit(1);
  }
  readCurationYield(chain, account, { windowDays: Number(windowDays) })
    .then((r) => console.log(JSON.stringify(r, null, 2)))
    .catch((e) => { console.error('error:', e?.message || e); process.exit(1); });
}
