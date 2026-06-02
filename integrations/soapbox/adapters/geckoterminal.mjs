// adapters/geckoterminal.mjs — Tier-1b on-chain/DEX (spec §5). Keyless, ~30 calls/min, 260+ networks.
// Where new + unlisted tokens land first (a token trading on a DEX before any CEX lists it). id form:
// "gt:<network>:<pool-or-token-address>". Same uniform interface; OHLC comes from pool endpoints.

import { normalizeCoin } from '../schema.mjs';

const UA = 'MELEK-SoapBox/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function jget(url, timeout = 12000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try { const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json;version=20230302' }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

export const id = 'geckoterminal';
export const tier = 1;
const BASE = 'https://api.geckoterminal.com/api/v2';

export async function fetchTokens() { return []; }  // GT is address-keyed; no global market list

// id: "gt:<network>:<token-address>"
export async function fetchToken(gid) {
  const [, network, address] = String(gid).split(':');
  if (!network || !address) throw new Error('geckoterminal id must be gt:<network>:<address>');
  const d = await jget(`${BASE}/networks/${network}/tokens/${address}`);
  const a = d.data?.attributes || {};
  return normalizeCoin({
    id: gid, symbol: a.symbol, name: a.name,
    price_usd: +a.price_usd || 0, market_cap_usd: +a.market_cap_usd || +a.fdv_usd || 0, volume_24h_usd: +a.volume_usd?.h24 || 0,
    supply: { total: +a.total_supply || 0 },
    chains: [network], contracts: [{ chain: network, address }],
  }, { tier: 1, source: 'geckoterminal', updatedAt: new Date().toISOString() });
}

export async function fetchOHLCV(gid, { days = 7 } = {}) {
  const [, network, address] = String(gid).split(':');
  // pools carry OHLCV; resolve the token's top pool, then its candles.
  const pools = await jget(`${BASE}/networks/${network}/tokens/${address}/pools?page=1`).catch(() => null);
  const pool = pools?.data?.[0]?.attributes?.address;
  if (!pool) return [];
  const tf = days <= 1 ? 'minute' : days <= 30 ? 'hour' : 'day';
  const d = await jget(`${BASE}/networks/${network}/pools/${pool}/ohlcv/${tf}?limit=168`).catch(() => null);
  return (d?.data?.attributes?.ohlcv_list || []).map(([t, , , , c]) => ({ t, p: +c })).reverse();
}
