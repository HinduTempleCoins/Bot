// macro.mjs — traditional-markets data for SoapBox (operator 2026-06-02): metals, US + global stock
// indexes, rates/yields, energy, volatility/currency — "things people need to know before going into
// a market." Source: Yahoo Finance's keyless chart API (one source for all of it). Cached 60s.
// Fed Funds target rate isn't on Yahoo — add FRED (free key) later; the 10Y yield is the live proxy.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// category → [ [yahoo symbol, label, kind] ]. kind: usd|index|pct|fx
export const SYMBOLS = {
  'Metals': [['GC=F', 'Gold', 'usd'], ['SI=F', 'Silver', 'usd'], ['PL=F', 'Platinum', 'usd'], ['PA=F', 'Palladium', 'usd'], ['HG=F', 'Copper', 'usd']],
  'US Indices': [['^DJI', 'Dow Jones', 'index'], ['^GSPC', 'S&P 500', 'index'], ['^IXIC', 'Nasdaq', 'index'], ['^RUT', 'Russell 2000', 'index']],
  'Global Indices': [['^FTSE', 'FTSE 100 (UK)', 'index'], ['^GDAXI', 'DAX (DE)', 'index'], ['^FCHI', 'CAC 40 (FR)', 'index'], ['^N225', 'Nikkei (JP)', 'index'], ['^HSI', 'Hang Seng (HK)', 'index'], ['000001.SS', 'Shanghai (CN)', 'index'], ['^BSESN', 'Sensex (IN)', 'index']],
  'Rates & Bonds': [['^TNX', 'US 10Y Yield', 'pct'], ['^FVX', 'US 5Y Yield', 'pct'], ['^TYX', 'US 30Y Yield', 'pct'], ['^IRX', 'US 13wk (short rate)', 'pct']],
  'Energy': [['CL=F', 'WTI Crude Oil', 'usd'], ['BZ=F', 'Brent Crude', 'usd'], ['NG=F', 'Natural Gas', 'usd']],
  'Risk & Currency': [['^VIX', 'VIX (volatility)', 'index'], ['DX-Y.NYB', 'Dollar Index (DXY)', 'index'], ['EURUSD=X', 'EUR/USD', 'fx'], ['GBPUSD=X', 'GBP/USD', 'fx']],
};

// Commodities people actually buy. Futures price = the honest reference (with its unit); WHERE_TO_BUY
// then points at where a real person sources the physical thing or paper exposure. Grounded in the
// operator's own threads: bulk botanicals/coffee by the ton via Alibaba (Botanica Coffee Co.), and the
// "crypto needs a commodity anchor" lesson — bullion dealers that accept crypto (BullionStar/Bitgild).
export const COMMODITIES = {
  'Grains': [['ZW=F', 'Wheat', '¢/bu'], ['ZC=F', 'Corn', '¢/bu'], ['ZS=F', 'Soybeans', '¢/bu'], ['ZO=F', 'Oats', '¢/bu'], ['ZR=F', 'Rough Rice', '$/cwt']],
  'Softs': [['KC=F', 'Coffee (Arabica)', '¢/lb'], ['SB=F', 'Sugar #11', '¢/lb'], ['CC=F', 'Cocoa', '$/t'], ['CT=F', 'Cotton', '¢/lb'], ['OJ=F', 'Orange Juice', '¢/lb'], ['LBS=F', 'Lumber', '$/kbf']],
  'Livestock': [['LE=F', 'Live Cattle', '¢/lb'], ['GF=F', 'Feeder Cattle', '¢/lb'], ['HE=F', 'Lean Hogs', '¢/lb']],
  'Metals': [['GC=F', 'Gold', '$/oz'], ['SI=F', 'Silver', '$/oz'], ['PL=F', 'Platinum', '$/oz'], ['PA=F', 'Palladium', '$/oz'], ['HG=F', 'Copper', '$/lb']],
  'Energy': [['CL=F', 'WTI Crude', '$/bbl'], ['BZ=F', 'Brent Crude', '$/bbl'], ['NG=F', 'Natural Gas', '$/MMBtu'], ['RB=F', 'Gasoline', '$/gal'], ['HO=F', 'Heating Oil', '$/gal']],
};

