// strategy-router.mjs — PURE regime→strategy router for the adaptive trade engine.
//
// ┌─ HARD SAFETY INVARIANTS (read before touching) ────────────────────────────────────────────┐
// │ • REPO-SIDE ONLY. Nothing here trades, broadcasts, holds a key, or does ANY I/O. routeStrategy │
// │   is a PURE function: regime + opts → { strategy, params, why }. No fetch, no fs, no clock, no  │
// │   randomness. It INVENTS NO EXECUTION — it only SELECTS which existing trade-strategies.mjs     │
// │   family the loop should run this tick, and tunes that family's params.                        │
// │ • The router NEVER sets order size or side. That stays with trade-strategies.decide() and then  │
// │   the loop's sizeOrder + the single (gated, unbuilt-here) signing gate. Every order that ever   │
// │   leaves trade-strategies is frozen dryRun:true / signer:null by construction.                 │
// │ • planWithRouter() (detect→route→decide) is for SHADOW / backtest use only. It is NOT wired     │
// │   into loop.mjs and importing it changes nothing about the live loop's behaviour.              │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// THE MAPPING (per .local/ADAPTIVE_TRADEBOT_DESIGN.md STEP 3b / the regime→strategy table):
//   DEAD           → do-nothing            (the anti-rug hard stop)
//   PEG_DISLOCATED → peg-arb               (the only proven-positive family; two-sided, self-closing)
//   RANGE          → nudge  (our issued token: troll-down/accumulate ratchet)  |  grid (liquid pair)
//   TREND_UP       → momentum (single unit, no pyramiding)   |  do-nothing if already long
//   TREND_DOWN     → do-nothing            (never catch a falling knife) — our token keeps support-only nudge
//   HIGH_VOL       → market-make w/ widened spread (our token)  |  do-nothing (don't quote tight into chaos)
//   THIN_BOOK      → wall support (defensive)  |  do-nothing
//   UNCERTAIN / unknown → do-nothing        (safe HOLD)
//
//   import { routeStrategy, planWithRouter, ROUTES } from './strategy-router.mjs';
//   node integrations/strategy-router.mjs        # print the mapping + a demo plan per regime

import { decide, STRATEGIES } from './trade-strategies.mjs';
import { detectRegime } from './regime-detector.mjs';
import { loadTradeConfig } from './trade-config.mjs';

const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
const round = (n, dp = 8) => +(+n).toFixed(dp);

// 'do-nothing' is a first-class route: a HOLD that produces no orders. It is NOT a trade-strategies
// family — the caller maps it to an empty decision without ever calling decide().
export const DO_NOTHING = 'do-nothing';

/**
 * ROUTES — the static regime→route table (documentation + a machine-readable contract for tests).
 * `strategy` is the default family; `issued`/`liquid` note the token-tier split where it applies.
 */
export const ROUTES = Object.freeze({
  DEAD:           { strategy: DO_NOTHING, why: 'dead/suspect/one-sided book — hard stop (anti-rug gate)' },
  PEG_DISLOCATED: { strategy: 'peg-arb',  why: 'real executable peg edge — fade it (the proven family)' },
  RANGE:          { issued: 'nudge', liquid: 'grid', why: 'range-bound — accumulate our token (troll-down ratchet) / grid a liquid pair' },
  TREND_UP:       { strategy: 'momentum', why: 'up-trend — ride single-unit; HOLD if already long (no pyramiding)' },
  TREND_DOWN:     { issued: 'nudge', strategy: DO_NOTHING, why: 'down-trend — no new buys (falling-knife guard); our token keeps support-only ratchet' },
  HIGH_VOL:       { issued: 'market-make', strategy: DO_NOTHING, why: "volatility spike — widen the MM spread on our token, else don't quote into chaos" },
  THIN_BOOK:      { issued: 'wall', strategy: DO_NOTHING, why: 'thin book fakes edges — defend a floor (wall), else HOLD' },
  UNCERTAIN:      { strategy: DO_NOTHING, why: 'no usable signal — safe HOLD (the default)' },
});

/**
 * routeStrategy — PURE. Map a regime to the active strategy + tuned params, per the table above.
 * Never throws; an unknown/missing regime routes to the safe do-nothing HOLD.
 *
 * @param {string} regime  one of regime-detector REGIMES
 * @param {object} [opts]
 *   isIssuedToken: {bool} the token is one WE issue (VKBT/CURE/KULA/MELEK) → the accumulation lane
 *   alreadyLong:   {bool} we already hold a long position (TREND_UP → HOLD rather than add)
 *   volSpreadMultiplier: {number} widen the MM spread by this factor in HIGH_VOL (default 2)
 *   params:        {object} explicit per-token param overrides merged onto the tuned params (win)
 *   config:        trade-config overrides (env-injectable)
 * @returns {{ regime, strategy, params, why, hold }}  hold=true ⇒ do-nothing (no orders this tick)
 */
