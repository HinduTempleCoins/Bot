// loop.mjs — the STANDING LIVE LOOP for the angelicalist trade bot (task #189 / bot #1 in
// .local/ANGELICALIST_BOT_RECOMMENDATION.md). One runOnce() per tick; designed to be fired by
// cron / a systemd timer every ~5 min. It WIRES TOGETHER the existing, already-tested pieces — it
// adds NO new strategy logic:
//
//   • decisions   ← trade-presets.simulate()        (swap-sell-on-premium / swap-buy-on-discount)
//   • ranking     ← ai-trade-suggest.suggest()      (deterministic edge×liquidity×jurisdiction−risk)
//   • sizing      ← execute.sizeOrder()             (live depth + balances, per-order cap, dust floor)
//   • execution   ← trader.placeOrder()             (the ONLY signing gate; ANGELICALIST_LIVE + WIF)
//   • sweep       ← dry-run.planSweep() + trader.sweepToKali()   (skim profit above principal)
//   • logging     ← profit-tracker.record()         (FIFO P&L ledger the briefs read)
//
// ── ACCOUNT & KEY POSTURE (operator, 2026-06-04) ────────────────────────────────────────────────
// angelicalist is an accepted-compromised / leaked-key account. The bot signs LOCALLY with that
// account's own WIF read at runtime from process.env.ANGELICALIST_WIF — no HiveSigner, no rotation,
// no MELEK-Signer. Profit is swept to the COLD kalivankush account (receiving needs no key). The key
// is NEVER hard-coded, NEVER logged, NEVER committed. trader.mjs is the single place that signs.
//
// ── DEFAULT IS DRY-RUN ──────────────────────────────────────────────────────────────────────────
// Nothing broadcasts unless ANGELICALIST_LIVE === 'true' AND a key is present. Without both, every
// decision/order/sweep is returned as an INTENT and nothing touches the chain.
//
// ── HARD GUARDS (reuse where present) ───────────────────────────────────────────────────────────
//   1. BLEED-GUARD: never one-way accumulate. A BUY with no matching SELL leg this tick is downgraded
//      to WATCH and never broadcast (the −6,424 HIVE SWAP.LTC lesson).
//   2. DEAD-BOOK REJECT: any "edge" > MAX_BELIEVABLE_EDGE (default 30%) is a stale/broken book
//      (the SWAP.ETH 164% / SWAP.MATIC 16% trap) → rejected, never acted on.
//   3. PER-ORDER CAP: MAX_ORDER_HIVE (env, default 10) — enforced in execute.sizeOrder.
//   4. THIN-DEPTH SKIP: a market without enough executable depth (MIN_EXEC_HIVE) is skipped.
//
//   node integrations/angelicalist/loop.mjs once          # one tick, dry-run (default)
//   ANGELICALIST_LIVE=true ANGELICALIST_WIF=<wif> node integrations/angelicalist/loop.mjs once   # LIVE

import { simulate } from '../trade-presets.mjs';
import { suggest } from '../ai-trade-suggest.mjs';
import { scanArb } from '../arb-scanner.mjs';
import { sizeOrder } from './execute.mjs';
import { planSweep } from './dry-run.mjs';
import { placeOrder as realPlaceOrder, sweepToKali as realSweepToKali, mode } from './trader.mjs';
import { tokenBalances } from './internal.mjs';
import { record as ptRecord } from '../profit-tracker.mjs';

// ── tunables (env-overridable). Read PER-TICK so cron/systemd env changes take effect live and so
// the per-order cap stays in lock-step with execute.sizeOrder's own MAX_ORDER_HIVE read. ───────────
function tunables() {
  return {
    MAX_ORDER_HIVE: +(process.env.MAX_ORDER_HIVE || 10),               // per-order ceiling (also enforced in execute.sizeOrder)
    MAX_BELIEVABLE_EDGE: +(process.env.MAX_BELIEVABLE_EDGE || 0.30),   // >this = dead/stale book → reject
    MIN_EXEC_HIVE: +(process.env.ARB_MIN_EXEC_HIVE || 20),             // need ≥this executable HIVE of depth to act
    SWEEP_PRINCIPAL: +(process.env.SWEEP_PRINCIPAL_HIVE || 0),         // float to keep on the hot account (never swept)
    SWEEP_THRESHOLD: +(process.env.SWEEP_THRESHOLD_HIVE || 5),         // buffer above principal before skimming
    SWEEP_ASSET: process.env.SWEEP_ASSET || 'SWAP.HIVE',             // asset to sweep to kalivankush
  };
}

const round = (n) => +(+n).toFixed(8);
const balOf = (tokens, symbol) => { const t = tokens.find((x) => x.symbol === symbol); return t ? t.balance : 0; };

