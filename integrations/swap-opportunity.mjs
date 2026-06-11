// swap-opportunity.mjs — Swap.* pair opportunity scanner (backlog item 89:
// "vankush-arbitrage-scanner.cjs — Swap.* opportunity detection").
//
// A PURE pool-math route finder for Hive-Engine Diesel-Pool (Swap.HIVE / Swap.X) routes. Given a set of
// constant-product pool reserves and a table of reference prices, it scores multi-hop Swap.* paths and
// surfaces the ones whose realised output beats the reference by at least a configurable edge.
//
// DISTINCT FROM its siblings:
//   - arb-scanner.mjs      — order-book execution (walk asks/bids, buy-here-sell-there).
//   - triangular-arb.mjs   — three-leg cyclic arbitrage.
//   - this module          — Diesel-Pool (x*y=k) ROUTE scoring against supplied reserves + reference prices.
//
// PURE arithmetic. NO network, NO chain, NO keys. Every reserve, fee and reference price is passed IN —
// the live pool reads happen elsewhere and hand their numbers to these functions. Nothing injectable is
// needed (no IO of any kind).
//
// Reuses the canonical constant-product kernel: getAmountOut() is imported from ./cp-amm.mjs so the curve
// math lives in exactly one place.
//
// Soft-fail everywhere: empty pools → [], any divide-by-zero is guarded → 0, garbage/negative inputs clamp,
// nothing ever throws.
//
//   node integrations/swap-opportunity.mjs    # worked example with inline reserves
//
// Exports: poolPrice(), routeOut(), findOpportunities(), scoreRoute().

import { getAmountOut } from './cp-amm.mjs';

const BPS = 10000;
const DEFAULT_MIN_EDGE_BPS = 50;        // 0.50% — default minimum edge to call a route an opportunity
const DEFAULT_FEE_BPS = 30;             // 0.30% — canonical Diesel-Pool / Uniswap-v2 swap fee

const num = (x, d = 0) => (Number.isFinite(+x) ? +x : d);
// clamp to a finite, non-negative number (soft-fail: garbage/negative → 0)
const nn = (x) => Math.max(0, num(x));
const round = (x) => +(+x).toFixed(8);

// ── spot price of a single pool ────────────────────────────────────────────────
// poolPrice({ baseQty, quoteQty }) → quoteQty / baseQty  (quote-per-base spot, fee-free)
// The instantaneous price of the base asset denominated in the quote asset. baseQty<=0 (or missing) → 0
// (soft-fail, no divide-by-zero, never throws).
export function poolPrice({ baseQty, quoteQty } = {}) {
  const b = nn(baseQty);
  const q = nn(quoteQty);
  if (b <= 0) return 0;
  return round(q / b);
}

// ── chain getAmountOut across a multi-hop Swap.* path ───────────────────────────
// routeOut({ amountIn, pools:[{base, baseQty, quote, quoteQty, feeBps}] }) →
//   { amountOut, hops:[{base, quote, in, out, feeBps}], symbolsIn, symbolsOut }
//
// Walks the path hop by hop, feeding each hop's output into the next hop's input. Each pool is read as a
// base→quote swap: amountIn is spent in `base`, output comes out in `quote`, which becomes the input to the
// next pool. Curve math is delegated to cp-amm getAmountOut() (reserveIn = baseQty, reserveOut = quoteQty).
//
// Soft-fail: empty/missing pools → amountOut 0 with no hops; any hop that produces 0 (dead reserve, zero
// input) short-circuits the rest of the route to 0. Never throws.
export function routeOut({ amountIn, pools } = {}) {
  const list = Array.isArray(pools) ? pools : [];
  if (list.length === 0) {
    return { amountOut: 0, hops: [], symbolsIn: '', symbolsOut: '' };
  }

  let running = nn(amountIn);
  const hops = [];

  for (const pool of list) {
    const p = pool || {};
    const feeBps = Number.isFinite(+p.feeBps) ? +p.feeBps : DEFAULT_FEE_BPS;
    const { amountOut, feeBps: fee } = getAmountOut({
      amountIn: running,
      reserveIn: p.baseQty,
      reserveOut: p.quoteQty,
      feeBps,
    });
    hops.push({
      base: p.base ?? '',
      quote: p.quote ?? '',
      in: round(running),
      out: amountOut,
      feeBps: fee,
    });
    running = amountOut;
    if (running <= 0) break;   // dead hop → the rest of the route is 0; stop walking
  }

  return {
    amountOut: round(running),
    hops,
    symbolsIn: list[0] && list[0].base != null ? String(list[0].base) : '',
    symbolsOut: list[list.length - 1] && list[list.length - 1].quote != null ? String(list[list.length - 1].quote) : '',
  };
}

