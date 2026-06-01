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
async function withFailover(nodes, fn) {
  let lastErr;
  for (const node of nodes) {
    try { return await fn(node); }
    catch (e) { lastErr = e; }
  }
  throw lastErr || new Error('all nodes failed');
}

// contracts find — failover across RPC mirrors
export async function find(contract, table, query, limit = 1000, indexes = []) {
  return withFailover(RPC_NODES, async (node) => {
    const j = await fetchJSON(node, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'find', params: { contract, table, query, limit, offset: 0, indexes } }),
    });
    if (j.error) throw new Error(j.error.message);
    return j.result || [];
  });
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
