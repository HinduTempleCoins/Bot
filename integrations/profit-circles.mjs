// profit-circles.mjs — READ-ONLY / ADVISORY profit-circle + volatility-scalp engine (task #191).
//
// ┌─────────────────────────────────────────────────────────────────────────────────────────┐
// │ STRATEGY (operator-corrected): KEEP THE CAPITAL. CYCLE IT. SKIM.                          │
// │   We do NOT sell capital for USD. The core capital stays intact on Hive-Engine and        │
// │   CYCLES round-trip; we only skim the small profit each loop throws off. Every path in     │
// │   this engine RETURNS TO HIVE-ENGINE (back to HIVE), never one-way out to USD/fiat.        │
// │   Skimmed profits accumulate in a 'war chest' that funds stocks/USD/copy-trade LATER —     │
// │   the principal is never spent.                                                            │
// └─────────────────────────────────────────────────────────────────────────────────────────┘
//
// NEVER executes a trade. No keys on host (zero-WIF rule). Best-effort + cached: every public fn
// catches and returns an empty/zeroed shape rather than throwing, so an unattended 24/7 engine
// loop never dies on a flaky node.
//
//   node integrations/profit-circles.mjs              # print circles + scalps + the skim plan
//   node integrations/profit-circles.mjs circles      # just the round-trip loops
//   node integrations/profit-circles.mjs scalps       # just the volatility-scalp candidates
//   node integrations/profit-circles.mjs block        # the brief-ready markdown section
//   import { profitCircles, scalpCandidates, skimPlan, engineBlock } from './profit-circles.mjs'

import { topByVolume, allMarketMetrics } from './market-universe.mjs';
import { market } from './hive-engine-market.mjs';
import { cached, TTL } from './soapbox/cache.mjs';

// Hive-Engine charges a fee per side of a market trade. 1% buy + 1% sell = ~2% round-trip drag,
// so a closed loop only nets HIVE if the captured spread clears the round-trip fee.
const FEE_PER_SIDE = +(process.env.PC_FEE_PER_SIDE || 0.01);   // 1% per side (HE default)
const ROUND_TRIP_FEE = FEE_PER_SIDE * 2;                        // both legs
// only surface a loop if it nets at least this much AFTER fees — below this it's noise.
const MIN_NET_PCT = +(process.env.PC_MIN_NET_PCT || 0.5);       // 0.5% net
// a loop must be executable for at least this much HIVE on the thinner leg to be worth proposing.
const MIN_DEPTH_HIVE = +(process.env.PC_MIN_DEPTH_HIVE || 15);
// scalp filters: a candidate must clear BOTH a real-volume floor AND an oscillation floor.
const SCALP_MIN_VOL = +(process.env.PC_SCALP_MIN_VOL || 50);    // 24h HIVE volume floor
const SCALP_MIN_OSC = +(process.env.PC_SCALP_MIN_OSC || 1.5);   // % oscillation floor over the window
const SCALP_TRADE_WINDOW = +(process.env.PC_SCALP_TRADES || 40);// recent fills to sample per token
const UNIVERSE_N = +(process.env.PC_UNIVERSE_N || 25);          // how deep into the volume table we scan

const round = (n, d = 4) => (Number.isFinite(+n) ? +(+n).toFixed(d) : 0);

// ── helpers ──────────────────────────────────────────────────────────────────

// HIVE resting on one side of the book within a price band [lo, hi]. For a closed buy-low/sell-high
// loop the realizable size is bounded by the liquidity sitting INSIDE the spread you'd work — the
// bids you could rest a sell against and the asks you could rest a buy against. Walk levels and sum
// the HIVE whose price falls in the band, so a far-away phantom wall outside the band doesn't count.
export function bandHive(levels, lo, hi) {
  let hive = 0, qty = 0;
  for (const lvl of levels || []) {
    const price = +lvl.price, q = +lvl.quantity;
    if (!(price > 0) || !(q > 0)) continue;
    if (price < lo || price > hi) continue;        // only liquidity inside the working band
    hive += price * q; qty += q;
  }
  return { hive, qty };
}

