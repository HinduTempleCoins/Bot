// backtest.mjs — KEYLESS, READ-ONLY backtester over HIVE-Engine history (task #222, ADOPT #1).
//
// WHY this exists (the single biggest gap in our trade stack — see .local/oss-benchmark/trade-stack.md):
//   We could compute realized P&L AFTER the fact (profit-tracker) and rank CURRENT opportunities
//   (market-entry / ai-trade-suggest), but we could never replay history to ask "what WOULD this
//   strategy have done?". That is exactly the question that would have caught the SWAP.LTC bleed
//   (−6,424 HIVE one-way accumulation) as a sinking equity curve, DAYS before it cost real HIVE.
//
// DESIGN (own code only — Freqtrade/OctoBot are GPL-3, patterns harvested, NO code copied):
//   • Candle-replay loop (Freqtrade pattern): iterate candles sequentially, in time order.
//   • No look-ahead bias (Jesse rule): the strategy only ever sees data up to the current candle.
//   • Fees always included (Freqtrade rule): every simulated fill carries a fee into the P&L.
//   • DEPTH-AWARE fills (our correction of Freqtrade's zero-slippage optimism, mandatory on thin
//     HIVE-Engine books): fill price worsens linearly with order size vs available book depth, and
//     orders larger than the depth get PARTIAL fills. A backtest that assumes you always get your
//     price lies on exactly the illiquid pairs we trade.
//
// SAFETY:
//   • READ-ONLY. Replays the past and reports. It signs NOTHING, holds NO key, broadcasts NOTHING.
//   • Deterministic given its input data (pure replay; no Date.now, no randomness in the math).
//   • Offline-testable: history/market source is injectable via __setData(); the network readers are
//     a defensive, soft-failing fallback only.
//   • REUSE not reinvent: scoring goes through profit-tracker.mjs's FIFO P&L (imported, not edited);
//     the default strategy mirrors execute.mjs's premium-sell / discount-buy + bleed-guard shape.
//
//   node integrations/angelicalist/backtest.mjs                 # demo on built-in synthetic history
//   import { backtest, loadHistory, simulateFill, wouldHaveCaught, report } from './backtest.mjs'

import { reset as ptReset, record as ptRecord, pnl as ptPnl } from '../profit-tracker.mjs';

const round = (n) => +(+n).toFixed(8);
const FEE_RATE = 0.0025; // HIVE-Engine market fee (0.25%) — applied to the HIVE value of every fill.

// ── injectable data source ────────────────────────────────────────────────────────────────────
// __setData(fn) lets tests (and callers) supply history WITHOUT touching the network. fn receives
// { token, days, source } and returns raw rows; loadHistory normalizes them. Default is null →
// loadHistory falls back to a defensive import of the real readers and soft-fails to [] offline.
let _dataFn = null;
export function __setData(fn) { _dataFn = typeof fn === 'function' ? fn : null; return _dataFn; }

// Normalize anything candle-ish or fill-ish into our canonical candle shape.
//   { t, open, high, low, close, volume, bidDepth?, askDepth? }
// Accepts: native candles; or raw HE trade rows ({timestamp,price,quantity,type}); soft-skips junk.
function normalizeCandle(r) {
  if (!r || typeof r !== 'object') return null;
  // already a candle?
  if (r.close != null && (r.open != null || r.t != null)) {
    const close = +r.close;
    const open = +(r.open ?? close);
    const high = +(r.high ?? Math.max(open, close));
    const low = +(r.low ?? Math.min(open, close));
    if (!(close >= 0)) return null;
    return {
      t: r.t ?? r.timestamp ?? 0,
      open, high, low, close,
      volume: +(r.volume ?? 0) || 0,
      ...(r.bidDepth != null ? { bidDepth: +r.bidDepth } : {}),
      ...(r.askDepth != null ? { askDepth: +r.askDepth } : {}),
    };
  }
  // raw HE fill/trade row → degenerate 1-tick candle (price = open = high = low = close).
  const price = +(r.price ?? r.lastPrice);
  if (!(price >= 0)) return null;
  const qty = +(r.quantity ?? r.quantityTokens ?? r.volume ?? 0) || 0;
  return { t: r.timestamp ?? r.t ?? 0, open: price, high: price, low: price, close: price, volume: qty };
}

/**
 * loadHistory — fetch + normalize candles/fills for one token.
 * Uses the injected source if set (offline/tests); otherwise defensively imports the real readers
 * and SOFT-FAILS to [] (never throws, never blocks on the network in a test).
 * Returns candles sorted ascending by time: [{ t, open, high, low, close, volume, bidDepth?, askDepth? }]
 */
