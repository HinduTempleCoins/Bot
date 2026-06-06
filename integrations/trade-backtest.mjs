// trade-backtest.mjs — OFFLINE replay harness for the strategy layer (queue #189).
//
// Feeds a sequence of historical/fixture market snapshots through ONE strategy's pure decision
// function, simulating fills against each snapshot's price with explicit fee + slippage
// assumptions, tracking HIVE balance / token inventory / realized + unrealized PnL, and printing
// a verdict table. Pure simulation: NO network, NO keys, NO execution, NO broadcast. The orders the
// strategy returns are already dryRun:true/signer:null; the backtester just pretends they filled so
// the operator/AIs can compare strategies on real(istic) data before anything ever goes live.
//
//   import { backtest } from './integrations/trade-backtest.mjs';
//   const r = backtest('peg-arb', snapshots, { params, fees: 0.0025, slippage: 0.001, startHive: 1000 });
//
// CLI:  node integrations/trade-backtest.mjs --strategy peg-arb --fixtures integrations/fixtures/trade-snapshots.peg-arb.json
//       node integrations/trade-backtest.mjs --strategy peg-arb            # uses the bundled fixture
//       node integrations/trade-backtest.mjs --list                        # list strategies + fixtures

import { readFileSync, existsSync } from 'node:fs';
import { decide, listStrategies, STRATEGIES } from './trade-strategies.mjs';

const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
const round = (n, dp = 4) => +(+n).toFixed(dp);

// Default fixture lookup: integrations/fixtures/trade-snapshots.<strategy>.json, falling back to a
// generic one. Resolved relative to this module so the CLI works from any cwd.
function defaultFixture(strategy) {
  const base = new URL('./fixtures/', import.meta.url);
  const specific = new URL(`trade-snapshots.${strategy}.json`, base);
  const generic = new URL('trade-snapshots.json', base);
  if (existsSync(specific)) return specific;
  if (existsSync(generic)) return generic;
  return specific; // will error informatively if absent
}

export function loadFixture(pathOrUrl) {
  const raw = readFileSync(pathOrUrl, 'utf8');
  const data = JSON.parse(raw);
  // accept either a bare array of snapshots or { snapshots:[...], params, label }
  if (Array.isArray(data)) return { snapshots: data, params: {}, label: '' };
  return { snapshots: data.snapshots || [], params: data.params || {}, label: data.label || '', start: data.start || {} };
}

/**
 * Replay snapshots through a strategy, simulating fills. PURE — operates only on the inputs.
 *
 * Fill model (deliberately conservative, documented assumptions):
 *  - A buy fills at  price × (1 + slippage),  paying an extra `fees` fraction in HIVE.
 *  - A sell fills at price × (1 − slippage),  paying an extra `fees` fraction in HIVE.
 *  - We never spend HIVE we don't have, never sell tokens we don't hold (orders are clamped).
 *  - State carried into the next snapshot's decide(): inventoryToken, inventoryHive (HIVE value of
 *    the token position at last fill price), spentHive (DCA), filledRungs (grid), lastBuyTs.
 *
 * @param {string} strategy
 * @param {Array<object>} snapshots
 * @param {object} [opts]
 * @param {object} [opts.params]    strategy params
 * @param {number} [opts.fees]      taker fee fraction (default 0.0025 = 0.25%)
 * @param {number} [opts.slippage] price slippage fraction (default 0.001 = 0.10%)
 * @param {number} [opts.startHive]  starting HIVE balance (default 1000)
 * @param {number} [opts.startToken] starting token inventory (default 0)
 * @returns {object} verdict: { strategy, fills, buys, sells, hive, token, feesPaid, realizedPnl, unrealizedPnl, totalPnl, returnPct, trail }
 */