// recent trade fills for a token, normalized + sorted oldest→newest. Cached (candles TTL).
async function recentTrades(symbol, limit = SCALP_TRADE_WINDOW) {
  return cached(`pc:trades:${symbol}:${limit}`, TTL.ohlcv, async () => {
    try {
      const rows = await market.trades(symbol, limit);
      return (rows || [])
        .map((t) => ({ price: +t.price, qty: +t.quantity, ts: +t.timestamp, type: t.type }))
        .filter((t) => t.price > 0)
        .sort((a, b) => a.ts - b.ts);
    } catch { return []; }
  });
}

// oscillation metric over a fills window: high/low spread as a % of the average, plus the
// coefficient of variation (stdev/mean) so a few wild prints don't masquerade as a tradable swing.
export function oscillation(trades) {
  const px = trades.map((t) => t.price).filter((p) => p > 0);
  if (px.length < 4) return null;
  const hi = Math.max(...px), lo = Math.min(...px);
  const mean = px.reduce((a, p) => a + p, 0) / px.length;
  if (!(mean > 0)) return null;
  const variance = px.reduce((a, p) => a + (p - mean) ** 2, 0) / px.length;
  const cv = Math.sqrt(variance) / mean;                 // coefficient of variation
  const rangePct = ((hi - lo) / mean) * 100;             // peak-to-trough as % of avg
  const spanHrs = trades.length > 1 ? (trades[trades.length - 1].ts - trades[0].ts) / 3600 : 0;
  return { hi, lo, mean, rangePct, cvPct: cv * 100, samples: px.length, spanHrs };
}

