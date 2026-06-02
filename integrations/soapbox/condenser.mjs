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
// Only genuine Van Kush ecosystem currencies belong here. SWAP.GIFU is a pegged/wrapped Hive-Engine
// token, NOT an ecosystem currency — removed so it isn't mislabeled "ecosystem" or pinned on top.
export const OUR_TOKENS = (process.env.SOAPBOX_OUR_TOKENS || 'VKBT,CURE').split(',').map((s) => s.trim());

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
      image: c.image || '',
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

// a market-cap-weighted 7d index from the top coins' sparklines (keyless — CoinGecko's total-mcap
// history endpoint needs a key, so we compute an honest equivalent from data we already have). Each
// coin's 7d path is normalized to its start, weighted by market cap, summed → a total-return index
// rebased to 100. Labeled as what it is: a top-N cap-weighted market index, not CG's raw figure.
export async function marketIndex({ limit = 50 } = {}) {
  return cached(`mktidx:${limit}`, TTL.list, async () => {
    const top = await topCoins({ limit, sparkline: true });
    const series = top.filter((c) => c.sparkline_7d?.length > 2 && c.market_cap_usd > 0);
    if (!series.length) return [];
    const n = Math.min(...series.map((c) => c.sparkline_7d.length));
    const totalCap = series.reduce((a, c) => a + c.market_cap_usd, 0);
    const out = [];
    for (let i = 0; i < n; i++) {
      let v = 0;
      for (const c of series) { const s = c.sparkline_7d; v += c.market_cap_usd * (s[i] / s[0]); }
      out.push({ t: i, p: (v / totalCap) * 100 });
    }
    return out;
  });
}

// coin-link finder phase 2: for coins CoinGecko doesn't carry an official thread for (especially our
// Hive-Engine ecosystem tokens), SEARCH the web for the real Bitcointalk/Altcoinstalks/announcement
// thread. Heavily cached (24h) so it's ~one search per coin per day. Best-effort.
// high-traffic crypto forums + boards that carry official coin/announcement threads (researched
// 2026). Each entry: [url-pattern, label]. The Hive/Steem/Blurt boards matter for our own ecosystem
// tokens (VKBT/CURE post there). Order = display priority.
const FORUMS = [
  [/bitcointalk\.org/i, 'Bitcointalk'], [/altcoinstalks\.com/i, 'Altcoinstalks'],
  [/cryptocurrencytalk\.com/i, 'CryptocurrencyTalk'], [/bitcoingarden\.org/i, 'BitcoinGarden'],
  [/cryptointalk\.com/i, 'CryptoInTalk'], [/forum\.bitcoin\.com|bitcoin\.com\/forum/i, 'Bitcoin.com'],
  [/bitco\.in/i, 'Bitco.in'], [/reddit\.com\/r\//i, 'Reddit'],
  [/peakd\.com|ecency\.com|hive\.blog/i, 'Hive'], [/steemit\.com/i, 'Steemit'],
  [/blurt\.blog|blurtter/i, 'Blurt'], [/waivio\.com/i, 'Waivio'], [/tribaldex\.com/i, 'TribalDEX'],
  [/(index\.php\?topic|\/ann\b|announcement)/i, 'Forum'],
];
export async function officialThreads(name, symbol) {
  const q = `${name} ${symbol}`.trim();
  if (!q) return [];
  return cached(`threads:${q.toLowerCase()}`, 86_400_000, async () => {
    try {
      const { search } = await import('../scraper.mjs');
      const hits = await search(`${name} ${symbol} token official announcement thread forum`, { limit: 12 });
      const out = [], seen = new Set();
      // normalize a forum URL so the same thread at different pages/anchors dedups (topic=N.40 → topic=N)
      const norm = (u) => u.replace(/(topic=\d+)[.\d]*/i, '$1').replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
      for (const h of hits) {
        const f = FORUMS.find(([re]) => re.test(h.url));
        const k = norm(h.url);
        if (f && !seen.has(k)) { seen.add(k); out.push({ title: h.title, url: h.url, forum: f[1] }); }
        if (out.length >= 5) break;
      }
      return out;
    } catch { return []; }
  });
}

// where to trade a coin — CoinGecko tickers (which exchanges list it + volume + trust). Powers the
// "Where to trade" panel and the market fact-checker's "can you buy X on Y / was it delisted" checks.
export async function coinTickers(id, { limit = 12 } = {}) {
  if (!id || id.startsWith('hive-engine:') || id.startsWith('node:')) return [];
  return cached(`tickers:${id}`, TTL.metadata, async () => {
    const d = await jget(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/tickers?page=1&order=volume_desc&depth=false`);
    return (d.tickers || []).slice(0, limit).map((t) => ({
      exchange: t.market?.name || '', pair: `${t.base}/${t.target}`,
      price_usd: t.converted_last?.usd || 0, volume_usd: t.converted_volume?.usd || 0,
      trust: t.trust_score || null, url: t.trade_url || '',
    })).filter((t) => t.exchange);
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

// The timeframe choices offered on every coin page: [range-key, label, coingecko-days]. '1h' reuses the
// keyless days=1 series (5-min granularity) and slices the last hour. 'max' = all history we can get.
export const CHART_RANGES = [['1h', '1H', 1], ['1d', '1D', 1], ['7d', '7D', 7], ['30d', '1M', 30], ['365d', '1Y', 365], ['max', 'All', 'max']];

/** Price series for a chart range-key (1h|1d|7d|30d|365d|max). Works for CoinGecko + Hive-Engine ids. */
export async function coinChartRange(id, range = '7d') {
  const row = CHART_RANGES.find((r) => r[0] === range) || CHART_RANGES.find((r) => r[0] === '7d');
  const days = row[2];
  let series = await coinChart(id, { days });
  // 'max': CoinGecko's KEYLESS API caps history at 365d, so days=max comes back empty for those coins —
  // fall back to 365 so "All" still shows the most we can get. (Hive-Engine ids read full on-chain history.)
  if (range === 'max' && series.length < 2) series = await coinChart(id, { days: 365 }).catch(() => series);
  if (range === '1h' && series.length) {
    const last = series[series.length - 1].t;
    const win = series.filter((s) => s.t >= last - 3600);
    series = win.length >= 2 ? win : series.slice(-12); // fall back to last few points if <1h of data
  }
  return series;
}

// Tier-2 chart: build a real USD price series for a Hive-Engine token from its on-chain trade
// history (prices are quoted in HIVE → convert via the oracle). This is what gives OUR ecosystem
// tokens (VKBT/CURE) a genuine chart instead of a placeholder.
export async function hiveEngineChart(symbol, { days = 7 } = {}) {
  const sym = String(symbol).toUpperCase();
  const dnum = days === 'max' ? 3650 : days; // 'max' → ~10y of on-chain trade history
  return cached(`chart:he:${sym}:${days}`, TTL.ohlcv, async () => {
    const cutoff = Math.floor(Date.now() / 1000) - dnum * 86400;
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
