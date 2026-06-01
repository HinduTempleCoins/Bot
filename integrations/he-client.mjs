// he-client.mjs — resilient READ-ONLY HIVE-Engine client. No keys.
// Multi-node failover + timeout + retry so an unattended automode run doesn't die
// on one flaky endpoint. Shared by hive-engine-market, tradebot-forensics, etc.

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

// contracts RPC mirrors (find/findOne against the sidechain state)
const RPC_NODES = (process.env.HE_RPC_NODES || [
  'https://api.hive-engine.com/rpc/contracts',
  'https://herpc.dtools.dev/contracts',
  'https://engine.rishipanthee.com/contracts',
].join(',')).split(/[,\s]+/).filter(Boolean);

// account-history mirrors (paginated market history)
const HISTORY_NODES = (process.env.HE_HISTORY_NODES || [
  'https://history.hive-engine.com/accountHistory',
  'https://accounts.hive-engine.com/accountHistory',
].join(',')).split(/[,\s]+/).filter(Boolean);

const TIMEOUT_MS = +(process.env.HE_TIMEOUT_MS || 20000);

async function fetchJSON(url, opts = {}, timeout = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await fetch(url, { headers: { 'user-agent': UA, ...(opts.headers || {}) }, signal: ctrl.signal, ...opts });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// try each node in order; return first success, throw last error if all fail
export async function withFailover(nodes, fn) {
  let lastErr;
  for (const node of nodes) {
    try { return await fn(node); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all nodes failed');
}

// optional short-TTL disk cache (opt-in via HE_CACHE_TTL_MS) so repeated digest/scenario runs in
// the same few minutes don't re-hammer the API. Off by default (TTL 0) — exact data when it matters.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
const CACHE_TTL = +(process.env.HE_CACHE_TTL_MS || 0);
const CACHE_DIR = '.local/cache/he';
function cacheKey(parts) { let h = 0; const s = JSON.stringify(parts); for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return `${CACHE_DIR}/${h >>> 0}.json`; }
function cacheGet(file) { if (!CACHE_TTL) return null; try { const c = JSON.parse(readFileSync(file, 'utf8')); return c.exp > Date.now() ? c.v : null; } catch { return null; } }
function cacheSet(file, v) { if (!CACHE_TTL) return; try { mkdirSync(CACHE_DIR, { recursive: true }); writeFileSync(file, JSON.stringify({ exp: Date.now() + CACHE_TTL, v })); } catch {} }

// contracts find — failover across RPC mirrors (+ optional cache)
export async function find(contract, table, query, limit = 1000, indexes = []) {
  const file = cacheKey(['find', contract, table, query, limit, indexes]);
  const hit = cacheGet(file); if (hit) return hit;
  const result = await withFailover(RPC_NODES, async (node) => {
    const j = await fetchJSON(node, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'find', params: { contract, table, query, limit, offset: 0, indexes } }),
    });
    if (j.error) throw new Error(j.error.message);
    return j.result || [];
  });
  cacheSet(file, result);
  return result;
}

export async function findOne(contract, table, query) {
  return (await find(contract, table, query, 1))[0] || null;
}

// account market history — failover across history mirrors, single page
export async function historyPage(account, { limit = 500, offset = 0, ops = 'market_buy,market_sell,market_placeOrder,market_expire,market_cancel' } = {}) {
  return withFailover(HISTORY_NODES, (node) =>
    fetchJSON(`${node}?account=${encodeURIComponent(account)}&limit=${limit}&offset=${offset}&ops=${ops}`));
}

export const NODES = { RPC_NODES, HISTORY_NODES };
