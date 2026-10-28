// liquidity-ratios.mjs — WHAT RATIO TO SEED A POOL AT, derived from tokenomics rather than picked.
//
// In a constant-product AMM the ratio of the reserves IS the price. So "seed the pool with some
// liquidity" is never a neutral act: whoever seeds it sets the opening price, and everyone who trades
// afterwards trades against that choice. Picking a round number here would be inventing a valuation.
//
// The operator's standing rule is that our tokens are arcade coins — "value" means USD or BTC, and our
// tokens are game coins until a real market prices them. This module takes that literally. It will not
// express an opinion in dollars about a token no market has priced. Instead it derives a ratio from the
// best basis actually available, in a fixed order of preference, and always reports WHICH basis it used:
//
//   1. MARKET  — a real external market exists (VKBT and CURE trade on Hive-Engine). Real money prices
//                the token; we just read it. Injected, never guessed.
//   2. ANCHOR  — no external market, but the token already trades against something we have a price for
//                in a live pool. Propagate by no-arbitrage. KULA/WPRANA is the anchor pool: it has real
//                depth (8,828 KULA / 5,668 WPRANA) and a price the market set, not us.
//   3. SCARCITY— neither exists (wMELEK against KULA). Fall back to pure tokenomics: price in inverse
//                proportion to lifetime supply. This is the only honest basis left, and it is a
//                *tokenomic* statement, not a valuation.
//
// WHY LIFETIME SUPPLY AND NOT CIRCULATING. KULA is emission-only: ~258k of a ~10M lifetime schedule has
// been issued, so it is about 2.6% emitted. MELEK is fully issued. Comparing the two on CIRCULATING
// supply would price KULA as if it were as scarce as its first year makes it look, and would overprice
// it roughly 39x against a fully-emitted counterpart. Fully-diluted is the comparison that does not
// systematically mis-price a young token, so it is the default — and `useLifetime:false` is available
// for anyone who wants to see the other number rather than be quietly given it.
//
// PURE ARITHMETIC. No chain, no network, no keys. Mirrors kula-farm.mjs's role as the off-chain tuner
// that settles parameters BEFORE anything is pinned on-chain.
//
//   import { ratioFor, seedPlan, triangleCheck, impliedPrice } from './liquidity-ratios.mjs'

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };

/**
 * The tokens this economy pools, with the basis each one is entitled to.
 * `circulating` and `lifetime` are in whole tokens. Figures read on-chain 2026-10-28.
 */
export const TOKENOMICS = Object.freeze({
  KULA:   { decimals: 18, circulating: 258447.4886, lifetime: 10000000, cap: 11000000, basis: 'anchor',
            note: 'emission-only, ~1M year one decaying -10%/yr, hard cap 11M' },
  WPRANA: { decimals: 18, circulating: 8001, lifetime: 8001, basis: 'anchor',
            note: 'wrapped native PRANA; priced by the KULA/WPRANA pool' },
  wVKBT:  { decimals: 8,  circulating: 23298, lifetime: 23298, basis: 'market',
            note: 'wrapper of VKBT, which trades on Hive-Engine' },
  wCURE:  { decimals: 8,  circulating: 599, lifetime: 599, basis: 'market',
            note: 'wrapper of CURE, which trades on Hive-Engine' },
  wMELEK: { decimals: 18, circulating: 0.9, lifetime: 2501906.61, basis: 'scarcity',
            note: 'lifetime = MELEK chain current_supply; only 0.9 has ever been bridged' },
  MWALI:  { decimals: 18, circulating: 0, lifetime: 0, basis: 'scarcity',
            note: 'proof-of-liquidity token; never minted — no ratio can be set until it emits' },
});

/** The pool whose price the market set, which every ANCHOR price is propagated from. */
export const ANCHOR_POOL = Object.freeze({
  name: 'KULA/WPRANA', address: '0x3fC307dEa06667f5a7a640Ec0aBb950EacC4B8C2',
  a: 'KULA', b: 'WPRANA', reserveA: 8828.7438, reserveB: 5668.3937,
});

/** Price of one B expressed in A, from raw reserves and decimals. Reserves may be strings/BigInt. */
export function impliedPrice({ reserveA, reserveB, decA = 18, decB = 18, raw = false } = {}) {
  const a = raw ? Number(reserveA) / 10 ** decA : nn(reserveA);
  const b = raw ? Number(reserveB) / 10 ** decB : nn(reserveB);
  if (!(b > 0)) return 0;
  return round(a / b);
}

/**
 * SCARCITY basis: price in inverse proportion to supply. One unit of the scarcer token costs more.
 * Returns how many `priceIn` tokens one `token` is worth.
 */
