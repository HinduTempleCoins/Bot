// api-catalog.mjs — the foundational catalog of LIVE market-DATA APIs across all asset classes.
// This is the "what can we read, how often, and for free?" layer behind the Resource Center's
// arbitrage watch (tasks #175/#176/#177). It is a STRUCTURED INDEX, not live clients — the live
// keyless clients already live in integrations/free-apis.mjs; this catalog tells the bots and
// the Directory WHICH source to reach for, whether it needs a key, and how hard they can poll.
//
// Each entry:
//   { name, base, asset, keyless, freeTier, pollable, note }
//     keyless  : true  → no signup/key needed (safe to call from any host, hammer-friendly).
//                false → requires an API key (provisioned to the vault, never hard-coded here).
//     freeTier : human-readable free-tier limit ('<calls/limit notes>'); 'keyless/public' for
//                no-auth endpoints with soft IP rate limits. Approximate — bots should VERIFY.
//     pollable : 'constant'  → cheap/keyless; safe to poll on a tight loop (the arbitrage tickers).
//                'on-demand' → keyless but heavier or rate-limited; poll when asked, cache hard.
//                'keyed'     → behind a key + a real quota; schedule, don't hammer.
//
// No secrets in this file. No live calls at module load. Knowledge as of mid-2026 — free tiers
// and rate limits change; treat numbers as a starting point.

export const ASSETS = ['crypto', 'forex', 'stocks', 'bonds', 'macro', 'news', 'multi'];

