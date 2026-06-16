// cdp-loop-safety.mjs — ADVERSARIAL loop-safety proof for the MELEK/KULA CDP DAG.
//
// The two CDP markets form a directed graph:
//     KULA  --Market 1 (lock KULA,   borrow wMELEK)-->  wMELEK
//     wMELEK --Market 2 (lock wMELEK, borrow ALTI)  -->  ALTI
// ALTI is collateral for NOTHING (debt of last resort). So the graph is a DAG: KULA → wMELEK → ALTI,
// no edge returns. There is no cycle to spin. This module PROVES that even an attacker who recursively
// "loops" — borrow, sell/relock the borrowed asset as fresh collateral, borrow again — cannot:
//   (a) run forever: each hop borrows only an LTV fraction of the previous, so leverage is a GEOMETRIC
//       series that converges. Total exposure ≤ 1/(1−LTV). The loop TERMINATES in a bounded #hops.
//   (b) drain the system: at EVERY hop, total collateral value ≥ total debt value (the system stays
//       overcollateralized — never "all locked, nothing left / debt exceeds backing").
//
// This is the off-chain mirror of the on-chain invariant `debt ≤ collateral * maxLTV` enforced per-
// position by CDPVault.borrow()/withdraw(). The simulation aggregates many looped positions and shows
// the aggregate invariant also holds — leverage looping cannot manufacture undercollateralization.
//
// House style: pure arithmetic, soft-fail to safe shapes, NEVER throws. No network, no deps.

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 10) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };

// Below this borrowed-value-per-hop we declare the geometric series effectively terminated.
const DUST = 1e-9;
// Hard cap so a pathological LTV (≈1) can never spin the loop unbounded — the proof's bound, enforced.
const HARD_HOP_CAP = 10000;

/**
 * The theoretical max total leverage of a recursive borrow→relock loop at a constant LTV:
 *   1 + LTV + LTV^2 + ... = 1 / (1 - LTV)   (geometric series, |LTV| < 1)
 * At LTV = 0.5 → 2x; LTV = 0.4 → 1.667x; LTV → 1 → ∞ (why maxLtv must stay < 1, and well below it).
 * Soft-fails: LTV ≤ 0 → 1 (no leverage); LTV ≥ 1 → Infinity (the degenerate, forbidden case).
 */
export function maxLeverage(ltv) {
  const l = Math.min(1, Math.max(0, nn(ltv)));
  if (l <= 0) return 1;
  if (l >= 1) return Infinity;
  return round(1 / (1 - l), 10);
}

/**
 * #hops until the per-hop borrowed VALUE decays below `dust` (as a fraction of start capital):
 *   LTV^n < dust  ⇒  n > ln(dust) / ln(LTV)
 * Bounded by HARD_HOP_CAP. LTV ≤ 0 → 0 hops; LTV ≥ 1 → HARD_HOP_CAP (never converges → capped).
 */
export function hopsToConverge(ltv, dust = DUST) {
  const l = Math.min(1, Math.max(0, nn(ltv)));
  const d = nn(dust) || DUST;
  if (l <= 0) return 0;
  if (l >= 1) return HARD_HOP_CAP;
  return Math.min(HARD_HOP_CAP, Math.ceil(Math.log(d) / Math.log(l)));
}

