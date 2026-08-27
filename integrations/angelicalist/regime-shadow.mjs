// regime-shadow.mjs — READ-ONLY shadow/eval harness for the adaptive regime engine.
//
// ┌─ WHAT THIS IS / IS NOT ─────────────────────────────────────────────────────────────────────┐
// │ • PURPOSE: let us SEE the adaptive engine on live/backtest data BEFORE arming it. For a data   │
// │   snapshot it LOGS, side by side: (a) the current REGIME, (b) what the ROUTER would pick +      │
// │   the intended orders, and (c) what the current LIVE LOOP actually does this tick.             │
// │ • READ-ONLY. It holds no key, signs nothing, broadcasts nothing. It runs loop.runOnce() in its │
// │   DEFAULT DRY-RUN mode purely to READ the loop's intended action — it passes NO router into the │
// │   loop and changes NOTHING about the loop's behaviour. loop.mjs is untouched and unaware of it. │
// │ • The router/detector are NOT wired into the live decision/execution path. This harness merely  │
// │   observes both, in parallel, and prints the comparison.                                       │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// shadowCompare({ marketState, loopResult, route }) is PURE + offline-testable (inject everything).
// runShadow(deps) wires the real read-only readers + a dry-run loop tick for the CLI; every seam is
// injectable so `node --test` never touches the network or a key.
//
//   node integrations/angelicalist/regime-shadow.mjs once           # one read-only shadow tick
//   node integrations/angelicalist/regime-shadow.mjs once --json     # machine-readable
//   import { shadowCompare, runShadow, buildMarketState } from './regime-shadow.mjs';

import { detectRegime } from '../regime-detector.mjs';
import { planWithRouter } from '../strategy-router.mjs';

const round = (n, dp = 8) => +(+n || 0).toFixed(dp);

// Summarize a trade-strategies decision (frozen dryRun orders) into a compact one-liner.
function summarizeOrders(orders = []) {
  if (!orders.length) return 'no orders (HOLD)';
  return orders.map((o) => `${String(o.side || '').toUpperCase()} ${round(o.qtyToken, 4)} ${o.symbol} @ ${round(o.price, 8)}`).join(', ');
}

// Summarize what the LIVE loop did this tick (its runOnce() result) into a compact one-liner.
// The loop returns { orders:[{order, result, skip}], blocked, summary }. We only READ it.
function summarizeLoop(loopResult) {
  if (!loopResult || typeof loopResult !== 'object') return 'no loop result';
  if (loopResult.error) return `loop error: ${loopResult.error}`;
  const acted = (loopResult.orders || []).filter((o) => o && o.order);
  if (!acted.length) {
    const blocked = (loopResult.blocked || []).length;
    return `HOLD (all HOLD${blocked ? `, ${blocked} blocked` : ''})`;
  }
  return acted.map((o) => {
    const side = String(o.order.side || '').toUpperCase();
    const tag = o.result?.simulated ? 'SIM' : o.result?.error ? 'ERR' : 'LIVE';
    return `${side} ${o.order.quantity} ${o.order.symbol} @ ${o.order.price} [${tag}]`;
  }).join(', ');
}

/**
 * shadowCompare — PURE. Given a market snapshot, the router options, and the live loop's already-
 * computed tick result, produce the side-by-side comparison. Never throws.
 *
 * @param {object} args
 *   marketState: the regime-detector/router input (candles/books/arb/…)
 *   route:       routeStrategy opts { isIssuedToken, alreadyLong, params, … }
 *   detect:      detectRegime opts { prior, minDwell, config }
 *   snapshot:    extra decide() snapshot fields  |  state: decide() position state
 *   loopResult:  the loop.runOnce() result to compare against (READ-ONLY; may be null)
 * @returns {{ regime, confidence, router:{strategy,hold,orders,why}, loop:{action}, factors, lines, hysteresis }}
 */
export function shadowCompare(args = {}) {
  try {
    const { marketState = {}, route = {}, detect = {}, snapshot = {}, state = {}, loopResult = null } = args;
    const plan = planWithRouter(marketState, { detect, route, snapshot, state });
    const routerOrders = plan.decision?.orders || [];
    const routerLine = plan.route.hold ? 'HOLD (do-nothing)' : summarizeOrders(routerOrders);
    const loopLine = summarizeLoop(loopResult);

    const sym = marketState.symbol || plan.detection.factors?.symbol || '(symbol?)';
    const lines = [
      `symbol:  ${sym}`,
      `regime:  ${plan.regime}  (confidence ${plan.detection.confidence}${plan.detection.switched === false ? ', held' : ''})`,
      `router → ${plan.route.strategy}${plan.route.hold ? ' (HOLD)' : ''}: ${routerLine}`,
      `loop   → ${loopLine}`,
      `why:     ${plan.route.why}`,
    ];
    return {
      regime: plan.regime,
      confidence: plan.detection.confidence,
      router: { strategy: plan.route.strategy, hold: plan.route.hold, orders: routerOrders, why: plan.route.why },
      loop: { action: loopLine },
      factors: plan.detection.factors,
      hysteresis: plan.detection.hysteresis,
      lines,
    };
  } catch (e) {
    return { regime: 'UNCERTAIN', confidence: 0, router: { strategy: 'do-nothing', hold: true, orders: [], why: 'error' },
      loop: { action: 'n/a' }, factors: {}, hysteresis: null, lines: [`shadow error: ${e && e.message ? e.message : e}`] };
  }
}

