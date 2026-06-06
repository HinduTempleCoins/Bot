// trade-strategies.mjs — the STRATEGY LAYER for a standing, strategy-driven trade bot (queue #189).
//
// ┌─ HARD SAFETY INVARIANTS (read before touching) ────────────────────────────────────────────┐
// │ • REPO-SIDE ONLY. Nothing here trades, broadcasts, or holds a key. Every `decide()` is a     │
// │   PURE function: snapshot + params + state → { orders, reason }. No I/O, no fetch, no fs,     │
// │   no clock, no randomness. The "orders" it returns are INTENTIONS — plain objects a human or  │
// │   the (separate, gated, unbuilt) MELEK-Signer would have to review and sign.                   │
// │ • Every order carries `dryRun: true` and `signer: null`. There is no code path in this file   │
// │   that can set dryRun:false or attach a key — by construction (see freezeOrder).              │
// │ • The autonomous live trade bot is a SEPARATE system we do not touch. This layer exists so    │
// │   its DATA can be replayed (trade-backtest.mjs) and so a future signer-gated bot has a tested,│
// │   forkable strategy brain. zero-WIF-on-host holds: no WIF is ever read, stored, or referenced.│
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// SNAPSHOT shape (whatever the readers in integrations/ can produce; tolerant of partial data):
//   {
//     symbol: 'SWAP.DOGE',          // the HE/market symbol the strategy is acting on
//     hePrice: 0.012,               // HIVE-Engine mid/last price (HIVE per token)
//     realUsd: 0.085,               // real-asset price in USD (price-oracle), optional
//     hiveUsd: 0.30,                // HIVE/USD, optional (needed to value realUsd vs hePrice)
//     bid: 0.0118, ask: 0.0122,     // best bid/ask on HE, optional
//     ts: 1718000000               // snapshot timestamp (ms), optional — informational only
//   }
//
// ORDER shape every strategy emits (all advisory; the bot/signer decides whether to ever act):
//   { side: 'buy'|'sell', symbol, price, qtyToken, qtyHive, reason, dryRun:true, signer:null, strategy }
//
//   import { STRATEGIES, decide } from './integrations/trade-strategies.mjs';
//   const { orders, reason } = decide('peg-arb', snapshot, params, state);
//
// CLI:  node integrations/trade-strategies.mjs        # list strategies + a demo decision each
//
// ┌─ VERDICT — what the data supports trying first, and what the AI layer should feed in ───────┐
// │ TRY FIRST: **peg-arb**. It is the only family with a positive track record in the on-chain   │
// │   forensics (the SWAP.BLURT / SWAP.DOGE arbitrage that actually worked). It is structurally   │
// │   two-sided — there is always a thesis for closing the position (the peg reconverges) — so it  │
// │   does not drift into the one-way accumulation that cost the operator −6,424 HIVE on SWAP.LTC. │
// │   On the bundled mean-reversion fixture it returns ~+3% net of fees+slippage; on the          │
// │   deliberately-adverse "bleed" fixture (a token that looks cheap vs a STALE peg and keeps      │
// │   falling) the inventory cap throttles new buys and bounds the loss to single digits instead   │
// │   of an unbounded drain. Keep `threshold` ≥ 3% and `maxInventoryHive` conservative.           │
// │ SECOND TIER (range-bound, capped): **grid** and sell-biased **market-make** earn the chop in   │
// │   a sideways book; both are inventory-capped and the MM is deliberately sell-leaning so the    │
// │   book net-distributes. Use only when a token is genuinely range-bound — neither is for trend. │
// │ USE WITH CARE: **dca** (only ever as a hard-budget-capped accumulation of a token you WANT to   │
// │   hold) and **momentum** (single-unit, no pyramiding) — both are accumulation-prone and only    │
// │   safe because of their structural caps. Treat them as opt-in, not the default.                │
// │ WHAT THE AI-SUGGESTION LAYER SHOULD FEED IN (ai-trade-suggest.mjs sits on top of this):        │
// │   • a confident, multi-source `realUsd` + `hiveUsd` (price-oracle) so peg-arb has a real peg;  │
// │   • EXECUTABLE depth (from arb-scanner) so it does not chase phantom thin-book edges;          │
// │   • current `inventoryToken` / `inventoryHive` (tradebot-forensics holdings) so the caps bite; │
// │   • a jurisdiction/risk read per token; the AI writes the rationale, never the order.          │
// │ The AI never sets size or side here — the deterministic decide() does. The AI only RANKS which  │
// │ strategy×token to run and explains why; execution stays gated, MELEK-Signer-only, unbuilt.     │
// └────────────────────────────────────────────────────────────────────────────────────────────┘