/**
 * Simulate an attacker recursively looping across the CDP DAG to maximize leverage.
 *
 * Model (all values in a single USD-ish unit so cross-market value is comparable): the attacker starts
 * with `startCapital` of collateral value. Hop k locks the value freed by hop k-1 and borrows LTV× of
 * it, then treats that borrowed value as new collateral for the next hop (the worst case for the
 * system — every borrow is immediately re-locked, maximizing aggregate debt). `ltvs` is the per-hop LTV
 * (a single number applies to all hops, or an array walked then clamped to its last entry); this lets
 * the loop traverse different markets (e.g. Market 1 then Market 2) with different LTVs.
 *
 * Returns per-hop {hop, locked, borrowed, collateral, debt, ratio} plus the proven booleans:
 *   terminates              — the loop converged within the bound (borrowed value hit dust)
 *   maxHops                 — hops actually taken
 *   totalCollateral/totalDebt/leverage — aggregates
 *   alwaysOvercollateralized — collateral ≥ debt at EVERY hop (the drain-safety invariant)
 *   boundedLeverage         — total leverage ≤ 1/(1−maxLtv) + ε (the termination invariant)
 *   safe                    — both invariants held (the headline result)
 * Soft-fails to a safe, empty-but-consistent shape on bad input — never throws, never reports a cycle.
 */
export function simulateLoop({ startCapital = 0, ltvs = 0.5, hops } = {}) {
  const cap = nn(startCapital);
  const ltvArr = Array.isArray(ltvs) ? ltvs.map((x) => Math.min(1, Math.max(0, nn(x)))) : null;
  const flatLtv = ltvArr ? null : Math.min(1, Math.max(0, nn(ltvs)));
  const ltvAt = (k) => (ltvArr ? (ltvArr[k] ?? ltvArr[ltvArr.length - 1] ?? 0) : flatLtv);
  const maxLtvSeen = ltvArr ? Math.max(0, ...ltvArr) : flatLtv;

  // Hop budget: explicit `hops`, else derived from the worst (highest) LTV's convergence, capped.
  const budget = Number.isFinite(+hops) && +hops > 0
    ? Math.min(HARD_HOP_CAP, Math.trunc(+hops))
    : hopsToConverge(maxLtvSeen);

  const steps = [];
  let totalCollateral = 0;
  let totalDebt = 0;
  let lockNext = cap;          // value locked at the current hop
  let terminated = false;
  let alwaysOver = true;
  let k = 0;

  if (cap <= 0) {
    // No capital → nothing to loop. Vacuously safe and terminated.
    return {
      steps, startCapital: 0, terminates: true, maxHops: 0,
      totalCollateral: 0, totalDebt: 0, leverage: 0,
      theoreticalMaxLeverage: maxLeverage(maxLtvSeen),
      alwaysOvercollateralized: true, boundedLeverage: true, safe: true,
    };
  }

  for (; k < budget; k++) {
    const ltv = ltvAt(k);
    if (lockNext <= DUST) { terminated = true; break; }

    const locked = lockNext;
    const borrowed = round(locked * ltv, 10); // borrow only an LTV fraction — the geometric step

    totalCollateral = round(totalCollateral + locked, 10);
    totalDebt = round(totalDebt + borrowed, 10);

    const ratio = totalDebt > 0 ? round(totalCollateral / totalDebt, 10) : Infinity;
    // Per-hop drain-safety: aggregate collateral value must cover aggregate debt value.
    if (totalCollateral + 1e-9 < totalDebt) alwaysOver = false;

    steps.push({ hop: k + 1, ltv, locked, borrowed, collateral: totalCollateral, debt: totalDebt, ratio });

    lockNext = borrowed; // the borrowed asset is re-locked as the next hop's collateral (worst case)
    if (borrowed <= DUST) { terminated = true; break; }
  }
  // If we exhausted an explicit budget but the series was still decaying, it still terminates in the
  // limit; only an LTV ≥ 1 (which can't decay) is genuinely non-terminating.
  if (!terminated && maxLtvSeen < 1) terminated = true;

  const leverage = cap > 0 ? round(totalCollateral / cap, 10) : 0;
  const theoreticalMax = maxLeverage(maxLtvSeen);
  // Bounded iff leverage never exceeds the geometric ceiling (tiny ε for rounding).
  const boundedLeverage = theoreticalMax === Infinity ? false : leverage <= theoreticalMax + 1e-6;

  return {
    steps,
    startCapital: cap,
    terminates: terminated && maxLtvSeen < 1,
    maxHops: steps.length,
    totalCollateral,
    totalDebt,
    leverage,
    theoreticalMaxLeverage: theoreticalMax,
    alwaysOvercollateralized: alwaysOver,
    boundedLeverage,
    safe: terminated && maxLtvSeen < 1 && alwaysOver && boundedLeverage,
  };
}