// ── 1. profitCircles() — round-trip loops that RETURN TO HIVE-ENGINE with more HIVE ──────────
//
// Two honest families of closed loop, both ending back in HIVE on Hive-Engine (never exiting to USD):
//
//   (a) INTERNAL HE SPREAD LOOP: for a single liquid HE market, if the lowest ask and highest bid
//       straddle the recent VWAP wide enough that buying near the bid and selling near the ask
//       clears the ~2% round-trip fee, that's a closed HIVE→token→HIVE loop. We size it by the
//       executable depth on the thinner leg so a phantom 1-token wall can't fake an edge.
//
//   (b) SWAP.X RE-ANCHOR LOOP: a SWAP token's own HE bid/ask spread (its mid drifting around its
//       VWAP) lets the same buy-low/sell-high loop run while the value stays inside Hive-Engine in
//       HIVE terms. (The richer external-price version lives in arb-scanner.mjs; here we keep the
//       loop strictly HE-internal so the path provably returns to HIVE-Engine.)
//
// Returns advisory loops, each clearly labelled as returning to HE (NOT a sell-to-USD).
export async function profitCircles({ universeN = UNIVERSE_N } = {}) {
  return cached(`pc:circles:${universeN}`, TTL.price, async () => {
    const out = [];
    let top;
    try { top = await topByVolume(universeN); } catch { top = []; }
    for (const t of top || []) {
      try {
        const sym = t.symbol;
        const [buys, sells, trades] = await Promise.all([
          market.buyBook(sym, 12).catch(() => []),   // bids (we'd SELL into these)
          market.sellBook(sym, 12).catch(() => []),  // asks (we'd BUY from these)
          recentTrades(sym, SCALP_TRADE_WINDOW),
        ]);
        const bid = +(buys[0]?.price) || 0;          // best bid (highest)
        const ask = +(sells[0]?.price) || 0;         // best ask (lowest)
        if (!(bid > 0) || !(ask > 0) || ask <= bid) continue;  // need a genuine two-sided book with bid<ask

        // VWAP of recent fills = the loop's anchor (the "fair" price the round-trip cycles around)
        const vol = trades.reduce((a, x) => a + x.price * x.qty, 0);
        const totQty = trades.reduce((a, x) => a + x.qty, 0);
        const vwap = totQty > 0 ? vol / totQty : (bid + ask) / 2;

        // The captured spread of the closed loop: buy at the ask, sell at the bid would be negative,
        // so the loop only works as buy-LOW / sell-HIGH around the VWAP. We model the realistic
        // closed loop: place a buy just above the best bid, a sell just below the best ask. The gross
        // edge available is the bid/ask gap relative to the mid; fees eat ROUND_TRIP_FEE of it.
        const mid = (bid + ask) / 2;
        const grossPct = ((ask - bid) / mid) * 100;            // the spread you could work inside
        const netPct = grossPct - ROUND_TRIP_FEE * 100;        // after both 1% fees
        if (netPct < MIN_NET_PCT) continue;

        // executable depth: the HIVE resting INSIDE the working band [bid, ask] on each side. The
        // loop's realizable size is the thinner of the two — you can only cycle as much as both the
        // buy leg (asks within band) and the sell leg (bids within band) will absorb.
        const buyLeg = bandHive(sells, bid, ask);    // asks we could rest a buy against
        const sellLeg = bandHive(buys, bid, ask);    // bids we could rest a sell against
        const depthHive = round(Math.min(buyLeg.hive, sellLeg.hive), 1);
        if (depthHive < MIN_DEPTH_HIVE) continue;

        // confidence: more recent fills + tighter coefficient-of-variation around VWAP = more trustworthy
        const osc = oscillation(trades);
        const confidence =
          osc && osc.samples >= 12 && depthHive >= MIN_DEPTH_HIVE * 2 ? 'high'
            : osc && osc.samples >= 6 ? 'medium' : 'low';

        const startHive = depthHive;
        const estEndHive = round(startHive * (1 + netPct / 100), 2);
        out.push({
          symbol: sym,
          path: [
            `HIVE → buy ${sym} near ${round(bid, 8)} (bid side)`,
            `${sym} → sell near ${round(ask, 8)} (ask side)`,
            `→ back to HIVE on Hive-Engine`,
          ],
          startHive: round(startHive, 2),
          estEndHive,
          netPct: round(netPct, 2),
          grossPct: round(grossPct, 2),
          vwap: round(vwap, 8),
          depthHive,
          confidence,
          note: `Closed HE loop — capital returns to HIVE-Engine, not USD. Buy near bid ${round(bid, 8)}, sell near ask ${round(ask, 8)} around VWAP ${round(vwap, 8)}; ~${round(depthHive, 0)} HIVE cyclable; nets ~${round(netPct, 2)}% after the ${(ROUND_TRIP_FEE * 100).toFixed(0)}% round-trip fee. Advisory only.`,
        });
      } catch { /* skip this token, keep the loop alive */ }
    }
    // best loops first: realizable skim = depth × net%
    out.sort((a, b) => b.depthHive * b.netPct - a.depthHive * a.netPct);
    return out;
  });
}

// ── 2. scalpCandidates() — high-VOLUME tokens that OSCILLATE intraday ("swings ±$0.05 all day") ──
//
// Rank by BOTH 24h volume AND oscillation, then propose a constant-size RANGE SCALP for each:
// buy the dip / sell the pop, keep position size constant, skim the swing — never sell the whole bag.
export async function scalpCandidates({ universeN = UNIVERSE_N, minVol = SCALP_MIN_VOL, minOsc = SCALP_MIN_OSC } = {}) {
  return cached(`pc:scalps:${universeN}:${minVol}:${minOsc}`, TTL.price, async () => {
    const out = [];
    let metrics;
    try { metrics = await allMarketMetrics(); } catch { metrics = []; }
    const bySym = new Map((metrics || []).map((m) => [m.symbol, m]));
    let top;
    try { top = await topByVolume(universeN); } catch { top = []; }

    for (const t of top || []) {
      try {
        if (!(t.volume >= minVol)) continue;                  // real-volume floor
        const trades = await recentTrades(t.symbol, SCALP_TRADE_WINDOW);
        const osc = oscillation(trades);
        if (!osc) continue;
        // use the larger of range% and 2×CV% as the "swing" — robust to one or two outlier prints
        const oscillationPct = round(Math.max(osc.rangePct, osc.cvPct * 2), 2);
        if (oscillationPct < minOsc) continue;                // oscillation floor

        const m = bySym.get(t.symbol);
        const last = m ? m.lastPrice : osc.mean;
        // constant-size range: buy below the lower third of the swing, sell above the upper third.
        const span = osc.hi - osc.lo;
        const suggestedBuyBelow = round(osc.lo + span * 0.25, 8);
        const suggestedSellAbove = round(osc.hi - span * 0.25, 8);
        out.push({
          symbol: t.symbol,
          volume: round(t.volume, 1),
          lastPrice: round(last, 8),
          oscillationPct,
          rangePct: round(osc.rangePct, 2),
          cvPct: round(osc.cvPct, 2),
          windowHrs: round(osc.spanHrs, 1),
          samples: osc.samples,
          suggestedBuyBelow,
          suggestedSellAbove,
          note: `buy the dip (≤${suggestedBuyBelow}) / sell the pop (≥${suggestedSellAbove}), keep size constant, skim the swing — never sell the whole bag. ${oscillationPct}% intraday oscillation on ${round(t.volume, 0)} HIVE 24h volume. Advisory only.`,
        });
      } catch { /* skip token */ }
    }
    // rank by volume × oscillation — the tokens that move a lot AND trade a lot
    out.sort((a, b) => b.volume * b.oscillationPct - a.volume * a.oscillationPct);
    return out;
  });
}

