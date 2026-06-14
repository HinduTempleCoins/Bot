// quick-trade-volatility.mjs — "quick trades on a volatile market" strategy (queue #189 family).
//
// ┌─ HARD SAFETY INVARIANTS (read before touching) ────────────────────────────────────────────┐
// │ • REPO-SIDE ONLY. This file does not trade, broadcast, or hold a key. `quickVol()` is a PURE  │
// │   function: snapshot + params + state → { orders, reason }. No I/O, no fetch, no fs, no clock, │
// │   no randomness. The "orders" it returns are INTENTIONS — plain objects a human or the         │
// │   (separate, gated, unbuilt) MELEK-Signer would have to review and sign.                        │
// │ • Every order is emitted through the SAME frozen shape as trade-strategies.mjs: dryRun:true,    │
// │   signer:null, with no code path that can flip either. By construction.                         │
// │ • This plugs into the trade-strategies.mjs STRATEGIES registry under the SAME decide(name,      │
// │   snapshot, params, state)→{orders,reason} contract. See the registry one-liner at file end.    │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// WHAT IT DOES — quick in-and-out on a SHORT-TERM volatility/momentum burst:
//   A volatile HE market briefly mis-prices on a velocity spike + a widening spread. quickVol detects
//   that burst, and ONLY when there is a clean two-leg path (a real entry AND a matching exit on the
//   far side of the spread) proposes a SMALL, FAST round-trip: an entry leg and a paired exit leg.
//   It NEVER proposes a one-way trade — that is the SWAP.LTC bleed lesson, encoded structurally:
//   no exit leg ⇒ no entry leg ⇒ no orders.
//
// SNAPSHOT shape (tolerant of partial data; superset of trade-strategies.mjs):
//   {
//     symbol: 'SWAP.DOGE',
//     hePrice / mid: 0.011,            // current HE mid/last (HIVE per token)
//     bid: 0.0108, ask: 0.0112,        // best bid/ask — needed for spread + a real exit leg
//     prices: [0.0100, 0.0103, 0.011], // recent price samples (oldest→newest) for velocity, optional
//     velocity: 0.08,                  // OR pre-computed short-term return over the window (fraction)
//     spread: 0.037,                   // OR pre-computed (ask-bid)/mid; else derived from bid/ask
//     baseSpread: 0.004,               // the token's normal/resting spread (fraction); for widening
//     bidDepthHive: 40, askDepthHive: 60, // executable HIVE depth at top of book (liquidity gate)
//     issuerConcentration: 0.2,        // 0..1 fraction of supply held by issuer/top holder, optional
//     ts: 1718000000000
//   }
//
// ORDER shape (identical to trade-strategies.mjs): the entry leg and the paired exit leg, both
//   { side, symbol, price, qtyToken, qtyHive, reason, strategy:'quick-vol', dryRun:true, signer:null }.
//
//   import { quickVol } from './integrations/quick-trade-volatility.mjs';
//   const { orders, reason } = quickVol(snapshot, params, state);
//
// CLI:  node integrations/quick-trade-volatility.mjs    # demo a burst, a one-way block, an illiquid reject

// ── tiny pure helpers (no I/O) — mirrors trade-strategies.mjs ─────────────────────────────────
const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
const isPos = (n) => Number.isFinite(+n) && +n > 0;
const round = (n, dp = 8) => +(+n).toFixed(dp);
const pct = (n) => `${(num(n) * 100).toFixed(2)}%`;

// freezeOrder hard-stamps the dry-run / no-signer invariant onto EVERY order. There is no path in
// this file that can set dryRun:false or attach a key — same structural guarantee as the registry.
function freezeOrder(o) {
  return Object.freeze({
    side: o.side,
    symbol: o.symbol,
    price: round(num(o.price)),
    qtyToken: round(num(o.qtyToken)),
    qtyHive: round(num(o.qtyHive)),
    reason: String(o.reason || ''),
    strategy: 'quick-vol',
    dryRun: true,   // ALWAYS. No override path exists.
    signer: null,   // ALWAYS. No key is ever attached here.
  });
}