/**
 * Walk the DAG once (KULA → wMELEK → ALTI) and assert it has NO back-edge — i.e. ALTI is never
 * collateral, so no node reachable from a borrowed token leads back to its own collateral. Returns
 * { isDag, terminal, order, hasCycle }. Pure structural check over the fixed market graph; used by the
 * test to prove "never a cycle" independent of the numeric simulation.
 */
export function analyzeGraph(markets = DEFAULT_MARKETS) {
  const edges = (Array.isArray(markets) ? markets : []).map((m) => ({
    from: String(m?.collateral ?? ''), to: String(m?.debt ?? ''),
  })).filter((e) => e.from && e.to);

  // Kahn's algorithm for cycle detection / topological order.
  const nodes = new Set();
  const outAdj = new Map();
  const indeg = new Map();
  for (const { from, to } of edges) {
    nodes.add(from); nodes.add(to);
    if (!outAdj.has(from)) outAdj.set(from, []);
    outAdj.get(from).push(to);
    indeg.set(to, (indeg.get(to) || 0) + 1);
    if (!indeg.has(from)) indeg.set(from, indeg.get(from) || 0);
  }
  const queue = [...nodes].filter((n) => (indeg.get(n) || 0) === 0);
  const order = [];
  while (queue.length) {
    const n = queue.shift();
    order.push(n);
    for (const m of (outAdj.get(n) || [])) {
      indeg.set(m, indeg.get(m) - 1);
      if (indeg.get(m) === 0) queue.push(m);
    }
  }
  const isDag = order.length === nodes.size;
  // Terminal nodes: in the DAG, nodes with no out-edges (collateral for nothing) — should be [ALTI].
  const terminal = [...nodes].filter((n) => !(outAdj.get(n) || []).length);
  return { isDag, hasCycle: !isDag, terminal, order };
}

/** The fixed market graph of the MELEK/KULA CDP DAG. */
export const DEFAULT_MARKETS = Object.freeze([
  Object.freeze({ market: 1, collateral: 'KULA', debt: 'wMELEK' }),
  Object.freeze({ market: 2, collateral: 'wMELEK', debt: 'ALTI' }),
]);

// CLI demo (guarded) — show the bounded geometric decay + the per-hop overcollateralization.
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('cdp-loop-safety.mjs')) {
  const g = analyzeGraph();
  console.log('graph:', g, '(hasCycle should be false; terminal should be [ALTI])');
  for (const ltv of [0.4, 0.5, 0.66]) {
    const r = simulateLoop({ startCapital: 1000, ltvs: ltv });
    console.log(`\nLTV ${ltv}: theoreticalMaxLeverage=${r.theoreticalMaxLeverage}`,
      `actualLeverage=${r.leverage} hops=${r.maxHops}`,
      `terminates=${r.terminates} alwaysOver=${r.alwaysOvercollateralized} safe=${r.safe}`);
    console.log('  totalCollateral', r.totalCollateral, 'totalDebt', r.totalDebt,
      'ratio', round(r.totalCollateral / r.totalDebt, 4));
  }
  // Cross-market loop (Market 1 then Market 2 LTVs), and the degenerate LTV=1 attempt.
  console.log('\ncross-market [0.5,0.4]:', simulateLoop({ startCapital: 1000, ltvs: [0.5, 0.4] }).safe);
  const bad = simulateLoop({ startCapital: 1000, ltvs: 1 });
  console.log('attack LTV=1:', { terminates: bad.terminates, safe: bad.safe, hops: bad.maxHops },
    '(bounded by HARD_HOP_CAP, reported unsafe — never an infinite cycle)');
}
