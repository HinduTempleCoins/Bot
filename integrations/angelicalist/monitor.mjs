// monitor.mjs — the STANDING BACKGROUND MONITOR for the angelicalist trade bot (operator, 2026-06-04:
// "Monitoring the Trade Bot in the Background and getting like Diagnostics and Analytics and
// Everything on it"). This is the READ-ONLY companion to loop.mjs: it never holds a key, never signs,
// never trades — it only LOOKS. Safe to run on a tight timer regardless of whether live trading is on.
//
// It composes the existing read-only pieces into ONE snapshot + an assessment the briefs / the admin
// trade-analytics HUD (#205) can read:
//
//   • account state   ← internal.snapshot()        (HIVE layer + HE token balances + open orders)
//   • realized P&L     ← tradebot-forensics         (on-chain: HIVE spent vs received per token — the
//                                                     bleed-vs-win view; the SWAP.LTC −6,424 lesson)
//   • ledger P&L       ← profit-tracker.summary()   (the FIFO ledger the loop writes its fills to)
//   • findings         ← trade-analyzer.analyze()   (categorized + ranked diagnostics)
//   • opportunities    ← arb-scanner.scanArb()      (current depth-aware peg-arb edges)
//
// assess() turns that into health SIGNALS: portfolio value, idle float, open-order count, net realized,
// the single worst bleed token + best earner, the top live opportunity, and ANOMALY flags (one-way
// accumulation, stale/dead-book edges) — the things a human or a brief should see at a glance.
//
//   node integrations/angelicalist/monitor.mjs once          # one read-only snapshot + report
//   node integrations/angelicalist/monitor.mjs once --json    # machine-readable
//   import { collect, assess, report } from './angelicalist/monitor.mjs'

import { snapshot as realSnapshot } from './internal.mjs';
import { marketHistory as realHistory, reconstruct } from '../tradebot-forensics.mjs';
import { summary as realLedgerSummary } from '../profit-tracker.mjs';
import { analyze as realAnalyze } from '../trade-analyzer.mjs';
import { scanArb as realScanArb } from '../arb-scanner.mjs';

const ACCOUNT = process.env.ANGELICALIST_ACCOUNT || 'angelicalist';
const round = (n, d = 4) => +(+n || 0).toFixed(d);

// cross-chain context (#450): EVM gas + optional configured wallet balances via chain-data (Helius/Alchemy).
// Read-only, soft-fail, naturally a no-op without the keys — never blocks the HIVE monitor.
let _chain = null;
try { _chain = await import('../chain-data.mjs'); } catch { /* chain-data absent — monitor still runs */ }
async function realChainContext() {
  if (!_chain) return null;
  const cfg = _chain.providersConfigured();
  if (!cfg.alchemy && !cfg.helius) return null;
  const out = { providers: cfg };
  if (cfg.alchemy) {
    const g = await _chain.evmGasPrice('eth').catch(() => null);
    if (g && g.ok) out.ethGasGwei = round(g.gwei, 2);
    const w = process.env.TRADE_EVM_WALLET;
    if (w) { const b = await _chain.evmBalance(w, process.env.TRADE_EVM_CHAIN || 'eth').catch(() => null); if (b && b.ok) out.evm = { wallet: w, chain: b.chain, ether: round(b.ether, 6) }; }
  }
  if (cfg.helius) {
    const w = process.env.TRADE_SOL_WALLET;
    if (w) { const b = await _chain.solBalance(w).catch(() => null); if (b && b.ok) out.sol = { wallet: w, sol: round(b.sol, 6) }; }
  }
  return out;
}

/**
 * collect — pull every read-only data source for the account, concurrently. Each source soft-fails to
 * an empty/neutral value so one dead endpoint never blanks the whole snapshot. All sources are
 * injectable (tests pass fakes; nothing touches the network or a key).
 *
 * deps: { snapshot, history, ledgerSummary, analyze, scanArb, account }
 */
export async function collect(deps = {}) {
  const account = deps.account || ACCOUNT;
  const snapshot = deps.snapshot || realSnapshot;
  const history = deps.history || realHistory;
  const ledgerSummary = deps.ledgerSummary || realLedgerSummary;
  const analyze = deps.analyze || realAnalyze;
  const scanArb = deps.scanArb || realScanArb;
  const chainContext = deps.chainContext || realChainContext;

  const [snap, ops, ledger, analysis, arb, chain] = await Promise.all([
    Promise.resolve().then(() => snapshot(account)).catch((e) => ({ account, error: e.message, tokens: [], openOrders: [] })),
    Promise.resolve().then(() => history(account)).catch(() => []),
    Promise.resolve().then(() => ledgerSummary()).catch(() => null),
    Promise.resolve().then(() => analyze(account)).catch(() => []),
    Promise.resolve().then(() => scanArb()).catch(() => ({ opportunities: [], rows: [] })),
    Promise.resolve().then(() => chainContext()).catch(() => null),
  ]);

  const forensics = reconstruct(Array.isArray(ops) ? ops : []);
  return { at: new Date().toISOString(), account, snapshot: snap, forensics, opsCount: Array.isArray(ops) ? ops.length : 0, ledger, analysis, arb, chain };
}

/**
 * assess — pure. Turn a collect() result into health signals + anomaly flags. No I/O.
 * Returns { portfolio, trading, opportunities, anomalies, health }.
 */
