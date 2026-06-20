// markets-catalog.mjs — the foundational catalog of MARKETS and EXCHANGES across all asset
// classes (crypto, stocks, forex, bonds, commodities). This is the data layer behind the
// Resource Center's "watch hundreds of venues for arbitrage + tell Americans where they can
// trade" vision (tasks #175/#176/#177).
//
// ─────────────────────────────────────────────────────────────────────────────────────────
//  WE OPERATE FROM THE US.  `us` availability is a FIRST-CLASS field on every venue.
// ─────────────────────────────────────────────────────────────────────────────────────────
//  The trade bots and the Directory ask one question of this catalog before anything else:
//  "Should WE (a US-operated entity) open an account here?"  A venue that is `us:'no'` is not
//  off the table for the PROJECT — a non-US server / non-US entity could cover the rest of the
//  world — but it is off the table for a US-resident operator/host. So the field distinguishes:
//
//     'full'    — open to US persons nationwide (modulo routine KYC).
//     'partial' — US-accessible but with carve-outs (some states excluded, some assets/products
//                 like derivatives blocked, or a separate US entity with a thinner listing).
//     'no'      — blocks US persons / US IPs (often by regulator order or settlement).
//     'unknown' — not verified; bots MUST confirm before relying on it.
//
//  This is a static reference snapshot (knowledge as of mid-2026). Regulatory status moves;
//  the bots should treat `us` as a STARTING POINT and re-verify before opening accounts or
//  routing capital. No live calls are made at module load — pure data + helpers.

// Asset-class tags used across the catalog.
export const ASSETS = ['crypto', 'stocks', 'forex', 'bonds', 'commodities'];

