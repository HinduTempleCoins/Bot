// trade-config.mjs — ONE place the trade layer reads its scattered env knobs from. Pure, no side
// effects (no fetch, no fs, no clock). Before this module the MM_*, ARB_*, MAX_ORDER_HIVE,
// SCENARIO_*, CVA_*, XCHAIN_* knobs were read with ad-hoc `process.env.X || default` calls in a
// dozen files; the defaults drifted and nobody could see the whole surface. This consolidates them
// into ONE documented config object so the operator (and the AIs) can see every tunable at a glance.
//
// HARD INVARIANT: this module reads env and returns numbers/strings. It NEVER reads a key, never
// trades, never sets a "live" flag, never adds a daily cap or profit-skim value. Those stay where
// they are (operator-gated). It KEEPS the existing env names as the source of truth so importing it
// changes nothing about behaviour — same env → same numbers the old inline reads produced.
//
//   import { loadTradeConfig, TRADE_CONFIG } from './trade-config.mjs';
//   const cfg = loadTradeConfig();           // reads process.env now (or an injected env)
//   node integrations/trade-config.mjs       # print the resolved config + every default
//
// NOTE on consumers: trade-strategies/price-nudge/wall-bot import their knobs from here, but each
// keeps its OWN existing env names so nothing breaks. This is a READ consolidation, not a rename.

// ── tiny pure readers (no I/O) ─────────────────────────────────────────────────────────────────
const numOf = (v, d) => {
  if (v == null || v === '') return d;
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : d;
};
// a number that may be deliberately UNSET (returns null, not a default) — used for the fair-value
// ceiling/floor where "no value" must mean "refuse to act", not "fall back to a number".
const numOrNull = (v) => {
  if (v == null || v === '') return null;
  const f = parseFloat(v);
  return Number.isFinite(f) ? f : null;
};
const listOf = (v, d) => {
  const s = (v || '').trim();
  if (!s) return d;
  return s.split(/[,\s]+/).map((x) => x.trim()).filter(Boolean);
};

/**
 * Resolve the whole trade-config surface from an env object (defaults to process.env).
 * Pure: same env in → same object out. No caching, no clock, no fs.
 *
 * @param {object} [env=process.env]
 * @returns {object} the documented config (see the inline doc on each field)
 */