/**
 * runOnce — one tick of the standing loop.
 *
 * Injectables (all default to the real modules; tests inject fakes — no network, no key):
 *   deps.decisions(): preset decisions   → defaults to trade-presets.simulate()
 *   deps.arb():       arb-scan result    → defaults to arb-scanner.scanArb() (depth + edge per market)
 *   deps.balances():  token balances     → defaults to internal.tokenBalances()
 *   deps.broadcaster: { placeOrder, sweepToKali } → defaults to trader.{placeOrder,sweepToKali}
 *   deps.ptRecord:    ledger logger      → defaults to profit-tracker.record
 *   deps.llm:         optional rationale LLM for ai-trade-suggest (soft-fails)
 *
 * Returns { ts, mode, dryRun, decisions, orders, swept, blocked, summary }.
 */
export async function runOnce(deps = {}) {
  const { MAX_ORDER_HIVE, MAX_BELIEVABLE_EDGE, MIN_EXEC_HIVE, SWEEP_PRINCIPAL, SWEEP_THRESHOLD, SWEEP_ASSET } = tunables();
  const m = (deps.mode || mode)();
  const live = m.live;                                  // true only when ANGELICALIST_LIVE + WIF present
  const broadcaster = deps.broadcaster || { placeOrder: realPlaceOrder, sweepToKali: realSweepToKali };
  const logFill = deps.ptRecord || ptRecord;

  // 1. pull preset decisions + the depth-aware arb scan (edge + executable HIVE per market).
  const [rawDecisions, arb, tokens] = await Promise.all([
    (deps.decisions || simulate)().catch(() => []),
    (deps.arb || scanArb)().catch(() => ({ opportunities: [], rows: [] })),
    (deps.balances || tokenBalances)().catch(() => []),
  ]);

  // index arb rows by symbol for edge/depth lookup (arb-scanner already depth-walks + reject-guards).
  const arbBySym = {};
  for (const r of [...(arb.rows || []), ...(arb.opportunities || [])]) if (r && r.sym) arbBySym[r.sym] = r;

  const decisions = (Array.isArray(rawDecisions) ? rawDecisions : []).filter((d) => d && (d.action === 'SELL' || d.action === 'BUY'));

  // 2a. BLEED-GUARD: a BUY needs a matching SELL leg this tick, else it's downgraded to WATCH.
  const hasSellLeg = (sym) => decisions.some((x) => x.sym === sym && x.action === 'SELL');
  const blocked = [];
  let guarded = decisions.filter((d) => {
    if (d.action === 'BUY' && !hasSellLeg(d.sym)) {
      blocked.push({ ...d, action: 'WATCH', blocked: 'no-selling-leg (SWAP.LTC bleed guard)' });
      return false;
    }
    return true;
  });

  // 2b. DEAD-BOOK REJECT + THIN-DEPTH SKIP using the arb scan's per-market edge/depth.
  guarded = guarded.filter((d) => {
    const a = arbBySym[d.sym];
    const edge = a ? Math.abs(+a.edge || 0) : 0;
    if (edge > MAX_BELIEVABLE_EDGE) {
      blocked.push({ ...d, blocked: `dead/stale book — edge ${(edge * 100).toFixed(1)}% > ${(MAX_BELIEVABLE_EDGE * 100).toFixed(0)}% cap (broken-book trap)` });
      return false;
    }
    // depth: if we have an arb row for this symbol, require executable depth; absent row → let sizeOrder decide.
    if (a && (+a.execHive || 0) > 0 && (+a.execHive || 0) < MIN_EXEC_HIVE) {
      blocked.push({ ...d, blocked: `thin depth — ${(+a.execHive).toFixed(0)} HIVE executable < ${MIN_EXEC_HIVE} min` });
      return false;
    }
    return true;
  });

  // 2c. RANK the survivors via ai-trade-suggest (deterministic; LLM only writes prose, soft-fails).
  //     We feed the guarded decisions as opportunities so the ranker's own bleed-guard is a second net.
  let ranked = guarded;
  try {
    const opportunities = guarded.map((d) => {
      const a = arbBySym[d.sym] || {};
      return {
        market: d.sym, action: d.action,
        edge: Math.abs(+a.edge || 0), execHive: +a.execHive || 0,
        jurisdiction: 'clean', paired: d.action === 'SELL' || hasSellLeg(d.sym),
        reason: d.reason,
      };
    });
    const holdings = Object.fromEntries(tokens.map((t) => [t.symbol, t.balance]));
    const suggestions = await suggest({ snapshot: { opportunities, liquidityTargetHive: 100 }, holdings }, { llm: deps.llm });
    const order = new Map(suggestions.map((s, i) => [s.market, i]));
    // a suggestion downgraded to WATCH is dropped from execution; everything else keeps preset order by rank.
    const watched = new Set(suggestions.filter((s) => s.action === 'WATCH').map((s) => s.market));
    for (const d of guarded) if (watched.has(d.sym)) blocked.push({ ...d, action: 'WATCH', blocked: 'ranker downgraded to WATCH (bleed-guard)' });
    ranked = guarded
      .filter((d) => !watched.has(d.sym))
      .sort((x, y) => (order.get(x.sym) ?? 1e9) - (order.get(y.sym) ?? 1e9));
  } catch { /* ranker is advisory; on any failure keep the guarded list as-is */ }

  // 3 + 4. SIZE each survivor (execute.sizeOrder: live depth + balances + per-order cap) and EXECUTE.
  const orders = [];
  for (const d of ranked) {
    const sized = await sizeOrder(d, tokens).catch((e) => ({ ...d, skip: `sizeOrder error: ${e.message}` }));
    if (sized.skip || !sized.order) { orders.push(sized); continue; }
    let result;
    if (live) {
      result = await broadcaster.placeOrder(sized.order).catch((e) => ({ error: e.message }));
      // log the (attempted) fill to the FIFO ledger — feeds the briefs.
      if (result && !result.error) {
        try {
          logFill({
            ts: Date.now(), account: m.account, market: sized.order.symbol, side: sized.order.side,
            qty: sized.order.quantity, price: sized.order.price,
            feeHive: 0, txId: result.txId ?? null,
          });
        } catch { /* logging must never break the loop */ }
      }
    } else {
      result = { simulated: true, would: `${sized.order.side.toUpperCase()} ${sized.order.quantity} ${sized.order.symbol} @ ${sized.order.price}` };
    }
    orders.push({ ...sized, result });
  }

  // 5. SWEEP: skim profit above (principal + buffer) to kalivankush. Never touches the principal.
  const liquid = balOf(tokens, SWEEP_ASSET);
  const sweepPlan = planSweep({ balances: { [SWEEP_ASSET]: liquid }, threshold: SWEEP_THRESHOLD, asset: SWEEP_ASSET, principal: SWEEP_PRINCIPAL });
  let swept = { ...sweepPlan, executed: false };
  if (sweepPlan.skim && sweepPlan.amount > 0) {
    if (live) {
      const r = await broadcaster.sweepToKali({ symbol: sweepPlan.asset, quantity: sweepPlan.amount, memo: 'profit sweep' }).catch((e) => ({ error: e.message }));
      swept = { ...sweepPlan, executed: !!(r && !r.error && !r.simulated), result: r };
    } else {
      swept = { ...sweepPlan, executed: false, result: { simulated: true, would: `SWEEP ${sweepPlan.amount} ${sweepPlan.asset} -> @${sweepPlan.to}` } };
    }
  }

  const placedCount = orders.filter((o) => o.order && o.result && !o.result.error && !o.result.skip).length;
  return {
    ts: new Date().toISOString(),
    mode: m,
    dryRun: !live,
    decisions: ranked,
    orders,
    swept,
    blocked,
    summary: {
      considered: decisions.length, executable: ranked.length, placed: placedCount,
      blocked: blocked.length, swept: swept.executed ? swept.amount : 0,
      capHive: MAX_ORDER_HIVE, maxEdge: MAX_BELIEVABLE_EDGE,
    },
  };
}