// B2B wholesale marketplaces — where you buy the physical commodity in bulk (the Alibaba thread).
const B2B = [
  ['Alibaba', 'https://www.alibaba.com/', 'Global B2B — bulk goods by the ton'],
  ['IndiaMART', 'https://www.indiamart.com/', "India's largest B2B marketplace"],
  ['Made-in-China', 'https://www.made-in-china.com/', 'China manufacturers & suppliers'],
  ['Global Sources', 'https://www.globalsources.com/', 'Verified export suppliers'],
  ['Tridge', 'https://www.tridge.com/', 'Agricultural commodity intelligence + sourcing'],
];
// Bullion dealers — buy physical metal near spot; crypto-friendly ones flagged (the commodity-anchor thread).
const BULLION = [
  ['APMEX', 'https://www.apmex.com/', 'Largest US online bullion dealer'],
  ['JM Bullion', 'https://www.jmbullion.com/', 'Low-premium gold & silver'],
  ['SD Bullion', 'https://sdbullion.com/', 'Low over-spot pricing'],
  ['Kitco', 'https://www.kitco.com/', 'Live spot charts + dealer'],
  ['BullionStar', 'https://www.bullionstar.com/', 'Accepts crypto; vaulted storage'],
  ['Bitgild', 'https://www.bitgild.com/', 'Crypto-native bullion (since 2013)'],
];
// Paper exposure / brokers for those who don't want the physical.
const BROKERS = [
  ['Interactive Brokers', 'https://www.interactivebrokers.com/', 'Stocks, futures, FX, global'],
  ['Charles Schwab', 'https://www.schwab.com/', 'Stocks, ETFs, bonds'],
  ['Fidelity', 'https://www.fidelity.com/', 'Stocks, ETFs, bonds, no-fee'],
  ['Vanguard', 'https://investor.vanguard.com/', 'Low-cost index funds & ETFs'],
];

// commodity category → where to buy the physical (or paper). Pinned by what the thing actually is.
export const WHERE_TO_BUY = {
  'Grains': B2B, 'Softs': B2B, 'Livestock': B2B, 'Metals': BULLION, 'Energy': BROKERS,
};

// Basic raw resources WITHOUT a liquid futures ticker — hemp, textiles, gemstones, industrial inputs.
// No live Yahoo quote, so each row carries an INDICATIVE price range (confirm with suppliers — these
// move a lot by grade/origin) and an HS code (the Harmonized System code customs uses for duty lookup).
export const SOURCED_GOODS = {
  'Hemp & Bast Fibers': [
    { name: 'Industrial Hemp Fiber', typical: '$0.30–0.80 / lb', hs: '5302.10' },
    { name: 'Hemp Hurd (shiv)', typical: '$0.10–0.25 / lb', hs: '5302.90' },
    { name: 'Hemp Seed (food-grade)', typical: '$0.50–1.50 / lb', hs: '1207.99' },
    { name: 'Hemp Seed Oil', typical: '$8–20 / L', hs: '1515.90' },
    { name: 'Flax / Linen Fiber', typical: '$1–3 / lb', hs: '5301.21' },
    { name: 'Jute (raw)', typical: '$0.40–0.90 / lb', hs: '5303.10' },
  ],
  'Textiles & Raw Fibers': [
    { name: 'Wool (greasy)', typical: '$2–6 / lb', hs: '5101.11' },
    { name: 'Raw Silk', typical: '$40–70 / kg', hs: '5002.00' },
    { name: 'Cotton Yarn', typical: '$2.50–4 / kg', hs: '5205.00' },
    { name: 'Polyester Staple Fiber', typical: '$0.80–1.30 / lb', hs: '5503.20' },
    { name: 'Woven Cotton Fabric', typical: '$1–4 / m', hs: '5208.00' },
  ],
  'Gemstones (rough)': [
    { name: 'Industrial Diamond (rough)', typical: '$50–150 / ct', hs: '7102.21' },
    { name: 'Sapphire / Ruby (rough)', typical: '$5–500+ / ct (grade)', hs: '7103.10' },
    { name: 'Emerald (rough)', typical: '$10–800+ / ct (grade)', hs: '7103.10' },
    { name: 'Quartz / Amethyst', typical: '$1–20 / kg rough', hs: '7103.10' },
    { name: 'Jade (rough)', typical: 'grade-driven, wide', hs: '7103.10' },
  ],
  'Basic Industrial Inputs': [
    { name: 'Steel (hot-rolled coil)', typical: '$600–900 / t', hs: '7208.00' },
    { name: 'Aluminum (ingot)', typical: '$2,200–2,700 / t', hs: '7601.10' },
    { name: 'Lithium Carbonate', typical: '$12–20 / kg', hs: '2836.91' },
    { name: 'Portland Cement', typical: '$100–150 / t', hs: '2523.29' },
    { name: 'Industrial Salt', typical: '$50–200 / t', hs: '2501.00' },
  ],
};
// every sourced-goods category is bought through the same bulk B2B marketplaces.
for (const k of Object.keys(SOURCED_GOODS)) WHERE_TO_BUY[k] = B2B;

// Authoritative duty / VAT / tariff lookup tools — keyed by HS code + importing country. This is what
// turns a sticker price into a real LANDED cost (unit + freight + import duty + import VAT + brokerage).
export const DUTY_TOOLS = [
  ['USITC Harmonized Tariff Schedule (US)', 'https://hts.usitc.gov/', 'Official US import duty rates by HS code'],
  ['WTO Tariff & Trade Data', 'https://ttd.wto.org/', 'Applied tariff rates for every WTO member'],
  ['EU Access2Markets / TARIC', 'https://trade.ec.europa.eu/access-to-markets/en/home', 'EU duties, VAT, rules-of-origin by product + country'],
  ['UK Trade Tariff', 'https://www.gov.uk/trade-tariff', 'UK import duty + VAT lookup by commodity code'],
  ['SimplyDuty calculator', 'https://www.simplyduty.com/', 'Quick landed-cost / duty + VAT estimate'],
  ['WCO Harmonized System', 'https://www.wcoomd.org/en/topics/nomenclature/overview.aspx', 'What HS codes are + how classification works'],
];