export function routeStrategy(regime, opts = {}) {
  try {
    const cfg = loadTradeConfig();
    const issued = opts.isIssuedToken === true;
    const extra = (opts.params && typeof opts.params === 'object') ? opts.params : {};
    const mk = (strategy, why, params = {}) => {
      if (strategy === DO_NOTHING || !STRATEGIES[strategy]) {
        return { regime, strategy: DO_NOTHING, params: {}, why, hold: true };
      }
      return { regime, strategy, params: { ...params, ...extra }, why, hold: false };
    };

    switch (regime) {
      case 'PEG_DISLOCATED':
        return mk('peg-arb', ROUTES.PEG_DISLOCATED.why);

      case 'RANGE':
        return issued
          ? mk('nudge', 'RANGE + our issued token — troll-down/accumulate outbid-ratchet (support + skim)')
          : mk('grid', 'RANGE + liquid third-party pair — grid the chop, inventory-capped');

      case 'TREND_UP':
        return opts.alreadyLong
          ? mk(DO_NOTHING, 'TREND_UP but already long — ride, do not pyramid (HOLD)')
          : mk('momentum', ROUTES.TREND_UP.why, { /* single-unit; momentum enforces no-pyramiding itself */ });

      case 'TREND_DOWN':
        // never catch a falling knife: no new directional buys. Our own token keeps ONLY the support
        // ratchet (nudge only ever places a resting bid — it never sells / crosses), skim disabled.
        return issued
          ? mk('nudge', 'TREND_DOWN + our token — support bid only (no skim into a falling book)', { supportOnly: true })
          : mk(DO_NOTHING, 'TREND_DOWN — no new buys (falling-knife guard)');

      case 'HIGH_VOL': {
        // volatility widens the fair spread — widen the MM quote on our own token; else stand down.
        if (!issued) return mk(DO_NOTHING, "HIGH_VOL — don't quote tight into chaos (HOLD)");
        const base = num(cfg?.strategy?.spread, 0.02) || 0.02;
        const mult = num(opts.volSpreadMultiplier, 2) || 2;
        return mk('market-make', 'HIGH_VOL + our token — market-make with a WIDER spread (bigger gamma)',
          { spread: round(base * mult, 6) });
      }

      case 'THIN_BOOK':
        return issued
          ? mk('wall', 'THIN_BOOK + our token — defensive buy-wall support only (do not chase thin edges)')
          : mk(DO_NOTHING, 'THIN_BOOK — thin book fakes edges, stand down (HOLD)');

      case 'DEAD':
        return mk(DO_NOTHING, ROUTES.DEAD.why);

      case 'UNCERTAIN':
      default:
        return mk(DO_NOTHING, ROUTES.UNCERTAIN.why);
    }
  } catch (e) {
    return { regime, strategy: DO_NOTHING, params: {}, hold: true,
      why: `router error ${e && e.message ? e.message : e} — soft-fail to HOLD` };
  }
}

/**
 * planWithRouter — SHADOW / BACKTEST ONLY. Compose detectRegime → routeStrategy → trade-strategies.decide
 * into a single intended DECISION. PURE (all three stages are pure). This is DELIBERATELY not imported
 * by loop.mjs; it exists so the shadow harness + backtester can SEE what the adaptive engine WOULD do.
 *
 * @param {object} marketState  the regime-detector input (candles/books/arb/…) + a `symbol`
 * @param {object} [opts]
 *   detect: { prior, minDwell, config } forwarded to detectRegime
 *   route:  { isIssuedToken, alreadyLong, volSpreadMultiplier, params } forwarded to routeStrategy
 *   snapshot: extra fields merged into the decide() snapshot (realUsd/hiveUsd/ourAccounts/…)
 *   state:  the decide() position/budget state (inventoryToken, inventoryHive, lastNudge, …)
 * @returns {{ regime, detection, route, decision }}  decision = { orders:[], reason } (frozen dryRun orders)
 */
export function planWithRouter(marketState = {}, opts = {}) {
  const detection = detectRegime(marketState, opts.detect || {});
  const route = routeStrategy(detection.regime, opts.route || {});

  if (route.hold) {
    return {
      regime: detection.regime, detection, route,
      decision: { orders: [], reason: `HOLD (${route.strategy}) — ${route.why}` },
    };
  }

  // Build the decide() snapshot from the market state (no fabrication — only what's present is passed).
  const f = detection.factors || {};
  const snapshot = {
    symbol: marketState.symbol,
    hePrice: marketState.hePrice ?? f.price ?? undefined,
    mid: marketState.mid ?? f.price ?? undefined,
    bid: marketState.bid ?? (f.bestBid || undefined),
    ask: marketState.ask ?? (f.bestAsk || undefined),
    buyBook: marketState.buyBook || [],
    sellBook: marketState.sellBook || [],
    // momentum wants fast/slow MAs — feed the ones the detector already computed (past-only).
    fast: f.fastMA ?? undefined,
    slow: f.slowMA ?? undefined,
    ...(opts.snapshot || {}),
  };
  const decision = decide(route.strategy, snapshot, route.params || {}, opts.state || {});
  return { regime: detection.regime, detection, route, decision };
}

// ── CLI (guarded) — offline: print the mapping + a demo route per regime, no network, no keys ────
if (process.argv[1] && process.argv[1].endsWith('strategy-router.mjs')) {
  const { REGIMES } = await import('./regime-detector.mjs');
  console.log('Strategy router — PURE regime→strategy mapping (SHADOW/backtest only, never in the live loop)\n' + '─'.repeat(84));
  for (const regime of REGIMES) {
    const issued = routeStrategy(regime, { isIssuedToken: true });
    const liquid = routeStrategy(regime, { isIssuedToken: false });
    const same = issued.strategy === liquid.strategy;
    console.log(`\n[${regime}]`);
    console.log(`  issued token → ${issued.strategy}${issued.hold ? ' (HOLD)' : ''}  — ${issued.why}`);
    if (!same) console.log(`  liquid pair  → ${liquid.strategy}${liquid.hold ? ' (HOLD)' : ''}  — ${liquid.why}`);
  }
  console.log('\nThe router only SELECTS + tunes an existing trade-strategies family. It never sets size/side,');
  console.log('never signs, never trades. planWithRouter() composes detect→route→decide for SHADOW use only.');
}
