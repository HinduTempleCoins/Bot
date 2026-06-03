// profit-tracker.mjs — append-only ledger of trade-bot executions with running P&L (queue #46).
//
// PURE + pluggable: every fill is recorded into a store (default in-memory), and realized P&L is
// computed by FIFO lot matching (sells consume the oldest buys first). This is the structured feed
// the analyzer + briefs read to answer "is the bot making or losing HIVE, and where?"
//
//   • record({ts, account, market, side, qty, price, feeHive, txId}) — append one execution
//   • pnl({account?, market?})  — realized P&L (proceeds − cost − fees), per market + total, FIFO
//   • summary()                 — trades count, volume, net P&L, best/worst market
//   • save(path) / load(path)   — JSON round-trip via node:fs (optional persistence)
//
// Design rules:
//   • Append-only. record() never mutates prior entries; the store is the source of truth.
//   • Pure math. pnl()/summary() derive everything from the ledger — no I/O, no network.
//   • Read-only / advisory. This logs and computes; it executes nothing (zero-WIF rule).
//
//   node integrations/profit-tracker.mjs                 # demo: record a few fills + print P&L
//   node integrations/profit-tracker.mjs <ledger.json>   # load a saved ledger + print summary

// In-memory append-only store. Swap-in any object with the same shape for a different backend.
function makeMemoryStore() {
  const rows = [];
  return {
    append(entry) { rows.push(entry); return entry; },
    all() { return rows.slice(); },
    replaceAll(entries) { rows.length = 0; rows.push(...entries); },
  };
}

// Module-level default store so the simple `record()/pnl()` API works without wiring.
let store = makeMemoryStore();

// Allow callers (and tests) to inject/reset the store.
export function useStore(s) { store = s; return store; }
export function reset() { store = makeMemoryStore(); return store; }
export function entries() { return store.all(); }

// Normalize a fill into a canonical, validated ledger row. Throws on missing essentials.
function normalize(e) {
  const { ts, account, market, side, qty, price } = e;
  if (!account) throw new Error('record: account is required');
  if (!market) throw new Error('record: market is required');
  const s = String(side || '').toLowerCase();
  if (s !== 'buy' && s !== 'sell') throw new Error(`record: side must be buy|sell, got ${side}`);
  const q = Number(qty), p = Number(price);
  if (!(q > 0)) throw new Error(`record: qty must be > 0, got ${qty}`);
  if (!(p >= 0)) throw new Error(`record: price must be >= 0, got ${price}`);
  return {
    ts: ts ?? Date.now(),
    account: String(account),
    market: String(market),
    side: s,
    qty: q,
    price: p,
    feeHive: Number(e.feeHive ?? 0) || 0,
    txId: e.txId ?? null,
  };
}

// Append one execution to the ledger. Returns the normalized row.
export function record(e) {
  return store.append(normalize(e));
}

// Filter + chronologically order the ledger for deterministic FIFO matching.
function filtered({ account, market } = {}) {
  return store.all()
    .filter(r => (!account || r.account === account) && (!market || r.market === market))
    .slice()
    .sort((a, b) => (a.ts - b.ts));
}

// FIFO realized P&L for a single market's chronological fills.
// proceeds (sell qty*price) − cost (matched buy qty*price) − all fees on matched activity.
function pnlForMarket(rows) {
  const lots = [];            // open buy lots: { qty, price } FIFO queue
  let realized = 0;           // proceeds − matched cost (excludes fees)
  let fees = 0;               // every fee touches the ledger, so all count against P&L
  let buyVol = 0, sellVol = 0, matchedQty = 0;

  for (const r of rows) {
    fees += r.feeHive;
    if (r.side === 'buy') {
      lots.push({ qty: r.qty, price: r.price });
      buyVol += r.qty * r.price;
    } else {
      sellVol += r.qty * r.price;
      let remaining = r.qty;
      while (remaining > 1e-12 && lots.length) {
        const lot = lots[0];
        const take = Math.min(remaining, lot.qty);
        realized += take * (r.price - lot.price); // per-unit gain on the matched lot
        matchedQty += take;
        lot.qty -= take;
        remaining -= take;
        if (lot.qty <= 1e-12) lots.shift();
      }
      // remaining is a sell with no matching buy lot (short / pre-history) — proceeds still count
      if (remaining > 1e-12) realized += remaining * r.price;
    }
  }
  const openQty = lots.reduce((s, l) => s + l.qty, 0);
  const openCost = lots.reduce((s, l) => s + l.qty * l.price, 0);
  return {
    realized: realized - fees,   // net realized P&L
    gross: realized,             // before fees
    fees,
    buyVolume: buyVol,
    sellVolume: sellVol,
    volume: buyVol + sellVol,
    matchedQty,
    openQty,                     // unsold inventory (qty)
    openCost,                    // cost basis of unsold inventory (HIVE)
  };
}

