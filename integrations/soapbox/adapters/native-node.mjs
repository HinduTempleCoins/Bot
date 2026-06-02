// adapters/native-node.mjs — Tier-3, the MOAT (spec §3/§4). Reads OUR OWN chains (MELEK/SOAP, and
// later PRANA) and maps them into the same one schema — data no third-party lister has, because
// they don't run the nodes. CMC structurally can't replicate this tier.
//
// It is intentionally a SCAFFOLD: gated behind an RPC URL in the environment. Until a chain's RPC
// exists, fetchToken returns null (the coin simply isn't listed — never a fake price). The moment
// MELEK_RPC_URL / SOAP_RPC_URL is set, this file is where the real Graphene/steemd queries land —
// one config step to switch the moat on. id form: "node:<chain>:<symbol>".

import { normalizeCoin } from '../schema.mjs';

const UA = 'MELEK-SoapBox/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

export const id = 'native-node';
export const tier = 3;

// chain → RPC endpoint, from env. Empty until the chains are live (Phase 1 gate, see CLAUDE.md).
export const RPC = {
  melek: process.env.MELEK_RPC_URL || '',
  soap: process.env.SOAP_RPC_URL || '',
  prana: process.env.PRANA_RPC_URL || '',
};

export function isConfigured(chain) { return !!RPC[chain]; }

async function rpc(url, method, params = [], timeout = 12000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', 'user-agent': UA },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const d = await r.json();
    if (d.error) throw new Error(d.error.message || 'rpc error');
    return d.result;
  } finally { clearTimeout(t); }
}

export async function fetchTokens() {
  // when the chain is live: enumerate its assets and map each. Until then, nothing to list.
  return [];
}

// id: "node:<chain>:<symbol>"  e.g. "node:melek:MELEK"
export async function fetchToken(fullId) {
  const [, chain, symbol] = String(fullId).split(':');
  if (!chain || !isConfigured(chain)) return null;   // not live yet → not listed, no fake data
  // ── real Graphene/steemd mapping goes here once RPC is live ────────────────
  // const obj = await rpc(RPC[chain], 'get_objects', [[`asset:${symbol}`]]);
  // const supply = await rpc(RPC[chain], 'get_asset_supply', [symbol]);
  // map (price from the internal market / our condenser's own feeds) → normalizeCoin(...).
  const info = await rpc(RPC[chain], 'lookup_asset_symbols', [[symbol]]).catch(() => null);
  if (!info || !info[0]) return null;
  const a = info[0];
  return normalizeCoin({
    id: fullId, symbol: a.symbol || symbol, name: a.symbol || symbol,
    price_usd: 0,                                    // wired to the internal market feed when live
    supply: { total: +(a.dynamic_asset_data?.current_supply || 0) },
    chains: [chain],
    clarity_score: { inputs: ['holder_dist', 'supply_locks', 'contract_behavior', 'activity'] },
  }, { tier: 3, source: `node:${chain}`, updatedAt: new Date().toISOString() });
}

export async function fetchOHLCV() { return []; }    // backfilled from genesis once the chain is live
