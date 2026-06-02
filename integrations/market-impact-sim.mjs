// market-impact-sim.mjs — READ-ONLY "what-if" market-impact simulator + spike learning. No keys,
// no signing, NO ORDERS PLACED. Everything here is pure simulation against the live HIVE-Engine
// order books and the recent on-chain trade history — a thinking aid for the bots/AIs, never a
// trade and never a recommendation.
//
// Two jobs:
//   1. WHAT-IF  — "what happens to the market if I put $X (HIVE) into VKBT / CURE?" We walk the
//                 live sell book (to buy) or buy book (to sell) and report tokens, avg price,
//                 price impact, walls consumed, slippage. simulateBuy/simulateSell + whatIf() ladder.
//   2. LEARN    — spikeStudy() reads recent trade history, finds the biggest move (a spike), and
//                 characterises it (pre-spike price, peak, volume, trade count, how fast it
//                 reverted). The operator deliberately spiked VKBT so the bots could WATCH and
//                 build a market-impact prior from a real event.
//
// IMPORTANT: advisory, simulation only. No keys are loaded, no orders are placed, nothing is
// broadcast. Reads go through the keyless multi-node he-client. Price oracle gives HIVE→USD so the
// curve is legible in dollars.
//
//   node integrations/market-impact-sim.mjs [SYMBOL ...]            # default: VKBT CURE
//   import { orderBook, simulateBuy, simulateSell, spikeStudy, whatIf, engineBlock }

import { find } from './he-client.mjs';
import { hiveUsd as oracleHiveUsd } from './price-oracle.mjs';

const DEFAULT_TARGETS = ['VKBT', 'CURE'];
// USD ladder for the impact curve — small real-world sizes a bot might actually deploy.
const DEFAULT_LADDER_USD = [10, 25, 50, 100, 250, 500, 1000];
// "real liquidity" band: orders within this multiple of the best price count as tradeable;
// anything beyond is treated as a parked/junk order (won't realistically fill).
const REAL_BAND = 5;

const num = (x) => { const v = +x; return Number.isFinite(v) ? v : 0; };
const round = (x, d = 8) => +(+x).toFixed(d);

// ───────────────────────────── order book ─────────────────────────────

/**
 * Read the live HIVE-Engine buy/sell books for a token, normalized to bids/asks with cumulative
 * depth (cumQty / cumHive running totals). Asks ascending (cheapest first = what a buyer eats),
 * bids descending (highest first = what a seller hits). Read-only.
 */
export async function orderBook(symbol, { depth = 200 } = {}) {
  const [buyBook, sellBook] = await Promise.all([
    find('market', 'buyBook', { symbol }, depth, [{ index: 'priceDec', descending: true }]).catch(() => []),
    find('market', 'sellBook', { symbol }, depth, [{ index: 'priceDec', descending: false }]).catch(() => []),
  ]);

  const norm = (orders, ascending) => {
    const rows = orders
      .map((o) => ({ price: num(o.price), quantity: num(o.quantity), account: o.account }))
      .filter((o) => o.price > 0 && o.quantity > 0)
      .sort((a, b) => ascending ? a.price - b.price : b.price - a.price);
    let cumQty = 0, cumHive = 0;
    return rows.map((o) => {
      cumQty += o.quantity;
      cumHive += o.price * o.quantity;
      return { ...o, hive: round(o.price * o.quantity), cumQty: round(cumQty, 6), cumHive: round(cumHive, 6) };
    });
  };

  const asks = norm(sellBook, true);   // sell book = asks (offers to sell to a buyer)
  const bids = norm(buyBook, false);   // buy book  = bids (offers to buy from a seller)

  // "Real" liquidity = depth within REAL_BAND of the best price. HIVE-Engine micro-books are full
  // of junk orders parked at absurd prices (an ask 1000x the market that will never fill); those
  // inflate raw book depth and make a simulated big buy print a nonsense avg price. We keep the
  // FULL book in `asks`/`bids` (the sim walks real chain state faithfully), but also report the
  // tradeable depth so the brief can say how much can actually deploy at a sane price.
  const bestAsk = asks[0]?.price || 0, bestBid = bids[0]?.price || 0;
  const realAsks = bestAsk ? asks.filter((o) => o.price <= bestAsk * REAL_BAND) : asks;
  const realBids = bestBid ? bids.filter((o) => o.price >= bestBid / REAL_BAND) : bids;

  return {
    symbol,
    asks, bids,
    bestAsk, bestBid,
    spreadPct: (asks[0] && bids[0]) ? round((asks[0].price - bids[0].price) / asks[0].price * 100, 2) : null,
    askDepthHive: round(asks.reduce((a, o) => a + o.hive, 0), 6),   // total HIVE to clear the WHOLE ask book (incl. junk)
    bidDepthHive: round(bids.reduce((a, o) => a + o.hive, 0), 6),
    askTokens: round(asks.reduce((a, o) => a + o.quantity, 0), 6),
    bidTokens: round(bids.reduce((a, o) => a + o.quantity, 0), 6),
    // tradeable depth within a sane band of the top of book — what can actually deploy
    realAskDepthHive: round(realAsks.reduce((a, o) => a + o.hive, 0), 6),
    realBidDepthHive: round(realBids.reduce((a, o) => a + o.hive, 0), 6),
    realAskTokens: round(realAsks.reduce((a, o) => a + o.quantity, 0), 6),
    realBidTokens: round(realBids.reduce((a, o) => a + o.quantity, 0), 6),
  };
}

