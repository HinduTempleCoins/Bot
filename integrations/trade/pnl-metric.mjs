// integrations/trade/pnl-metric.mjs — DRAFT (NOT WIRED IN). The "is the bot PROFITABLE?" METRIC.
// Pure math, no network, no keys, no execution. Turns a list of trades into a defensible profitability
// scorecard the operator flagged was missing (SURVEY_TRADEBOTS: "+113 HIVE realized" was mostly naked
// dumping, not repeatable profit).
//
// ┌─ HARD SAFETY INVARIANT ─────────────────────────────────────────────────────────────────────┐
// │ READ-ONLY / ADVISORY DRAFT. Measures. It never trades, broadcasts, or holds a key.             │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// THE DEFINITION OF "PROFITABLE" (see .local/TRADE_BOT_PROFITABILITY.md §2). A run is profitable when,
// over a window, its ROUND-TRIP net-of-fees P&L is positive AND beats the benchmark of just holding.
// The scorecard reports, so no single number can hide a problem:
//   • netPnl            — Σ round-trip P&L, AFTER fees. Naked sells (a sell with no prior buy to close)
//                         are counted SEPARATELY as `dumpPnl` and EXCLUDED from netPnl — dumping a bag
//                         is inventory liquidation, not trading profit. (feedback-selling-is-not-
//                         profit-buy-first)
//   • roundTrips        — count of buy→sell closes actually measured
//   • hitRate           — fraction of round-trips that were net-positive
//   • avgWin / avgLoss  — mean win, mean loss (magnitude)
//   • winLossRatio      — avgWin / avgLoss (the "R" — payoff asymmetry)
//   • expectancy        — hitRate·avgWin − (1−hitRate)·avgLoss  (expected P&L per round-trip)
//   • profitFactor      — grossWins / grossLosses (>1 = profitable, >1.5 = healthy)
//   • sharpe            — mean(return) / stdev(return) of per-trade returns (unitless, Sharpe-ish;
//                         NOT annualized — a within-window risk-adjusted quality number)
//   • maxDrawdown       — worst peak-to-trough on the cumulative net-P&L curve
//   • vsBenchmark       — netPnl minus the benchmark P&L (e.g. buy-and-hold the same capital); the
//                         bot only "wins" if this is positive. `profitable` requires BOTH netPnl>0 AND
//                         excessReturn>0.
//
// A trade row: { symbol?, side: 'buy'|'sell', qty, price, fee?, ts?, closesBuy?: bool }. A round-trip
// is a buy matched to a later sell of the same symbol (FIFO). Rows can also be pre-paired as
// { symbol?, entry, exit, qty, feeIn?, feeOut? } via `roundTripPnl`.
//
//   import { scorecard, roundTripPnl } from './integrations/trade/pnl-metric.mjs'

const num = (x) => (Number.isFinite(+x) ? +x : NaN);
const round = (x, n = 6) => (Number.isFinite(x) ? Number(x.toFixed(n)) : null);
const sum = (a) => a.reduce((s, x) => s + x, 0);
const mean = (a) => (a.length ? sum(a) / a.length : 0);
function stdev(a) {
  if (a.length < 2) return 0;
  const m = mean(a);
  return Math.sqrt(sum(a.map((x) => (x - m) ** 2)) / (a.length - 1));
}

/** Net P&L of one explicit round-trip. { entry, exit, qty, feeIn=0, feeOut=0 }. null on junk. */
export function roundTripPnl(rt) {
  if (!rt || typeof rt !== 'object') return null;
  const { entry, exit, qty, feeIn = 0, feeOut = 0 } = rt;
  const e = num(entry), x = num(exit), q = num(qty);
  if (!(e > 0 && x > 0 && q > 0)) return null;
  const fi = Number.isFinite(+feeIn) ? +feeIn : 0;
  const fo = Number.isFinite(+feeOut) ? +feeOut : 0;
  const gross = (x - e) * q;
  const net = gross - fi - fo;
  return { gross: round(gross), net: round(net), retFrac: round((x - e) / e), qty: q };
}

