// pentecaust/groups/dues-verify.mjs — the 'wallet' dues rail for MELEK: proof of payment read from the chain.
//
// A member pays a club's dues with an ordinary MELEK transfer, from their own wallet, straight to the payee
// the club named (never this platform), with the memo `pact:<club id>`. This module reads the PAYEE's account
// history over public RPC and finds that transfer. Nothing the member sends us counts as proof — only the
// chain does — which is what lets groups/model.mjs admit a dues member without trusting the request.
//
// Pure + injectable fetch + soft-fail-never-throw. No keys, no writes.
//
//   import { duesMemo, findDuesPayment, periodMs } from './dues-verify.mjs'

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const MELEK_RPC = () => env('PACT_MELEK_RPC', 'https://melek.salon/rpc');
export const MELEK_DECIMALS = 3;               // 1.000 MELEK = amount 1000 in a club's dues terms

export const duesMemo = (groupId) => `pact:${String(groupId || '').trim()}`;

export function periodMs(period) {
  if (period === 'yearly') return 365 * 86400000;
  if (period === 'monthly') return 30 * 86400000;
  return Infinity;                              // 'once' — paid for good
}

/** '12.500 MELEK' → { units: 12500, symbol: 'MELEK' } (minor units, no floats). */
export function parseAsset(s) {
  const m = /^\s*(\d+)(?:\.(\d+))?\s+([A-Z]+)\s*$/.exec(String(s || ''));
  if (!m) return null;
  const frac = (m[2] || '').padEnd(MELEK_DECIMALS, '0').slice(0, MELEK_DECIMALS);
  return { units: Number(m[1]) * 10 ** MELEK_DECIMALS + Number(frac), symbol: m[3] };
}

/**
 * Find the most recent qualifying dues transfer.
 * @param {object} q { payer, payee, groupId, minUnits, symbol='MELEK', since=0 (ms), rpcUrl, fetch, limit=1000 }
 * @returns {Promise<{ok:true, paidAt:number, units:number, trx_id:string} | {ok:false, reason:string}>}
 */
export async function findDuesPayment(q = {}) {
  const payer = String(q.payer || '').toLowerCase(); const payee = String(q.payee || '').toLowerCase();
  const f = q.fetch || (typeof fetch !== 'undefined' ? fetch : null);
  if (!payer || !payee || !q.groupId || typeof f !== 'function') return { ok: false, reason: 'bad request' };
  const symbol = q.symbol || 'MELEK';
  const memo = duesMemo(q.groupId);
  let hist;
  try {
    const r = await f(q.rpcUrl || MELEK_RPC(), { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'condenser_api.get_account_history',
        params: [payee, -1, Math.max(1, Math.min(1000, Number(q.limit) || 1000))] }) });
    const j = await r.json();
    hist = Array.isArray(j && j.result) ? j.result : null;
  } catch { hist = null; }
  if (!hist) return { ok: false, reason: 'could not read the chain right now — try again in a minute' };

  let best = null;
  for (const row of hist) {
    const e = Array.isArray(row) ? row[1] : null;
    const op = e && Array.isArray(e.op) ? e.op : null;
    if (!op || op[0] !== 'transfer') continue;
    const t = op[1] || {};
    if (String(t.from).toLowerCase() !== payer || String(t.to).toLowerCase() !== payee) continue;
    if (String(t.memo || '').trim() !== memo) continue;
    const a = parseAsset(t.amount);
    if (!a || a.symbol !== symbol || a.units < Number(q.minUnits || 0)) continue;
    const ts = Date.parse(String(e.timestamp || '') + (String(e.timestamp || '').endsWith('Z') ? '' : 'Z'));
    if (!Number.isFinite(ts) || ts < Number(q.since || 0)) continue;
    if (!best || ts > best.paidAt) best = { ok: true, paidAt: ts, units: a.units, trx_id: e.trx_id || '' };
  }
  return best || { ok: false, reason: `No transfer found yet from @${payer} to @${payee} with memo "${memo}" for at least ${(Number(q.minUnits || 0) / 1000).toFixed(3)} ${symbol}.` };
}