export async function loadHistory({ token, days = 30, source } = {}) {
  let raw = [];
  try {
    if (_dataFn) {
      raw = await _dataFn({ token, days, source });
    } else {
      // Defensive fallback to real readers — never let a network/import failure throw.
      const mod = await import('../hive-engine-market.mjs').catch(() => null);
      if (mod?.market?.trades) raw = await mod.market.trades(token, 500).catch(() => []);
    }
  } catch { raw = []; }
  if (!Array.isArray(raw)) return [];
  return raw.map(normalizeCandle).filter(Boolean).sort((a, b) => (a.t || 0) - (b.t || 0));
}

/**
 * simulateFill — DEPTH-AWARE fill model (the honesty correction for thin books).
 *
 * order: { side:'buy'|'sell', symbol, quantity, price }  (price is the limit/intended price)
 * candle: a normalized candle (carries optional bidDepth/askDepth = tokens available at the touch).
 *
 * Rules:
 *   1. An order never fills BETTER than the candle range. A buy pays at least the low; a sell never
 *      receives more than the high. (Freqtrade's "must be within the candle" rule.)
 *   2. PARTIAL FILLS: you cannot take more size than the book holds. filledQty = min(qty, depth).
 *      Depth defaults to the candle volume when explicit bid/askDepth is absent.
 *   3. LINEAR PRICE IMPACT: pushing size into a thin book worsens your average price. The penalty is
 *      proportional to (filledQty / depth): a fill that consumes the whole visible depth pays/【receives
 *      a full IMPACT_MAX worse price; a tiny fill pays ~mid. Documented, simple, conservative.
 *
 * Returns { filledQty, avgPrice, hiveValue, fee, partial, impactPct }. filledQty 0 ⇒ no fill.
 */
const IMPACT_MAX = 0.10; // a fill that eats 100% of visible depth gets a 10% worse average price.
export function simulateFill(order, candle) {
  if (!order || !candle) return { filledQty: 0, avgPrice: 0, hiveValue: 0, fee: 0, partial: false, impactPct: 0 };
  const side = String(order.side || '').toLowerCase();
  const want = Math.max(0, +order.quantity || 0);
  if (!(want > 0)) return { filledQty: 0, avgPrice: 0, hiveValue: 0, fee: 0, partial: false, impactPct: 0 };

  const depth = (side === 'buy')
    ? (candle.askDepth != null ? +candle.askDepth : (+candle.volume || 0))
    : (candle.bidDepth != null ? +candle.bidDepth : (+candle.volume || 0));
  // No depth at all → cannot fill (don't pretend a phantom counterparty exists on a thin book).
  if (!(depth > 0)) return { filledQty: 0, avgPrice: 0, hiveValue: 0, fee: 0, partial: false, impactPct: 0 };

  const filledQty = Math.min(want, depth);
  const partial = filledQty < want - 1e-12;

  // base reference price: the touch you're crossing, clamped into the candle range.
  const ref = +order.price > 0 ? +order.price : candle.close;
  const fraction = filledQty / depth;          // 0..1 of visible depth consumed
  const impactPct = round(IMPACT_MAX * fraction);

  let avgPrice;
  if (side === 'buy') {
    avgPrice = ref * (1 + impactPct);           // pay MORE as you eat the ask
    avgPrice = Math.max(avgPrice, candle.low);  // never better than the low
    avgPrice = Math.max(avgPrice, ref);         // never better than your intended price
  } else {
    avgPrice = ref * (1 - impactPct);           // receive LESS as you eat the bid
    avgPrice = Math.min(avgPrice, candle.high); // never better than the high
    avgPrice = Math.min(avgPrice, ref);         // never better than your intended price
  }
  avgPrice = round(avgPrice);
  const hiveValue = round(filledQty * avgPrice);
  const fee = round(hiveValue * FEE_RATE);
  return { filledQty: round(filledQty), avgPrice, hiveValue, fee, partial, impactPct };
}