// ── tiny pure helpers (no I/O) ───────────────────────────────────────────────────────────────
const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
const isPos = (n) => Number.isFinite(+n) && +n > 0;
const round = (n, dp = 8) => +(+n).toFixed(dp);

// freezeOrder is the ONLY way an order leaves this module. It hard-stamps the dry-run /
// no-signer invariant onto every order, overriding anything a strategy or params tried to set.
// Nothing in this file can produce a live, signer-attached order — that is the structural guarantee.
function freezeOrder(o, strategy) {
  return Object.freeze({
    side: o.side,
    symbol: o.symbol,
    price: round(num(o.price)),
    qtyToken: round(num(o.qtyToken)),
    qtyHive: round(num(o.qtyHive)),
    reason: String(o.reason || ''),
    strategy,
    dryRun: true,   // ALWAYS. No override path exists.
    signer: null,   // ALWAYS. No key is ever attached here.
  });
}

// Build a {orders, reason} result, freezing every order. `orders` may be empty (a hold).
function result(orders, reason, strategy) {
  return { orders: (orders || []).filter(Boolean).map((o) => freezeOrder(o, strategy)), reason: String(reason || '') };
}

// Value of a HE price (HIVE per token) in USD, if we have HIVE/USD.
function heUsd(snapshot) {
  const he = num(snapshot.hePrice ?? snapshot.mid ?? ((num(snapshot.bid) + num(snapshot.ask)) / 2 || 0));
  const hiveUsd = num(snapshot.hiveUsd);
  return { he, heUsd: he * hiveUsd, hiveUsd };
}

// ── 1. PEG-ARBITRAGE — the proven family (SWAP.BLURT / SWAP.DOGE arbitrage) ───────────────────
// A HE SWAP.X token should track the real asset. When the HE price (in USD) drifts from the real
// USD price by more than `threshold`, fade the gap: HE cheap → BUY on HE; HE rich → SELL on HE.
// This is the ONLY family with a positive track record in the forensics (the bleed was elsewhere).
// Two-sided by nature: it always has a thesis for closing the position (the peg reconverges), so
// it does NOT trip the one-way-accumulation bleed-guard the way a bare momentum BUY would.
function pegArb(snapshot, params = {}, state = {}) {
  const threshold = num(params.threshold, 0.03);     // 3% min edge to act
  const tradeHive = num(params.tradeHive, 50);       // HIVE to deploy per signal
  const maxInventoryHive = num(params.maxInventoryHive, 500); // never accumulate past this (bleed cap)
  const { he, heUsd: heInUsd, hiveUsd } = heUsd(snapshot);
  const realUsd = num(snapshot.realUsd);
  if (!isPos(he) || !isPos(hiveUsd) || !isPos(realUsd)) {
    return result([], 'peg-arb: insufficient price data (need hePrice, hiveUsd, realUsd)', 'peg-arb');
  }
  const edge = (realUsd - heInUsd) / heInUsd; // >0 → HE underpriced vs real → BUY HE; <0 → SELL HE
  const invHive = num(state.inventoryHive); // signed HIVE value of current position (+long token)
  if (edge >= threshold) {
    // HE cheap → BUY token on HE. Respect the inventory cap (the anti-bleed limit).
    if (invHive >= maxInventoryHive) {
      return result([], `peg-arb: ${pct(edge)} buy edge but inventory cap reached (${invHive}/${maxInventoryHive} HIVE) — hold`, 'peg-arb');
    }
    const spendHive = Math.min(tradeHive, maxInventoryHive - invHive);
    const qtyToken = spendHive / he;
    return result(
      [{ side: 'buy', symbol: snapshot.symbol, price: he, qtyToken, qtyHive: spendHive,
         reason: `HE underpriced ${pct(edge)} vs real ($${realUsd}) — buy the peg gap` }],
      `peg-arb: BUY ${snapshot.symbol} (${pct(edge)} edge, ${spendHive} HIVE)`, 'peg-arb');
  }
  if (edge <= -threshold) {
    // HE rich → SELL token on HE. Only sell what we hold (no shorting on a spot AMM/book).
    const holdToken = num(state.inventoryToken);
    if (!isPos(holdToken)) {
      return result([], `peg-arb: ${pct(edge)} sell edge but no inventory to sell — hold (no shorting)`, 'peg-arb');
    }
    const sellToken = Math.min(holdToken, tradeHive / he);
    return result(
      [{ side: 'sell', symbol: snapshot.symbol, price: he, qtyToken: sellToken, qtyHive: sellToken * he,
         reason: `HE overpriced ${pct(edge)} vs real ($${realUsd}) — sell into the peg gap` }],
      `peg-arb: SELL ${snapshot.symbol} (${pct(edge)} edge)`, 'peg-arb');
  }
  return result([], `peg-arb: |${pct(edge)}| edge below ${pct(threshold)} threshold — hold`, 'peg-arb');
}