export function backtest(strategy, snapshots = [], opts = {}) {
  const params = opts.params || {};
  const fees = num(opts.fees, 0.0025);
  const slippage = num(opts.slippage, 0.001);
  const startHive = num(opts.startHive, 1000);
  const startToken = num(opts.startToken, 0);

  let hive = startHive;
  let token = startToken;
  let costBasisHive = 0;   // HIVE paid for the tokens currently held (for realized PnL on sell)
  let spentHive = 0;       // DCA cumulative
  let feesPaid = 0;
  let realizedPnl = 0;
  const filledRungs = [];
  let lastBuyTs = NaN;
  let lastPrice = 0;
  let buys = 0, sells = 0, fills = 0;
  const trail = [];

  if (!STRATEGIES[strategy]) {
    return { strategy, error: `unknown strategy '${strategy}'`, fills: 0, snapshots: snapshots.length };
  }

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i] || {};
    lastPrice = num(snap.hePrice ?? snap.mid ?? lastPrice, lastPrice);
    const state = {
      inventoryToken: token,
      inventoryHive: round(token * lastPrice, 8),
      spentHive,
      filledRungs: [...filledRungs],
      lastBuyTs,
    };
    const { orders, reason } = decide(strategy, snap, params, state);

    for (const o of orders) {
      const px = num(o.price);
      if (!(px > 0)) continue;
      if (o.side === 'buy') {
        const fillPx = px * (1 + slippage);
        let spend = Math.min(num(o.qtyHive), hive);             // never overspend
        if (spend <= 0) continue;
        const fee = spend * fees;
        const spendNet = spend - fee;                            // HIVE that actually buys tokens
        const got = spendNet / fillPx;
        hive -= spend;
        token += got;
        costBasisHive += spendNet;
        spentHive += spend;
        feesPaid += fee;
        lastBuyTs = num(snap.ts, lastBuyTs);
        buys++; fills++;
        recordRung(filledRungs, reason, 'b');
        trail.push({ i, side: 'buy', price: round(fillPx), token: round(got), hive: round(-spend), reason });
      } else if (o.side === 'sell') {
        const fillPx = px * (1 - slippage);
        const sellToken = Math.min(num(o.qtyToken), token);     // never sell what we don't hold
        if (sellToken <= 0) continue;
        const gross = sellToken * fillPx;
        const fee = gross * fees;
        const net = gross - fee;
        // realized PnL: proceeds minus the proportional cost basis of the tokens sold
        const basisPortion = token > 0 ? costBasisHive * (sellToken / token) : 0;
        realizedPnl += net - basisPortion;
        costBasisHive -= basisPortion;
        hive += net;
        token -= sellToken;
        feesPaid += fee;
        sells++; fills++;
        recordRung(filledRungs, reason, 's');
        trail.push({ i, side: 'sell', price: round(fillPx), token: round(-sellToken), hive: round(net), reason });
      }
    }
  }

  const markPrice = lastPrice;
  const tokenValueHive = round(token * markPrice, 4);
  const unrealizedPnl = round(tokenValueHive - costBasisHive, 4);
  const totalEquity = round(hive + tokenValueHive, 4);
  const totalPnl = round(totalEquity - startHive, 4);
  const returnPct = startHive > 0 ? round((totalPnl / startHive) * 100, 2) : 0;

  return {
    strategy,
    snapshots: snapshots.length,
    fills, buys, sells,
    startHive,
    hive: round(hive, 4),
    token: round(token, 4),
    tokenValueHive,
    feesPaid: round(feesPaid, 4),
    realizedPnl: round(realizedPnl, 4),
    unrealizedPnl,
    totalEquity,
    totalPnl,
    returnPct,
    trail,
  };
}

// Heuristic: pull a rung tag out of a grid reason string so repeated rungs don't re-fill.
function recordRung(filledRungs, reason, sidePrefix) {
  const m = /rung (-?\d+)/.exec(reason || '');
  if (m) {
    const tag = `${sidePrefix}${m[1]}`;
    if (!filledRungs.includes(tag)) filledRungs.push(tag);
  }
}