// ── default strategy: premium-sell / discount-buy + the SWAP.LTC bleed guard ────────────────────
// A decide-like fn: given the candle history UP TO AND INCLUDING the current index (no look-ahead)
// and a position view, returns { action:'BUY'|'SELL'|'HOLD', sym, quantity, price, reason }.
// Mirrors execute.mjs's shape: BUY the dip, SELL the rip, and refuse to keep buying with no sell leg.
export function defaultStrategy({ token = 'TOKEN', lookback = 5, band = 0.02, tradeQty = 100 } = {}) {
  return function strategy({ candles, i, position }) {
    if (i < lookback) return { action: 'HOLD', sym: token, reason: 'warming up' };
    const window = candles.slice(i - lookback, i); // STRICTLY past — no look-ahead onto candle i.
    const avg = window.reduce((s, c) => s + c.close, 0) / window.length;
    const here = candles[i];
    const price = here.close;
    if (!(avg > 0)) return { action: 'HOLD', sym: token, reason: 'no reference' };

    if (price <= avg * (1 - band)) {
      // discount: BUY — but honor the bleed guard. If we're already long beyond a ceiling and the
      // trend is down, refuse to add (this is the SWAP.LTC lesson: don't keep buying one-way).
      const downtrend = here.close < window[0].close;
      if (position && position.qty >= tradeQty * 3 && downtrend) {
        return { action: 'HOLD', sym: token, reason: 'bleed-guard: already long + downtrend, no add' };
      }
      return { action: 'BUY', sym: token, quantity: tradeQty, price: round(price), reason: `discount ${((1 - price / avg) * 100).toFixed(1)}%` };
    }
    if (price >= avg * (1 + band) && position && position.qty > 0) {
      const qty = Math.min(position.qty, tradeQty);
      return { action: 'SELL', sym: token, quantity: round(qty), price: round(price), reason: `premium ${((price / avg - 1) * 100).toFixed(1)}%` };
    }
    return { action: 'HOLD', sym: token, reason: 'in band' };
  };
}

// ── bleed detection: SWAP.LTC-style one-way accumulation ────────────────────────────────────────
// Reports windows where buys massively dominate sells while price falls — money quietly draining
// into a token that never gets sold. This is the proof-of-value signal.
function detectBleed(trades) {
  const events = [];
  const byMarket = {};
  for (const t of trades) (byMarket[t.market] ||= []).push(t);
  for (const [market, rows] of Object.entries(byMarket)) {
    let buyHive = 0, sellHive = 0, buys = 0, sells = 0;
    let firstPrice = null, lastPrice = null, firstTs = null, lastTs = null;
    for (const r of rows) {
      if (firstPrice == null) { firstPrice = r.price; firstTs = r.ts; }
      lastPrice = r.price; lastTs = r.ts;
      if (r.side === 'buy') { buyHive += r.qty * r.price; buys++; }
      else { sellHive += r.qty * r.price; sells++; }
    }
    const oneWay = buys >= 3 && sellHive < buyHive * 0.2;  // buys dominate; almost nothing sold
    const priceFell = firstPrice != null && lastPrice != null && lastPrice < firstPrice;
    if (oneWay && priceFell) {
      events.push({
        market,
        buys, sells,
        hiveSpent: round(buyHive),
        hiveRecovered: round(sellHive),
        hiveAtRisk: round(buyHive - sellHive),
        priceDrop: round(firstPrice - lastPrice),
        priceDropPct: firstPrice ? round((firstPrice - lastPrice) / firstPrice * 100) : 0,
        from: firstTs, to: lastTs,
        why: 'one-way accumulation (buys dominate, price falling) — SWAP.LTC-style bleed',
      });
    }
  }
  return events;
}

/**
 * wouldHaveCaught — THE proof-of-value function. Run the bleed detector directly over raw history
 * (independent of any strategy) and report the SWAP.LTC-style one-way bleed windows it would have
 * surfaced. `history` may be { [token]: candles[] } or a flat candle array (then `token` names it).
 */
export function wouldHaveCaught(history, token = 'TOKEN') {
  const byToken = Array.isArray(history) ? { [token]: history } : (history || {});
  const trades = [];
  for (const [sym, candles] of Object.entries(byToken)) {
    // Treat each candle as a market "fill" at its close, sized by volume — the raw flow of the book.
    for (const c of (candles || [])) {
      const qty = +c.volume || 0;
      if (!(qty > 0)) continue;
      // direction heuristic: up-candle = net buying pressure, down-candle = net selling.
      const side = c.close >= c.open ? 'buy' : 'sell';
      trades.push({ market: sym, side, qty, price: +c.close, ts: c.t });
    }
  }
  return detectBleed(trades);
}

/**
 * backtest — the replay loop. Each candle (in time order) → strategy(decide) → simulateFill →
 * ledger (profit-tracker FIFO) + equity mark-to-market. No look-ahead; fees always charged.
 *
 * args:
 *   history:  { [token]: candles[] }  OR  a flat candle array (uses opts.token / 'TOKEN')
 *   strategy: decide-like fn (defaults to defaultStrategy). Receives { candles, i, position, token }.
 *   startingBalance: starting SWAP.HIVE float (default 1000).
 *
 * Returns { trades, equity:[{t,value}], finalBalance, realizedPnl, maxDrawdown, winRate,
 *           biggestLoser, bleedEvents }.
 */