export const DATA_APIS = [
  // ── CRYPTO ───────────────────────────────────────────────────────────────────────────────
  { name: 'CoinGecko', base: 'https://api.coingecko.com/api/v3', asset: 'crypto', keyless: true, freeTier: 'keyless/public ~10-30 calls/min (soft); Demo key for more', pollable: 'on-demand', note: 'Prices, markets, global, categories, exchanges, trending. Our workhorse.' },
  { name: 'CoinCap', base: 'https://api.coincap.io/v2', asset: 'crypto', keyless: true, freeTier: 'keyless/public ~200 req/min', pollable: 'constant', note: 'Lightweight asset prices + history.' },
  { name: 'CoinPaprika', base: 'https://api.coinpaprika.com/v1', asset: 'crypto', keyless: true, freeTier: 'keyless/public ~20k calls/mo', pollable: 'on-demand', note: 'Tickers, OHLCV, coin metadata.' },
  { name: 'Binance public', base: 'https://api.binance.com/api/v3', asset: 'crypto', keyless: true, freeTier: 'keyless/public; weight-limited (1200 wt/min)', pollable: 'constant', note: 'Spot tickers/depth/klines. Deep order books for arb. (Read-only public; no US-account needed.)' },
  { name: 'Kraken public', base: 'https://api.kraken.com/0/public', asset: 'crypto', keyless: true, freeTier: 'keyless/public; tiered rate limit', pollable: 'constant', note: 'Ticker/Depth/OHLC; US-friendly venue.' },
  { name: 'Coinbase public', base: 'https://api.coinbase.com/v2', asset: 'crypto', keyless: true, freeTier: 'keyless/public', pollable: 'constant', note: 'Spot prices; pair with Exchange/Advanced API for books.' },
  { name: 'Coinbase Exchange', base: 'https://api.exchange.coinbase.com', asset: 'crypto', keyless: true, freeTier: 'keyless/public ~10 req/s', pollable: 'constant', note: 'Order books / trades / candles (public market data).' },
  { name: 'OKX public', base: 'https://www.okx.com/api/v5/market', asset: 'crypto', keyless: true, freeTier: 'keyless/public; rate-limited', pollable: 'constant', note: 'Tickers/books; now a US-available venue.' },
  { name: 'Bitstamp public', base: 'https://www.bitstamp.net/api/v2', asset: 'crypto', keyless: true, freeTier: 'keyless/public', pollable: 'constant', note: 'US-friendly venue tickers/books.' },
  { name: 'Gemini public', base: 'https://api.gemini.com/v1', asset: 'crypto', keyless: true, freeTier: 'keyless/public ~120 req/min', pollable: 'constant', note: 'US-regulated venue tickers/books.' },
  { name: 'Bitfinex public', base: 'https://api-pub.bitfinex.com/v2', asset: 'crypto', keyless: true, freeTier: 'keyless/public; rate-limited', pollable: 'constant', note: 'Tickers/books (non-US venue — data only).' },
  { name: 'KuCoin public', base: 'https://api.kucoin.com/api/v1', asset: 'crypto', keyless: true, freeTier: 'keyless/public', pollable: 'constant', note: 'Public market data only (venue is US-barred — never route US funds here).' },
  { name: 'Gate.io public', base: 'https://api.gateio.ws/api/v4', asset: 'crypto', keyless: true, freeTier: 'keyless/public', pollable: 'constant', note: 'Tickers/books (non-US venue — data only).' },
  { name: 'MEXC public', base: 'https://api.mexc.com/api/v3', asset: 'crypto', keyless: true, freeTier: 'keyless/public', pollable: 'constant', note: 'Tickers (non-US venue — data only).' },
  { name: 'Bybit public', base: 'https://api.bybit.com/v5/market', asset: 'crypto', keyless: true, freeTier: 'keyless/public', pollable: 'constant', note: 'Tickers (non-US venue — data only).' },
  { name: 'CryptoCompare', base: 'https://min-api.cryptocompare.com/data', asset: 'crypto', keyless: true, freeTier: 'keyless basic; key raises 100k/mo', pollable: 'on-demand', note: 'Multi-exchange prices + history; key unlocks more.' },
  { name: 'CoinLore', base: 'https://api.coinlore.net/api', asset: 'crypto', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'Simple ticker/global; redundancy.' },
  { name: 'DefiLlama', base: 'https://api.llama.fi', asset: 'crypto', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'TVL by chain/protocol; coins.llama.fi for prices; stablecoins.llama.fi.' },
  { name: 'DexScreener', base: 'https://api.dexscreener.com/latest/dex', asset: 'crypto', keyless: true, freeTier: 'keyless/public ~300 req/min', pollable: 'on-demand', note: 'DEX pair prices/liquidity across chains — the DEX-side arb feed.' },
  { name: 'GeckoTerminal', base: 'https://api.geckoterminal.com/api/v2', asset: 'crypto', keyless: true, freeTier: 'keyless/public ~30 req/min', pollable: 'on-demand', note: 'On-chain DEX pools/OHLCV.' },
  { name: 'Hive-Engine', base: 'https://api.hive-engine.com/rpc', asset: 'crypto', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'OUR ecosystem — layer-2 token markets (VKBT/CURE), balances, metrics.' },
  { name: 'Alternative.me F&G', base: 'https://api.alternative.me/fng', asset: 'crypto', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'Crypto Fear & Greed index + history.' },
  { name: 'CoinMarketCap', base: 'https://pro-api.coinmarketcap.com/v1', asset: 'crypto', keyless: false, freeTier: 'key: ~10k credits/mo (Basic)', pollable: 'keyed', note: 'Reference rankings/metadata; key → vault.' },
  { name: 'Messari', base: 'https://data.messari.io/api', asset: 'crypto', keyless: false, freeTier: 'key: limited free tier', pollable: 'keyed', note: 'Curated metrics/research; key → vault.' },

  // ── FOREX / FX ─────────────────────────────────────────────────────────────────────────────
  { name: 'Frankfurter', base: 'https://api.frankfurter.app', asset: 'forex', keyless: true, freeTier: 'keyless/public (ECB daily rates)', pollable: 'on-demand', note: 'Reference FX rates (daily, ECB). No intraday.' },
  { name: 'exchangerate.host', base: 'https://api.exchangerate.host', asset: 'forex', keyless: true, freeTier: 'keyless/public (key on newer plans)', pollable: 'on-demand', note: 'FX + some crypto conversion; verify current key requirement.' },
  { name: 'open.er-api.com', base: 'https://open.er-api.com/v6', asset: 'forex', keyless: true, freeTier: 'keyless/public (daily)', pollable: 'on-demand', note: 'Open exchange-rate feed; redundancy for FX reference.' },
  { name: 'Twelve Data', base: 'https://api.twelvedata.com', asset: 'multi', keyless: false, freeTier: 'key: 800 calls/day, 8/min', pollable: 'keyed', note: 'FX + stocks + crypto; generous free daily quota; key → vault.' },

  // ── STOCKS / EQUITIES ──────────────────────────────────────────────────────────────────────
  { name: 'Yahoo Finance (unofficial)', base: 'https://query1.finance.yahoo.com', asset: 'multi', keyless: true, freeTier: 'keyless/public (unofficial; throttle gently)', pollable: 'on-demand', note: 'Quotes/charts for stocks, ETFs, FX, indices, some crypto. Best free breadth — but unofficial; cache hard.' },
  { name: 'Alpha Vantage', base: 'https://www.alphavantage.co/query', asset: 'multi', keyless: false, freeTier: 'key: 25 calls/day, 5/min', pollable: 'keyed', note: 'Stocks/FX/crypto + indicators; tight free quota; key → vault.' },
  { name: 'Finnhub', base: 'https://finnhub.io/api/v1', asset: 'stocks', keyless: false, freeTier: 'key: 60 calls/min free', pollable: 'keyed', note: 'Realtime-ish stock/FX/crypto, fundamentals, news; best free RPM; key → vault.' },
  { name: 'Financial Modeling Prep (FMP)', base: 'https://financialmodelingprep.com/api/v3', asset: 'stocks', keyless: false, freeTier: 'key: 250 calls/day', pollable: 'keyed', note: 'Quotes + fundamentals/financials; key → vault.' },
  { name: 'Polygon.io', base: 'https://api.polygon.io', asset: 'stocks', keyless: false, freeTier: 'key: 5 calls/min (free)', pollable: 'keyed', note: 'US equities/options/FX/crypto; delayed on free; key → vault.' },
  { name: 'Tiingo', base: 'https://api.tiingo.com', asset: 'stocks', keyless: false, freeTier: 'key: ~1000 req/day, 50/hr', pollable: 'keyed', note: 'EOD + intraday stocks/crypto/news; key → vault.' },
  { name: 'Marketstack', base: 'https://api.marketstack.com/v1', asset: 'stocks', keyless: false, freeTier: 'key: ~100 req/mo (free)', pollable: 'keyed', note: 'Global EOD equities; small free tier; key → vault.' },

  // ── BONDS / MACRO ──────────────────────────────────────────────────────────────────────────
  { name: 'FRED (St. Louis Fed)', base: 'https://api.stlouisfed.org/fred', asset: 'macro', keyless: false, freeTier: 'free key, generous (no hard daily cap published)', pollable: 'keyed', note: 'Rates, yields, CPI, GDP, M2 — the macro backbone. Free key → vault.' },
  { name: 'US Treasury Fiscal Data', base: 'https://api.fiscaldata.treasury.gov/services/api/fiscal_service', asset: 'bonds', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'Treasury rates, auctions, debt, yield curve. No key.' },
  { name: 'Treasury Yield Curve (XML)', base: 'https://home.treasury.gov/resource-center/data-chart-center/interest-rates', asset: 'bonds', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'Daily par yield curve rates (XML feed).' },
  { name: 'World Bank', base: 'https://api.worldbank.org/v2', asset: 'macro', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'Global macro indicators (GDP, inflation, rates by country).' },
  { name: 'IMF', base: 'https://www.imf.org/external/datamapper/api/v1', asset: 'macro', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'IMF DataMapper macro series.' },
  { name: 'BLS (US Labor)', base: 'https://api.bls.gov/publicAPI/v2', asset: 'macro', keyless: true, freeTier: 'keyless ~25 req/day; key → 500/day', pollable: 'on-demand', note: 'CPI, unemployment, PPI. Registration key raises quota.' },
  { name: 'ECB Data Portal', base: 'https://data-api.ecb.europa.eu/service/data', asset: 'macro', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'Euro-area rates / FX reference / monetary stats.' },

  // ── NEWS / SENTIMENT ───────────────────────────────────────────────────────────────────────
  { name: 'CryptoPanic', base: 'https://cryptopanic.com/api/v1', asset: 'news', keyless: false, freeTier: 'free key; rate-limited', pollable: 'keyed', note: 'Aggregated crypto news + votes/sentiment; key → vault.' },
  { name: 'GDELT', base: 'https://api.gdeltproject.org/api/v2', asset: 'news', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'Global news/event/tone firehose; great for macro sentiment.' },
  { name: 'CoinDesk RSS', base: 'https://www.coindesk.com/arc/outboundfeeds/rss', asset: 'news', keyless: true, freeTier: 'keyless/public (RSS)', pollable: 'on-demand', note: 'Crypto headlines via RSS.' },
  { name: 'Cointelegraph RSS', base: 'https://cointelegraph.com/rss', asset: 'news', keyless: true, freeTier: 'keyless/public (RSS)', pollable: 'on-demand', note: 'Crypto headlines via RSS.' },
  { name: 'SEC EDGAR', base: 'https://data.sec.gov', asset: 'stocks', keyless: true, freeTier: 'keyless/public (declare User-Agent; ~10 req/s)', pollable: 'on-demand', note: 'US company filings/financial facts. Equity fundamentals at the source.' },
  { name: 'Hacker News (Firebase)', base: 'https://hacker-news.firebaseio.com/v0', asset: 'news', keyless: true, freeTier: 'keyless/public', pollable: 'on-demand', note: 'Tech/finance signal; already wired in free-apis.mjs.' },
];

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────