// ───────────────────────────── simulate buy / sell ─────────────────────────────

// Walk a book level-by-level, consuming up to `limit` of `unit` ('hive' to spend, or 'token' to
// sell). Returns fills + how many discrete order levels (walls) were eaten. Pure math.
function walk(levels, limit, unit) {
  let spentHive = 0, tokens = 0, lastPrice = levels[0]?.price || 0, walls = 0, fullyConsumed = 0, remaining = limit;
  for (const o of levels) {
    if (remaining <= 1e-12) break;
    const levelCapUnit = unit === 'hive' ? o.price * o.quantity : o.quantity;
    if (levelCapUnit <= remaining + 1e-12) {
      // eat the whole level
      spentHive += o.price * o.quantity;
      tokens += o.quantity;
      remaining -= levelCapUnit;
      lastPrice = o.price;
      walls += 1; fullyConsumed += 1;
    } else {
      // partial fill of this level — touched but not cleared; it remains the new top of book
      const takeTokens = unit === 'hive' ? remaining / o.price : remaining;
      spentHive += o.price * takeTokens;
      tokens += takeTokens;
      remaining = 0;
      lastPrice = o.price;
      walls += 1;  // count a partially-eaten wall as touched
      break;
    }
  }
  // fullyConsumed = levels cleared entirely (the new top-of-book is the next un-cleared level)
  return { spentHive, tokens, lastPrice, walls, fullyConsumed, unfilled: Math.max(0, remaining) };
}

/**
 * WHAT-IF "I put money in": simulate spending `hiveAmount` HIVE buying `symbol` by walking the live
 * sell book (asks, cheapest first). No order is placed. Returns tokensBought, avgPrice, price
 * impact (new top-of-book ask vs old best ask), walls consumed, and slippage (avg fill vs the
 * starting best ask). If the book is too thin to absorb the budget, `undeployedHive` is what
 * couldn't be spent.
 */
export async function simulateBuy(symbol, hiveAmount, book) {
  book = book || await orderBook(symbol);
  const asks = book.asks;
  const startAsk = book.bestAsk;
  if (!asks.length || !(hiveAmount > 0)) {
    return { symbol, side: 'buy', hiveIn: round(hiveAmount, 6), tokensBought: 0, avgPrice: 0,
      startAsk, newAsk: startAsk, priceImpactPct: 0, slippagePct: 0, wallsConsumed: 0,
      undeployedHive: round(hiveAmount, 6), clearedBook: false };
  }
  const f = walk(asks, hiveAmount, 'hive');
  const avgPrice = f.tokens > 0 ? f.spentHive / f.tokens : 0;
  // new best ask = the first ask level NOT fully consumed (a partially-eaten level stays best ask).
  // If every level was cleared (book swept), the top of book is the last price we reached.
  const clearedBook = f.unfilled > 1e-9 || f.fullyConsumed >= asks.length;
  const newAsk = asks[f.fullyConsumed]?.price ?? f.lastPrice;
  return {
    symbol, side: 'buy',
    hiveIn: round(hiveAmount, 6),
    spentHive: round(f.spentHive, 6),
    undeployedHive: round(f.unfilled, 6),
    tokensBought: round(f.tokens, 6),
    avgPrice: round(avgPrice),
    startAsk: round(startAsk),
    newAsk: round(newAsk),
    priceImpactPct: startAsk > 0 ? round((newAsk - startAsk) / startAsk * 100, 2) : 0,
    slippagePct: startAsk > 0 && avgPrice > 0 ? round((avgPrice - startAsk) / startAsk * 100, 2) : 0,
    wallsConsumed: f.walls,
    clearedBook,
  };
}