export function backtest({ history, strategy, startingBalance = 1000, token = 'TOKEN' } = {}) {
  const byToken = Array.isArray(history) ? { [token]: history } : (history || {});
  const strat = strategy || defaultStrategy({ token: Object.keys(byToken)[0] || token });

  // Isolated FIFO ledger via profit-tracker (REUSED, not re-implemented). We reset its default store,
  // record every simulated fill, then read realized P&L back out.
  ptReset();

  let cash = +startingBalance || 0;                 // liquid SWAP.HIVE
  const positions = {};                             // token -> { qty, costHive } running inventory
  const trades = [];
  const equity = [];

  // Merge all tokens' candles into one time-ordered stream so equity is a single curve.
  const stream = [];
  for (const [sym, candles] of Object.entries(byToken)) {
    (candles || []).forEach((c, idx) => stream.push({ sym, c, idx, candles }));
  }
  stream.sort((a, b) => (a.c.t || 0) - (b.c.t || 0));

  for (const step of stream) {
    const { sym, c, idx, candles } = step;
    const pos = (positions[sym] ||= { qty: 0, costHive: 0 });
    const decision = strat({ candles, i: idx, position: pos, token: sym, candle: c }) || { action: 'HOLD' };
    const action = String(decision.action || 'HOLD').toUpperCase();

    if (action === 'BUY' || action === 'SELL') {
      const order = {
        side: action.toLowerCase(),
        symbol: decision.sym || sym,
        quantity: +decision.quantity || 0,
        price: +decision.price || c.close,
      };
      // SELL can't exceed what we hold.
      if (action === 'SELL') order.quantity = Math.min(order.quantity, pos.qty);
      if (order.quantity > 0) {
        const fill = simulateFill(order, c);
        if (fill.filledQty > 0) {
          if (action === 'BUY') {
            // need cash for value + fee
            const total = fill.hiveValue + fill.fee;
            if (total <= cash + 1e-9) {
              cash = round(cash - total);
              pos.qty = round(pos.qty + fill.filledQty);
              pos.costHive = round(pos.costHive + fill.hiveValue);
            } else {
              continue; // can't afford — skip (deterministic)
            }
          } else { // SELL
            cash = round(cash + fill.hiveValue - fill.fee);
            // reduce inventory proportionally for the running cost-basis view (P&L is FIFO in ptPnl)
            const sellFrac = pos.qty > 0 ? fill.filledQty / pos.qty : 0;
            pos.costHive = round(pos.costHive * (1 - sellFrac));
            pos.qty = round(pos.qty - fill.filledQty);
          }
          const rec = {
            ts: c.t, account: 'backtest', market: order.symbol, side: order.side,
            qty: fill.filledQty, price: fill.avgPrice, feeHive: fill.fee, txId: null,
          };
          ptRecord(rec);
          trades.push({ ...rec, partial: fill.partial, impactPct: fill.impactPct, reason: decision.reason });
        }
      }
    }

    // mark-to-market equity at this candle close: cash + value of all open inventory.
    let invValue = 0;
    for (const [s, p] of Object.entries(positions)) {
      const mark = s === sym ? c.close : p.qty > 0 ? (p.costHive / p.qty) : 0;
      invValue += p.qty * mark;
    }
    equity.push({ t: c.t, value: round(cash + invValue) });
  }

  // ── scoring via profit-tracker FIFO (REUSED) ───────────────────────────────────────────────
  const p = ptPnl({ account: 'backtest' });
  const realizedPnl = round(p.total.realized);

  // win rate + biggest loser: per-market realized P&L (each market = one round-trip bucket here).
  let wins = 0, counted = 0, biggestLoser = null;
  for (const [market, m] of Object.entries(p.markets)) {
    if (m.matchedQty <= 0) continue; // only markets that actually round-tripped
    counted++;
    if (m.realized > 0) wins++;
    if (!biggestLoser || m.realized < biggestLoser.realized) biggestLoser = { market, realized: round(m.realized) };
  }
  const winRate = counted ? round(wins / counted) : 0;
  if (biggestLoser && biggestLoser.realized >= 0) biggestLoser = null; // no loser if nothing lost

  // max drawdown: largest peak-to-trough drop on the equity curve (as a fraction of the peak).
  let peak = -Infinity, maxDrawdown = 0;
  for (const e of equity) {
    if (e.value > peak) peak = e.value;
    if (peak > 0) {
      const dd = (peak - e.value) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }
  }
  maxDrawdown = round(maxDrawdown);

  const finalBalance = equity.length ? equity[equity.length - 1].value : round(startingBalance);
  const bleedEvents = wouldHaveCaught(byToken);

  return { trades, equity, finalBalance, realizedPnl, maxDrawdown, winRate, biggestLoser, bleedEvents };
}