// ── 2. GRID — ladder of buys below / sells above a center price ───────────────────────────────
// Profits from oscillation in a range. Emits the SINGLE rung that the current price has reached
// (one decision per snapshot): price at/below a buy rung → BUY; at/above a sell rung → SELL.
// Range-bound only — explicitly NOT for a trending market (will accumulate on a one-way drop),
// so it carries a hard inventory cap. Caller advances `state.filledRungs` between calls.
function grid(snapshot, params = {}, state = {}) {
  const center = num(params.center, num(snapshot.hePrice));
  const step = num(params.step, 0.02);               // 2% spacing per rung
  const rungs = Math.max(1, Math.floor(num(params.rungs, 5)));
  const tradeHive = num(params.tradeHivePerRung, 20);
  const maxInventoryHive = num(params.maxInventoryHive, tradeHive * rungs);
  const price = num(snapshot.hePrice ?? snapshot.mid);
  if (!isPos(center) || !isPos(price)) return result([], 'grid: need center + current price', 'grid');
  const filled = new Set((state.filledRungs || []).map(String));
  const drift = (price - center) / center; // negative → below center (buy zone)
  const rung = Math.round(drift / step);   // which rung the price is at (… -2,-1,0,1,2 …)
  if (rung <= -1 && Math.abs(rung) <= rungs && !filled.has(`b${rung}`)) {
    if (num(state.inventoryHive) >= maxInventoryHive) {
      return result([], `grid: buy rung ${rung} hit but inventory cap reached — hold`, 'grid');
    }
    const qtyToken = tradeHive / price;
    return result(
      [{ side: 'buy', symbol: snapshot.symbol, price, qtyToken, qtyHive: tradeHive,
         reason: `grid buy rung ${rung} (${pct(drift)} below center)` }],
      `grid: BUY rung ${rung}`, 'grid');
  }
  if (rung >= 1 && rung <= rungs && !filled.has(`s${rung}`)) {
    const holdToken = num(state.inventoryToken);
    if (!isPos(holdToken)) return result([], `grid: sell rung ${rung} hit but nothing to sell — hold`, 'grid');
    const sellToken = Math.min(holdToken, tradeHive / price);
    return result(
      [{ side: 'sell', symbol: snapshot.symbol, price, qtyToken: sellToken, qtyHive: sellToken * price,
         reason: `grid sell rung ${rung} (${pct(drift)} above center)` }],
      `grid: SELL rung ${rung}`, 'grid');
  }
  return result([], `grid: price at rung ${rung} — no unfilled rung to act on`, 'grid');
}