// human-readable one-tick report.
export function report(r) {
  if (!r) return '(no result)';
  const lines = [];
  lines.push(`angelicalist loop tick — ${r.dryRun ? '🟢 DRY-RUN (default)' : '🔴 LIVE'}  cap=${r.summary.capHive} HIVE/order  account=@${r.mode.account} sweep->@${r.mode.sweepTo}  (${r.ts})`);
  if (!r.orders.length && !r.blocked.length) lines.push('  (all HOLD — nothing actionable this tick)');
  for (const o of r.orders) {
    if (o.skip) { lines.push(`  [SKIP] ${o.sym}: ${o.skip}`); continue; }
    const econ = o.order.side === 'sell' ? `proceeds ~${o.proceedsHive} HIVE` : `spend ~${o.spendHive} HIVE`;
    const tag = o.result?.simulated ? 'SIMULATED' : o.result?.error ? `ERROR ${o.result.error}` : `LIVE tx ${o.result?.txId}`;
    lines.push(`  [${o.order.side.toUpperCase()}] ${o.order.quantity} ${o.order.symbol} @ ${o.order.price}  (${econ})  ${tag}`);
  }
  for (const b of r.blocked) lines.push(`  [BLOCKED] ${b.sym}: ${b.blocked}`);
  lines.push(r.swept.skim
    ? `  [SWEEP ${r.swept.executed ? 'DONE' : r.dryRun ? 'WOULD' : 'PENDING'}] ${r.swept.amount} ${r.swept.asset} -> @${r.swept.to}  (${r.swept.reason})`
    : `  [NO SWEEP] ${r.swept.reason}`);
  return lines.join('\n');
}

// ── CLI (guarded): `node loop.mjs once` runs one tick ───────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('loop.mjs')) {
  const cmd = process.argv[2];
  if (cmd === 'once') {
    const r = await runOnce().catch((e) => ({ error: e.message }));
    if (r.error) { console.error('loop error:', r.error); process.exit(1); }
    console.log(report(r));
  } else {
    console.log('angelicalist standing loop — usage:');
    console.log('  node integrations/angelicalist/loop.mjs once     # one tick (dry-run by default)');
    console.log('\nRun LIVE only with ANGELICALIST_LIVE=true and ANGELICALIST_WIF=<wif> in the env.');
    console.log('Schedule with cron/systemd every ~5 min (it does one tick per invocation).');
  }
}