// ── 3. skimPlan() — the war-chest model: PRESERVE the core, accumulate the skim ──────────────
//
// The whole point: principal is never spent. Each closed loop / scalp throws off a small profit;
// those profits accumulate in a 'war chest' bucket. The war chest — NOT the principal — is what
// later funds stocks / USD / copy-trade. This is a structure/documentation model, not an executor.
export function skimPlan(profits = [], { skimRate = +(process.env.PC_SKIM_RATE || 1.0), warChestUsdTarget = +(process.env.PC_WARCHEST_TARGET_HIVE || 0) } = {}) {
  // `profits` is a list of realized (or estimated) per-loop HIVE gains: [{ source, hive }] or [hive,...]
  const items = (profits || []).map((p) => (typeof p === 'number' ? { source: 'loop', hive: p } : { source: p.source || 'loop', hive: +p.hive || 0 }))
    .filter((p) => Number.isFinite(p.hive));
  const grossSkim = items.reduce((a, p) => a + p.hive, 0);
  const toWarChest = round(grossSkim * skimRate, 4);   // skimRate=1.0: ALL skim banked, principal untouched

  return {
    model: 'keep-capital / cycle / skim',
    principalPolicy: 'PRESERVED — core capital is never sold; it only cycles round-trip back to HIVE-Engine.',
    skimRate,
    skimmedThisBatch: round(grossSkim, 4),
    bankedToWarChest: toWarChest,
    warChest: {
      bucket: 'war-chest (HIVE)',
      purpose: 'LATER funds stocks / USD / copy-trade — drawn ONLY from accumulated skim, never from principal.',
      targetHive: warChestUsdTarget || null,
      readyToDeploy: warChestUsdTarget ? toWarChest >= warChestUsdTarget : null,
    },
    items,
    note: 'Advisory model. No trade executed. Principal cycles; only the skim leaves the loop, into the war chest.',
  };
}