/**
 * report — plain-English summary of a backtest result. No jargon; the operator reads this.
 */
export function report(result) {
  if (!result) return '(no backtest result)';
  const lines = [];
  const start = result.equity?.[0]?.value;
  const end = result.finalBalance;
  const days = result.equity?.length ? estimateDays(result.equity) : 0;
  const startStr = start != null ? `${round(start)} HIVE` : '(unknown start)';
  lines.push(
    `This strategy would have turned ${startStr} into ${round(end)} HIVE` +
    (days ? ` over ~${days} day${days === 1 ? '' : 's'}` : '') + '.'
  );
  lines.push(`  Realized profit/loss (closed trades, fees included): ${result.realizedPnl >= 0 ? '+' : ''}${round(result.realizedPnl)} HIVE.`);
  lines.push(`  Worst stretch (max drawdown): −${round(result.maxDrawdown * 100)}% from a peak.`);
  const wr = Math.round((result.winRate || 0) * 100);
  lines.push(`  Win rate across round-tripped markets: ${wr}%.`);
  if (result.biggestLoser) {
    lines.push(`  Biggest loser: ${result.biggestLoser.market} (${round(result.biggestLoser.realized)} HIVE).`);
  }
  if (result.bleedEvents && result.bleedEvents.length) {
    for (const b of result.bleedEvents) {
      const when = b.from ? ` around ${fmtTs(b.from)}` : '';
      lines.push(
        `  ⚠️ ${result.bleedEvents.length} bleed pattern${result.bleedEvents.length === 1 ? '' : 's'} detected in ${b.market}${when}: ` +
        `${b.hiveSpent} HIVE bought vs only ${b.hiveRecovered} sold (≈${b.hiveAtRisk} HIVE at risk) while price fell ${b.priceDropPct}%. ` +
        `This is the SWAP.LTC-style one-way bleed — it would have been visible here BEFORE it cost real HIVE.`
      );
    }
  } else {
    lines.push('  No SWAP.LTC-style one-way bleed detected over this history.');
  }
  return lines.join('\n');
}

function estimateDays(equity) {
  const a = equity[0]?.t, b = equity[equity.length - 1]?.t;
  if (typeof a !== 'number' || typeof b !== 'number' || b <= a) return 0;
  return Math.max(1, Math.round((b - a) / 86_400_000));
}
function fmtTs(t) {
  if (typeof t !== 'number') return String(t);
  try { return new Date(t).toISOString().slice(0, 10); } catch { return String(t); }
}

// ── CLI (guarded; offline synthetic demo) ───────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('backtest.mjs')) {
  const DAY = 86_400_000;
  const t0 = Date.UTC(2026, 0, 1);
  // A clean low/high square-wave the discount-buy / premium-sell strategy can profit on.
  const cycle = [1, 1, 1, 1, 2, 2, 2, 2];
  const wave = [];
  for (let k = 0; k < 5; k++) for (let j = 0; j < cycle.length; j++) {
    const price = cycle[j], i = k * cycle.length + j;
    wave.push({ t: t0 + i * DAY, open: price, high: price * 1.001, low: price * 0.999, close: price, volume: 10000 });
  }
  // A SWAP.LTC-style bleed series: relentless one-way BUYING (close above open each bar) into a
  // falling overall price.
  const bleed = [];
  for (let i = 0; i < 20; i++) {
    const price = 60 - i * 2.5; // falling
    bleed.push({ t: t0 + i * DAY, open: price - 0.5, high: price + 0.2, low: price - 0.7, close: price, volume: 300 });
  }
  console.log('Backtester demo — READ-ONLY, keyless, offline synthetic data.\n');
  console.log('— Low/high token (strategy should make money) —');
  const r1 = backtest({ history: { 'SWAP.OSC': wave }, startingBalance: 1000 });
  console.log(report(r1));
  console.log('\n— SWAP.LTC-style bleed series (should be FLAGGED) —');
  const caught = wouldHaveCaught({ 'SWAP.LTC': bleed });
  console.log(`wouldHaveCaught: ${caught.length} bleed window(s) detected.`);
  const r2 = backtest({ history: { 'SWAP.LTC': bleed }, startingBalance: 1000 });
  console.log(report(r2));
}