// macro category → the major entry points (brokers / exchanges / dealers / the headline ETF tickers).
export const ENTRY_POINTS = {
  'Metals': [...BULLION.slice(0, 4), ['ETFs: GLD · SLV · PPLT', 'https://www.spdrgoldshares.com/', 'Paper exposure via funds']],
  'US Indices': [...BROKERS, ['ETFs: SPY · QQQ · DIA · VTI', 'https://www.ssga.com/us/en/intermediary/etfs/spdr-sp-500-etf-trust-spy', 'Buy the index in one ticker']],
  'Global Indices': [['Interactive Brokers', 'https://www.interactivebrokers.com/', 'Direct access to global exchanges'], ['ETFs: EFA · VEA · VWO', 'https://investor.vanguard.com/', 'Developed + emerging markets']],
  'Rates & Bonds': [['TreasuryDirect', 'https://www.treasurydirect.gov/', 'Buy US Treasuries direct from the government, no broker'], ['Bond ETFs: TLT · IEF · SHY · BND', 'https://www.ishares.com/', 'Bond exposure in one ticker'], ...BROKERS.slice(0, 2)],
  'Energy': [['ETFs: USO · UNG · XLE', 'https://www.uscfinvestments.com/', 'Oil, gas, energy-sector funds'], ...BROKERS.slice(0, 2)],
  'Risk & Currency': [['OANDA', 'https://www.oanda.com/', 'FX broker + rates data'], ['Forex.com', 'https://www.forex.com/', 'Major + minor currency pairs'], ['Interactive Brokers', 'https://www.interactivebrokers.com/', 'FX, futures, DXY via UUP ETF']],
};

async function quote(symbol) {
  try {
    const r = await _fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}`, { headers: { 'user-agent': UA } });
    if (!r.ok) return null;
    const m = (await r.json())?.chart?.result?.[0]?.meta;
    if (!m || m.regularMarketPrice == null) return null;
    const prev = m.chartPreviousClose || m.previousClose;
    return { price: m.regularMarketPrice, change: prev ? (m.regularMarketPrice / prev - 1) * 100 : null, currency: m.currency || 'USD' };
  } catch { return null; }
}

/** Full macro snapshot, all categories. Cached 60s. Symbols that fail are dropped (best-effort). */
export async function macro() {
  return cached('macro:all', TTL.price, async () => {
    const out = {};
    for (const [cat, rows] of Object.entries(SYMBOLS)) {
      const vals = await Promise.all(rows.map(async ([sym, label, kind]) => {
        const q = await quote(sym);
        return q ? { symbol: sym, label, kind, ...q } : null;
      }));
      out[cat] = vals.filter(Boolean);
    }
    return out;
  });
}

/** A few headline numbers for the homepage chip: gold, Dow, 10Y, VIX. */
export async function macroSummary() {
  const m = await macro().catch(() => ({}));
  const find = (cat, label) => (m[cat] || []).find((x) => x.label.startsWith(label));
  return {
    gold: find('Metals', 'Gold'), dow: find('US Indices', 'Dow'),
    tenY: find('Rates & Bonds', 'US 10Y'), vix: find('Risk & Currency', 'VIX'),
  };
}

/** Full commodities snapshot (grains/softs/livestock/metals/energy), each row with its price unit. Cached 60s. */
export async function commodities() {
  return cached('commodities:all', TTL.price, async () => {
    const out = {};
    for (const [cat, rows] of Object.entries(COMMODITIES)) {
      const vals = await Promise.all(rows.map(async ([sym, label, unit]) => {
        const q = await quote(sym);
        return q ? { symbol: sym, label, unit, ...q } : null;
      }));
      out[cat] = vals.filter(Boolean);
    }
    return out;
  });
}

/** A few headline commodities for the homepage chip: coffee, wheat, corn, WTI crude. */
export async function commoditiesSummary() {
  const c = await commodities().catch(() => ({}));
  const find = (cat, label) => (c[cat] || []).find((x) => x.label.startsWith(label));
  return {
    coffee: find('Softs', 'Coffee'), wheat: find('Grains', 'Wheat'),
    corn: find('Grains', 'Corn'), oil: find('Energy', 'WTI'),
  };
}

if (process.argv[1] && process.argv[1].endsWith('macro.mjs')) {
  const m = await macro();
  for (const [cat, rows] of Object.entries(m)) { console.log(`\n${cat}`); for (const r of rows) console.log(`  ${r.label.padEnd(22)} ${r.price}  ${r.change != null ? (r.change >= 0 ? '+' : '') + r.change.toFixed(2) + '%' : ''}`); }
}