// Realized P&L per market + total. Optionally scoped to an account and/or single market.
export function pnl(scope = {}) {
  const rows = filtered(scope);
  const markets = {};
  for (const r of rows) (markets[r.market] ||= []).push(r);

  const perMarket = {};
  const total = { realized: 0, gross: 0, fees: 0, buyVolume: 0, sellVolume: 0, volume: 0, matchedQty: 0, openQty: 0, openCost: 0 };
  for (const [m, mr] of Object.entries(markets)) {
    const p = pnlForMarket(mr);
    perMarket[m] = p;
    for (const k of Object.keys(total)) total[k] += p[k];
  }
  return { scope, markets: perMarket, total, trades: rows.length };
}

// Aggregate overview: trade count, HIVE volume, net realized P&L, best/worst market by realized.
export function summary(scope = {}) {
  const p = pnl(scope);
  let best = null, worst = null;
  for (const [market, m] of Object.entries(p.markets)) {
    if (!best || m.realized > best.realized) best = { market, realized: m.realized };
    if (!worst || m.realized < worst.realized) worst = { market, realized: m.realized };
  }
  return {
    trades: p.trades,
    markets: Object.keys(p.markets).length,
    volume: p.total.volume,
    fees: p.total.fees,
    netPnl: p.total.realized,
    best,
    worst,
  };
}

// --- performance metrics (pure, additive) ---------------------------------
//
// Standard OSS-benchmark scorers over a series of per-trade results and/or an equity curve.
// Shared verbatim by live tracking and the backtester so both score performance identically.
//
// Conventions:
//   • `trades`  = array of numeric per-trade P&L results (positive = win, negative = loss),
//                 or array of objects with a `.pnl` / `.realized` field (auto-extracted).
//   • `returns` = array of numeric PERIOD returns (e.g. 0.01 = +1%). Annualization is the
//                 CALLER's choice — these return per-period (un-annualized) ratios. No hidden
//                 sqrt(252)/sqrt(12) factor is applied.
//   • `equity`  = array of { t, value } equity-curve points (assumed time-ordered).
//
// All functions are deterministic, division-by-zero safe, and NaN-free on empty input
// (they return null or 0 with explicit `ok` flags rather than producing NaN/Infinity-by-0).