export function scarcityPrice(token, priceIn = 'KULA', { useLifetime = true, tokenomics = TOKENOMICS } = {}) {
  const t = tokenomics[token]; const p = tokenomics[priceIn];
  if (!t || !p) return 0;
  const key = useLifetime ? 'lifetime' : 'circulating';
  const ts = nn(t[key]); const ps = nn(p[key]);
  if (!(ts > 0) || !(ps > 0)) return 0;
  return round(ps / ts);                      // scarcer token (smaller supply) => higher price
}

/**
 * The target ratio for a pair, with the basis that produced it and the reasoning in plain words.
 * `marketPrices` supplies MARKET-basis prices (token -> price in KULA); omit it and a market-basis
 * pair reports `ok:false` rather than inventing one.
 */
export function ratioFor(tokenA, tokenB, { marketPrices = {}, livePools = [], tokenomics = TOKENOMICS, useLifetime = true } = {}) {
  const A = tokenomics[tokenA]; const B = tokenomics[tokenB];
  if (!A || !B) return { ok: false, reason: `unknown token: ${!A ? tokenA : tokenB}` };
  if (nn(A.lifetime) <= 0 || nn(B.lifetime) <= 0) {
    const dead = nn(A.lifetime) <= 0 ? tokenA : tokenB;
    return { ok: false, basis: 'none', reason: `${dead} has never been issued — no ratio can be set until it exists` };
  }

  // 1. MARKET
  const mA = nn(marketPrices[tokenA]); const mB = nn(marketPrices[tokenB]);
  if (mA > 0 && mB > 0) {
    return { ok: true, basis: 'market', priceOfBInA: round(mB / mA), priceOfAInB: round(mA / mB),
             reason: `both priced by a real external market` };
  }

  // 2. ANCHOR — a live pool already prices this exact pair
  for (const p of livePools) {
    if (p.a === tokenA && p.b === tokenB) {
      return { ok: true, basis: 'anchor', priceOfBInA: impliedPrice({ reserveA: p.reserveA, reserveB: p.reserveB }),
               priceOfAInB: impliedPrice({ reserveA: p.reserveB, reserveB: p.reserveA }),
               reason: `already priced by the live ${p.name} pool — do not re-price it` };
    }
    if (p.a === tokenB && p.b === tokenA) {
      return { ok: true, basis: 'anchor', priceOfBInA: impliedPrice({ reserveA: p.reserveB, reserveB: p.reserveA }),
               priceOfAInB: impliedPrice({ reserveA: p.reserveA, reserveB: p.reserveB }),
               reason: `already priced by the live ${p.name} pool — do not re-price it` };
    }
  }

  // 3. SCARCITY — but ONLY if neither token is one a real market already prices.
  // A token declared `basis:'market'` has a real external price. Falling back to scarcity for it would
  // manufacture a valuation for something the world already values — the exact failure this module
  // exists to prevent. Refuse and say what is missing instead. (Found by running the CLI: wVKBT came
  // out at 429 KULA on scarcity while its live pool says 0.057 — a 7,500x invention.)
  const needsMarket = [tokenA, tokenB].filter((t) => tokenomics[t] && tokenomics[t].basis === 'market' && !(nn(marketPrices[t]) > 0));
  if (needsMarket.length) {
    return { ok: false, basis: 'market', missing: needsMarket,
             reason: `${needsMarket.join(' and ')} ${needsMarket.length > 1 ? 'are' : 'is'} priced by a real external market `
                   + `(Hive-Engine) — supply marketPrices, do not substitute a supply ratio` };
  }
  const sA = scarcityPrice(tokenA, 'KULA', { useLifetime, tokenomics });
  const sB = scarcityPrice(tokenB, 'KULA', { useLifetime, tokenomics });
  if (sA > 0 && sB > 0) {
    return { ok: true, basis: 'scarcity', priceOfBInA: round(sB / sA), priceOfAInB: round(sA / sB),
             reason: `no market and no anchor — priced by ${useLifetime ? 'lifetime' : 'circulating'} supply, `
                   + `${tokenA} ${useLifetime ? A.lifetime : A.circulating} vs ${tokenB} ${useLifetime ? B.lifetime : B.circulating}` };
  }
  return { ok: false, basis: 'none', reason: 'no basis available' };
}

/**
 * How much of each side to put in, given a budget denominated in `budgetToken`.
 * Half the budget goes each side — that is what the constant-product invariant requires for the
 * ratio above to be the resulting price. Returns amounts in whole tokens.
 */