// ── 4. engineBlock() — brief-ready markdown the 24/7 resource-center can drop in ─────────────
//
// Mirrors the shape of resource-center.mjs's briefReport sections so it can be appended directly.
export async function engineBlock({ universeN = UNIVERSE_N, maxCircles = 5, maxScalps = 6 } = {}) {
  let circles = [], scalps = [];
  try { circles = await profitCircles({ universeN }); } catch { circles = []; }
  try { scalps = await scalpCandidates({ universeN }); } catch { scalps = []; }

  const L = [];
  L.push(`### Profit circles & scalps`);
  L.push(`*Keep the capital, cycle it, skim — every path returns to Hive-Engine in HIVE, never sells out to USD. Advisory only, no trades executed.*`);
  L.push('');

  L.push(`**Round-trip loops** (HIVE → token → HIVE on Hive-Engine, net of the ${(ROUND_TRIP_FEE * 100).toFixed(0)}% round-trip fee):`);
  if (circles.length) {
    for (const c of circles.slice(0, maxCircles)) {
      L.push(`- **${c.symbol}**: cycle ~${c.depthHive} HIVE → ~${c.estEndHive} HIVE (**+${c.netPct}%** net, ${c.confidence} conf). Buy near ${c.vwap} VWAP, sell into the spread. Returns to HE.`);
    }
  } else L.push(`- No closed loops clear the ${(ROUND_TRIP_FEE * 100).toFixed(0)}% round-trip fee with ≥${MIN_DEPTH_HIVE} HIVE depth right now.`);
  L.push('');

  L.push(`**Volatility scalps** (high-volume + high-oscillation; constant size, buy the dip / sell the pop, never the whole bag):`);
  if (scalps.length) {
    for (const s of scalps.slice(0, maxScalps)) {
      L.push(`- **${s.symbol}**: ${s.oscillationPct}% swing on ${s.volume} HIVE 24h vol — buy ≤${s.suggestedBuyBelow}, sell ≥${s.suggestedSellAbove}.`);
    }
  } else L.push(`- No tokens currently clear both the volume (≥${SCALP_MIN_VOL} HIVE) and oscillation (≥${SCALP_MIN_OSC}%) floors.`);
  L.push('');
  L.push(`**Skim model:** principal PRESERVED — it only cycles. Each loop/scalp's small profit banks to a 'war chest' that LATER funds stocks/USD/copy-trade. The core capital is never sold.`);
  return L.join('\n');
}

export default { profitCircles, scalpCandidates, skimPlan, engineBlock };

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('profit-circles.mjs')) {
  const cmd = (process.argv[2] || 'all').toLowerCase();
  const f = (n, d = 8) => (Number.isFinite(+n) ? (+n).toFixed(d) : '—');

  if (cmd === 'block') {
    console.log(await engineBlock());
  } else {
    if (cmd === 'all' || cmd === 'circles') {
      const circles = await profitCircles();
      console.log('\nPROFIT CIRCLES — closed loops back to Hive-Engine (keep capital, cycle, skim — never sell to USD)');
      console.log('─'.repeat(92));
      if (!circles.length) console.log('  none clearing the round-trip fee with real depth right now.');
      for (const c of circles.slice(0, 10)) {
        console.log(`  ${c.symbol.padEnd(14)} +${String(c.netPct).padStart(5)}% net  depth ~${String(c.depthHive).padStart(7)} HIVE  (${c.confidence})  VWAP ${f(c.vwap)}`);
        console.log(`     ${c.path.join('  ')}`);
      }
    }
    if (cmd === 'all' || cmd === 'scalps') {
      const scalps = await scalpCandidates();
      console.log('\nSCALP CANDIDATES — high volume + high oscillation (constant size, buy dip / sell pop)');
      console.log('─'.repeat(92));
      console.log('  symbol         24h vol(HIVE)   osc%    buy ≤            sell ≥           window');
      console.log('─'.repeat(92));
      if (!scalps.length) console.log('  none clearing both the volume and oscillation floors right now.');
      for (const s of scalps.slice(0, 15)) {
        console.log(`  ${s.symbol.padEnd(14)} ${String(s.volume).padStart(12)}  ${String(s.oscillationPct).padStart(5)}  ${f(s.suggestedBuyBelow).padStart(14)}  ${f(s.suggestedSellAbove).padStart(14)}  ${s.windowHrs}h/${s.samples}`);
      }
    }
    if (cmd === 'all') {
      // demo the skim model on the surfaced circles' estimated gains
      const circles = await profitCircles();
      const plan = skimPlan(circles.map((c) => ({ source: c.symbol, hive: c.estEndHive - c.startHive })), { warChestUsdTarget: 100 });
      console.log('\nSKIM PLAN (war-chest model — principal PRESERVED, only skim is banked)');
      console.log('─'.repeat(92));
      console.log(`  skimmed this batch: ${plan.skimmedThisBatch} HIVE → banked to war chest: ${plan.bankedToWarChest} HIVE`);
      console.log(`  ${plan.principalPolicy}`);
      console.log(`  war chest purpose: ${plan.warChest.purpose}`);
    }
  }
}
