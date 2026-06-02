// adapters/coingecko.mjs — Tier-1 primary. The uniform adapter interface every source implements
// (spec §4): fetchTokens(), fetchToken(id), fetchOHLCV(id). The condenser loops adapters and
// normalizes their output into the one schema — "adding a chain/source = adding one of these files."
// Keyless CoinGecko demo endpoints.

import { normalizeCoin } from '../schema.mjs';

const UA = 'MELEK-SoapBox/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function jget(url, timeout = 12000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try { const r = await _fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

export const id = 'coingecko';
export const tier = 1;

export async function fetchTokens({ limit = 50, page = 1 } = {}) {
  const arr = await jget(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=${page}&sparkline=true&price_change_percentage=24h`);
  return (Array.isArray(arr) ? arr : []).map((c) => ({
    id: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name,
    price_usd: c.current_price || 0, market_cap_usd: c.market_cap || 0, volume_24h_usd: c.total_volume || 0,
    change_24h: c.price_change_percentage_24h || 0, rank: c.market_cap_rank || null,
    sparkline_7d: c.sparkline_in_7d?.price || [],
  }));
}

export async function fetchToken(id) {
  const d = await jget(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false`);
  const m = d.market_data || {};
  return normalizeCoin({
    id: d.id, symbol: d.symbol, name: d.name,
    price_usd: m.current_price?.usd, market_cap_usd: m.market_cap?.usd, volume_24h_usd: m.total_volume?.usd,
    supply: { circulating: m.circulating_supply, total: m.total_supply, max: m.max_supply },
    chains: Object.keys(d.platforms || {}).filter(Boolean),
    contracts: Object.entries(d.platforms || {}).filter(([k, v]) => k && v).map(([chain, address]) => ({ chain, address })),
    links: { website: d.links?.homepage?.[0] || '', explorer: d.links?.blockchain_site?.[0] || '', social: [d.links?.twitter_screen_name && `https://twitter.com/${d.links.twitter_screen_name}`].filter(Boolean) },
  }, { tier: 1, source: 'coingecko', updatedAt: new Date().toISOString() });
}

export async function fetchOHLCV(id, { days = 7 } = {}) {
  const d = await jget(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`);
  return (d.prices || []).map(([t, p]) => ({ t: Math.floor(t / 1000), p }));
}