// Coerce a trades entry into a finite number (supports raw numbers or {pnl|realized} objects).
function tradePnl(t) {
  if (typeof t === 'number') return Number.isFinite(t) ? t : 0;
  if (t && typeof t === 'object') {
    const v = t.pnl ?? t.realized ?? t.value ?? 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  const n = Number(t);
  return Number.isFinite(n) ? n : 0;
}

function toNumbers(trades) {
  return (Array.isArray(trades) ? trades : []).map(tradePnl);
}

function mean(xs) {
  if (!xs.length) return 0;
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}

// Sample standard deviation (n-1). Returns 0 for fewer than 2 points (no spread to measure).
function stddev(xs, mu = mean(xs)) {
  if (xs.length < 2) return 0;
  const variance = xs.reduce((s, x) => s + (x - mu) ** 2, 0) / (xs.length - 1);
  return Math.sqrt(variance);
}

// Maximum drawdown from an equity curve [{t, value}].
// Returns { ok, pct, peak, trough, peakAt, troughAt }. pct is a positive fraction (0.4 = -40%).
export function maxDrawdown(equity) {
  const pts = (Array.isArray(equity) ? equity : []).filter(p => p && Number.isFinite(Number(p.value)));
  if (!pts.length) return { ok: false, pct: 0, peak: null, trough: null, peakAt: null, troughAt: null };

  let peak = Number(pts[0].value);
  let peakAt = pts[0].t ?? 0;
  let maxPct = 0;
  let mdPeak = peak, mdPeakAt = peakAt, mdTrough = peak, mdTroughAt = peakAt;

  for (const p of pts) {
    const v = Number(p.value);
    if (v > peak) { peak = v; peakAt = p.t ?? null; }
    // drawdown only meaningful when peak is positive (fraction of a positive high-water mark)
    const dd = peak > 0 ? (peak - v) / peak : 0;
    if (dd > maxPct) {
      maxPct = dd;
      mdPeak = peak; mdPeakAt = peakAt;
      mdTrough = v; mdTroughAt = p.t ?? null;
    }
  }
  return { ok: true, pct: maxPct, peak: mdPeak, trough: mdTrough, peakAt: mdPeakAt, troughAt: mdTroughAt };
}

// Sharpe ratio over a series of PERIOD returns: (mean(excess)) / stddev(excess).
// Un-annualized — caller multiplies by sqrt(periodsPerYear) if they want an annual figure.
export function sharpe(returns, { riskFreeRate = 0 } = {}) {
  const rs = (Array.isArray(returns) ? returns : []).map(Number).filter(Number.isFinite);
  if (rs.length < 2) return { ok: false, value: 0, mean: 0, stddev: 0, n: rs.length };
  const excess = rs.map(r => r - riskFreeRate);
  const mu = mean(excess);
  const sd = stddev(excess, mu);
  if (sd === 0) return { ok: false, value: 0, mean: mu, stddev: 0, n: rs.length };
  return { ok: true, value: mu / sd, mean: mu, stddev: sd, n: rs.length };
}

// Sortino ratio: like Sharpe but the denominator is DOWNSIDE deviation only (returns below the
// risk-free target). Upside volatility is ignored, so a series of big wins scores better than a
// symmetric one with the same mean/total spread. Un-annualized.
export function sortino(returns, { riskFreeRate = 0 } = {}) {
  const rs = (Array.isArray(returns) ? returns : []).map(Number).filter(Number.isFinite);
  if (rs.length < 1) return { ok: false, value: 0, mean: 0, downsideDeviation: 0, n: rs.length };
  const excess = rs.map(r => r - riskFreeRate);
  const mu = mean(excess);
  // downside deviation: RMS of negative excess returns (zero for non-negative ones), over N.
  const sumSqDown = excess.reduce((s, e) => s + (e < 0 ? e * e : 0), 0);
  const dd = Math.sqrt(sumSqDown / rs.length);
  if (dd === 0) return { ok: false, value: 0, mean: mu, downsideDeviation: 0, n: rs.length };
  return { ok: true, value: mu / dd, mean: mu, downsideDeviation: dd, n: rs.length };
}

// Profit factor = gross wins / gross losses. Infinity-safe: all-wins → Infinity (ok:true),
// no trades or no wins-and-no-losses → 0 (ok:false).
export function profitFactor(trades) {
  const xs = toNumbers(trades);
  if (!xs.length) return { ok: false, value: 0, grossWins: 0, grossLosses: 0 };
  let grossWins = 0, grossLosses = 0;
  for (const x of xs) {
    if (x > 0) grossWins += x;
    else if (x < 0) grossLosses += -x;
  }
  if (grossLosses === 0) {
    // no losses: Infinity if there were wins, otherwise undefined (all flat) → 0
    return { ok: grossWins > 0, value: grossWins > 0 ? Infinity : 0, grossWins, grossLosses };
  }
  return { ok: true, value: grossWins / grossLosses, grossWins, grossLosses };
}

// Win rate. Flat trades (exactly 0) count as neither win nor loss but are in the denominator.
export function winRate(trades) {
  const xs = toNumbers(trades);
  if (!xs.length) return { ok: false, wins: 0, losses: 0, rate: 0 };
  let wins = 0, losses = 0;
  for (const x of xs) {
    if (x > 0) wins++;
    else if (x < 0) losses++;
  }
  return { ok: true, wins, losses, rate: wins / xs.length };
}

// Expectancy = (avg win × win-rate) − (avg loss × loss-rate). Average expected P&L per trade.
// avgLoss is reported as a positive magnitude; the formula subtracts it.
export function expectancy(trades) {
  const xs = toNumbers(trades);
  if (!xs.length) return { ok: false, value: 0, avgWin: 0, avgLoss: 0, winRate: 0, lossRate: 0 };
  const winsArr = xs.filter(x => x > 0);
  const lossesArr = xs.filter(x => x < 0);
  const avgWin = winsArr.length ? mean(winsArr) : 0;
  const avgLoss = lossesArr.length ? -mean(lossesArr) : 0; // positive magnitude
  const wr = winsArr.length / xs.length;
  const lr = lossesArr.length / xs.length;
  return { ok: true, value: avgWin * wr - avgLoss * lr, avgWin, avgLoss, winRate: wr, lossRate: lr };
}

// Full performance report: every metric above + a plain-English summary line.
export function performanceReport(trades, equity) {
  const xs = toNumbers(trades);
  const pf = profitFactor(trades);
  const wr = winRate(trades);
  const exp = expectancy(trades);
  const dd = maxDrawdown(equity);
  // build returns from equity curve if available (period-over-period fractional change)
  const report = {
    trades: xs.length,
    netPnl: xs.reduce((s, x) => s + x, 0),
    profitFactor: pf,
    winRate: wr,
    expectancy: exp,
    maxDrawdown: dd,
  };

  // plain-English line — front-loads the profit factor in operator-readable terms.
  let english;
  if (!xs.length) {
    english = 'No trades to score yet.';
  } else {
    const pfText = pf.value === Infinity
      ? 'Profit factor ∞ — no losing trades.'
      : pf.ok
        ? `Profit factor ${pf.value.toFixed(2)} — for every 1 lost, ${pf.value.toFixed(2)} won.`
        : 'Profit factor n/a — no completed wins or losses yet.';
    const wrText = `Win rate ${(wr.rate * 100).toFixed(0)}% (${wr.wins}W/${wr.losses}L).`;
    const ddText = dd.ok ? `Max drawdown ${(dd.pct * 100).toFixed(1)}%.` : '';
    const expText = `Expectancy ${exp.value >= 0 ? '+' : ''}${exp.value.toFixed(4)} per trade.`;
    english = [pfText, wrText, expText, ddText].filter(Boolean).join(' ');
  }
  report.english = english;
  return report;
}

// --- optional persistence (node:fs) ---------------------------------------

export async function save(path) {
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path, JSON.stringify({ version: 1, entries: store.all() }, null, 2), 'utf8');
  return path;
}

