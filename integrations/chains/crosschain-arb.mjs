// crosschain-arb.mjs — READ-ONLY cross-chain arbitrage detector. No keys.
// The HIVE-Engine arb pattern, generalized: the SAME asset should cost the same everywhere. When
// a token's price on one chain/DEX drifts from another, that's a cross-chain mispricing. Uses
// DEXScreener (keyless) which returns a token's trading pairs across every chain at once.
// Read-only — surfaces spreads for the analyzer/AIs; never executes.
//
//   node integrations/chains/crosschain-arb.mjs <query>   (e.g. a token symbol or address)
//   import { crossChainSpread } from './chains/crosschain-arb.mjs'

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
const THRESHOLD = +(process.env.XCHAIN_THRESHOLD || 0.03); // 3% spread worth flagging
const MIN_LIQ_USD = +(process.env.XCHAIN_MIN_LIQ || 5000); // ignore illiquid phantom pairs

async function dexscreener(q) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).pairs || [];
  } finally { clearTimeout(t); }
}

// compare a token's USD price across chains/DEXes; only count pairs with real liquidity (anti-phantom)
export async function crossChainSpread(query) {
  const pairs = await dexscreener(query);
  const venues = pairs
    .filter(p => +(p.liquidity?.usd || 0) >= MIN_LIQ_USD && +(p.priceUsd || 0) > 0)
    .map(p => ({
      chain: p.chainId, dex: p.dexId, symbol: p.baseToken?.symbol,
      priceUsd: +p.priceUsd, liqUsd: +(p.liquidity?.usd || 0), vol24h: +(p.volume?.h24 || 0),
      pair: `${p.baseToken?.symbol}/${p.quoteToken?.symbol}`,
    }))
    .sort((a, b) => a.priceUsd - b.priceUsd);
  if (venues.length < 2) return { query, venues, opportunity: null };
  // anti-scam: symbol search can return look-alike tokens. Keep only venues within 50% of the
  // MEDIAN price (the real asset cluster), so a fake token can't manufacture a phantom spread.
  const sorted = [...venues].sort((a, b) => a.priceUsd - b.priceUsd);
  const med = sorted[sorted.length >> 1].priceUsd;
  const real = venues.filter(v => v.priceUsd >= med * 0.5 && v.priceUsd <= med * 1.5);
  if (real.length < 2) return { query, venues: real, opportunity: null };
  const lo = real[0], hi = real[real.length - 1];
  const spread = (hi.priceUsd - lo.priceUsd) / lo.priceUsd;
  const opportunity = spread >= THRESHOLD
    ? { spreadPct: +(spread * 100).toFixed(1), buyOn: `${lo.chain}/${lo.dex}`, sellOn: `${hi.chain}/${hi.dex}`,
        buyUsd: lo.priceUsd, sellUsd: hi.priceUsd, executableLiqUsd: Math.min(lo.liqUsd, hi.liqUsd) }
    : null;
  return { query, venues: venues.slice(0, 12), opportunity };
}

if (process.argv[1] && process.argv[1].endsWith('crosschain-arb.mjs')) {
  const q = process.argv.slice(2).join(' ');
  if (!q) { console.error('usage: crosschain-arb.mjs <token symbol or address>'); process.exit(1); }
  const r = await crossChainSpread(q).catch(e => ({ error: e.message }));
  if (r.error) { console.error(`crosschain-arb: ${r.error}`); process.exit(1); }
  console.log(`Cross-chain price scan — "${q}" (read-only, liq≥$${MIN_LIQ_USD})\n${'─'.repeat(70)}`);
  if (!r.venues.length) { console.log('  no liquid pairs found.'); process.exit(0); }
  console.log('chain        dex            pair            price USD     liq USD');
  for (const v of r.venues) console.log(`${(v.chain || '').padEnd(12)} ${(v.dex || '').padEnd(14)} ${(v.pair || '').padEnd(15)} ${('$' + v.priceUsd.toPrecision(5)).padStart(12)} ${('$' + Math.round(v.liqUsd).toLocaleString()).padStart(11)}`);
  console.log('─'.repeat(70));
  if (r.opportunity) {
    const o = r.opportunity;
    console.log(`\n⚡ ${o.spreadPct}% spread: buy on ${o.buyOn} ($${o.buyUsd}) → sell on ${o.sellOn} ($${o.sellUsd})`);
    console.log(`   executable liquidity ~$${Math.round(o.executableLiqUsd).toLocaleString()} (verify bridge cost + slippage before sizing).`);
  } else console.log('\nNo ≥' + (THRESHOLD * 100) + '% cross-chain spread on liquid venues right now.');
}
