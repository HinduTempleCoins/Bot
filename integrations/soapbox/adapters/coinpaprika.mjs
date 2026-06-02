// adapters/coinpaprika.mjs — Tier-1 SECONDARY / failover. Same uniform interface. Keyless
// (20k calls/mo). Two jobs: (1) cover for CoinGecko when it rate-limits, (2) the People endpoint
// for founder/team metadata CoinGecko doesn't carry (spec §5). CoinPaprika ids look like
// "btc-bitcoin"; we accept either that or a bare CoinGecko-style id and resolve via /search.

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

export const id = 'coinpaprika';
export const tier = 1;

// resolve a loose id ("bitcoin") to a paprika id ("btc-bitcoin"); pass through if already one.
async function resolveId(loose) {
  if (/-/.test(loose)) return loose;
  const d = await jget(`https://api.coinpaprika.com/v1/search?q=${encodeURIComponent(loose)}&c=currencies&limit=1`).catch(() => null);
  return d?.currencies?.[0]?.id || `${loose}`;
}

export async function fetchTokens({ limit = 50 } = {}) {
  const arr = await jget('https://api.coinpaprika.com/v1/tickers?quotes=USD');
  return (Array.isArray(arr) ? arr : []).slice(0, limit).map((c) => ({
    id: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name,
    price_usd: c.quotes?.USD?.price || 0, market_cap_usd: c.quotes?.USD?.market_cap || 0,
    volume_24h_usd: c.quotes?.USD?.volume_24h || 0, change_24h: c.quotes?.USD?.percent_change_24h || 0,
    rank: c.rank || null, sparkline_7d: [],
  }));
}

export async function fetchToken(loose) {
  const pid = await resolveId(loose);
  const c = await jget(`https://api.coinpaprika.com/v1/tickers/${encodeURIComponent(pid)}?quotes=USD`);
  // team metadata is a separate, optional call — never let it fail the price fetch.
  const meta = await jget(`https://api.coinpaprika.com/v1/coins/${encodeURIComponent(pid)}`).catch(() => null);
  const team = (meta?.team || []).slice(0, 8).map((t) => ({ name: t.name, role: (t.position || ''), social: '' }));
  return normalizeCoin({
    id: loose, symbol: c.symbol, name: c.name,
    price_usd: c.quotes?.USD?.price, market_cap_usd: c.quotes?.USD?.market_cap, volume_24h_usd: c.quotes?.USD?.volume_24h,
    supply: { circulating: c.circulating_supply, total: c.total_supply, max: c.max_supply },
    links: { website: meta?.links?.website?.[0] || '', explorer: meta?.links?.explorer?.[0] || '', social: meta?.links?.twitter?.map((x) => x.url || x) || [] },
    team,
  }, { tier: 1, source: 'coinpaprika', updatedAt: new Date().toISOString() });
}

// paprika historical needs a key for fine granularity; skip OHLCV here (CoinGecko/GeckoTerminal cover it).
export async function fetchOHLCV() { return []; }