export function seedPlan({ tokenA, tokenB, budget, budgetToken = 'KULA', ...opts } = {}) {
  const r = ratioFor(tokenA, tokenB, opts);
  if (!r.ok) return { ...r, ok: false };
  const b = nn(budget);
  if (b <= 0) return { ...r, ok: false, reason: 'budget must be positive' };
  if (budgetToken !== tokenA && budgetToken !== tokenB) {
    return { ...r, ok: false, reason: `budget is in ${budgetToken}, which is not in this pair` };
  }
  // half the value each side
  const halfA = budgetToken === tokenA ? b / 2 : (b / 2) * r.priceOfBInA;
  const halfB = budgetToken === tokenB ? b / 2 : (b / 2) / r.priceOfBInA;
  return { ...r, ok: true, tokenA, tokenB, amountA: round(halfA), amountB: round(halfB),
           impliedPriceOfBInA: r.priceOfBInA };
}

/**
 * Three pools that share tokens form a closed loop, and the loop must multiply to 1 or somebody can
 * walk round it for free. Reports the discrepancy against the fee a round trip actually costs.
 * `legs` is three {from,to,price} where price = how many `from` one `to` costs.
 */
export function triangleCheck(legs = [], { feeBps = 30 } = {}) {
  if (legs.length !== 3) return { ok: false, reason: 'need exactly three legs' };
  let product = 1;
  for (const l of legs) { if (!(nn(l.price) > 0)) return { ok: false, reason: `leg ${l.from}->${l.to} has no price` }; product *= nn(l.price); }
  const feePct = (feeBps / 10000) * 3 * 100;          // three hops
  const discrepancyPct = (product - 1) * 100;
  const netPct = Math.abs(discrepancyPct) - feePct;
  return {
    ok: true, product: round(product), discrepancyPct: round(discrepancyPct, 4),
    roundTripFeePct: round(feePct, 4), netArbitragePct: round(Math.max(netPct, 0), 4),
    arbitrageFree: netPct <= 0,
    reason: netPct <= 0 ? 'inside the fee band — no free money' : `${round(netPct, 2)}% net of fees is extractable`,
  };
}

/** Does a live pool's price match what the tokenomics say it should be? */
export function driftFromTokenomics({ tokenA, tokenB, reserveA, reserveB, ...opts } = {}) {
  const target = ratioFor(tokenA, tokenB, opts);
  if (!target.ok) return target;
  const actual = impliedPrice({ reserveA, reserveB });
  if (!(actual > 0) || !(target.priceOfBInA > 0)) return { ok: false, reason: 'no price' };
  const driftPct = (actual / target.priceOfBInA - 1) * 100;
  return { ok: true, basis: target.basis, target: target.priceOfBInA, actual, driftPct: round(driftPct, 4) };
}

// ── CLI (guarded) — prints the seeding table ──────────────────────────────────────────────────────
if (process.argv[1] && /liquidity-ratios\.mjs$/.test(process.argv[1])) {
  const live = [
    { name: ANCHOR_POOL.name, a: ANCHOR_POOL.a, b: ANCHOR_POOL.b, reserveA: ANCHOR_POOL.reserveA, reserveB: ANCHOR_POOL.reserveB },
    { name: 'KULA/wVKBT',  a: 'KULA',  b: 'wVKBT', reserveA: 1002.8990, reserveB: 17555.7132 },
    { name: 'wCURE/KULA',  a: 'wCURE', b: 'KULA',  reserveA: 393.4344,  reserveB: 922.1010 },
    { name: 'wCURE/wVKBT', a: 'wCURE', b: 'wVKBT', reserveA: 90.4381,   reserveB: 3650.0000 },
  ];
  console.log(`anchor: ${ANCHOR_POOL.name}  1 ${ANCHOR_POOL.b} = ${impliedPrice({ reserveA: ANCHOR_POOL.reserveA, reserveB: ANCHOR_POOL.reserveB })} ${ANCHOR_POOL.a}\n`);
  for (const [a, b] of [['KULA', 'wMELEK'], ['KULA', 'WPRANA'], ['KULA', 'wVKBT'], ['wCURE', 'KULA'], ['KULA', 'MWALI']]) {
    const r = ratioFor(a, b, { livePools: live });
    if (!r.ok) { console.log(`${a}/${b}\n   REFUSED — ${r.reason}\n`); continue; }
    const p = seedPlan({ tokenA: a, tokenB: b, budget: 2000, budgetToken: 'KULA', livePools: live });
    console.log(`${a}/${b}`);
    console.log(`   basis   : ${r.basis}`);
    console.log(`   price   : 1 ${b} = ${r.priceOfBInA} ${a}`);
    console.log(`   why     : ${r.reason}`);
    if (p.ok) console.log(`   seed 2k : ${p.amountA} ${a}  +  ${p.amountB} ${b}`);
    console.log('');
  }
}
