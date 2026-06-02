// markets-extra.mjs — keyless readers for the secondary market surfaces (categories, exchanges,
// chains/TVL, stablecoins, fear & greed, global market-cap history). Each is cached and feeds one
// new route through the page factory. No keys, read-only.

import { cached, TTL } from './cache.mjs';

const UA = 'MELEK-SoapBox/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function jget(url, timeout = 15000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try { const r = await _fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

// Crypto Fear & Greed index (alternative.me) — 0 (extreme fear) … 100 (extreme greed).
export async function fearGreed() {
  return cached('fng', TTL.list, async () => {
    const d = await jget('https://api.alternative.me/fng/');
    const x = d.data?.[0] || {};
    return { value: +x.value || null, classification: x.value_classification || '', updated: x.timestamp || '' };
  });
}

// CoinGecko categories (L1, DeFi, memes…) by market cap.
export async function categories({ limit = 30 } = {}) {
  return cached(`cats:${limit}`, TTL.metadata, async () => {
    const arr = await jget('https://api.coingecko.com/api/v3/coins/categories?order=market_cap_desc');
    return (Array.isArray(arr) ? arr : []).slice(0, limit).map((c) => ({
      id: c.id, name: c.name, market_cap: c.market_cap || 0, change_24h: c.market_cap_change_24h ?? null,
      volume_24h: c.volume_24h || 0, top: (c.top_3_coins_id || []).slice(0, 3),
    }));
  });
}

// CoinGecko exchanges by volume + trust score.
export async function exchanges({ limit = 25 } = {}) {
  return cached(`exch:${limit}`, TTL.metadata, async () => {
    const arr = await jget(`https://api.coingecko.com/api/v3/exchanges?per_page=${limit}&page=1`);
    return (Array.isArray(arr) ? arr : []).map((e) => ({
      id: e.id, name: e.name, country: e.country || '', year: e.year_established || null,
      trust: e.trust_score ?? null, volume_btc: e.trade_volume_24h_btc || 0,
    }));
  });
}

// market caps for a set of CoinGecko ids (the chains' native coins) — so /chains can show market
// cap ALONGSIDE TVL. They mean different things: market cap = price × circulating supply of the
// native coin; TVL = value of assets locked in that chain's DeFi contracts.
export async function marketCapsByIds(ids = []) {
  const list = [...new Set(ids.filter(Boolean))];
  if (!list.length) return {};
  return cached(`mcaps:${list.sort().join(',')}`, TTL.price, async () => {
    const arr = await jget(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${encodeURIComponent(list.join(','))}&per_page=250&page=1&sparkline=false`);
    const out = {};
    for (const c of (Array.isArray(arr) ? arr : [])) out[c.id] = { market_cap: c.market_cap || 0, price: c.current_price || 0 };
    return out;
  });
}

// DeFiLlama chain TVL (the multi-chain overview).
export async function chainsTVL({ limit = 30 } = {}) {
  return cached(`chains:${limit}`, TTL.metadata, async () => {
    const arr = await jget('https://api.llama.fi/v2/chains');
    return (Array.isArray(arr) ? arr : []).filter((c) => Number.isFinite(c.tvl))
      .sort((a, b) => b.tvl - a.tvl).slice(0, limit)
      .map((c) => ({ name: c.name, tvl: c.tvl, symbol: c.tokenSymbol || '', gecko_id: c.gecko_id || '' }));
  });
}

// DeFiLlama stablecoins — circulating + peg deviation.
export async function stablecoins({ limit = 15 } = {}) {
  return cached(`stables:${limit}`, TTL.metadata, async () => {
    const d = await jget('https://stablecoins.llama.fi/stablecoins?includePrices=true');
    return (d.peggedAssets || []).slice(0, limit).map((s) => {
      const circ = s.circulating?.peggedUSD ?? Object.values(s.circulating || {})[0] ?? 0;
      const price = s.price ?? null;
      return { name: s.name, symbol: s.symbol, mechanism: s.pegMechanism || '', circulating: +circ || 0,
        price, peg_off: price != null ? (price - 1) * 100 : null };
    });
  });
}

// total market-cap history (CoinGecko global market chart) for a homepage trend line.
export async function marketCapHistory({ days = 30 } = {}) {
  return cached(`mcaphist:${days}`, TTL.ohlcv, async () => {
    const d = await jget(`https://api.coingecko.com/api/v3/global/market_cap_chart?days=${days}`).catch(() => null);
    const pts = d?.market_cap_chart?.market_cap || [];
    return pts.map(([t, v]) => ({ t: Math.floor(t / 1000), p: v }));
  });
}