/**
 * WHAT-IF "I sell into the book": simulate selling `tokenAmount` of `symbol` by walking the live
 * buy book (bids, highest first). No order placed. Returns hiveReceived, avgPrice, downward price
 * impact (new top bid vs old best bid), walls consumed, slippage. `unsoldTokens` is what the bid
 * book couldn't absorb.
 */
export async function simulateSell(symbol, tokenAmount, book) {
  book = book || await orderBook(symbol);
  const bids = book.bids;
  const startBid = book.bestBid;
  if (!bids.length || !(tokenAmount > 0)) {
    return { symbol, side: 'sell', tokensIn: round(tokenAmount, 6), hiveReceived: 0, avgPrice: 0,
      startBid, newBid: startBid, priceImpactPct: 0, slippagePct: 0, wallsConsumed: 0,
      unsoldTokens: round(tokenAmount, 6), clearedBook: false };
  }
  const f = walk(bids, tokenAmount, 'token');
  const avgPrice = f.tokens > 0 ? f.spentHive / f.tokens : 0;
  // new best bid = the first bid level NOT fully consumed (a partially-hit level stays best bid)
  const clearedBook = f.unfilled > 1e-9 || f.fullyConsumed >= bids.length;
  const newBid = bids[f.fullyConsumed]?.price ?? f.lastPrice;
  return {
    symbol, side: 'sell',
    tokensIn: round(tokenAmount, 6),
    tokensSold: round(f.tokens, 6),
    unsoldTokens: round(f.unfilled, 6),
    hiveReceived: round(f.spentHive, 6),
    avgPrice: round(avgPrice),
    startBid: round(startBid),
    newBid: round(newBid),
    // selling pushes price DOWN; report impact as the (negative) move in the top bid
    priceImpactPct: startBid > 0 ? round((newBid - startBid) / startBid * 100, 2) : 0,
    slippagePct: startBid > 0 && avgPrice > 0 ? round((avgPrice - startBid) / startBid * 100, 2) : 0,
    wallsConsumed: f.walls,
    clearedBook,
  };
}

// ───────────────────────────── what-if ladder (impact curve) ─────────────────────────────

/**
 * Run simulateBuy across a ladder of HIVE sizes against ONE freshly-pulled book → the market-impact
 * curve ("this much HIVE moves the price by this much"). The prior the bots learn from. Pass a USD
 * ladder + hiveUsd to think in dollars; defaults to HIVE sizes derived from the USD ladder.
 */
export async function whatIf(symbol, hiveAmounts, { hiveUsd } = {}) {
  const book = await orderBook(symbol);
  let ladder = hiveAmounts;
  if (!ladder || !ladder.length) {
    hiveUsd = hiveUsd || await oracleHiveUsd().catch(() => 0);
    ladder = hiveUsd > 0 ? DEFAULT_LADDER_USD.map((u) => u / hiveUsd) : [10, 25, 50, 100, 250, 500];
  }
  const curve = [];
  for (const h of ladder) {
    const s = await simulateBuy(symbol, h, book);
    curve.push({
      hiveIn: round(h, 4),
      usdIn: hiveUsd ? round(h * hiveUsd, 2) : null,
      tokensBought: s.tokensBought,
      avgPrice: s.avgPrice,
      priceImpactPct: s.priceImpactPct,
      slippagePct: s.slippagePct,
      wallsConsumed: s.wallsConsumed,
      undeployedHive: s.undeployedHive,
      clearedBook: s.clearedBook,
      // beyondRealBook: the spend exceeds the tradeable (sane-priced) depth, so the avg/impact
      // above are dominated by parked junk asks — the realistic read is "no real liquidity here".
      beyondRealBook: h > book.realAskDepthHive + 1e-9,
    });
  }
  return {
    symbol,
    hiveUsd: hiveUsd || null,
    bestAsk: book.bestAsk,
    askDepthHive: book.askDepthHive,
    realAskDepthHive: book.realAskDepthHive,
    realAskTokens: book.realAskTokens,
    askTokens: book.askTokens,
    curve,
  };
}

// ───────────────────────────── spike study (learning record) ─────────────────────────────

/**
 * LEARN from a real event: pull recent trade history for `symbol`, detect the biggest price move
 * (the spike), and characterise it — pre-spike baseline, peak, the run-up %, volume during,
 * how many trades carried it, and how far it reverted afterward. This is how the bots build a
 * market-impact prior from the operator's deliberately-made VKBT spike. Read-only.
 *
 * NOTE: HIVE-Engine's tradesHistory table is a shallow rolling window (only the most recent fills),
 * so the study covers whatever the chain still exposes. `hours` filters that window further.
 */