// ── 3. MARKET-MAKING (SELL-BIASED) — quote both sides, lean to distribute inventory ──────────
// Posts a bid below mid and an ask above mid to earn the spread. Deliberately SELL-BIASED per the
// brief: the ask is tighter (more aggressive) than the bid, and the bid is suppressed/withdrawn as
// inventory rises, so the book net-distributes rather than net-accumulates (the bleed lesson again).
function marketMake(snapshot, params = {}, state = {}) {
  const spread = num(params.spread, 0.02);           // total quoted spread (2%)
  const sellBias = num(params.sellBias, 0.6);        // 0.5 = symmetric; >0.5 = lean sell
  const tradeHive = num(params.tradeHive, 20);
  const maxInventoryHive = num(params.maxInventoryHive, 300);
  const mid = num(snapshot.hePrice ?? snapshot.mid ?? ((num(snapshot.bid) + num(snapshot.ask)) / 2 || 0));
  if (!isPos(mid)) return result([], 'market-make: need a mid price', 'market-make');
  const half = spread / 2;
  // sell-biased: ask sits closer to mid (sells more readily); bid sits further (buys reluctantly)
  const askPrice = round(mid * (1 + half * (1 - (sellBias - 0.5))));
  const bidPrice = round(mid * (1 - half * (1 + (sellBias - 0.5))));
  const orders = [];
  const holdToken = num(state.inventoryToken);
  const invHive = num(state.inventoryHive);
  // always quote an ask if we have anything to sell (distribute)
  if (isPos(holdToken)) {
    const askToken = Math.min(holdToken, tradeHive / askPrice);
    orders.push({ side: 'sell', symbol: snapshot.symbol, price: askPrice, qtyToken: askToken, qtyHive: askToken * askPrice,
      reason: `MM ask ${pct(half)} above mid (sell-biased ${sellBias})` });
  }
  // only quote a bid while under the inventory cap — suppress it as we fill up (anti-bleed)
  if (invHive < maxInventoryHive) {
    const bidToken = tradeHive / bidPrice;
    orders.push({ side: 'buy', symbol: snapshot.symbol, price: bidPrice, qtyToken: bidToken, qtyHive: tradeHive,
      reason: `MM bid ${pct(half)} below mid (suppressed near cap)` });
  }
  if (!orders.length) return result([], 'market-make: nothing to sell and at inventory cap — no quotes', 'market-make');
  return result(orders, `market-make: ${orders.map((o) => o.side).join('+')} around mid ${mid}`, 'market-make');
}

// ── 4. DCA — dollar-cost average: fixed HIVE per interval, schedule-driven ────────────────────
// The least clever, most robust accumulation family. Buys a fixed HIVE amount once per interval.
// Because it is open-ended accumulation, it is HARD-CAPPED by totalBudgetHive — once the budget is
// spent it stops dead (this is the structural guard against a DCA turning into the SWAP.LTC bleed).
function dca(snapshot, params = {}, state = {}) {
  const buyHive = num(params.buyHive, 10);
  const totalBudgetHive = num(params.totalBudgetHive, 100);
  const intervalMs = num(params.intervalMs, 86400000); // default daily
  const price = num(snapshot.hePrice ?? snapshot.mid);
  if (!isPos(price)) return result([], 'dca: need a price', 'dca');
  const spent = num(state.spentHive);
  if (spent >= totalBudgetHive) return result([], `dca: budget exhausted (${spent}/${totalBudgetHive} HIVE) — done`, 'dca');
  // schedule guard: if caller supplies lastBuyTs + snapshot.ts, enforce the interval; else act.
  const lastTs = num(state.lastBuyTs, NaN);
  const nowTs = num(snapshot.ts, NaN);
  if (Number.isFinite(lastTs) && Number.isFinite(nowTs) && nowTs - lastTs < intervalMs) {
    return result([], `dca: interval not elapsed (${nowTs - lastTs}ms < ${intervalMs}ms) — hold`, 'dca');
  }
  const spend = Math.min(buyHive, totalBudgetHive - spent);
  const qtyToken = spend / price;
  return result(
    [{ side: 'buy', symbol: snapshot.symbol, price, qtyToken, qtyHive: spend,
       reason: `DCA buy ${spend} HIVE (spent ${spent}/${totalBudgetHive})` }],
    `dca: BUY ${spend} HIVE of ${snapshot.symbol}`, 'dca');
}

// ── 5. MOMENTUM — trade in the direction of a short-vs-long signal ────────────────────────────
// Goes long when fast > slow by `enter`, exits when it crosses back. State carries the position.
// Momentum is the family most prone to one-way accumulation, so it is strictly bounded: a single
// position unit (no pyramiding), an inventory cap, and it will ONLY emit a BUY when flat — never
// stacking. The bleed-guard lives in the structure: you cannot add to a winner here.
function momentum(snapshot, params = {}, state = {}) {
  const enter = num(params.enter, 0.02);     // fast must exceed slow by this to go long
  const exit = num(params.exit, 0.0);        // cross back below this → flatten
  const tradeHive = num(params.tradeHive, 50);
  const fast = num(snapshot.fast ?? snapshot.smaFast, NaN);
  const slow = num(snapshot.slow ?? snapshot.smaSlow, NaN);
  const price = num(snapshot.hePrice ?? snapshot.mid);
  if (!Number.isFinite(fast) || !Number.isFinite(slow) || !isPos(slow) || !isPos(price)) {
    return result([], 'momentum: need fast + slow + price', 'momentum');
  }
  const signal = (fast - slow) / slow; // >0 uptrend
  const inPosition = num(state.inventoryToken) > 0;
  if (!inPosition && signal >= enter) {
    const qtyToken = tradeHive / price;
    return result(
      [{ side: 'buy', symbol: snapshot.symbol, price, qtyToken, qtyHive: tradeHive,
         reason: `momentum entry: fast ${pct(signal)} over slow` }],
      `momentum: ENTER long ${snapshot.symbol}`, 'momentum');
  }
  if (inPosition && signal <= exit) {
    const holdToken = num(state.inventoryToken);
    return result(
      [{ side: 'sell', symbol: snapshot.symbol, price, qtyToken: holdToken, qtyHive: holdToken * price,
         reason: `momentum exit: signal ${pct(signal)} crossed below ${pct(exit)}` }],
      `momentum: EXIT long ${snapshot.symbol}`, 'momentum');
  }
  return result([], `momentum: signal ${pct(signal)} — ${inPosition ? 'hold long' : 'stay flat'}`, 'momentum');
}

