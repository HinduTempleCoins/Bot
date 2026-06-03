// unified-data.mjs — unified read/data API adapter (queue #168).
// One interface over multiple multichain read providers, with failover and a single
// normalized + provenance-tagged schema. Feeds the Data.SoapBox 3-tier ingest.
//
// Providers (in failover order):
//   1. Covalent / GoldRush  — keyed (COVALENT_KEY or GOLDRUSH_KEY env). Soft-fails when absent.
//   2. The Graph            — GraphQL subgraph queries (keyless token-api / hosted subgraphs).
//
// Design (mirrors integrations/soapbox/macro.mjs): ESM, __setFetch hook for offline tests,
// soft-fail that NEVER throws (always returns [] on total failure), CLI guarded by argv check.
//
//   import { balances, tokenTransfers, txByHash } from './chains/unified-data.mjs'
//   await balances({ chain: 'ethereum', address: '0x...' })
//
// Keys are read from env only, never logged or printed.

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';

let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject a fetch implementation; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// chain name -> { covalent: <covalent chain slug>, graph: <the-graph token-api network id> }.
// Covalent uses names like 'eth-mainnet'; The Graph token-api uses 'mainnet'/'matic'/etc.
export const CHAIN_MAP = {
  ethereum:  { covalent: 'eth-mainnet',       graph: 'mainnet' },
  bsc:       { covalent: 'bsc-mainnet',        graph: 'bsc' },
  polygon:   { covalent: 'matic-mainnet',      graph: 'matic' },
  base:      { covalent: 'base-mainnet',       graph: 'base' },
  arbitrum:  { covalent: 'arbitrum-mainnet',   graph: 'arbitrum-one' },
  optimism:  { covalent: 'optimism-mainnet',   graph: 'optimism' },
  avalanche: { covalent: 'avalanche-mainnet',  graph: 'avalanche' },
};

const COVALENT_BASE = 'https://api.covalenthq.com/v1';
// The Graph token-api — a keyless-ish unified balances/transfers endpoint over many chains.
const GRAPH_TOKEN_API = 'https://token-api.thegraph.com';

function covalentKey() {
  return process.env.COVALENT_KEY || process.env.GOLDRUSH_KEY || '';
}