function result(orders, reason) {
  return { orders: (orders || []).filter(Boolean).map(freezeOrder), reason: String(reason || '') };
}

// Short-term price velocity over the recent window: (newest-oldest)/oldest, signed.
// Prefers a pre-computed snapshot.velocity; else derives it from a prices[] series.
function velocityOf(snapshot) {
  const v = snapshot.velocity;
  if (Number.isFinite(+v)) return +v;
  const series = Array.isArray(snapshot.prices) ? snapshot.prices.map(num).filter(isPos) : [];
  if (series.length < 2) return NaN;
  const first = series[0];
  const last = series[series.length - 1];
  return isPos(first) ? (last - first) / first : NaN;
}

// Current spread as a fraction of mid. Prefers snapshot.spread; else (ask-bid)/mid.
function spreadOf(snapshot, mid) {
  if (Number.isFinite(+snapshot.spread)) return +snapshot.spread;
  const bid = num(snapshot.bid);
  const ask = num(snapshot.ask);
  if (isPos(bid) && isPos(ask) && isPos(mid) && ask > bid) return (ask - bid) / mid;
  return NaN;
}

/**
 * quickVol — quick in-and-out on a volatile HE market. PURE. Advisory only.
 *
 * @param {object} snapshot  see header
 * @param {object} [params]  tunables (all have conservative defaults)
 * @param {object} [state]   { inventoryHive } — current signed HIVE exposure for the bleed cap
 * @returns {{orders:Array, reason:string}}  orders frozen, dryRun:true, signer:null
 */