// All catalog entries.
export function allApis() {
  return DATA_APIS;
}

// Keyless APIs — safe to call from any host with no provisioning. The bots' first reach.
export function keylessApis() {
  return DATA_APIS.filter((a) => a.keyless);
}

// APIs cheap/safe enough to poll on a tight loop (the constant arbitrage tickers).
// Pass a pollable tier to filter precisely; default returns the 'constant' set.
export function pollableApis(tier = 'constant') {
  return DATA_APIS.filter((a) => a.pollable === tier);
}

// APIs covering an asset class. 'multi' sources (Yahoo, Twelve Data, Alpha Vantage) are included
// for crypto/forex/stocks queries since they span those classes.
export function apisByAsset(asset) {
  return DATA_APIS.filter((a) => a.asset === asset || (a.asset === 'multi' && ['crypto', 'forex', 'stocks'].includes(asset)));
}

// Keyed APIs — need a key in the vault before use; schedule, don't hammer.
export function keyedApis() {
  return DATA_APIS.filter((a) => !a.keyless);
}

// Quick counts for the summary / Directory header.
export function summary() {
  const byAsset = Object.fromEntries(ASSETS.map((a) => [a, DATA_APIS.filter((x) => x.asset === a).length]));
  return {
    total: DATA_APIS.length,
    keyless: keylessApis().length,
    keyed: keyedApis().length,
    constant: pollableApis('constant').length,
    onDemand: pollableApis('on-demand').length,
    keyedPollable: pollableApis('keyed').length,
    byAsset,
  };
}

// CLI summary:  node integrations/soapbox/api-catalog.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = summary();
  console.log('\nMELEK api-catalog');
  console.log('─'.repeat(60));
  console.log(`Total APIs: ${s.total}`);
  console.log(`Keyless: ${s.keyless}   Keyed: ${s.keyed}`);
  console.log(`Pollable — constant: ${s.constant}, on-demand: ${s.onDemand}, keyed: ${s.keyedPollable}`);
  console.log('By asset class:');
  for (const [a, c] of Object.entries(s.byAsset)) console.log(`  ${a.padEnd(12)} ${c}`);
  console.log('─'.repeat(60));
}