// ── reference (no-slippage, no-fee) expected output of a route ───────────────────
// The product of each hop's reference price (quote-per-base). Used as the benchmark the realised route
// output is compared against. Missing reference for any leg makes the route unscoreable → 0.
function referenceOut({ amountIn, pools, referencePrices } = {}) {
  const list = Array.isArray(pools) ? pools : [];
  const refs = referencePrices || {};
  if (list.length === 0) return 0;

  let factor = 1;
  for (const pool of list) {
    const p = pool || {};
    // reference price for this leg: prefer an explicit "BASE:QUOTE" key, else the pool's own spot price.
    const key = `${p.base ?? ''}:${p.quote ?? ''}`;
    const ref = Number.isFinite(+refs[key]) ? +refs[key] : poolPrice({ baseQty: p.baseQty, quoteQty: p.quoteQty });
    if (!(ref > 0)) return 0;
    factor *= ref;
  }
  return round(nn(amountIn) * factor);
}

// ── score a single route against a reference output ──────────────────────────────
// scoreRoute(route) → { edgeBps, viable }
// route = { amountIn, expectedOut, referenceOut, minEdgeBps? }
//   edgeBps : how much the realised output beats the reference, in basis points
//             ( (expectedOut - referenceOut) / referenceOut * 10000 ). 0 if no reference.
//   viable  : edgeBps >= minEdgeBps (default 50) AND expectedOut > 0
//
// Soft-fail: referenceOut<=0 → edgeBps 0, viable false; never divides by zero, never throws.
export function scoreRoute(route = {}) {
  const expectedOut = nn(route.expectedOut);
  const ref = nn(route.referenceOut);
  const minEdgeBps = Number.isFinite(+route.minEdgeBps) ? +route.minEdgeBps : DEFAULT_MIN_EDGE_BPS;

  if (ref <= 0 || expectedOut <= 0) {
    return { edgeBps: 0, viable: false };
  }

  const edgeBps = round((expectedOut - ref) / ref * BPS);
  return { edgeBps, viable: edgeBps >= minEdgeBps && expectedOut > 0 };
}