export function quickVol(snapshot = {}, params = {}, state = {}) {
  // soft-fail any non-object input (null / number / string / array) to a hold — never throw.
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    return result([], 'quick-vol: no usable snapshot object — hold');
  }
  if (!params || typeof params !== 'object') params = {};
  if (!state || typeof state !== 'object') state = {};
  // ── tunables (conservative by default; small + fast is the whole point) ──────────────────────
  const minVelocity = num(params.minVelocity, 0.03);        // burst trigger: ≥3% move over the window
  const widenMultiple = num(params.widenMultiple, 2);       // spread must be ≥ this × the base spread
  const tradeHive = num(params.tradeHive, 10);              // SMALL per-leg notional
  const perOrderCapHive = num(params.perOrderCapHive, 15);  // tight hard cap per order
  const maxInventoryHive = num(params.maxInventoryHive, 30);// bleed cap on standing exposure
  const minDepthMultiple = num(params.minDepthMultiple, 1.5); // need ≥ this × tradeHive executable on each side
  const maxEdge = num(params.maxEdge, 0.15);                // implausibility ceiling — reject "free money"
  const maxIssuerConcentration = num(params.maxIssuerConcentration, 0.5); // issuer-concentrated → reject
  const minNetEdge = num(params.minNetEdge, 0.005);         // round-trip must clear costs by ≥0.5% to be worth it

  const symbol = snapshot.symbol;
  const mid = num(snapshot.hePrice ?? snapshot.mid ?? ((num(snapshot.bid) + num(snapshot.ask)) / 2 || 0));
  const bid = num(snapshot.bid);
  const ask = num(snapshot.ask);

  if (!symbol || !isPos(mid)) {
    return result([], 'quick-vol: insufficient data (need symbol + a mid price) — hold');
  }

  // ── burst detection: velocity AND spread-widening must BOTH fire ─────────────────────────────
  const velocity = velocityOf(snapshot);
  if (!Number.isFinite(velocity)) {
    return result([], 'quick-vol: no velocity signal (need snapshot.velocity or prices[]) — hold');
  }
  const spread = spreadOf(snapshot, mid);
  if (!Number.isFinite(spread)) {
    return result([], 'quick-vol: no spread signal (need bid/ask or snapshot.spread) — hold');
  }
  const baseSpread = num(snapshot.baseSpread, 0);
  const absVel = Math.abs(velocity);

  if (absVel < minVelocity) {
    return result([], `quick-vol: velocity ${pct(velocity)} below ${pct(minVelocity)} trigger — flat market, no trade`);
  }
  // spread must be genuinely WIDE vs the token's resting spread (a burst, not a normal quiet book).
  if (isPos(baseSpread) && spread < baseSpread * widenMultiple) {
    return result([], `quick-vol: spread ${pct(spread)} not widened ≥${widenMultiple}× base ${pct(baseSpread)} — no burst, hold`);
  }

  // ── implausibility / phantom guards ─────────────────────────────────────────────────────────
  // Edge bigger than maxEdge is almost never real on a thin HE book — it's a phantom wall or a stale
  // quote. Refuse it rather than chase "free money" (the arb-scanner phantom-edge lesson).
  if (absVel > maxEdge || (Number.isFinite(spread) && spread > maxEdge)) {
    return result([], `quick-vol: edge implausible (velocity ${pct(velocity)} / spread ${pct(spread)} > ${pct(maxEdge)}) — phantom, reject`);
  }
  // issuer/top-holder concentrated token → one holder can rug the book mid-round-trip. Reject.
  const issuerConc = num(snapshot.issuerConcentration, 0);
  if (issuerConc > maxIssuerConcentration) {
    return result([], `quick-vol: issuer-concentrated (${pct(issuerConc)} > ${pct(maxIssuerConcentration)}) — illiquid/rug risk, reject`);
  }

  // ── liquidity gate: need real executable depth on BOTH sides (so the exit leg can actually fill) ─
  const need = tradeHive * minDepthMultiple;
  const bidDepth = num(snapshot.bidDepthHive, NaN);
  const askDepth = num(snapshot.askDepthHive, NaN);
  if (Number.isFinite(bidDepth) && Number.isFinite(askDepth) && (bidDepth < need || askDepth < need)) {
    return result([], `quick-vol: illiquid — depth bid ${bidDepth} / ask ${askDepth} HIVE below ${round(need)} needed each side, reject`);
  }

  // ── decide direction from the burst, and require a CLEAN PAIRED EXIT on the far side ─────────
  // Up-burst (velocity>0): the burst pushed price up → fade it: SELL into strength, then re-BUY lower.
  //   entry = SELL at ask (top of book), exit = BUY back at bid. Needs inventory to sell? No — this is
  //   a quote-the-spread round-trip on a book that briefly gapped; but we still require a real bid to
  //   buy back at and a real ask to sell at. If either side of the book is missing, there is no clean
  //   exit leg → block (never one-way).
  // Down-burst (velocity<0): price gapped down → BUY the dip at bid-ish, then SELL into the bounce at ask.
  const up = velocity > 0;
  if (!isPos(bid) || !isPos(ask) || !(ask > bid)) {
    return result([], 'quick-vol: no clean two-sided book (need bid<ask) — no exit leg, blocked (never one-way)');
  }

  // round-trip net edge after crossing the spread once each way is ~ (ask-bid)/mid minus a fee/slippage
  // budget. If the spread we capture does not clear minNetEdge, there is no profitable clean exit → block.
  const grossRoundTrip = (ask - bid) / mid;
  const netEdge = grossRoundTrip - minNetEdge;
  if (netEdge <= 0) {
    return result([], `quick-vol: spread ${pct(grossRoundTrip)} does not clear cost floor ${pct(minNetEdge)} — no profitable exit, block`);
  }

  // bleed cap: do not open a round-trip that pushes standing exposure past the cap.
  const invHive = num(state.inventoryHive);
  if (Math.abs(invHive) >= maxInventoryHive) {
    return result([], `quick-vol: inventory cap reached (${invHive}/${maxInventoryHive} HIVE) — hold`);
  }

  // size: small, tight per-order cap, and never push past the inventory cap on this round-trip.
  const legHive = Math.min(tradeHive, perOrderCapHive, maxInventoryHive - Math.abs(invHive));
  if (!isPos(legHive)) {
    return result([], 'quick-vol: sized to zero against the caps — hold');
  }

  // entry at the favourable top-of-book price, exit at the matching far side. qty matched across legs.
  const entryPrice = up ? ask : bid;     // up-burst: sell at ask; down-burst: buy at bid
  const exitPrice = up ? bid : ask;      // ...then close on the other side
  const qtyToken = legHive / entryPrice;
  const entrySide = up ? 'sell' : 'buy';
  const exitSide = up ? 'buy' : 'sell';

  const entry = {
    side: entrySide, symbol, price: entryPrice, qtyToken, qtyHive: round(qtyToken * entryPrice),
    reason: `quick-vol entry: ${up ? 'up' : 'down'}-burst ${pct(velocity)} on widened spread ${pct(spread)} — ${entrySide} ${legHive} HIVE at top of book`,
  };
  const exit = {
    side: exitSide, symbol, price: exitPrice, qtyToken, qtyHive: round(qtyToken * exitPrice),
    reason: `quick-vol exit (paired): ${exitSide} back the SAME ${round(qtyToken)} ${symbol} at ${exitPrice} — net ~${pct(netEdge)}, never one-way`,
  };

  return result(
    [entry, exit],
    `quick-vol: ${entrySide.toUpperCase()}→${exitSide.toUpperCase()} round-trip on ${symbol} (${pct(velocity)} burst, ${pct(netEdge)} net edge, ${legHive} HIVE)`,
  );
}

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('quick-trade-volatility.mjs')) {
  console.log('quick-trade-volatility — quick in/out on a volatile market. DRY RUN only, NO keys, NO execution');
  console.log('─'.repeat(90));
  const demos = [
    ['real burst, clean two-leg path',
      { symbol: 'SWAP.DOGE', mid: 0.011, bid: 0.0103, ask: 0.0117, baseSpread: 0.004, velocity: 0.07,
        bidDepthHive: 40, askDepthHive: 60, issuerConcentration: 0.1, ts: 1718000000000 }, {}],
    ['flat market (no burst)',
      { symbol: 'SWAP.DOGE', mid: 0.011, bid: 0.01098, ask: 0.01102, baseSpread: 0.004, velocity: 0.005,
        bidDepthHive: 40, askDepthHive: 60 }, {}],
    ['one-way / no exit leg (no bid)',
      { symbol: 'SWAP.X', mid: 0.011, ask: 0.0117, baseSpread: 0.004, velocity: 0.07,
        bidDepthHive: 40, askDepthHive: 60 }, {}],
    ['illiquid / issuer-concentrated',
      { symbol: 'SWAP.RUG', mid: 0.011, bid: 0.0103, ask: 0.0117, baseSpread: 0.004, velocity: 0.07,
        bidDepthHive: 40, askDepthHive: 60, issuerConcentration: 0.8 }, {}],
    ['phantom (implausible edge)',
      { symbol: 'SWAP.X', mid: 0.011, bid: 0.008, ask: 0.018, baseSpread: 0.004, velocity: 0.40,
        bidDepthHive: 40, askDepthHive: 60 }, {}],
  ];
  for (const [label, snap, st] of demos) {
    const { orders, reason } = quickVol(snap, {}, st);
    console.log(`\n[${label}]`);
    console.log(`  reason: ${reason}`);
    for (const o of orders) console.log(`  → ${o.side.toUpperCase()} ${o.qtyToken} ${o.symbol} @ ${o.price} (${o.qtyHive} HIVE)  dryRun=${o.dryRun} signer=${o.signer}`);
  }
  console.log('\nEvery order above is dryRun:true / signer:null by construction. Execution is a separate,');
  console.log('gated, MELEK-Signer-only concern (zero WIF on this host). This layer only DECIDES.');
}