async function jsonFetch(url, opts = {}, timeout = 12000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, {
      headers: { 'user-agent': UA, accept: 'application/json', ...(opts.headers || {}) },
      signal: ctrl.signal,
      ...opts,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally { clearTimeout(t); }
}

// --- normalization helpers -------------------------------------------------

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
const lc = (v) => (typeof v === 'string' ? v.toLowerCase() : v);

function tag(rows, provider, chain) {
  return rows.map((r) => ({ ...r, chain, provider, source: provider }));
}

// --- Covalent / GoldRush provider -----------------------------------------

const covalent = {
  async balances({ chain, address }) {
    const key = covalentKey();
    if (!key) throw new Error('no covalent key'); // soft-fail to next provider
    const c = CHAIN_MAP[chain]?.covalent;
    if (!c) throw new Error(`unmapped chain ${chain}`);
    const url = `${COVALENT_BASE}/${c}/address/${encodeURIComponent(address)}/balances_v2/?key=${encodeURIComponent(key)}`;
    const j = await jsonFetch(url);
    if (j?.error) throw new Error(j.error_message || 'covalent error');
    const items = j?.data?.items || [];
    return tag(items.map((it) => ({
      contract: lc(it.contract_address),
      symbol: it.contract_ticker_symbol || null,
      name: it.contract_name || null,
      decimals: num(it.contract_decimals),
      balance: it.balance != null ? String(it.balance) : null,
      quoteUsd: num(it.quote),
    })), 'covalent', chain);
  },

  async tokenTransfers({ chain, address }) {
    const key = covalentKey();
    if (!key) throw new Error('no covalent key');
    const c = CHAIN_MAP[chain]?.covalent;
    if (!c) throw new Error(`unmapped chain ${chain}`);
    const url = `${COVALENT_BASE}/${c}/address/${encodeURIComponent(address)}/transfers_v2/?key=${encodeURIComponent(key)}`;
    const j = await jsonFetch(url);
    if (j?.error) throw new Error(j.error_message || 'covalent error');
    const items = j?.data?.items || [];
    const out = [];
    for (const it of items) {
      for (const tr of (it.transfers || [])) {
        out.push({
          hash: lc(it.tx_hash || tr.tx_hash),
          from: lc(tr.from_address),
          to: lc(tr.to_address),
          contract: lc(tr.contract_address),
          symbol: tr.contract_ticker_symbol || null,
          decimals: num(tr.contract_decimals),
          value: tr.delta != null ? String(tr.delta) : null,
          timestamp: it.block_signed_at || tr.block_signed_at || null,
          blockHeight: num(it.block_height),
        });
      }
    }
    return tag(out, 'covalent', chain);
  },

  async txByHash({ chain, hash }) {
    const key = covalentKey();
    if (!key) throw new Error('no covalent key');
    const c = CHAIN_MAP[chain]?.covalent;
    if (!c) throw new Error(`unmapped chain ${chain}`);
    const url = `${COVALENT_BASE}/${c}/transaction_v2/${encodeURIComponent(hash)}/?key=${encodeURIComponent(key)}`;
    const j = await jsonFetch(url);
    if (j?.error) throw new Error(j.error_message || 'covalent error');
    const it = j?.data?.items?.[0];
    if (!it) return [];
    return tag([{
      hash: lc(it.tx_hash),
      from: lc(it.from_address),
      to: lc(it.to_address),
      value: it.value != null ? String(it.value) : null,
      feeUsd: num(it.fees_paid),
      success: it.successful !== false,
      timestamp: it.block_signed_at || null,
      blockHeight: num(it.block_height),
    }], 'covalent', chain);
  },
};

// --- The Graph provider ----------------------------------------------------

async function graphGet(path, params) {
  const c = CHAIN_MAP[params.chain]?.graph;
  if (!c) throw new Error(`unmapped chain ${params.chain}`);
  const qs = new URLSearchParams({ network_id: c, ...params.query }).toString();
  const headers = {};
  const tok = process.env.GRAPH_API_KEY || process.env.THEGRAPH_KEY;
  if (tok) headers.authorization = `Bearer ${tok}`;
  const j = await jsonFetch(`${GRAPH_TOKEN_API}${path}?${qs}`, { headers });
  if (j?.error) throw new Error(typeof j.error === 'string' ? j.error : 'graph error');
  return j?.data || [];
}

const graph = {
  async balances({ chain, address }) {
    const rows = await graphGet('/balances/evm/' + encodeURIComponent(address), {
      chain, query: {},
    });
    return tag((rows || []).map((b) => ({
      contract: lc(b.contract),
      symbol: b.symbol || null,
      name: b.name || null,
      decimals: num(b.decimals),
      balance: b.amount != null ? String(b.amount) : (b.value != null ? String(b.value) : null),
      quoteUsd: num(b.value_usd ?? b.valueUsd),
    })), 'thegraph', chain);
  },

  async tokenTransfers({ chain, address }) {
    const rows = await graphGet('/transfers/evm/' + encodeURIComponent(address), {
      chain, query: {},
    });
    return tag((rows || []).map((t) => ({
      hash: lc(t.transaction_id ?? t.tx_hash ?? t.hash),
      from: lc(t.from),
      to: lc(t.to),
      contract: lc(t.contract),
      symbol: t.symbol || null,
      decimals: num(t.decimals),
      value: t.amount != null ? String(t.amount) : (t.value != null ? String(t.value) : null),
      timestamp: t.datetime ?? t.timestamp ?? null,
      blockHeight: num(t.block_num ?? t.block_height),
    })), 'thegraph', chain);
  },

  async txByHash({ chain, hash }) {
    const rows = await graphGet('/transfers/evm', {
      chain, query: { transaction_id: hash },
    });
    return tag((rows || []).map((t) => ({
      hash: lc(t.transaction_id ?? t.tx_hash ?? t.hash),
      from: lc(t.from),
      to: lc(t.to),
      value: t.amount != null ? String(t.amount) : (t.value != null ? String(t.value) : null),
      feeUsd: null,
      success: true,
      timestamp: t.datetime ?? t.timestamp ?? null,
      blockHeight: num(t.block_num ?? t.block_height),
    })), 'thegraph', chain);
  },
};

// failover order: keyed Covalent first (richest), then keyless-ish The Graph.
const PROVIDERS = [covalent, graph];

// Run providers in order; first one to return without throwing wins. Soft-fail to [].
async function withFailover(method, args) {
  for (const p of PROVIDERS) {
    const fn = p[method];
    if (!fn) continue;
    try {
      const out = await fn(args);
      if (Array.isArray(out)) return out; // a result (possibly empty) from a provider that worked
    } catch { /* try next provider */ }
  }
  return [];
}

/** Normalized token balances for an address on a chain. Soft-fails to []. */
export async function balances({ chain, address } = {}) {
  if (!chain || !address) return [];
  return withFailover('balances', { chain, address });
}

/** Normalized token-transfer history for an address on a chain. Soft-fails to []. */
export async function tokenTransfers({ chain, address } = {}) {
  if (!chain || !address) return [];
  return withFailover('tokenTransfers', { chain, address });
}

/** Normalized single-transaction lookup by hash. Returns [] or a one-element array. Soft-fails to []. */
export async function txByHash({ chain, hash } = {}) {
  if (!chain || !hash) return [];
  return withFailover('txByHash', { chain, hash });
}

if (process.argv[1] && process.argv[1].endsWith('unified-data.mjs')) {
  const [, , chain, address] = process.argv;
  if (!chain || !address) {
    console.log('usage: node integrations/chains/unified-data.mjs <chain> <address>');
    console.log('chains:', Object.keys(CHAIN_MAP).join(', '));
    console.log(covalentKey() ? 'covalent key: present' : 'covalent key: ABSENT (will use The Graph)');
  } else {
    const bal = await balances({ chain, address });
    console.log(`balances (${bal.length}) via ${bal[0]?.provider || 'none'}:`);
    for (const b of bal.slice(0, 20)) {
      console.log(`  ${(b.symbol || '?').padEnd(10)} ${String(b.balance).padStart(28)}  ${b.quoteUsd != null ? '$' + b.quoteUsd.toFixed(2) : ''}`);
    }
  }
}