// ── Crypto exchanges (CEX + DEX) ──────────────────────────────────────────────────────────
// `type`: 'CEX' (custodial order book) | 'DEX' (on-chain, non-custodial).
// DEXs are generally reachable by anyone with a wallet; the US question for a DEX is about the
// FRONT END / fiat on-ramps and whether the operating entity geoblocks US IPs, so several read
// 'partial' (interface restricted, contracts still reachable) — bots should note the nuance.
export const CRYPTO_EXCHANGES = [
  // — US-friendly majors —
  { name: 'Coinbase', url: 'https://www.coinbase.com', type: 'CEX', asset: 'crypto', us: 'full', note: 'US-headquartered; the default US on-ramp.' },
  { name: 'Kraken', url: 'https://www.kraken.com', type: 'CEX', asset: 'crypto', us: 'full', note: 'US-based; some products (futures/staking) state-restricted.' },
  { name: 'Gemini', url: 'https://www.gemini.com', type: 'CEX', asset: 'crypto', us: 'full', note: 'NY-regulated (NYDFS trust).' },
  { name: 'Crypto.com', url: 'https://crypto.com', type: 'CEX', asset: 'crypto', us: 'full', note: 'US app + exchange; product set narrower than global.' },
  { name: 'Binance.US', url: 'https://www.binance.us', type: 'CEX', asset: 'crypto', us: 'partial', note: 'Separate US entity; fiat rails + listings have been restricted at times; not all states.' },
  { name: 'Bitstamp', url: 'https://www.bitstamp.net', type: 'CEX', asset: 'crypto', us: 'full', note: 'Long-running; US-supported (now Robinhood-owned).' },
  { name: 'River', url: 'https://river.com', type: 'CEX', asset: 'crypto', us: 'full', note: 'US BTC-focused brokerage.' },
  { name: 'Coinbase Advanced (Pro)', url: 'https://www.coinbase.com/advanced-trade', type: 'CEX', asset: 'crypto', us: 'full', note: 'Coinbase pro order book.' },
  { name: 'Robinhood Crypto', url: 'https://robinhood.com/crypto', type: 'CEX', asset: 'crypto', us: 'partial', note: 'US broker; crypto withdrawals limited historically; not all states.' },
  { name: 'Cash App', url: 'https://cash.app', type: 'CEX', asset: 'crypto', us: 'full', note: 'BTC buy/sell + lightning; US consumer rail.' },
  { name: 'OKX (US)', url: 'https://www.okx.com', type: 'CEX', asset: 'crypto', us: 'partial', note: 'Relaunched US access Apr-2025 after DOJ settlement; rolling out by state.' },
  { name: 'Bitnomial', url: 'https://bitnomial.com', type: 'CEX', asset: 'crypto', us: 'full', note: 'US CFTC-regulated crypto derivatives exchange.' },
  { name: 'CoinList', url: 'https://coinlist.co', type: 'CEX', asset: 'crypto', us: 'partial', note: 'US token launches/staking; some assets state-restricted.' },
  { name: 'Coinmama', url: 'https://www.coinmama.com', type: 'CEX', asset: 'crypto', us: 'partial', note: 'Brokerage on-ramp; varies by state.' },
  { name: 'Bullish', url: 'https://bullish.com', type: 'CEX', asset: 'crypto', us: 'unknown', note: 'Institutional-leaning; US retail status varies — verify.' },
  { name: 'Uphold', url: 'https://uphold.com', type: 'CEX', asset: 'crypto', us: 'full', api: 'public+trade', kyc: 'standard', note: 'US multi-asset (crypto/metals/equities); has a trading API + many pairs — useful arb leg.' },
  { name: 'Strike', url: 'https://strike.me', type: 'CEX', asset: 'crypto', us: 'full', api: 'limited', kyc: 'standard', note: 'BTC + lightning, low fees; API limited.' },
  { name: 'Swan Bitcoin', url: 'https://www.swanbitcoin.com', type: 'CEX', asset: 'crypto', us: 'full', api: 'limited', kyc: 'standard', note: 'US BTC-only accumulation broker.' },
  { name: 'CEX.IO', url: 'https://cex.io', type: 'CEX', asset: 'crypto', us: 'partial', api: 'public+trade', kyc: 'standard', note: 'US-accessible in many states; full REST/WebSocket trading API.' },
  { name: 'Coinbase Derivatives', url: 'https://www.coinbase.com/derivatives', type: 'CEX', asset: 'crypto', us: 'partial', api: 'public+trade', kyc: 'standard', note: 'CFTC-regulated US crypto futures (ex-FairX); eligibility-gated.' },

  // — Global majors, generally US-RESTRICTED —
  { name: 'Binance', url: 'https://www.binance.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Global entity blocks US persons; US users routed to Binance.US.' },
  { name: 'Bybit', url: 'https://www.bybit.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Blocks US IPs / US residents.' },
  { name: 'KuCoin', url: 'https://www.kucoin.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'CFTC consent order (2026) permanently bars US users; US IP access disabled.' },
  { name: 'Bitget', url: 'https://www.bitget.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Does not serve US persons.' },
  { name: 'MEXC', url: 'https://www.mexc.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'No KYC for small accounts but restricts US; verify.' },
  { name: 'Gate.io', url: 'https://www.gate.io', type: 'CEX', asset: 'crypto', us: 'no', note: 'Exited US market; blocks US users.' },
  { name: 'HTX (Huobi)', url: 'https://www.htx.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Does not serve US persons.' },
  { name: 'Kraken Pro (global futures)', url: 'https://futures.kraken.com', type: 'CEX', asset: 'crypto', us: 'partial', note: 'Futures arm; US access limited/eligibility-gated.' },
  { name: 'Bitfinex', url: 'https://www.bitfinex.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Exited US retail.' },
  { name: 'Bitmart', url: 'https://www.bitmart.com', type: 'CEX', asset: 'crypto', us: 'partial', note: 'Claims US support in some states; verify.' },
  { name: 'Poloniex', url: 'https://poloniex.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Dropped US users post-2019.' },
  { name: 'Phemex', url: 'https://phemex.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Restricts US persons.' },
  { name: 'WhiteBIT', url: 'https://whitebit.com', type: 'CEX', asset: 'crypto', us: 'unknown', note: 'EU-leaning; US status unverified.' },
  { name: 'BingX', url: 'https://bingx.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Restricts US persons.' },
  { name: 'CoinW', url: 'https://www.coinw.com', type: 'CEX', asset: 'crypto', us: 'unknown', note: 'Verify US eligibility.' },
  { name: 'LBank', url: 'https://www.lbank.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Restricts US persons.' },
  { name: 'Bitrue', url: 'https://www.bitrue.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Restricts US persons.' },
  { name: 'Upbit', url: 'https://upbit.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Korea-focused; no US service.' },
  { name: 'Bithumb', url: 'https://www.bithumb.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'Korea-focused; no US service.' },
  { name: 'Bitvavo', url: 'https://bitvavo.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'EU-only.' },
  { name: 'Bitpanda', url: 'https://www.bitpanda.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'EU-only.' },
  { name: 'WazirX', url: 'https://wazirx.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'India-focused; no US service.' },
  { name: 'CoinDCX', url: 'https://coindcx.com', type: 'CEX', asset: 'crypto', us: 'no', note: 'India-focused; no US service.' },

  // — DEXs (on-chain, non-custodial) —
  { name: 'Uniswap', url: 'https://uniswap.org', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Contracts open globally; the hosted UI geoblocks some tokens/US — use any front end.' },
  { name: 'PancakeSwap', url: 'https://pancakeswap.finance', type: 'DEX', asset: 'crypto', us: 'partial', note: 'BSC-first AMM; UI restricts some products to US.' },
  { name: 'Curve', url: 'https://curve.fi', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Stable/pegged-asset AMM; contracts open.' },
  { name: 'SushiSwap', url: 'https://www.sushi.com', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Multi-chain AMM.' },
  { name: 'Balancer', url: 'https://balancer.fi', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Weighted-pool AMM.' },
  { name: '1inch', url: 'https://1inch.io', type: 'DEX', asset: 'crypto', us: 'partial', note: 'DEX aggregator; UI geo-restrictions apply.' },
  { name: 'dYdX', url: 'https://dydx.exchange', type: 'DEX', asset: 'crypto', us: 'no', note: 'Perps DEX; UI blocks US persons.' },
  { name: 'Hyperliquid', url: 'https://hyperliquid.xyz', type: 'DEX', asset: 'crypto', us: 'no', note: 'On-chain perps; front end restricts US.' },
  { name: 'GMX', url: 'https://gmx.io', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Perp/spot DEX (Arbitrum/Avalanche); verify.' },
  { name: 'Jupiter', url: 'https://jup.ag', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Solana swap aggregator.' },
  { name: 'Raydium', url: 'https://raydium.io', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Solana AMM.' },
  { name: 'Orca', url: 'https://www.orca.so', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Solana AMM.' },
  { name: 'Aerodrome', url: 'https://aerodrome.finance', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Base-chain AMM.' },
  { name: 'Trader Joe', url: 'https://traderjoexyz.com', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Avalanche/multi-chain AMM.' },
  { name: 'PumpSwap / Pump.fun', url: 'https://pump.fun', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Solana memecoin launchpad/AMM.' },
  { name: 'Velodrome', url: 'https://velodrome.finance', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Optimism AMM.' },
  { name: 'THORChain', url: 'https://thorchain.org', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Cross-chain native-asset swaps (no wrapping).' },
  { name: 'Osmosis', url: 'https://osmosis.zone', type: 'DEX', asset: 'crypto', us: 'partial', note: 'Cosmos-ecosystem AMM.' },
  { name: 'CoW Swap', url: 'https://swap.cow.fi', type: 'DEX', asset: 'crypto', us: 'partial', api: 'public+order', kyc: 'none', note: 'MEV-protected intent/aggregator (CoW Protocol); batch auctions; solver API.' },
  { name: 'Matcha (0x)', url: 'https://matcha.xyz', type: 'DEX', asset: 'crypto', us: 'partial', api: 'public+swap', kyc: 'none', note: '0x-powered DEX aggregator; the 0x Swap API is a clean programmatic route.' },
  { name: 'Meteora', url: 'https://www.meteora.ag', type: 'DEX', asset: 'crypto', us: 'partial', api: 'public', kyc: 'none', note: 'Solana DLMM/dynamic-pool AMM; deep memecoin + major liquidity.' },
  { name: 'Camelot', url: 'https://camelot.exchange', type: 'DEX', asset: 'crypto', us: 'partial', api: 'public', kyc: 'none', note: 'Arbitrum-native AMM; launch liquidity hub.' },

  // — Our ecosystem (Hive-Engine / Graphene) —
  { name: 'Hive-Engine', url: 'https://hive-engine.com', type: 'DEX', asset: 'crypto', us: 'partial', note: 'OUR ecosystem — layer-2 token DEX on Hive; non-custodial via Hive keys. Lists VKBT/CURE etc.' },
  { name: 'TribalDEX', url: 'https://tribaldex.com', type: 'DEX', asset: 'crypto', us: 'partial', note: 'OUR ecosystem — Hive-Engine front end / diesel-pool AMM.' },
  { name: 'Beeswap', url: 'https://beeswap.dcity.io', type: 'DEX', asset: 'crypto', us: 'partial', note: 'OUR ecosystem — Hive-Engine swap UI.' },
];

// ── Stocks / forex / bonds / commodities venues (brokers + exchanges) ───────────────────────
// Brokers are where a US person actually transacts; exchanges are the matching venues behind
// them (listed for completeness so the Directory can show "where the asset actually trades").
export const TRADFI_VENUES = [
  // — Stock/multi-asset BROKERS (US-accessible) —
  { name: 'Interactive Brokers (IBKR)', url: 'https://www.interactivebrokers.com', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Global multi-asset broker; stocks, options, futures, forex, bonds.' },
  { name: 'Charles Schwab', url: 'https://www.schwab.com', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Stocks, options, futures (thinkorswim), bonds, forex via affiliates.' },
  { name: 'Fidelity', url: 'https://www.fidelity.com', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Stocks, options, bonds, some crypto.' },
  { name: 'E*TRADE (Morgan Stanley)', url: 'https://us.etrade.com', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Stocks, options, futures, bonds.' },
  { name: 'Robinhood', url: 'https://robinhood.com', type: 'BROKER', asset: 'stocks', us: 'partial', note: 'Stocks/options/crypto; futures newer; product gating by state.' },
  { name: 'Webull', url: 'https://www.webull.com', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Stocks, options, some futures.' },
  { name: 'TastyTrade', url: 'https://tastytrade.com', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Options/futures-focused broker.' },
  { name: 'TradeStation', url: 'https://www.tradestation.com', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Stocks, options, futures, crypto.' },
  { name: 'Vanguard', url: 'https://investor.vanguard.com', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Stocks, ETFs, bonds, funds.' },
  { name: 'Merrill (BofA)', url: 'https://www.merrilledge.com', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Stocks, options, bonds.' },
  { name: 'Public.com', url: 'https://public.com', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Stocks, options, bonds, treasuries, crypto.' },
  { name: 'SoFi Invest', url: 'https://www.sofi.com/invest', type: 'BROKER', asset: 'stocks', us: 'full', note: 'Stocks, ETFs, options.' },

  // — Stock EXCHANGES —
  { name: 'NYSE', url: 'https://www.nyse.com', type: 'EXCHANGE', asset: 'stocks', us: 'full', note: 'New York Stock Exchange (ICE-owned).' },
  { name: 'Nasdaq', url: 'https://www.nasdaq.com', type: 'EXCHANGE', asset: 'stocks', us: 'full', note: 'US equities + listings.' },
  { name: 'Cboe', url: 'https://www.cboe.com', type: 'EXCHANGE', asset: 'stocks', us: 'full', note: 'Options + equities + volatility (VIX).' },
  { name: 'LSE', url: 'https://www.londonstockexchange.com', type: 'EXCHANGE', asset: 'stocks', us: 'partial', note: 'UK listings; US persons trade via brokers (IBKR etc.).' },
  { name: 'Euronext', url: 'https://www.euronext.com', type: 'EXCHANGE', asset: 'stocks', us: 'partial', note: 'Pan-European exchange; access via broker.' },
  { name: 'Deutsche Börse (Xetra)', url: 'https://www.xetra.com', type: 'EXCHANGE', asset: 'stocks', us: 'partial', note: 'German equities; access via broker.' },
  { name: 'Japan Exchange (JPX)', url: 'https://www.jpx.co.jp', type: 'EXCHANGE', asset: 'stocks', us: 'partial', note: 'Tokyo Stock Exchange; access via broker.' },
  { name: 'Hong Kong Exchanges (HKEX)', url: 'https://www.hkex.com.hk', type: 'EXCHANGE', asset: 'stocks', us: 'partial', note: 'HK listings; access via broker.' },
  { name: 'TSX (Toronto)', url: 'https://www.tsx.com', type: 'EXCHANGE', asset: 'stocks', us: 'partial', note: 'Canadian listings; access via broker.' },
  { name: 'NSE India', url: 'https://www.nseindia.com', type: 'EXCHANGE', asset: 'stocks', us: 'no', note: 'India equities; foreign retail access tightly restricted.' },

  // — FOREX brokers/venues —
  { name: 'OANDA', url: 'https://www.oanda.com', type: 'BROKER', asset: 'forex', us: 'full', note: 'US-regulated retail FX (NFA/CFTC).' },
  { name: 'Forex.com (StoneX)', url: 'https://www.forex.com', type: 'BROKER', asset: 'forex', us: 'full', note: 'US-regulated retail FX.' },
  { name: 'IG', url: 'https://www.ig.com', type: 'BROKER', asset: 'forex', us: 'partial', note: 'Global FX/CFD; US offering limited (FX via tastyfx).' },
  { name: 'Interactive Brokers FX', url: 'https://www.interactivebrokers.com', type: 'BROKER', asset: 'forex', us: 'full', note: 'Spot FX within IBKR.' },
  { name: 'Saxo Bank', url: 'https://www.home.saxo', type: 'BROKER', asset: 'forex', us: 'no', note: 'Does not onboard US retail.' },
  { name: 'Pepperstone', url: 'https://pepperstone.com', type: 'BROKER', asset: 'forex', us: 'no', note: 'No US retail.' },
  { name: 'EBS / CME FX', url: 'https://www.cmegroup.com/markets/fx.html', type: 'EXCHANGE', asset: 'forex', us: 'full', note: 'Listed FX futures via CME; institutional spot via EBS.' },

  // — BONDS / fixed income —
  { name: 'TreasuryDirect', url: 'https://www.treasurydirect.gov', type: 'VENUE', asset: 'bonds', us: 'full', note: 'Buy US Treasuries directly from the government (US citizens/residents).' },
  { name: 'IBKR Bonds', url: 'https://www.interactivebrokers.com/en/trading/bonds.php', type: 'BROKER', asset: 'bonds', us: 'full', note: 'Corporate/muni/treasury secondary market.' },
  { name: 'Fidelity Fixed Income', url: 'https://www.fidelity.com/fixed-income-bonds/overview', type: 'BROKER', asset: 'bonds', us: 'full', note: 'Bond ladder/secondary market.' },
  { name: 'Schwab BondSource', url: 'https://www.schwab.com/fixed-income', type: 'BROKER', asset: 'bonds', us: 'full', note: 'Secondary bond market.' },
  { name: 'Public Treasuries', url: 'https://public.com/treasuries', type: 'BROKER', asset: 'bonds', us: 'full', note: 'Retail T-bill access.' },
  { name: 'MarketAxess', url: 'https://www.marketaxess.com', type: 'EXCHANGE', asset: 'bonds', us: 'partial', note: 'Electronic corporate-bond marketplace (institutional).' },
  { name: 'Tradeweb', url: 'https://www.tradeweb.com', type: 'EXCHANGE', asset: 'bonds', us: 'partial', note: 'Fixed-income/rates marketplace (institutional).' },

  // — COMMODITIES / derivatives exchanges —
  { name: 'CME Group', url: 'https://www.cmegroup.com', type: 'EXCHANGE', asset: 'commodities', us: 'full', note: 'Futures/options: energy, metals, ags, rates, FX, crypto futures.' },
  { name: 'ICE', url: 'https://www.ice.com', type: 'EXCHANGE', asset: 'commodities', us: 'full', note: 'Intercontinental Exchange — energy/softs/financials; owns NYSE.' },
  { name: 'COMEX (CME)', url: 'https://www.cmegroup.com/markets/metals.html', type: 'EXCHANGE', asset: 'commodities', us: 'full', note: 'Metals futures (gold/silver/copper).' },
  { name: 'NYMEX (CME)', url: 'https://www.cmegroup.com/markets/energy.html', type: 'EXCHANGE', asset: 'commodities', us: 'full', note: 'Energy futures (crude/natgas).' },
  { name: 'CBOT (CME)', url: 'https://www.cmegroup.com/markets/agriculture.html', type: 'EXCHANGE', asset: 'commodities', us: 'full', note: 'Ag/grains + Treasury futures.' },
  { name: 'LME', url: 'https://www.lme.com', type: 'EXCHANGE', asset: 'commodities', us: 'partial', note: 'London Metal Exchange; US access via broker.' },
  { name: 'APMEX', url: 'https://www.apmex.com', type: 'VENUE', asset: 'commodities', us: 'full', note: 'Physical precious-metals dealer (spot bullion).' },
  { name: 'JM Bullion', url: 'https://www.jmbullion.com', type: 'VENUE', asset: 'commodities', us: 'full', note: 'Physical precious-metals dealer.' },
];

// All venues, both crypto and tradfi, in one array.
export const EXCHANGES = [...CRYPTO_EXCHANGES, ...TRADFI_VENUES];

// `MARKETS` — the asset classes themselves with the venue rollup, so the Directory can render an
// asset-class overview without re-filtering. Counts are derived (kept honest, never drift).
export const MARKETS = ASSETS.map((asset) => {
  const venues = EXCHANGES.filter((e) => e.asset === asset);
  return {
    asset,
    venueCount: venues.length,
    usFriendlyCount: venues.filter((e) => e.us === 'full' || e.us === 'partial').length,
    venues: venues.map((e) => e.name),
  };
});

// ── Helpers ─────────────────────────────────────────────────────────────────────────────────

// Every venue in the catalog.
export function allExchanges() {
  return EXCHANGES;
}

// Venues for one asset class ('crypto' | 'stocks' | 'forex' | 'bonds' | 'commodities').
export function exchangesByAsset(asset) {
  return EXCHANGES.filter((e) => e.asset === asset);
}

// Venues a US-operated entity can actually use for an asset class: us:'full' or us:'partial'.
// Pass no asset to get US-friendly venues across all classes.
export function usFriendly(asset) {
  const ok = (e) => e.us === 'full' || e.us === 'partial';
  return asset ? EXCHANGES.filter((e) => e.asset === asset && ok(e)) : EXCHANGES.filter(ok);
}

// Crypto-only convenience filters.
export function cryptoExchanges({ type } = {}) {
  return type ? CRYPTO_EXCHANGES.filter((e) => e.type === type) : CRYPTO_EXCHANGES;
}

// Quick counts for the summary / Directory header.
export function summary() {
  const byAsset = Object.fromEntries(ASSETS.map((a) => {
    const v = exchangesByAsset(a);
    return [a, { total: v.length, usFriendly: v.filter((e) => e.us === 'full' || e.us === 'partial').length }];
  }));
  return {
    totalExchanges: EXCHANGES.length,
    crypto: { total: CRYPTO_EXCHANGES.length, cex: cryptoExchanges({ type: 'CEX' }).length, dex: cryptoExchanges({ type: 'DEX' }).length },
    byAsset,
    usFriendlyTotal: usFriendly().length,
  };
}

// CLI summary:  node integrations/soapbox/markets-catalog.mjs
if (import.meta.url === `file://${process.argv[1]}`) {
  const s = summary();
  console.log('\nMELEK markets-catalog');
  console.log('─'.repeat(60));
  console.log(`Total venues: ${s.totalExchanges}`);
  console.log(`Crypto: ${s.crypto.total} (CEX ${s.crypto.cex} / DEX ${s.crypto.dex})`);
  for (const [a, c] of Object.entries(s.byAsset)) {
    console.log(`  ${a.padEnd(12)} ${String(c.total).padStart(3)} venues, ${String(c.usFriendly).padStart(3)} US-friendly`);
  }
  console.log(`US-friendly crypto exchanges: ${usFriendly('crypto').length}`);
  console.log(`US-friendly total (all assets): ${s.usFriendlyTotal}`);
  console.log('─'.repeat(60));
}