/**
 * buildMarketState — assemble a regime-detector/router input for ONE symbol from the existing
 * READ-ONLY readers. Every reader is injectable and soft-fails, so this never throws and (with
 * fakes injected) never touches the network. Used by the CLI to shadow live data.
 *
 * deps: { symbol, loadHistory, buyBook, sellBook, arbRowFor, days }
 */
export async function buildMarketState(deps = {}) {
  const symbol = deps.symbol || 'VKBT';
  const out = { symbol };
  try {
    if (deps.loadHistory) out.candles = await deps.loadHistory({ token: symbol, days: deps.days || 30 }).catch(() => []);
    if (deps.buyBook) out.buyBook = await deps.buyBook(symbol).catch(() => []);
    if (deps.sellBook) out.sellBook = await deps.sellBook(symbol).catch(() => []);
    if (deps.arbRowFor) out.arb = (await deps.arbRowFor(symbol).catch(() => null)) || undefined;
  } catch { /* soft-fail — a partial market state still classifies */ }
  return out;
}

/**
 * runShadow — wire the read-only readers + a dry-run loop tick + the comparison. Every seam is
 * injectable; with no deps the CLI supplies the real readers (still read-only / dry-run).
 *
 * deps: { marketState | buildState(), runLoop(), route, detect, snapshot, state }
 *   runLoop: returns a loop.runOnce() result to compare against. Defaults (CLI) to a real DRY-RUN tick.
 */
export async function runShadow(deps = {}) {
  const marketState = deps.marketState || (deps.buildState ? await deps.buildState() : {});
  let loopResult = null;
  try {
    loopResult = deps.runLoop ? await deps.runLoop() : null;
  } catch (e) { loopResult = { error: e && e.message ? e.message : String(e) }; }
  return shadowCompare({
    marketState, loopResult,
    route: deps.route || {}, detect: deps.detect || {},
    snapshot: deps.snapshot || {}, state: deps.state || {},
  });
}

// ── CLI (guarded) — read-only shadow tick against live readers (dry-run loop; no key, no broadcast) ─
if (process.argv[1] && process.argv[1].endsWith('regime-shadow.mjs')) {
  const cmd = process.argv[2];
  if (cmd !== 'once') {
    console.log('Regime SHADOW harness — READ-ONLY. Logs regime + what the router WOULD pick vs what the');
    console.log('live loop actually does, side by side. It changes NOTHING about the live loop.\n');
    console.log('  node integrations/angelicalist/regime-shadow.mjs once           # one shadow tick');
    console.log('  node integrations/angelicalist/regime-shadow.mjs once --json      # machine-readable');
    console.log('\nSafe on any timer: no key, no signing, no broadcast — the loop tick runs in dry-run mode.');
  } else {
    // Wire the real read-only readers. All soft-fail offline; the loop runs in its default DRY-RUN mode.
    const symbol = process.env.SHADOW_SYMBOL || 'VKBT';
    const isIssued = (process.env.ISSUED_TOKENS || 'VKBT,CURE').split(/[,\s]+/).includes(symbol);
    const [{ loadHistory }, mkt, arb, loop] = await Promise.all([
      import('./backtest.mjs').catch(() => ({})),
      import('../hive-engine-market.mjs').catch(() => ({})),
      import('../arb-scanner.mjs').catch(() => ({})),
      import('./loop.mjs').catch(() => ({})),
    ]);
    const arbRowFor = async (sym) => {
      if (!arb.scanArb) return null;
      const scan = await arb.scanArb().catch(() => ({ rows: [], opportunities: [] }));
      return [...(scan.rows || []), ...(scan.opportunities || [])].find((r) => r && r.sym === sym) || null;
    };
    const buildState = () => buildMarketState({
      symbol,
      loadHistory: loadHistory || undefined,
      buyBook: mkt.market ? (s) => mkt.market.buyBook(s, 20) : undefined,
      sellBook: mkt.market ? (s) => mkt.market.sellBook(s, 20) : undefined,
      arbRowFor,
    });
    // READ-ONLY: loop.runOnce() with NO deps runs its default DRY-RUN tick (no key ⇒ intents only).
    const runLoop = loop.runOnce ? () => loop.runOnce() : null;
    const result = await runShadow({ buildState, runLoop, route: { isIssuedToken: isIssued } });
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      console.log(`Regime SHADOW — READ-ONLY (no key, no broadcast; loop tick is dry-run)\n${'─'.repeat(72)}`);
      for (const l of result.lines) console.log('  ' + l);
      console.log('\nThis is observation only — the router is NOT driving the live loop.');
    }
  }
}
