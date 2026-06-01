// price-oracle.mjs — READ-ONLY multi-source USD price with outlier rejection. No keys.
// "Look at the data more than one way": instead of trusting a single feed, pull the real
// asset's USD price from several free sources and take a robust median. A single bad/stale
// quote can't drive a phantom arbitrage signal anymore.
//
//   import { priceUsd, hiveUsd } from './price-oracle.mjs'
//   await priceUsd('ethereum')   -> { usd, sources, spreadPct, confident }

import { crypto } from './free-apis.mjs';

// coingecko id -> the same asset on the other sources we can cross-check against
const XREF = {
  bitcoin:   { paprika: 'btc-bitcoin',  cap: 'bitcoin',  kraken: 'XBTUSD',  coinbase: 'BTC-USD' },
  ethereum:  { paprika: 'eth-ethereum', cap: 'ethereum', kraken: 'ETHUSD',  coinbase: 'ETH-USD' },
  litecoin:  { paprika: 'ltc-litecoin', cap: 'litecoin', kraken: 'LTCUSD',  coinbase: 'LTC-USD' },
  dogecoin:  { paprika: 'doge-dogecoin', cap: 'dogecoin', kraken: 'XDGUSD', coinbase: 'DOGE-USD' },
  hive:      { paprika: 'hive-hive',    cap: 'hive',     coinbase: 'HIVE-USD' },
  steem:     { paprika: 'steem-steem',  cap: 'steem' },
  blurt:     { paprika: 'blurt-blurt' },
};

const n = (x) => { const v = +x; return Number.isFinite(v) && v > 0 ? v : null; };
function median(a) { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }

// gather every USD quote we can for one coingecko id
async function gather(id, cgPrice) {
  const x = XREF[id] || {};
  const jobs = [];
  if (cgPrice != null) jobs.push(Promise.resolve(['coingecko', cgPrice]));
  if (x.paprika) jobs.push(crypto.coinpaprika(x.paprika).then(d => ['coinpaprika', n(d?.quotes?.USD?.price)]).catch(() => null));
  if (x.cap) jobs.push(crypto.coincap(x.cap).then(d => ['coincap', n(d?.data?.priceUsd)]).catch(() => null));
  if (x.coinbase) jobs.push(crypto.coinbase(x.coinbase).then(d => ['coinbase', n(d?.data?.amount)]).catch(() => null));
  if (x.kraken) jobs.push(crypto.kraken(x.kraken).then(d => { const k = Object.values(d?.result || {})[0]; return ['kraken', n(k?.c?.[0])]; }).catch(() => null));
  const settled = await Promise.all(jobs);
  return settled.filter(r => r && r[1] != null);
}

// robust median USD price + a confidence signal (sources agree within band)
export async function priceUsd(id, cgPrice = null) {
  const quotes = await gather(id, cgPrice);
  if (!quotes.length) return { usd: 0, sources: 0, spreadPct: null, confident: false, quotes: {} };
  const vals = quotes.map(q => q[1]);
  const med = median(vals);
  // drop quotes >35% from the median (stale/wrong feed), then re-median the survivors
  const kept = quotes.filter(q => Math.abs(q[1] - med) / med <= 0.35);
  const keptVals = (kept.length ? kept : quotes).map(q => q[1]);
  const usd = median(keptVals);
  const spreadPct = keptVals.length > 1 ? (Math.max(...keptVals) - Math.min(...keptVals)) / usd : 0;
  return {
    usd,
    sources: keptVals.length,
    spreadPct: spreadPct == null ? null : +(spreadPct * 100).toFixed(2),
    confident: keptVals.length >= 2 && spreadPct <= 0.05,   // ≥2 sources within 5%
    quotes: Object.fromEntries(quotes),
  };
}

export async function hiveUsd() { const p = await priceUsd('hive'); return p.usd; }

if (process.argv[1] && process.argv[1].endsWith('price-oracle.mjs')) {
  const ids = process.argv.slice(2);
  const targets = ids.length ? ids : ['hive', 'bitcoin', 'ethereum', 'litecoin', 'dogecoin'];
  const cg = await crypto.coingecko(targets.join(','), 'usd').catch(() => ({}));
  console.log('Multi-source price oracle (read-only, outlier-rejected median)\n' + '─'.repeat(64));
  for (const id of targets) {
    const p = await priceUsd(id, cg[id]?.usd ?? null);
    const flag = p.confident ? '✓' : '⚠';
    console.log(`${flag} ${id.padEnd(10)} $${p.usd.toFixed(p.usd < 1 ? 6 : 2).padStart(11)}  (${p.sources} src, spread ${p.spreadPct}%)  ${Object.entries(p.quotes).map(([k, v]) => `${k}:${(+v).toFixed(v < 1 ? 4 : 0)}`).join(' ')}`);
  }
}
