// condenser.mjs — SoapBox's read-API spine ("the steemd"). Pulls a coin from the right tier
// and returns it in the ONE normalized schema. The site, Hathor, and the trade bots all call
// getCoin()/getCoins() — none of them talk to a tier feeder directly. REUSES the existing
// integrations/ readers as feeders (don't reinvent): he-client for Tier 2, CoinGecko keyless
// for Tier 1. Tier 3 (our native nodes) is the moat hook, stubbed until MELEK/SOAP RPC exists.
//
//   import { getCoin } from './soapbox/condenser.mjs'
//   node integrations/soapbox/condenser.mjs bitcoin        # tier-1 demo
//   node integrations/soapbox/condenser.mjs hive-engine:VKBT

import { normalizeCoin, validateCoin } from './schema.mjs';
import { find } from '../he-client.mjs';
import { hiveUsd as oracleHiveUsd } from '../price-oracle.mjs';
import { cached, TTL } from './cache.mjs';
import { fetchTokenFailover } from './adapters/index.mjs';
import { holders as heHolders } from '../holders.mjs';

// our ecosystem tokens to surface on the aggregator (Tier 2/3 first-party).
export const OUR_TOKENS = (process.env.SOAPBOX_OUR_TOKENS || 'VKBT,CURE,SWAP.GIFU').split(',').map((s) => s.trim());

const UA = 'MELEK-SoapBox/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
let _now = () => new Date().toISOString();        // injectable for deterministic tests
export function __setClock(fn) { _now = fn || (() => new Date().toISOString()); }

async function jget(url, timeout = 12000) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try { const r = await _fetch(url, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

// --- Tier 1: CoinGecko (keyless demo endpoints) -----------------------------
export async function fromCoinGecko(id) {
  const d = await jget(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}?localization=false&tickers=false&community_data=false&developer_data=false`);
  const m = d.market_data || {};
  return normalizeCoin({
    id: d.id, symbol: d.symbol, name: d.name,
    price_usd: m.current_price?.usd, market_cap_usd: m.market_cap?.usd, volume_24h_usd: m.total_volume?.usd,
    supply: { circulating: m.circulating_supply, total: m.total_supply, max: m.max_supply },
    chains: Object.keys(d.platforms || {}).filter(Boolean),
    contracts: Object.entries(d.platforms || {}).filter(([k, v]) => k && v).map(([chain, address]) => ({ chain, address })),
    links: { website: d.links?.homepage?.[0] || '', explorer: d.links?.blockchain_site?.[0] || '', social: [d.links?.twitter_screen_name && `https://twitter.com/${d.links.twitter_screen_name}`].filter(Boolean) },
  }, { tier: 1, source: 'coingecko', updatedAt: _now() });
}

// --- Tier 2: Hive-Engine (first-party; reuse he-client failover) -------------
export async function fromHiveEngine(symbol) {
  const sym = String(symbol).toUpperCase();
  const [tok] = await find('tokens', 'tokens', { symbol: sym }, 1);
  const [metric] = await find('market', 'metrics', { symbol: sym }, 1);
  if (!tok && !metric) return null;
  // HE prices are quoted in HIVE — convert to USD via the price oracle so the token shows a real
  // USD price on the aggregator like any other coin.
  const lastPriceHive = +(metric?.lastPrice || 0);
  const hiveUsd = await oracleHiveUsd().catch(() => 0);
  const priceUsd = lastPriceHive * hiveUsd;
  const circulating = +(tok?.circulatingSupply || 0);
  const coin = normalizeCoin({
    id: `hive-engine:${sym.toLowerCase()}`, symbol: sym, name: tok?.name || sym,
    price_usd: priceUsd,
    market_cap_usd: priceUsd * circulating,
    volume_24h_usd: +(metric?.volume || 0) * hiveUsd,
    supply: { circulating, total: +(tok?.supply || 0), max: +(tok?.maxSupply || 0) },
    chains: ['hive-engine'],
    links: tok?.metadata ? safeMeta(tok.metadata) : undefined,
    clarity_score: { inputs: ['holder_dist', 'supply_locks', 'contract_behavior', 'activity'] },
  }, { tier: 2, source: 'hive-engine', updatedAt: _now() });
  // real 24h change from the market metrics ("11.03%" → 11.03, or derived from lastDayPrice).
  const pctStr = metric?.priceChangePercent;
  coin.change_24h = pctStr != null ? parseFloat(String(pctStr).replace('%', ''))
    : (metric?.lastDayPrice ? (lastPriceHive / +metric.lastDayPrice - 1) * 100 : null);
  return coin;
}
function safeMeta(metaStr) {
  try { const m = JSON.parse(metaStr); return { website: m.url || '', explorer: '', social: [] }; } catch { return undefined; }
}

