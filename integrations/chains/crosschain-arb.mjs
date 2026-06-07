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
// Per-leg sanity guard: every leg of a candidate arb must price within this fraction of a REFERENCE
// spot price, else a poisoned pair (e.g. a fake-WETH token mispriced near — but not at — the cluster)
// can manufacture a bogus huge-profit signal the internal median filter alone won't catch. When no
// reference price is available we MARK the signal unverified rather than dropping it silently.
const SPOT_DEV = +(process.env.XCHAIN_SPOT_DEV || 0.20); // 20% default; override via env or options

// injectable fetch seam (house pattern) — lets offline tests drive the detector without a network.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function dexscreener(q) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await _fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`, { headers: { 'user-agent': UA }, signal: ctrl.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return (await r.json()).pairs || [];
  } finally { clearTimeout(t); }
}

// PURE: per-leg sanity check against a reference spot price. Returns a verdict the caller acts on.
//   spotUsd absent/invalid -> { verified:false } (unverified, NOT dropped — soft-fail convention)
//   any leg off spot by more than maxDev -> { ok:false, dropped:true } with the offending legs
//   all legs within tolerance -> { ok:true, verified:true }
export function checkLegsAgainstSpot(legs, spotUsd, maxDev = SPOT_DEV) {
  const ref = +spotUsd;
  if (!(ref > 0)) return { ok: true, verified: false, reason: 'no reference spot price' };
  const off = legs
    .filter(l => l && +l.priceUsd > 0)
    .map(l => ({ ...l, dev: Math.abs(l.priceUsd - ref) / ref }))
    .filter(l => l.dev > maxDev);
  if (off.length) {
    return {
      ok: false, dropped: true, verified: false, spotUsd: ref, maxDev,
      reason: `leg price deviates >${(maxDev * 100).toFixed(0)}% from spot $${ref} (possible poisoned pair)`,
      offending: off.map(l => ({ chain: l.chain, dex: l.dex, priceUsd: l.priceUsd, devPct: +(l.dev * 100).toFixed(1) })),
    };
  }
  return { ok: true, verified: true, spotUsd: ref, maxDev };
}

// compare a token's USD price across chains/DEXes; only count pairs with real liquidity (anti-phantom)
//
// opts.spotUsd  — reference spot price (USD) for the asset. When given, each leg of a candidate arb is
//                 checked against it; a leg off by more than opts.maxDev (default SPOT_DEV) is treated
//                 as a poisoned pair and the whole signal is DROPPED + flagged suspicious. When absent
//                 the signal is returned but marked verified:false (unverified) — never dropped silently.
// opts.maxDev   — deviation tolerance as a fraction (default SPOT_DEV / XCHAIN_SPOT_DEV env).
export async function crossChainSpread(query, opts = {}) {
  const { spotUsd, maxDev = SPOT_DEV } = opts;
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
  let opportunity = spread >= THRESHOLD
    ? { spreadPct: +(spread * 100).toFixed(1), buyOn: `${lo.chain}/${lo.dex}`, sellOn: `${hi.chain}/${hi.dex}`,
        buyUsd: lo.priceUsd, sellUsd: hi.priceUsd, executableLiqUsd: Math.min(lo.liqUsd, hi.liqUsd) }
    : null;
  // Per-leg spot sanity guard. Check the two legs that make the signal against a reference spot price.
  let suspicious = null;
  if (opportunity) {
    const verdict = checkLegsAgainstSpot([lo, hi], spotUsd, maxDev);
    if (verdict.dropped) {
      // a leg priced too far off spot — drop the signal, surface it as suspicious instead of profit.
      suspicious = { ...verdict, query, spreadPct: opportunity.spreadPct };
      opportunity = null;
    } else {
      opportunity.verified = verdict.verified;
      if (!verdict.verified) opportunity.note = 'unverified: no reference spot price to sanity-check legs';
    }
  }
  return { query, venues: venues.slice(0, 12), opportunity, suspicious };
}

if (process.argv[1] && process.argv[1].endsWith('crosschain-arb.mjs')) {
  const q = process.argv.slice(2).join(' ');
  if (!q) { console.error('usage: crosschain-arb.mjs <token symbol or address>'); process.exit(1); }
  const spotUsd = +(process.env.XCHAIN_SPOT_USD || 0) || undefined; // optional reference spot for the sanity guard
  const r = await crossChainSpread(q, { spotUsd }).catch(e => ({ error: e.message }));
  if (r.error) { console.error(`crosschain-arb: ${r.error}`); process.exit(1); }
  console.log(`Cross-chain price scan — "${q}" (read-only, liq≥$${MIN_LIQ_USD})\n${'─'.repeat(70)}`);
  if (!r.venues.length) { console.log('  no liquid pairs found.'); process.exit(0); }
  console.log('chain        dex            pair            price USD     liq USD');
  for (const v of r.venues) console.log(`${(v.chain || '').padEnd(12)} ${(v.dex || '').padEnd(14)} ${(v.pair || '').padEnd(15)} ${('$' + v.priceUsd.toPrecision(5)).padStart(12)} ${('$' + Math.round(v.liqUsd).toLocaleString()).padStart(11)}`);
  console.log('─'.repeat(70));
  if (r.suspicious) {
    console.log(`\n⛔ DROPPED suspicious ${r.suspicious.spreadPct}% signal: ${r.suspicious.reason}`);
    for (const l of r.suspicious.offending) console.log(`   ${l.chain}/${l.dex} @ $${l.priceUsd} (${l.devPct}% off spot)`);
  } else if (r.opportunity) {
    const o = r.opportunity;
    console.log(`\n⚡ ${o.spreadPct}% spread: buy on ${o.buyOn} ($${o.buyUsd}) → sell on ${o.sellOn} ($${o.sellUsd})`);
    console.log(`   executable liquidity ~$${Math.round(o.executableLiqUsd).toLocaleString()} (verify bridge cost + slippage before sizing).`);
    if (o.verified === false) console.log(`   ⚠ ${o.note} — set XCHAIN_SPOT_USD to sanity-check the legs.`);
  } else console.log('\nNo ≥' + (THRESHOLD * 100) + '% cross-chain spread on liquid venues right now.');
}