function pct(n) { return `${(num(n) * 100).toFixed(2)}%`; }

// ── registry ─────────────────────────────────────────────────────────────────────────────────
export const STRATEGIES = Object.freeze({
  'peg-arb': { decide: pegArb, label: 'Peg arbitrage (proven)', proven: true,
    note: 'Fade HE-vs-real price gaps. The only positive-track-record family in the forensics.' },
  'grid': { decide: grid, label: 'Grid (range-bound)', proven: false,
    note: 'Ladder buys/sells around a center. Range-bound only; inventory-capped.' },
  'market-make': { decide: marketMake, label: 'Market-making (sell-biased)', proven: false,
    note: 'Quote both sides for the spread, leaning sell so the book net-distributes.' },
  'dca': { decide: dca, label: 'DCA (budget-capped)', proven: false,
    note: 'Fixed HIVE per interval. Hard budget cap is the anti-bleed guard.' },
  'momentum': { decide: momentum, label: 'Momentum (single-unit)', proven: false,
    note: 'Trend-follow fast-vs-slow. No pyramiding; one unit only.' },
});

/**
 * Run a strategy's pure decision function. Soft-fails to an empty hold on any error.
 *
 * @param {string} name  one of Object.keys(STRATEGIES)
 * @param {object} snapshot  market snapshot (see header)
 * @param {object} [params]  strategy tunables
 * @param {object} [state]   carried position/budget state (inventoryToken, inventoryHive, spentHive…)
 * @returns {{orders:Array, reason:string}}  orders are frozen, dryRun:true, signer:null
 */
export function decide(name, snapshot = {}, params = {}, state = {}) {
  const s = STRATEGIES[name];
  if (!s) return result([], `unknown strategy '${name}'`, name);
  try {
    return s.decide(snapshot || {}, params || {}, state || {});
  } catch (e) {
    return result([], `${name}: error ${e && e.message ? e.message : e} — soft-fail to hold`, name);
  }
}

// List strategy names + metadata (for the backtester CLI and any menu).
export function listStrategies() {
  return Object.entries(STRATEGIES).map(([name, s]) => ({ name, label: s.label, proven: s.proven, note: s.note }));
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('trade-strategies.mjs')) {
  console.log('Trade STRATEGY layer — pure decision functions, dry-run only, NO keys, NO execution');
  console.log('─'.repeat(82));
  const demoSnap = { symbol: 'SWAP.DOGE', hePrice: 0.011, realUsd: 0.085, hiveUsd: 0.30, bid: 0.0108, ask: 0.0112,
    fast: 0.0115, slow: 0.011, mid: 0.011, ts: 1718000000000 };
  const demoState = { inventoryToken: 100, inventoryHive: 50, spentHive: 0 };
  for (const { name, label, proven } of listStrategies()) {
    const { orders, reason } = decide(name, demoSnap, {}, demoState);
    console.log(`\n[${name}] ${label}${proven ? '  ★ proven' : ''}`);
    console.log(`  reason: ${reason}`);
    for (const o of orders) console.log(`  → ${o.side.toUpperCase()} ${o.qtyToken} ${o.symbol} @ ${o.price} (${o.qtyHive} HIVE)  dryRun=${o.dryRun} signer=${o.signer}`);
  }
  console.log('\nEvery order above is dryRun:true / signer:null by construction. Execution is a separate,');
  console.log('gated, MELEK-Signer-only concern (zero WIF on this host). This layer only DECIDES.');
}