// top coins for the list page (Tier-1 CoinGecko markets, keyless). Normalized lightly.
// `sparkline` pulls the 7d price series for the list-page mini-charts (one extra field, same call).
export async function topCoins({ limit = 50, page = 1, sparkline = true } = {}) {
  return cached(`top:${limit}:${page}:${sparkline ? 1 : 0}`, TTL.list, async () => {
    const arr = await jget(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&order=market_cap_desc&per_page=${limit}&page=${page}&sparkline=${sparkline}&price_change_percentage=24h`);
    return (Array.isArray(arr) ? arr : []).map((c) => ({
      id: c.id, symbol: (c.symbol || '').toUpperCase(), name: c.name,
      price_usd: c.current_price || 0, market_cap_usd: c.market_cap || 0, volume_24h_usd: c.total_volume || 0,
      change_24h: c.price_change_percentage_24h || 0, rank: c.market_cap_rank || null,
      sparkline_7d: sparkline ? (c.sparkline_in_7d?.price || []) : [],
    }));
  });
}

// related coins for the coin page — ecosystem siblings for our tokens, else top coins sharing a
// chain/category. Cheap: drawn from the already-cached top list + ourCoins, no extra upstream call.
export async function relatedCoins(coin, { limit = 6 } = {}) {
  if (!coin) return [];
  const [ours, top] = await Promise.all([ourCoins().catch(() => []), topCoins({ limit: 50 }).catch(() => [])]);
  if (coin.source === 'hive-engine' || coin.source_tier === 2) {
    return ours.filter((c) => c.id !== coin.id).slice(0, limit);
  }
  const chains = new Set(coin.chains || []);
  const scored = top.filter((c) => c.id !== coin.id);
  // a coin shares relevance if it lives on one of this coin's chains; fall back to top-by-cap.
  const onChain = scored.filter((c) => c.chainsHint && chains.has(c.chainsHint));
  return (onChain.length ? onChain : scored).slice(0, limit);
}

// trending coins (CoinGecko /search/trending, keyless) — the "what people are searching" strip.
export async function trending({ limit = 7 } = {}) {
  return cached(`trending:${limit}`, TTL.list, async () => {
    const d = await jget('https://api.coingecko.com/api/v3/search/trending');
    return (d.coins || []).slice(0, limit).map(({ item }) => ({
      id: item.id, symbol: (item.symbol || '').toUpperCase(), name: item.name, rank: item.market_cap_rank || null,
    }));
  });
}

// global market stats for the list-page header (CoinGecko /global, keyless).
export async function globalStats() {
  return cached('global', TTL.list, async () => {
    const d = await jget('https://api.coingecko.com/api/v3/global');
    const g = d.data || {};
    return {
      total_market_cap_usd: g.total_market_cap?.usd || 0,
      total_volume_usd: g.total_volume?.usd || 0,
      btc_dominance: g.market_cap_percentage?.btc || 0,
      eth_dominance: g.market_cap_percentage?.eth || 0,
      active_cryptocurrencies: g.active_cryptocurrencies || 0,
      market_cap_change_24h: g.market_cap_change_percentage_24h_usd || 0,
    };
  });
}

// OHLCV-ish price series for the coin-page chart. CoinGecko market_chart is keyless and returns
// [ms, price] points; we hand the site a light {t, p} series (lightweight-charts maps it to a line).
// Hive-Engine candles come from the market history endpoint when we wire Tier-2 charts; for now a
// Tier-2 id returns [] (the chart panel shows "history coming" rather than a broken graph).
export async function coinChart(id, { days = 7 } = {}) {
  if (!id) return [];
  if (id.startsWith('node:')) return []; // Tier 3 — wired when MELEK/SOAP RPC exists
  if (id.startsWith('hive-engine:')) return hiveEngineChart(id.split(':')[1], { days });
  return cached(`chart:${id}:${days}`, TTL.ohlcv, async () => {
    const d = await jget(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=${days}`);
    return (d.prices || []).map(([t, p]) => ({ t: Math.floor(t / 1000), p }));
  });
}

