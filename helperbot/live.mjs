// live.mjs — shared READ-ONLY data plumbing for Hathor's helper bot: one injectable fetch, a short TTL
// cache, JSON-RPC helpers for the MELEK (Graphene) and PRANA (EVM) chains, Hive-Engine + MELEK-Engine
// readers, and number formatting. Every reader SOFT-FAILS to null — it never throws and never invents
// a figure. No keys, no signing, no broadcast anywhere in this file.

export const CFG = {
  // MELEK RPC nodes in FAILOVER ORDER. Public defaults; on the chain host put the local node first and add
  // the private mainnet nodes via MELEK_RPC_NODES (kept in the host env / .local, never in this repo).
  melekNodes: {
    mainnet: String(process.env.MELEK_RPC_NODES || process.env.MELEK_RPC_MAINNET || 'https://melek.salon/rpc,https://wallet.melek.salon/rpc').split(',').map((x) => x.trim()).filter(Boolean),
    testnet: String(process.env.MELEK_RPC_NODES_TESTNET || process.env.MELEK_RPC_TESTNET || 'https://alpha.melek.salon/rpc').split(',').map((x) => x.trim()).filter(Boolean),
  },
  rpcTimeoutMs: Number(process.env.HELPERBOT_RPC_TIMEOUT_MS || 5000),
  nodeCooldownMs: Number(process.env.HELPERBOT_NODE_COOLDOWN_MS || 60000),
  staleMaxMs: Number(process.env.HELPERBOT_STALE_MAX_MS || 15 * 60000),
  pranaRpc: { mainnet: process.env.PRANA_RPC_URL_MAINNET || 'https://rpc.prana.melek.salon', alpha: process.env.PRANA_RPC_URL_ALPHA || 'https://rpc.prana.alpha.melek.salon' },
  pranascan: { mainnet: process.env.PRANASCAN_URL || 'https://pranascan.soapbox.community', alpha: process.env.PRANASCAN_ALPHA_URL || 'https://pranascan.alpha.soapbox.community' },
  hiveEngine: process.env.HIVE_ENGINE_RPC || 'https://api.hive-engine.com/rpc/contracts',
  melekEngine: process.env.MELEK_ENGINE_PUBLIC_API || 'https://engine.melek.salon/api',
  pool: process.env.POOL_API_URL || 'https://pool.soapbox.community/api',
  timeoutMs: Number(process.env.HELPERBOT_FETCH_TIMEOUT_MS || 12000),
  ttlMs: Number(process.env.HELPERBOT_CACHE_TTL_MS || 60000),
};

let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch (pass nothing to restore the global). Also clears the cache. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); _cache.clear(); if (typeof __resetNodes === 'function') __resetNodes(); }

const _cache = new Map();
export function clearCache() { _cache.clear(); }

/** cached(key, fn, ttl) — memoize a soft-failing async read. null results are NOT cached. */
export async function cached(key, fn, ttl = CFG.ttlMs, now = Date.now()) {
  const hit = _cache.get(key);
  if (hit && hit.exp > now) return hit.v;
  let v = null;
  try { v = await fn(); } catch { v = null; }
  if (v !== null && v !== undefined) _cache.set(key, { v, exp: now + ttl });
  return v ?? null;
}

async function withTimeout(url, init = {}, ms = CFG.timeoutMs) {
  const ac = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ac ? setTimeout(() => ac.abort(), ms) : null;
  try {
    return await _fetch(url, ac ? { ...init, signal: ac.signal } : init);
  } finally { if (t) clearTimeout(t); }
}