export async function load(path) {
  const { readFile } = await import('node:fs/promises');
  const raw = await readFile(path, 'utf8');
  const data = JSON.parse(raw);
  const rows = Array.isArray(data) ? data : (data.entries || []);
  store.replaceAll(rows.map(normalize));
  return store.all();
}

// --- CLI ------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('profit-tracker.mjs')) {
  const arg = process.argv[2];
  if (arg && !arg.startsWith('-')) {
    await load(arg);
    console.log(`Loaded ${entries().length} fills from ${arg}\n`);
  } else {
    // demo ledger
    record({ account: 'kalivankush', market: 'SWAP.DOGE', side: 'buy', qty: 1000, price: 0.04, feeHive: 0.1, txId: 'a' });
    record({ account: 'kalivankush', market: 'SWAP.DOGE', side: 'sell', qty: 600, price: 0.05, feeHive: 0.1, txId: 'b' });
    record({ account: 'kalivankush', market: 'SWAP.LTC', side: 'buy', qty: 2, price: 60, feeHive: 0.2, txId: 'c' });
    record({ account: 'kalivankush', market: 'SWAP.LTC', side: 'sell', qty: 2, price: 50, feeHive: 0.2, txId: 'd' });
    console.log('Demo ledger (no real data):\n');
  }
  const p = pnl();
  for (const [m, x] of Object.entries(p.markets)) {
    console.log(`  ${m.padEnd(14)} realized ${x.realized.toFixed(4)} HIVE  (vol ${x.volume.toFixed(2)}, fees ${x.fees.toFixed(2)}, open ${x.openQty})`);
  }
  const s = summary();
  console.log(`\n  ${s.trades} trades / ${s.markets} markets / vol ${s.volume.toFixed(2)} HIVE`);
  console.log(`  NET realized P&L: ${s.netPnl.toFixed(4)} HIVE`);
  if (s.best) console.log(`  best:  ${s.best.market} (${s.best.realized.toFixed(4)})`);
  if (s.worst) console.log(`  worst: ${s.worst.market} (${s.worst.realized.toFixed(4)})`);
}