// Tier-2 chart: build a real USD price series for a Hive-Engine token from its on-chain trade
// history (prices are quoted in HIVE → convert via the oracle). This is what gives OUR ecosystem
// tokens (VKBT/CURE) a genuine chart instead of a placeholder.
export async function hiveEngineChart(symbol, { days = 7 } = {}) {
  const sym = String(symbol).toUpperCase();
  return cached(`chart:he:${sym}:${days}`, TTL.ohlcv, async () => {
    const cutoff = Math.floor(Date.now() / 1000) - days * 86400;
    const trades = await find('market', 'tradesHistory', { symbol: sym }, 500, [{ index: 'timestamp', descending: true }]).catch(() => []);
    const hiveUsd = await oracleHiveUsd().catch(() => 0);
    if (!hiveUsd || !trades.length) return [];
    return trades
      .filter((t) => +t.timestamp >= cutoff)
      .map((t) => ({ t: +t.timestamp, p: +t.price * hiveUsd }))
      .sort((a, b) => a.t - b.t);
  });
}

// First-party coin-page extras for a Hive-Engine token: holder distribution + live order book.
// This is data no third-party lister has (we read the chain). Cached together.
export async function hiveEngineExtras(symbol) {
  const sym = String(symbol).toUpperCase();
  return cached(`he:extras:${sym}`, TTL.clarity, async () => {
    const [h, buy, sell, hiveUsd] = await Promise.all([
      heHolders(sym).catch(() => null),
      find('market', 'buyBook', { symbol: sym }, 8, [{ index: 'price', descending: true }]).catch(() => []),
      find('market', 'sellBook', { symbol: sym }, 8, [{ index: 'price', descending: false }]).catch(() => []),
      oracleHiveUsd().catch(() => 0),
    ]);
    const lvl = (o) => ({ priceUsd: +o.price * hiveUsd, priceHive: +o.price, qty: +o.quantity });
    return { holders: h, buyBook: buy.map(lvl), sellBook: sell.map(lvl) };
  });
}

// our ecosystem tokens (Tier-2 Hive-Engine), normalized + USD-priced, for the top of the list.
export async function ourCoins() {
  return cached('ourCoins', TTL.price, async () => {
    const coins = await Promise.all(OUR_TOKENS.map((s) => fromHiveEngine(s).catch(() => null)));
    return coins.filter(Boolean).map((c) => ({
      id: c.id, symbol: c.symbol, name: c.name, price_usd: c.price_usd, market_cap_usd: c.market_cap_usd,
      volume_24h_usd: c.volume_24h_usd, change_24h: c.change_24h ?? null, rank: null, ours: true,
    }));
  });
}

// --- the read API the site/Hathor/bots call --------------------------------
// id forms: "bitcoin" (tier 1), "hive-engine:VKBT" (tier 2), "node:melek:..." (tier 3, stub).
export async function getCoin(id) {
  if (!id) return null;
  return cached(`coin:${id}`, TTL.price, async () => {
    let coin = null;
    if (id.startsWith('hive-engine:')) coin = await fromHiveEngine(id.split(':')[1]);
    else coin = await fetchTokenFailover(id); // adapter registry: Tier-1 (CG→Paprika), gt: DEX, node: Tier-3
    if (!coin) return null;
    const { valid, errors } = validateCoin(coin);
    return { ...coin, _valid: valid, _errors: errors };
  });
}

if (process.argv[1] && process.argv[1].endsWith('condenser.mjs')) {
  const id = process.argv[2] || 'bitcoin';
  const coin = await getCoin(id);
  console.log(JSON.stringify(coin, null, 2));
}