export async function getJSON(url) {
  try {
    const r = await withTimeout(url, { headers: { accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

export async function getText(url) {
  try {
    const r = await withTimeout(url);
    if (!r || !r.ok) return null;
    return await r.text();
  } catch { return null; }
}

export async function postJSON(url, body, headers = {}, ms = CFG.timeoutMs) {
  try {
    const r = await withTimeout(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }, ms);
    if (!r) return null;
    const j = await r.json().catch(() => null);
    return j;
  } catch { return null; }
}

export async function rpc(url, method, params = [], ms = CFG.timeoutMs) {
  const j = await postJSON(url, { jsonrpc: '2.0', id: 1, method, params }, {}, ms);
  if (!j || j.error || j.result === undefined) return null;
  return j.result;
}

// ── MELEK RPC failover + last-good fallback (24/7 answers) ───────────────────────────────────────
// A node that errors/times out is benched for nodeCooldownMs and the next one is tried. If every node
// fails, the last good answer for the same call (≤ staleMaxMs old) is returned flagged stale, so the bot
// degrades to "chain unreachable — as of N s ago" instead of going silent.
const _bench = new Map(); // url -> benchedUntil
const _lastGood = new Map(); // net|method|params -> { result, at }
const _nodeStats = new Map(); // url -> { ok, fail, lastOkAt, lastFailAt }
export function nodeHealth() {
  const out = {};
  for (const net of Object.keys(CFG.melekNodes)) {
    out[net] = CFG.melekNodes[net].map((url) => ({ url, benched: (_bench.get(url) || 0) > Date.now(), ...(_nodeStats.get(url) || { ok: 0, fail: 0 }) }));
  }
  return out;
}
export function __resetNodes() { _bench.clear(); _lastGood.clear(); _nodeStats.clear(); }

const stat = (url, ok, now) => {
  const s = _nodeStats.get(url) || { ok: 0, fail: 0 };
  if (ok) { s.ok += 1; s.lastOkAt = now; } else { s.fail += 1; s.lastFailAt = now; }
  _nodeStats.set(url, s);
};

/** melekCallX(net, method, params) → { result, stale (ms, 0 = fresh), node } | { result:null } */
export async function melekCallX(net = 'mainnet', method, params = [], { now = () => Date.now() } = {}) {
  const nodes = CFG.melekNodes[net] || CFG.melekNodes.mainnet;
  const ordered = [...nodes.filter((u) => !((_bench.get(u) || 0) > now())), ...nodes.filter((u) => (_bench.get(u) || 0) > now())];
  const key = `${net}|${method}|${JSON.stringify(params)}`;
  for (const url of ordered) {
    let j = null;
    try { j = await postJSON(url, { jsonrpc: '2.0', id: 1, method, params }, {}, CFG.rpcTimeoutMs); } catch { j = null; }
    if (j && j.result !== undefined && !j.error) {
      stat(url, true, now());
      _bench.delete(url);
      _lastGood.set(key, { result: j.result, at: now() });
      return { result: j.result, stale: 0, node: url };
    }
    if (j && j.error && j.id !== undefined) { stat(url, true, now()); return { result: null, error: j.error, node: url }; } // node is fine; the call is bad
    stat(url, false, now());
    _bench.set(url, now() + CFG.nodeCooldownMs);
  }
  const lg = _lastGood.get(key);
  if (lg && now() - lg.at <= CFG.staleMaxMs) return { result: lg.result, stale: Math.max(1, now() - lg.at), node: null };
  return { result: null, stale: 0, node: null };
}

// ── MELEK (Graphene) ──────────────────────────────────────────────────────────────────────────────
export const melek = {
  url: (net = 'mainnet') => (CFG.melekNodes[net] || CFG.melekNodes.mainnet)[0],
  call: async (net, method, params = []) => (await melekCallX(net, method, params)).result,
  globals: (net = 'mainnet') => cached(`melek:dgp:${net}`, () => melek.call(net, 'condenser_api.get_dynamic_global_properties')),
  config: (net = 'mainnet') => cached(`melek:cfg:${net}`, () => melek.call(net, 'condenser_api.get_config'), 3600_000),
  accountCount: (net = 'mainnet') => cached(`melek:acc#:${net}`, () => melek.call(net, 'condenser_api.get_account_count')),
  async account(name, net = 'mainnet') {
    const r = await melek.call(net, 'condenser_api.get_accounts', [[name]]);
    if (!Array.isArray(r)) return null; // null = could not read
    return r[0] || false; // false = does not exist
  },
  history: (name, net = 'mainnet', limit = 100) => melek.call(net, 'condenser_api.get_account_history', [name, -1, limit]),
  witness: (name, net = 'mainnet') => melek.call(net, 'condenser_api.get_witness_by_account', [name]),
};

// ── PRANA (EVM) ───────────────────────────────────────────────────────────────────────────────────
export const SEL = {
  totalSupply: '0x18160ddd', cap: '0x355274ea', decimals: '0x313ce567', balanceOf: '0x70a08231',
  getReserves: '0x0902f1ac', token0: '0x0dfe1681', getPair: '0xe6a43905',
};
const pad32 = (hex) => String(hex).replace(/^0x/, '').toLowerCase().padStart(64, '0');
export const encAddr = (a) => pad32(a);

export const prana = {
  url: (net = 'mainnet') => CFG.pranaRpc[net] || CFG.pranaRpc.mainnet,
  call: (net, method, params = []) => rpc(prana.url(net), method, params),
  async ethCall(to, data, net = 'mainnet') {
    const r = await prana.call(net, 'eth_call', [{ to, data }, 'latest']);
    return typeof r === 'string' && r.startsWith('0x') && r.length > 2 ? r : null;
  },
  async uint(to, data, net = 'mainnet') {
    const r = await prana.ethCall(to, data, net);
    try { return r ? BigInt('0x' + r.slice(2, 66)) : null; } catch { return null; }
  },
  async address(to, data, net = 'mainnet') {
    const r = await prana.ethCall(to, data, net);
    return r && r.length >= 66 ? '0x' + r.slice(26, 66) : null;
  },
  totalSupply: (token, net) => prana.uint(token, SEL.totalSupply, net),
  cap: (token, net) => prana.uint(token, SEL.cap, net),
  balanceOf: (token, who, net) => prana.uint(token, SEL.balanceOf + encAddr(who), net),
  async nativeBalance(who, net = 'mainnet') {
    const r = await prana.call(net, 'eth_getBalance', [who, 'latest']);
    try { return typeof r === 'string' ? BigInt(r) : null; } catch { return null; }
  },
  async nonce(who, net = 'mainnet') {
    const r = await prana.call(net, 'eth_getTransactionCount', [who, 'latest']);
    try { return typeof r === 'string' ? Number(BigInt(r)) : null; } catch { return null; }
  },
  async blockNumber(net = 'mainnet') {
    const r = await prana.call(net, 'eth_blockNumber');
    try { return typeof r === 'string' ? Number(BigInt(r)) : null; } catch { return null; }
  },
  async chainId(net = 'mainnet') {
    const r = await prana.call(net, 'eth_chainId');
    try { return typeof r === 'string' ? Number(BigInt(r)) : null; } catch { return null; }
  },
  async reserves(pair, net = 'mainnet') {
    const r = await prana.ethCall(pair, SEL.getReserves, net);
    if (!r || r.length < 130) return null;
    try { return [BigInt('0x' + r.slice(2, 66)), BigInt('0x' + r.slice(66, 130))]; } catch { return null; }
  },
  token0: (pair, net) => prana.address(pair, SEL.token0, net),
  getPair: (factory, a, b, net) => prana.address(factory, SEL.getPair + encAddr(a) + encAddr(b), net),
  scanStats: (net = 'mainnet') => cached(`scan:stats:${net}`, () => getJSON(`${CFG.pranascan[net]}/api/v2/stats`)),
  scanToken: (addr, net = 'mainnet') => cached(`scan:tok:${net}:${addr}`, () => getJSON(`${CFG.pranascan[net]}/api/v2/tokens/${addr}`)),
  scanTxs: (addr, net = 'mainnet') => getJSON(`${CFG.pranascan[net]}/api/v2/addresses/${addr}/transactions?filter=from`),
};

// ── Hive-Engine + MELEK-Engine ────────────────────────────────────────────────────────────────────
export const hiveEngine = {
  async find(contract, table, query, limit = 1000) {
    const r = await rpc(CFG.hiveEngine, 'find', { contract, table, query, limit });
    return Array.isArray(r) ? r : null;
  },
  token: (sym) => cached(`he:tok:${sym}`, async () => (await hiveEngine.find('tokens', 'tokens', { symbol: sym }, 1))?.[0] || null),
  metrics: (sym) => cached(`he:met:${sym}`, async () => (await hiveEngine.find('market', 'metrics', { symbol: sym }, 1))?.[0] || null),
  holders: (sym) => cached(`he:hold:${sym}`, async () => {
    const r = await hiveEngine.find('tokens', 'balances', { symbol: sym }, 1000);
    if (!r) return null;
    return { count: r.filter((b) => Number(b.balance) + Number(b.stake || 0) > 0).length, capped: r.length >= 1000 };
  }, 600_000),
};

export const melekEngine = {
  tokens: () => cached('me:tokens', () => getJSON(`${CFG.melekEngine}/tokens`)),
  async token(sym) {
    const all = await melekEngine.tokens();
    return Array.isArray(all) ? (all.find((t) => t.symbol === sym) || false) : null;
  },
  async balance(account, sym) {
    const r = await getJSON(`${CFG.melekEngine}/balances?account=${encodeURIComponent(account)}&symbol=${encodeURIComponent(sym)}`);
    if (!Array.isArray(r)) return null;
    const b = r[0];
    return b ? Number(b.balance || 0) + Number(b.stake || 0) : 0;
  },
};

// ── formatting ────────────────────────────────────────────────────────────────────────────────────
/** units(big, decimals) → Number (display only; precision loss past 15 sig digits is acceptable for chat). */
export function units(big, decimals = 18) {
  if (big === null || big === undefined) return null;
  try {
    const b = BigInt(big);
    const d = 10n ** BigInt(decimals);
    return Number(b / d) + Number(b % d) / Number(d);
  } catch { return null; }
}

export function fmt(n, max = 4) {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return 'n/a';
  const v = Number(n);
  const digits = Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 1 ? 2 : max + 2;
  return v.toLocaleString('en-US', { maximumFractionDigits: digits });
}

/** NA — the one honest placeholder for a figure we could not fetch. */
export const NA = 'unavailable right now (live read failed)';
export const show = (n, unit = '', max) => (n === null || n === undefined ? NA : `${fmt(n, max)}${unit ? ' ' + unit : ''}`);

/** escChat — neutralize mention pings / code fences / markdown injection in interpolated values. */
export function escChat(s) {
  return String(s ?? '')
    .replace(/@(everyone|here)/gi, '@​$1')
    .replace(/<@[!&]?\d+>/g, '@user')
    .replace(/[`*_~|>]/g, (c) => '\\' + c)
    .slice(0, 300);
}