export function assess(c) {
  const tokens = c?.snapshot?.tokens || [];
  const openOrders = c?.snapshot?.openOrders || [];
  const idleHive = (tokens.find((t) => t.symbol === 'SWAP.HIVE')?.balance) || 0;

  // realized HIVE per token from on-chain fills (recv − spent). Negative = bleed.
  const perToken = Object.entries(c?.forensics?.sym || {}).map(([symbol, v]) => ({
    symbol, net: round(v.hiveRecv - v.hiveSpent, 2), buys: v.buys, sells: v.sells,
    hiveSpent: round(v.hiveSpent, 2), hiveRecv: round(v.hiveRecv, 2),
  }));
  const sorted = [...perToken].sort((a, b) => a.net - b.net);
  const worstBleed = sorted[0] && sorted[0].net < 0 ? sorted[0] : null;
  const bestEarner = sorted.length ? sorted[sorted.length - 1] : null;
  const realizedNet = round(perToken.reduce((a, t) => a + t.net, 0), 2);

  // anomaly: one-way accumulation = bought but never (or barely) sold AND it cost HIVE (the SWAP.LTC trap).
  const anomalies = [];
  for (const t of perToken) {
    if (t.buys > 0 && t.sells === 0 && t.hiveSpent > 0) {
      anomalies.push({ kind: 'one-way-accumulation', symbol: t.symbol, detail: `bought ${t.buys}× for ${t.hiveSpent} HIVE, never sold (SWAP.LTC-style bleed risk)` });
    }
  }

  // live opportunities from the arb scan (already depth + dead-book guarded inside the scanner).
  const oppRows = [...(c?.arb?.opportunities || []), ...(c?.arb?.rows || [])].filter((r) => r && r.sym);
  const topOpp = oppRows
    .filter((r) => Math.abs(+r.edge || 0) > 0 && Math.abs(+r.edge || 0) <= 0.30 && (+r.execHive || 0) > 0)
    .sort((a, b) => Math.abs(+b.edge || 0) - Math.abs(+a.edge || 0))[0] || null;

  // a "dead/stale book" edge >30% is itself an anomaly worth surfacing (don't act, but note it).
  const seenDead = new Set();
  for (const r of oppRows) {
    if (Math.abs(+r.edge || 0) > 0.30 && !seenDead.has(r.sym)) {
      seenDead.add(r.sym);
      anomalies.push({ kind: 'dead-book-edge', symbol: r.sym, detail: `phantom ${(Math.abs(+r.edge) * 100).toFixed(0)}% edge — stale/broken book, never act on it` });
    }
  }

  const ledgerNet = c?.ledger?.netPnl ?? null;
  // health: a coarse rollup for the at-a-glance dot.
  let health = 'ok';
  if (c?.snapshot?.error) health = 'degraded';        // couldn't even read the account
  else if (anomalies.some((a) => a.kind === 'one-way-accumulation')) health = 'warn';

  return {
    portfolio: { tokenCount: tokens.length, idleHive: round(idleHive, 4), openOrders: openOrders.length },
    trading: { realizedNetHive: realizedNet, ledgerNetPnl: ledgerNet, worstBleed, bestEarner, perToken },
    opportunities: { top: topOpp, count: oppRows.length },
    anomalies,
    health,
  };
}

// human-readable one-tick monitor report.
export function report(c, a = assess(c)) {
  const L = [];
  const dot = a.health === 'ok' ? '🟢' : a.health === 'warn' ? '🟡' : '🔴';
  L.push(`${dot} angelicalist monitor — @${c.account}  (READ-ONLY, no keys)  ${c.at}`);
  if (c.snapshot?.error) L.push(`  ⚠ account read error: ${c.snapshot.error}`);
  L.push(`  Portfolio: ${a.portfolio.tokenCount} tokens · ${a.portfolio.idleHive} SWAP.HIVE idle · ${a.portfolio.openOrders} open orders`);
  L.push(`  Realized (on-chain): ${a.trading.realizedNetHive} HIVE net` +
    (a.trading.ledgerNetPnl != null ? ` · ledger P&L ${round(a.trading.ledgerNetPnl, 2)}` : ''));
  if (a.trading.bestEarner) L.push(`    best earner: ${a.trading.bestEarner.symbol} +${a.trading.bestEarner.net} HIVE`);
  if (a.trading.worstBleed) L.push(`    worst bleed: ${a.trading.worstBleed.symbol} ${a.trading.worstBleed.net} HIVE`);
  if (a.opportunities.top) {
    const o = a.opportunities.top;
    L.push(`  Top live edge: ${o.sym} ${((+o.edge) * 100).toFixed(1)}% on ${round(o.execHive, 0)} HIVE executable depth`);
  } else L.push(`  Top live edge: none actionable right now (${a.opportunities.count} markets scanned)`);
  if (a.anomalies.length) {
    L.push(`  Anomalies (${a.anomalies.length}):`);
    for (const an of a.anomalies.slice(0, 8)) L.push(`    [${an.kind}] ${an.symbol}: ${an.detail}`);
  } else L.push('  Anomalies: none');
  return L.join('\n');
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('monitor.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'once') {
    const c = await collect().catch((e) => ({ error: e.message }));
    if (c.error) { console.error('monitor error:', c.error); process.exit(1); }
    const a = assess(c);
    if (process.argv.includes('--json')) console.log(JSON.stringify({ collected: c, assessment: a }, null, 2));
    else console.log(report(c, a));
  } else {
    console.log('angelicalist background monitor — READ-ONLY diagnostics/analytics (no keys, no trades)');
    console.log('  node integrations/angelicalist/monitor.mjs once          # one snapshot + report');
    console.log('  node integrations/angelicalist/monitor.mjs once --json    # machine-readable');
    console.log('\nSchedule with cron/systemd every ~5-15 min. Safe regardless of whether live trading is on.');
  }
}