// FIFO-match a flat buy/sell log into closed round-trips + leftover naked sells (dumps) & open buys.
function matchFifo(trades) {
  const bySym = new Map();
  for (const t of trades) {
    const sym = String(t?.symbol ?? '_');
    if (!bySym.has(sym)) bySym.set(sym, []);
    bySym.get(sym).push(t);
  }
  const roundTrips = [];
  const dumps = [];        // sells with no prior buy to close (inventory liquidation)
  let openBuyCost = 0;     // remaining unclosed buy cost (informational)
  for (const [, rows] of bySym) {
    rows.sort((a, b) => (num(a.ts) || 0) - (num(b.ts) || 0));
    const lots = [];       // open buy lots: { qty, price, feePerUnit }
    for (const r of rows) {
      const side = String(r?.side ?? '').toLowerCase();
      const qty = num(r?.qty), price = num(r?.price);
      const fee = Number.isFinite(+r?.fee) ? +r.fee : 0;
      if (!(qty > 0 && price > 0)) continue;
      if (side === 'buy') {
        lots.push({ qty, price, feePerUnit: fee / qty });
      } else if (side === 'sell') {
        let remaining = qty;
        const feePerUnit = fee / qty;
        while (remaining > 1e-12 && lots.length) {
          const lot = lots[0];
          const take = Math.min(remaining, lot.qty);
          const rt = roundTripPnl({
            entry: lot.price, exit: price, qty: take,
            feeIn: lot.feePerUnit * take, feeOut: feePerUnit * take,
          });
          if (rt) roundTrips.push(rt);
          lot.qty -= take;
          remaining -= take;
          if (lot.qty <= 1e-12) lots.shift();
        }
        if (remaining > 1e-12) {
          // no buy to close against → a naked sell / dump. Recorded, NOT counted as trading profit.
          dumps.push({ qty: remaining, price, proceeds: round(remaining * price - feePerUnit * remaining) });
        }
      }
    }
    openBuyCost += sum(lots.map((l) => l.qty * l.price));
  }
  return { roundTrips, dumps, openBuyCost: round(openBuyCost) };
}

/**
 * Full profitability scorecard. `trades` = flat buy/sell log (FIFO-matched) OR pre-paired round-trips
 * (rows with entry/exit). `benchmarkPnl` = the P&L of the do-nothing alternative over the same window
 * (default 0 = flat cash). Always returns an object (soft-fail; junk rows are skipped).
 */
export function scorecard(trades = [], { benchmarkPnl = 0 } = {}) {
  const rows = Array.isArray(trades) ? trades : [];
  // pre-paired round-trips vs a flat buy/sell log
  const paired = rows.filter((r) => r && (r.entry != null || r.exit != null));
  let roundTrips, dumps = [], openBuyCost = 0;
  if (paired.length) {
    roundTrips = paired.map(roundTripPnl).filter(Boolean);
  } else {
    const m = matchFifo(rows);
    roundTrips = m.roundTrips; dumps = m.dumps; openBuyCost = m.openBuyCost;
  }

  const nets = roundTrips.map((r) => r.net);
  const rets = roundTrips.map((r) => r.retFrac).filter((x) => Number.isFinite(x));
  const wins = nets.filter((x) => x > 0);
  const losses = nets.filter((x) => x < 0);
  const grossWins = sum(wins);
  const grossLosses = Math.abs(sum(losses));
  const avgWin = wins.length ? mean(wins) : 0;
  const avgLoss = losses.length ? Math.abs(mean(losses)) : 0;
  const hitRate = roundTrips.length ? wins.length / roundTrips.length : 0;
  const netPnl = sum(nets);
  const dumpPnl = sum(dumps.map((d) => d.proceeds || 0));

  // cumulative-P&L drawdown over the round-trip sequence
  let peak = 0, cum = 0, maxDd = 0;
  for (const n of nets) { cum += n; if (cum > peak) peak = cum; const dd = peak - cum; if (dd > maxDd) maxDd = dd; }

  const sd = stdev(rets);
  const excess = netPnl - (num(benchmarkPnl) || 0);

  return {
    disclaimer: 'DRAFT metric — measures a trade log; no execution. Naked sells excluded from netPnl.',
    roundTrips: roundTrips.length,
    netPnl: round(netPnl),
    dumpPnl: round(dumpPnl),            // liquidation proceeds — NOT counted as trading profit
    openBuyCost,                        // capital still tied up in unclosed buys
    hitRate: round(hitRate),
    avgWin: round(avgWin),
    avgLoss: round(avgLoss),
    winLossRatio: avgLoss > 0 ? round(avgWin / avgLoss) : null,
    expectancy: round(hitRate * avgWin - (1 - hitRate) * avgLoss),
    profitFactor: grossLosses > 0 ? round(grossWins / grossLosses) : (grossWins > 0 ? Infinity : 0),
    sharpe: sd > 0 ? round(mean(rets) / sd) : null,
    maxDrawdown: round(maxDd),
    vsBenchmark: round(excess),
    // the headline: profitable ONLY if round-trips net positive AND beat the do-nothing benchmark.
    profitable: netPnl > 0 && excess > 0,
  };
}

if (process.argv[1] && process.argv[1].endsWith('pnl-metric.mjs')) {
  const log = [
    { symbol: 'X', side: 'buy', qty: 100, price: 1.00, fee: 0.25, ts: 1 },
    { symbol: 'X', side: 'sell', qty: 100, price: 1.10, fee: 0.28, ts: 2 },   // +9.47 net round-trip
    { symbol: 'Y', side: 'buy', qty: 50, price: 2.00, fee: 0.10, ts: 1 },
    { symbol: 'Y', side: 'sell', qty: 50, price: 1.90, fee: 0.09, ts: 2 },    // −5.19 net round-trip
    { symbol: 'Z', side: 'sell', qty: 1000, price: 0.05, ts: 3 },             // NAKED DUMP (no buy)
  ];
  console.log('pnl-metric DRAFT — scorecard:');
  console.log(JSON.stringify(scorecard(log, { benchmarkPnl: 1 }), null, 2));
}