// Render a one-line verdict for the table.
export function verdictLine(v) {
  if (v.error) return `${v.strategy.padEnd(14)} ERROR: ${v.error}`;
  const sign = v.totalPnl >= 0 ? '+' : '';
  return `${v.strategy.padEnd(14)} ${String(v.fills).padStart(5)} ${String(v.buys).padStart(5)} ${String(v.sells).padStart(6)} ` +
    `${v.hive.toFixed(1).padStart(10)} ${v.tokenValueHive.toFixed(1).padStart(11)} ${v.feesPaid.toFixed(2).padStart(8)} ` +
    `${(sign + v.totalPnl.toFixed(1)).padStart(11)} ${(sign + v.returnPct.toFixed(1) + '%').padStart(9)}`;
}

function parseArgs(argv) {
  const a = { strategy: null, fixtures: null, list: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const k = argv[i];
    if (k === '--strategy') a.strategy = argv[++i];
    else if (k === '--fixtures') a.fixtures = argv[++i];
    else if (k === '--list') a.list = true;
    else if (k === '--all') a.all = true;
  }
  return a;
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('trade-backtest.mjs')) {
  const args = parseArgs(process.argv.slice(2));
  if (args.list || (!args.strategy && !args.all)) {
    console.log('Trade backtester — OFFLINE replay, dry-run, NO keys, NO execution\n');
    console.log('Strategies:');
    for (const s of listStrategies()) console.log(`  ${s.name.padEnd(14)} ${s.label}${s.proven ? '  ★ proven' : ''}`);
    console.log('\nUsage:');
    console.log('  node integrations/trade-backtest.mjs --strategy peg-arb [--fixtures <file.json>]');
    console.log('  node integrations/trade-backtest.mjs --all   # run every strategy on its bundled fixture');
    if (!args.list) process.exit(0);
  }

  const header = 'strategy        fills  buys  sells       HIVE   tokenHIVE     fees     net PnL    return';
  const sep = '─'.repeat(header.length);

  if (args.all) {
    console.log('\nBacktest verdict (each strategy vs its bundled fixture):');
    console.log(sep + '\n' + header + '\n' + sep);
    for (const s of listStrategies()) {
      try {
        const fx = loadFixture(defaultFixture(s.name));
        const v = backtest(s.name, fx.snapshots, { params: fx.params, ...(fx.start || {}) });
        console.log(verdictLine(v));
      } catch (e) {
        console.log(`${s.name.padEnd(14)} (no fixture: ${e.message})`);
      }
    }
    console.log(sep);
  } else if (args.strategy) {
    const fxPath = args.fixtures || defaultFixture(args.strategy);
    let fx;
    try { fx = loadFixture(fxPath); }
    catch (e) { console.error(`Could not load fixtures (${fxPath}): ${e.message}`); process.exit(1); }
    const v = backtest(args.strategy, fx.snapshots, { params: fx.params, ...(fx.start || {}) });
    console.log(`\nBacktest: ${args.strategy}${fx.label ? ` — ${fx.label}` : ''}  (${v.snapshots} snapshots, fees ${num(fx.start?.fees, 0.0025)}, slippage ${num(fx.start?.slippage, 0.001)})`);
    console.log(sep + '\n' + header + '\n' + sep);
    console.log(verdictLine(v));
    console.log(sep);
    console.log(`realized PnL ${v.realizedPnl}  unrealized ${v.unrealizedPnl}  end equity ${v.totalEquity} HIVE (start ${v.startHive})`);
    if (v.trail.length) {
      console.log('\nfills:');
      for (const t of v.trail) console.log(`  #${t.i} ${t.side.toUpperCase().padEnd(4)} @${t.price}  Δtoken ${t.token}  ΔHIVE ${t.hive}  — ${t.reason}`);
    }
    console.log('\nSimulation only. No orders were placed; the strategy emits dryRun:true/signer:null intents.');
  }
}