// ── find and rank opportunities ──────────────────────────────────────────────────
// findOpportunities({ pools, referencePrices, minEdgeBps=50, amountIn=1, routes }) →
//   [{ path, edgeBps, amountIn, expectedOut }]  sorted by edge DESC
//
//   pools           : array of { base, baseQty, quote, quoteQty, feeBps } Diesel-Pools.
//   referencePrices : { "BASE:QUOTE": price } table; missing legs fall back to the pool's own spot price.
//   minEdgeBps      : minimum edge (bps) for a route to count as an opportunity (default 50).
//   amountIn        : probe size fed into each candidate route (default 1 unit of the first leg's base).
//   routes          : OPTIONAL explicit list of routes, each an array of pools (multi-hop). If omitted,
//                     every single pool is treated as a one-hop candidate route.
//
// Each viable route is scored via routeOut() + scoreRoute(); results are filtered to viable ones and
// returned sorted by edgeBps descending. Soft-fail: empty/missing pools (and no routes) → []; never throws.
export function findOpportunities({ pools, referencePrices, minEdgeBps = DEFAULT_MIN_EDGE_BPS, amountIn = 1, routes } = {}) {
  const poolList = Array.isArray(pools) ? pools : [];
  const refs = referencePrices || {};
  const edge = Number.isFinite(+minEdgeBps) ? +minEdgeBps : DEFAULT_MIN_EDGE_BPS;
  const probe = nn(amountIn) > 0 ? nn(amountIn) : 1;

  // Candidate routes: explicit `routes` if supplied, else each pool as its own one-hop route.
  const candidates = Array.isArray(routes) && routes.length > 0
    ? routes.map((r) => (Array.isArray(r) ? r : [])).filter((r) => r.length > 0)
    : poolList.map((p) => [p]);

  if (candidates.length === 0) return [];

  const out = [];
  for (const routePools of candidates) {
    const { amountOut, hops } = routeOut({ amountIn: probe, pools: routePools });
    const ref = referenceOut({ amountIn: probe, pools: routePools, referencePrices: refs });
    const { edgeBps, viable } = scoreRoute({ amountIn: probe, expectedOut: amountOut, referenceOut: ref, minEdgeBps: edge });
    if (!viable) continue;

    const path = hops
      .map((h, i) => (i === 0 ? `${h.base}→${h.quote}` : `→${h.quote}`))
      .join('');

    out.push({ path, edgeBps, amountIn: probe, expectedOut: amountOut });
  }

  return out.sort((a, b) => b.edgeBps - a.edgeBps);
}

// ───────────────────────────── CLI ─────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('swap-opportunity.mjs')) {
  console.log('Swap.* pair opportunity scanner — Hive-Engine Diesel-Pool route finder (PURE — no network)');
  console.log('='.repeat(78));

  // Inline reserves: three Diesel-Pools. The HIVE→PROJECT pool is priced richer than its reference,
  // creating a positive edge; the other two sit at/under reference.
  const pools = [
    { base: 'SWAP.HIVE', baseQty: 100_000, quote: 'PROJECT', quoteQty: 250_000, feeBps: 30 },
    { base: 'SWAP.HIVE', baseQty: 80_000,  quote: 'SWAP.BTC', quoteQty: 12,      feeBps: 30 },
    { base: 'PROJECT',   baseQty: 250_000, quote: 'SWAP.BTC', quoteQty: 11,      feeBps: 30 },
  ];

  // Reference prices (quote-per-base) the operator considers "fair" off-pool.
  const referencePrices = {
    'SWAP.HIVE:PROJECT': 2.4,        // pool spot ~2.5 → richer than reference → edge
    'SWAP.HIVE:SWAP.BTC': 0.00015,
    'PROJECT:SWAP.BTC': 0.000044,
  };

  console.log('\npool spot prices (quote-per-base):');
  for (const p of pools) {
    console.log(`  ${p.base} → ${p.quote}: ${poolPrice({ baseQty: p.baseQty, quoteQty: p.quoteQty })}`);
  }

  const probe = 1_000;
  const single = routeOut({ amountIn: probe, pools: [pools[0]] });
  console.log(`\nroute SWAP.HIVE→PROJECT, amountIn=${probe}: amountOut=${single.amountOut} (${single.symbolsIn}→${single.symbolsOut})`);

  const multi = routeOut({ amountIn: probe, pools: [pools[0], pools[2]] });
  console.log(`route SWAP.HIVE→PROJECT→SWAP.BTC, amountIn=${probe}: amountOut=${multi.amountOut} over ${multi.hops.length} hops`);

  const opps = findOpportunities({ pools, referencePrices, minEdgeBps: 50, amountIn: probe });
  console.log(`\nopportunities (minEdge=50bps): ${opps.length}`);
  for (const o of opps) {
    console.log(`  ${o.path.padEnd(28)} edge=${o.edgeBps}bps  in=${o.amountIn}  out=${o.expectedOut}`);
  }
}