export async function spikeStudy(symbol, { hours = 72, limit = 1000 } = {}) {
  const raw = await find('market', 'tradesHistory', { symbol }, limit, [{ index: 'timestamp', descending: true }]).catch(() => []);
  const cutoff = Math.floor(Date.now() / 1000) - hours * 3600;
  const trades = raw
    .map((t) => ({ ts: num(t.timestamp), price: num(t.price), qty: num(t.quantity), volume: num(t.volume), type: t.type, buyer: t.buyer, seller: t.seller }))
    .filter((t) => t.price > 0 && t.ts >= cutoff)
    .sort((a, b) => a.ts - b.ts); // chronological

  if (trades.length < 2) {
    return { symbol, hours, trades: trades.length, spike: null,
      note: trades.length ? 'too few trades in window to characterise a spike' : 'no trades in window' };
  }

  const prices = trades.map((t) => t.price);
  const peakIdx = prices.indexOf(Math.max(...prices));
  const troughIdx = prices.indexOf(Math.min(...prices));
  const peak = trades[peakIdx], trough = trades[troughIdx];

  // pre-spike baseline = the launch point of the run-up: the lowest price AT OR BEFORE the peak
  // (the floor the push lifted off). If the peak is the first trade, fall back to the first trade.
  let baselineIdx = 0, baselinePrice = trades[0].price;
  for (let i = 0; i <= peakIdx; i++) if (trades[i].price < baselinePrice) { baselinePrice = trades[i].price; baselineIdx = i; }
  const baseline = trades[baselineIdx];

  // volume + trade count over the whole window, and specifically over the run-up (baseline→peak)
  const runUp = trades.slice(Math.min(baselineIdx, peakIdx), Math.max(baselineIdx, peakIdx) + 1);
  const runUpVolume = runUp.reduce((a, t) => a + t.volume, 0);
  const totalVolume = trades.reduce((a, t) => a + t.volume, 0);

  // reversion, two well-defined views:
  //  - drawdownFromPeakPct: how far price fell from the peak, as a % of the peak (always 0..~100).
  //  - revertedPctOfRunUp: of the run-up (baseline→peak), how much was given back — clamped to
  //    [0,100] and only reported when the run-up was non-trivial (>1%), so a tiny run-up that later
  //    collapsed below baseline doesn't print an absurd ratio.
  const last = trades[trades.length - 1];
  const runUpPct = baseline.price > 0 ? (peak.price - baseline.price) / baseline.price * 100 : 0;
  const drawdownFromPeakPct = peak.price > 0 ? (peak.price - last.price) / peak.price * 100 : 0;
  const runUpRange = peak.price - baseline.price;
  const revertedPct = (runUpPct > 1 && runUpRange > 0)
    ? Math.max(0, Math.min(100, (peak.price - last.price) / runUpRange * 100))
    : null;
  const peakToLastMin = (last.ts - peak.ts) / 60;

  // dominant taker on the run-up (who pushed it)
  const buyerCounts = {};
  for (const t of runUp) if (t.buyer) buyerCounts[t.buyer] = (buyerCounts[t.buyer] || 0) + 1;
  const topBuyer = Object.entries(buyerCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  return {
    symbol,
    hours,
    trades: trades.length,
    window: { from: new Date(trades[0].ts * 1000).toISOString(), to: new Date(last.ts * 1000).toISOString() },
    spike: {
      baselinePrice: round(baseline.price),
      peakPrice: round(peak.price),
      troughPrice: round(trough.price),
      runUpPct: round(runUpPct, 1),
      peakAt: new Date(peak.ts * 1000).toISOString(),
      tradesInWindow: trades.length,
      runUpTrades: runUp.length,
      runUpVolumeHive: round(runUpVolume, 6),
      totalVolumeHive: round(totalVolume, 6),
      pushedBy: topBuyer,
      lastPrice: round(last.price),
      drawdownFromPeakPct: round(drawdownFromPeakPct, 1),       // peak→last fall as % of peak (robust)
      revertedPctOfRunUp: revertedPct == null ? null : round(revertedPct, 1),  // 100% = gave the spike fully back; null when run-up was trivial
      reversionMinutes: round(peakToLastMin, 1),
      // "reverted" = price has fallen meaningfully back off the peak; this is what the bots learn.
      heldOrReverted: drawdownFromPeakPct >= 20 ? 'reverted' : 'holding',
    },
  };
}

// ───────────────────────────── brief block ─────────────────────────────

const fmtUsd = (x) => x == null ? '—' : (x < 1 ? `$${(+x).toFixed(6)}` : `$${(+x).toFixed(2)}`);

/**
 * Brief-ready "### What-if & market impact" section: per token, the spike characterisation (what
 * the operator's event taught us) + the market-impact curve from whatIf(). Advisory, simulation
 * only — no orders placed.
 */
export async function engineBlock(symbols = DEFAULT_TARGETS, { hours = 72 } = {}) {
  const hiveUsd = await oracleHiveUsd().catch(() => 0);
  const L = [];
  L.push('### What-if & market impact');
  L.push('');
  L.push('_Advisory. Simulation only — these walk the live order books and recent trade history; NO orders are placed, no keys touched. A market-impact prior the bots learn from, not a recommendation._');
  L.push(`_HIVE ≈ ${fmtUsd(hiveUsd)} USD._`);
  L.push('');

  for (const symbol of symbols) {
    try {
      const [study, wi] = await Promise.all([
        spikeStudy(symbol, { hours }),
        whatIf(symbol, null, { hiveUsd }),
      ]);
      L.push(`**${symbol}**`);

      // spike learning record
      if (study.spike) {
        const s = study.spike;
        L.push(`- Spike study (${study.trades} trades${study.window ? `, ${study.window.from.slice(0, 16)}→${study.window.to.slice(0, 16)}` : ''}): ` +
          `baseline ${s.baselinePrice} → peak ${s.peakPrice} HIVE (${s.runUpPct >= 0 ? '+' : ''}${s.runUpPct}%), ` +
          `${s.runUpTrades} trades / ${s.runUpVolumeHive} HIVE vol${s.pushedBy ? `, pushed by @${s.pushedBy}` : ''}; ` +
          `since: ${s.lastPrice} HIVE — ${s.heldOrReverted}, down ${s.drawdownFromPeakPct}% from peak over ${s.reversionMinutes} min` +
          `${s.revertedPctOfRunUp != null ? ` (${s.revertedPctOfRunUp}% of the run-up given back)` : ''}.`);
        L.push(`  - Lesson: a thin book lets a small push print a high peak, but it ${s.heldOrReverted === 'reverted' ? 'reverts once the pushing stops — the move was liquidity, not demand' : 'has held so far — watch whether real bids appear under it'}.`);
      } else {
        L.push(`- Spike study: ${study.note}.`);
      }

      // impact curve
      if (wi.curve.length) {
        const realUsd = hiveUsd ? round(wi.realAskDepthHive * hiveUsd, 2) : null;
        L.push(`- Impact curve (buy, best ask ${wi.bestAsk} HIVE): only ${wi.realAskDepthHive} HIVE${realUsd != null ? ` (~${fmtUsd(realUsd)})` : ''} / ${wi.realAskTokens} tokens offered at a SANE price (within ${REAL_BAND}× best ask); the rest of the book is parked junk asks.`);
        for (const c of wi.curve) {
          const label = c.usdIn != null ? `${fmtUsd(c.usdIn)}` : `${c.hiveIn} HIVE`;
          L.push(`  - ${label} → buys ${c.tokensBought} ${symbol}, avg ${c.avgPrice}, top ask ${c.priceImpactPct >= 0 ? '+' : ''}${c.priceImpactPct}%, slippage ${c.slippagePct}%, ${c.wallsConsumed} walls${c.clearedBook ? ' (CLEARS BOOK)' : ''}${c.beyondRealBook ? ' ⚠ beyond real liquidity — avg is junk-ask noise' : ''}${c.undeployedHive > 0 ? `, ${c.undeployedHive} HIVE undeployable` : ''}`);
        }
      }
      L.push('');
    } catch (e) {
      L.push(`**${symbol}** — error: ${e.message}`);
      L.push('');
    }
  }
  L.push('_How the bots learn: the spike study turns the operator\'s real VKBT event into a measured prior (small push → big % on a thin book → fast reversion). The impact curve quantifies the same shape forward (how far $X moves price, how much can\'t deploy). Together they teach the bots that a swept book is a vanity print, not demand — so "put $X in" is simulated and questioned before it is ever acted on._');
  return L.join('\n');
}

// ───────────────────────────── CLI ─────────────────────────────

if (process.argv[1] && process.argv[1].endsWith('market-impact-sim.mjs')) {
  const syms = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const targets = syms.length ? syms : DEFAULT_TARGETS;
  console.log('What-if market-impact simulator + spike learning (READ-ONLY, simulation only — NO orders placed)');
  console.log('='.repeat(96));
  const block = await engineBlock(targets);
  console.log('\n' + block);
}