export function loadTradeConfig(env = process.env) {
  return Object.freeze({
    // ── token tiers (which tokens get special treatment) ──────────────────────────────────────
    // ISSUED_TOKENS = tokens this operator issues / tries to support (VKBT/CURE). PRIORITY_TOKENS =
    // the scenario-runner's must-cover set. Same env names watchlist.mjs/scenario-runner already use.
    issuedTokens: listOf(env.ISSUED_TOKENS, ['VKBT', 'CURE']),
    priorityTokens: listOf(env.SCENARIO_PRIORITY, ['VKBT', 'CURE']),

    // ── arbitrage (arb-scanner + cross-venue + crosschain + cex) ───────────────────────────────
    arb: {
      threshold: numOf(env.ARB_THRESHOLD, 0.03),         // single-leg HE-vs-real edge worth flagging (3%)
      minExecHive: numOf(env.ARB_MIN_EXEC_HIVE, 20),     // ignore edges you can't move ≥this much HIVE through
      heFee: numOf(env.CVA_HE_FEE, 0.01),                // Hive-Engine 1%/side (cross-venue stack)
      extTaker: numOf(env.CVA_EXT_TAKER, 0.005),         // external exchange ~0.5% taker
      minNetPct: numOf(env.CVA_MIN_NET_PCT, 0.5),        // min net-after-fee % a round trip must clear
      xchainThreshold: numOf(env.XCHAIN_THRESHOLD, 0.03),// cross-chain DEX spread worth flagging
      xchainMinLiqUsd: numOf(env.XCHAIN_MIN_LIQ, 5000),  // ignore illiquid phantom DEX pairs
      xchainSpotDev: numOf(env.XCHAIN_SPOT_DEV, 0.20),   // per-leg spot-sanity tolerance (anti-poisoned-pair)
    },

    // ── per-order execution caps (read by execute.sizeOrder + loop; NOT a daily cap) ───────────
    // These bound a SINGLE order. They are NOT the (operator-gated) daily cap or profit-skim — those
    // are intentionally absent here. Same env names execute.mjs/loop.mjs already read.
    exec: {
      maxOrderHive: numOf(env.MAX_ORDER_HIVE, 10),       // hard per-ORDER ceiling
      minOrderHive: numOf(env.MIN_ORDER_HIVE, 1),        // dust floor — skip below this
      maxBelievableEdge: numOf(env.MAX_BELIEVABLE_EDGE, 0.30), // >this = dead/stale book → reject
      // TODO(operator-gated): no DAILY_CAP_HIVE / PROFIT_SKIM here on purpose. Wiring a daily cap or a
      // profit-skim is an operator decision (it changes how much can move per day / where profit goes).
      // When the operator authorizes it, add the knob here AND the enforcement in execute/loop.
    },

    // ── VKBT outbid-ratchet market maker (price-nudge) + walls (wall-bot) ───────────────────────
    // Same MM_*/WALL_* env names price-nudge.loadConfig + wall-bot already use, so importing changes
    // nothing. ceiling/floor are null-when-unset on purpose (price-nudge HOLDs without a ceiling).
    mm: {
      nudgeIncrement: numOf(env.MM_NUDGE_INCREMENT, 0.00000001),  // one real HE tick (8-dp). NOT 1e-7 — that overshoots sub-tick prices and mis-rounds the 8th decimal.
      maxNudgesDay: numOf(env.MM_MAX_NUDGES_DAY, 10),
      nudgeInterval: numOf(env.MM_NUDGE_INTERVAL, 3600000),
      maxJump: numOf(env.MM_MAX_JUMP, 0.05),
      buyWallSize: numOf(env.MM_BUY_WALL_SIZE, 50),
      supportSize: numOf(env.MM_SUPPORT_SIZE, 25),
      minWhale: numOf(env.MM_MIN_WHALE, 100000),
      ceiling: numOrNull(env.MM_CEILING),               // null = refuse to ratchet (no fair-value cap set)
      floor: numOrNull(env.MM_FLOOR),                   // null = no defensive buy-wall floor
      ourAccounts: listOf(env.MM_OUR_ACCOUNTS, ['angelicalist', 'kalivankush']),
    },
    wall: {
      floor: numOf(env.WALL_FLOOR, 0.01),
      ceiling: numOf(env.WALL_CEILING, 0),               // 0 = no sell-wall ceiling
      size: numOf(env.WALL_SIZE, 1000),
    },

    // ── scenario-runner (what-if bot) ──────────────────────────────────────────────────────────
    scenario: {
      priorityFloor: numOf(env.SCENARIO_PRIORITY_FLOOR, 0.20), // ≥20% of daily runs cover VKBT/CURE
      cron: (env.SCENARIO_CRON || '*/15 * * * *').trim(),
    },

    // ── strategy-registry defaults (trade-strategies) — exposed so the registry can read them too.
    // These mirror the in-strategy defaults; importing them keeps the registry and this module in sync
    // without changing any strategy's behaviour (the strategy still falls back to the same number).
    strategy: {
      pegArbThreshold: numOf(env.STRAT_PEG_THRESHOLD, 0.03),
      pegArbTradeHive: numOf(env.STRAT_PEG_TRADE_HIVE, 50),
      pegArbMaxInventoryHive: numOf(env.STRAT_PEG_MAX_INV_HIVE, 500),
    },
  });
}

// Eagerly-resolved snapshot for the common case (read once at import). Modules that need live env
// changes per-call should call loadTradeConfig() instead of using this frozen snapshot.
export const TRADE_CONFIG = loadTradeConfig();

export default { loadTradeConfig, TRADE_CONFIG };

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('trade-config.mjs')) {
  const cfg = loadTradeConfig();
  console.log('Consolidated trade-config — all MM_*/ARB_*/MAX_ORDER_HIVE/SCENARIO_*/CVA_*/XCHAIN_* knobs\n' + '─'.repeat(78));
  console.log(JSON.stringify(cfg, null, 2));
  console.log('\nPure read-only resolution of env → numbers. NO key, NO daily-cap, NO profit-skim here');
  console.log('(those stay operator-gated). Same env names the existing modules read — importing changes nothing.');
}
