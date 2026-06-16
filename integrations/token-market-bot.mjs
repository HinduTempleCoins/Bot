// token-market-bot.mjs — market-maker + LP-rebalancer + tribe-curator for OUR OWN SCOT tokens.
//
// ┌─ HARD SAFETY INVARIANTS (read before touching) ────────────────────────────────────────────┐
// │ • REPO-SIDE ONLY. This module NEVER signs, NEVER broadcasts, NEVER holds a key/WIF/seed. It   │
// │   is PURE planning: orderbook/pool/post snapshots + params → a list of ACTION INTENTS (plain   │
// │   descriptor objects) that a human or the separate, gated MELEK-Signer would review and sign.  │
// │   Mirrors bridge-relayer.mjs (unsigned calls/intents only) + quick-trade-volatility.mjs        │
// │   (frozen dryRun:true / signer:null orders). By construction, no path can flip those flags.    │
// │ • SOFT-FAIL-NEVER-THROW. Every export tolerates null/garbage input and returns a safe shape    │
// │   (empty actions + a reason string), never an exception.                                        │
// │ • Network reads use an injectable fetch (__setFetch); tests run fully offline.                  │
// └────────────────────────────────────────────────────────────────────────────────────────────┘
//
// WHAT IT DOES — three decision surfaces over our own token markets:
//   1. MARKET-MAKING (Tomoyan HE market-maker pattern): quote a ladder of buy + sell orders around
//      the orderbook mid at a configured spread, so OUR tokens always have a two-sided book. Pure
//      `midPrice()` + `spreadOrders()`; the planner ladders both sides and caps total notional.
//   2. LP REBALANCING (KulaSwap AMM on PRANA): compare a pool's current token-value ratio to a
//      target and decide whether to PROVIDE or WITHDRAW liquidity to drift it back. `rebalanceLP()`.
//   3. TRIBE CURATION (NutBox-style stake → reward, SCOT autovote): pick which token-tribe posts to
//      autovote, gated on rshares + a per-tribe cap so weight spreads across the tribe. `curationPicks()`.
//
//   planActions() is the fetch-based top-level: it pulls the engine orderbook / tribe rules / payouts
//   (engine API, Hive-Engine shape) + an optional KulaSwap pool snapshot, and returns ALL the intents.
//
//   import { midPrice, spreadOrders, rebalanceLP, curationPicks, planActions, __setFetch }
//     from './integrations/token-market-bot.mjs'
//
//   node integrations/token-market-bot.mjs        # demo MM ladder / LP rebalance / curation picks

// ---- injectable fetch (parity with scot-earnings / bridge-relayer) ----------
let _fetch = (...a) => globalThis.fetch(...a);
/** Test hook — inject fetch; pass nothing to restore the global. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ---- tiny pure helpers (no I/O) ---------------------------------------------
const num = (n, d = 0) => (Number.isFinite(+n) ? +n : d);
const isPos = (n) => Number.isFinite(+n) && +n > 0;
const round = (n, dp = 8) => +(+n).toFixed(dp);
const pct = (n) => `${(num(n) * 100).toFixed(2)}%`;

// ---- order intents are frozen with the dry-run / no-signer invariant --------
// Identical guarantee to quick-trade-volatility.mjs: every order is dryRun:true / signer:null and
// there is NO code path in this file that can set either otherwise.
function freezeOrder(o) {
  return Object.freeze({
    kind: 'market-order',
    side: o.side,
    symbol: String(o.symbol || ''),
    market: String(o.market || ''),       // 'hive-engine' | 'melek-engine'
    price: round(num(o.price)),
    qtyToken: round(num(o.qtyToken)),
    qtyHive: round(num(o.qtyHive)),
    reason: String(o.reason || ''),
    strategy: 'token-market-bot',
    dryRun: true,   // ALWAYS. No override path exists.
    signer: null,   // ALWAYS. No key is ever attached here.
  });
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 1. MARKET MAKING
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * midPrice — the mid of an orderbook. PURE. Decides the reference price the MM ladder centres on.
 * Accepts a tolerant orderbook shape:
 *   { bids:[{price,quantity}|[price,qty]...], asks:[...] }  (also buyBook/sellBook, bid/ask scalars).
 * Prefers (bestBid+bestAsk)/2; falls back to a lone side, then a `last`/`mid` scalar. 0 if unknown.
 * @param {object} ob
 * @returns {number}  mid price (HIVE per token), or 0 when undeterminable
 */
export function midPrice(ob) {
  if (!ob || typeof ob !== 'object') return 0;
  const level = (x) => (Array.isArray(x) ? num(x[0]) : num(x && (x.price ?? x.rate)));
  const bids = ob.bids || ob.buyBook || ob.buy || [];
  const asks = ob.asks || ob.sellBook || ob.sell || [];
  // best bid = highest buy price; best ask = lowest sell price.
  const bestBid = Array.isArray(bids) && bids.length
    ? Math.max(...bids.map(level).filter(isPos), 0)
    : num(ob.bid ?? ob.highestBid);
  const bestAsk = Array.isArray(asks) && asks.length
    ? Math.min(...asks.map(level).filter(isPos).concat(Infinity))
    : num(ob.ask ?? ob.lowestAsk);
  if (isPos(bestBid) && isPos(bestAsk) && bestAsk >= bestBid) return round((bestBid + bestAsk) / 2);
  if (isPos(bestBid)) return round(bestBid);
  if (isPos(bestAsk) && bestAsk !== Infinity) return round(bestAsk);
  const last = num(ob.last ?? ob.lastPrice ?? ob.mid);
  return isPos(last) ? round(last) : 0;
}

/**
 * spreadOrders — a ladder of buy + sell market-maker orders around `mid`. PURE. Advisory descriptors
 * only (frozen dryRun/signer:null). Mirrors Tomoyan's HE market-maker: place several rungs each side,
 * stepping the spread outward, so OUR token always shows a two-sided book.
 *
 * @param {object} cfg
 *   mid        reference price (HIVE per token)
 *   spreadPct  half-spread at the INNERMOST rung, as a fraction (0.02 = 2% off mid each side)
 *   ladders    number of rungs PER SIDE (each rung steps the spread out by spreadPct again)
 *   size       per-rung notional in HIVE (qtyToken derived from the rung price)
 *   symbol/market  passed through onto each order
 *   maxNotionalHive  optional hard cap on TOTAL HIVE laddered across all rungs (both sides)
 * @returns {{orders:Array, reason:string}}  orders frozen; empty + reason on bad input
 */
export function spreadOrders(cfg = {}) {
  if (!cfg || typeof cfg !== 'object') return { orders: [], reason: 'mm: no config — hold' };
  const mid = num(cfg.mid);
  const spreadPct = num(cfg.spreadPct, 0.02);
  const ladders = Math.max(1, Math.floor(num(cfg.ladders, 3)));
  const size = num(cfg.size, 10);
  const symbol = cfg.symbol;
  const market = cfg.market || 'melek-engine';
  const maxNotional = num(cfg.maxNotionalHive, Infinity);

  if (!symbol || !isPos(mid)) return { orders: [], reason: 'mm: need symbol + a positive mid — hold' };
  if (!(spreadPct > 0) || spreadPct >= 1) return { orders: [], reason: `mm: spreadPct ${spreadPct} out of (0,1) — hold` };
  if (!isPos(size)) return { orders: [], reason: 'mm: per-rung size must be positive — hold' };

  const orders = [];
  let spent = 0;
  for (let i = 1; i <= ladders; i++) {
    const off = spreadPct * i;                 // rung i sits i× the half-spread off the mid
    if (off >= 1) break;                       // a buy price can never go to/below 0
    const buyPrice = round(mid * (1 - off));
    const sellPrice = round(mid * (1 + off));
    // BUY rung — pay HIVE for tokens below mid.
    if (isPos(buyPrice) && spent + size <= maxNotional) {
      orders.push({
        side: 'buy', symbol, market, price: buyPrice,
        qtyToken: round(size / buyPrice), qtyHive: round(size),
        reason: `mm buy rung ${i}/${ladders}: ${pct(off)} below mid ${mid} — quote the bid`,
      });
      spent += size;
    }
    // SELL rung — offer tokens for HIVE above mid. (qtyToken sized so its HIVE value ≈ size.)
    if (isPos(sellPrice) && spent + size <= maxNotional) {
      orders.push({
        side: 'sell', symbol, market, price: sellPrice,
        qtyToken: round(size / mid), qtyHive: round((size / mid) * sellPrice),
        reason: `mm sell rung ${i}/${ladders}: ${pct(off)} above mid ${mid} — quote the ask`,
      });
      spent += size;
    }
  }
  if (!orders.length) return { orders: [], reason: 'mm: capped to zero rungs against maxNotional — hold' };
  return {
    orders: orders.map(freezeOrder),
    reason: `mm: ${orders.length}-rung ladder on ${symbol} around mid ${mid} (±${pct(spreadPct)}/rung, ~${round(spent)} HIVE)`,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 2. LP REBALANCING (KulaSwap AMM on PRANA)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * rebalanceLP — decide whether to PROVIDE or WITHDRAW liquidity on a KulaSwap (UniswapV2-style) pool
 * to drift its token-value ratio toward a target. PURE. Returns an UNSIGNED action descriptor.
 *
 * A V2 pool holds reserveA of tokenA + reserveB of tokenB; the pool's spot price is reserveB/reserveA.
 * We track a TARGET VALUE WEIGHT for tokenA (e.g. 0.5 = a balanced 50/50 pool). The current weight is
 * valueA/(valueA+valueB) where value uses an external reference price (priceA/priceB in a common unit;
 * if omitted we fall back to the pool's own spot, in which case weight is structurally 0.5 and the only
 * signal left is the bandwidth/`addWhenBelow` provisioning rule).
 *
 * Decision:
 *   • |currentWeight − target| within `band`  → HOLD (no action).
 *   • currentWeight < target − band           → tokenA is UNDER-weighted → PROVIDE liquidity skewed to A
 *                                               (add more A) to lift its weight.
 *   • currentWeight > target + band           → tokenA is OVER-weighted → WITHDRAW (or provide skewed to B).
 *
 * @param {{reserveA:number, reserveB:number, priceA?:number, priceB?:number, pair?:string,
 *          tokenA?:string, tokenB?:string}} pool
 * @param {{target?:number, band?:number, stepHive?:number, maxStep?:number}} opts
 * @returns {{action:'hold'|'provide'|'withdraw', reason:string, intent:object|null,
 *            currentWeight:number, target:number}}
 */
export function rebalanceLP(pool = {}, opts = {}) {
  const safe = (action, reason, intent = null, cw = 0, tgt = 0.5) =>
    ({ action, reason, intent, currentWeight: round(cw, 6), target: round(tgt, 6) });
  if (!pool || typeof pool !== 'object') return safe('hold', 'lp: no pool snapshot — hold');

  const rA = num(pool.reserveA);
  const rB = num(pool.reserveB);
  if (!isPos(rA) || !isPos(rB)) return safe('hold', 'lp: pool reserves missing/zero — hold');

  const target = Math.min(0.99, Math.max(0.01, num(opts.target, 0.5)));
  const band = Math.max(0, num(opts.band, 0.05));
  const stepHive = num(opts.stepHive, 10);
  const maxStep = num(opts.maxStep, 100);

  // value weight of tokenA. If external prices are given, use them; else fall back to pool spot
  // (which makes valueA == valueB by definition, so weight = 0.5 — a neutral, no-edge reading).
  const pA = num(pool.priceA);
  const pB = num(pool.priceB);
  let valueA, valueB;
  if (isPos(pA) && isPos(pB)) { valueA = rA * pA; valueB = rB * pB; }
  else { const spot = rB / rA; valueA = rA * spot; valueB = rB; } // == valueB; weight 0.5
  const totalValue = valueA + valueB;
  if (!isPos(totalValue)) return safe('hold', 'lp: pool total value zero — hold', null, 0, target);
  const currentWeight = valueA / totalValue;

  const drift = currentWeight - target;
  const pair = pool.pair || `${pool.tokenA || 'A'}/${pool.tokenB || 'B'}`;
  if (Math.abs(drift) <= band) {
    return safe('hold', `lp: weight ${pct(currentWeight)} within ±${pct(band)} of target ${pct(target)} on ${pair} — hold`, null, currentWeight, target);
  }

  // size the rebalance proportional to the drift, capped.
  const stepValue = Math.min(maxStep, stepHive * (Math.abs(drift) / Math.max(band, 1e-9)));
  if (drift < 0) {
    // tokenA under-weighted → add liquidity skewed toward A.
    return safe('provide',
      `lp: tokenA weight ${pct(currentWeight)} below target ${pct(target)} on ${pair} — PROVIDE liquidity skewed to ${pool.tokenA || 'A'}`,
      {
        kind: 'lp-provide', dex: 'kulaswap', chain: 'prana', pair,
        tokenA: pool.tokenA, tokenB: pool.tokenB,
        skewToward: pool.tokenA || 'A', notionalHive: round(stepValue),
        router: 'KulaSwap.Router.addLiquidity', unsigned: true,
      }, currentWeight, target);
  }
  // tokenA over-weighted → withdraw liquidity (or rebalance out of A).
  return safe('withdraw',
    `lp: tokenA weight ${pct(currentWeight)} above target ${pct(target)} on ${pair} — WITHDRAW liquidity / rebalance out of ${pool.tokenA || 'A'}`,
    {
      kind: 'lp-withdraw', dex: 'kulaswap', chain: 'prana', pair,
      tokenA: pool.tokenA, tokenB: pool.tokenB,
      reduceToward: pool.tokenB || 'B', notionalHive: round(stepValue),
      router: 'KulaSwap.Router.removeLiquidity', unsigned: true,
    }, currentWeight, target);
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// 3. TRIBE CURATION (SCOT autovote — NutBox-style stake → reward)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

/**
 * curationPicks — choose which token-tribe posts to autovote. PURE. Returns vote INTENTS only.
 *
 * NutBox/SCOT framing: holders stake the tribe token for governance weight; the curator (Hathor) votes
 * tribe posts to seed the reward pool toward genuine content. We pick posts above an rshares floor,
 * skip already-voted ones, prefer fresher posts inside the reverse-auction window (so curation lands at
 * the optimal time, ~5 min on the MELEK fork), and cap per tribe so weight spreads, not concentrates.
 *
 * @param {Array} posts  [{author, permlink, tribe?|symbol?, rshares|netRshares, ageMinutes?,
 *                          alreadyVoted?}, ...]
 * @param {{minRshares?:number, perTribe?:number, weight?:number, maxAgeMinutes?:number,
 *          optimalMinutes?:number}} opts
 * @returns {{picks:Array, reason:string, skipped:Array}}
 */
export function curationPicks(posts, opts = {}) {
  if (!Array.isArray(posts)) return { picks: [], reason: 'curation: posts not an array — hold', skipped: [] };
  const minRshares = num(opts.minRshares, 0);
  const perTribe = Math.max(1, Math.floor(num(opts.perTribe, 3)));
  const weight = Math.min(10000, Math.max(1, Math.floor(num(opts.weight, 10000)))); // vote weight bps
  const maxAge = num(opts.maxAgeMinutes, 0);        // 0 = no max-age gate
  const optimalMin = num(opts.optimalMinutes, 5);   // reverse-auction sweet spot on this fork

  const skipped = [];
  // normalise + filter
  const eligible = [];
  for (const p of posts) {
    if (!p || typeof p !== 'object' || !p.author || !p.permlink) { skipped.push({ ref: p, reason: 'malformed-post' }); continue; }
    if (p.alreadyVoted) { skipped.push({ ref: `${p.author}/${p.permlink}`, reason: 'already-voted' }); continue; }
    const rsh = num(p.rshares ?? p.netRshares ?? p.weight);
    if (!(rsh > minRshares)) { skipped.push({ ref: `${p.author}/${p.permlink}`, reason: `rshares ${rsh} <= floor ${minRshares}` }); continue; }
    const age = num(p.ageMinutes, NaN);
    if (maxAge > 0 && Number.isFinite(age) && age > maxAge) { skipped.push({ ref: `${p.author}/${p.permlink}`, reason: `age ${age}m > max ${maxAge}m` }); continue; }
    eligible.push({ p, rsh, age });
  }

  // rank: highest rshares first; among similar, closeness to the optimal vote window wins.
  const score = (e) => {
    const ageScore = Number.isFinite(e.age) ? 1 / (1 + Math.abs(e.age - optimalMin)) : 0.5;
    return e.rsh * (0.5 + 0.5 * ageScore);
  };
  eligible.sort((a, b) => score(b) - score(a));

  // per-tribe cap so curation weight spreads across tribes, not piles on one.
  const counts = new Map();
  const picks = [];
  for (const e of eligible) {
    const tribe = String(e.p.tribe || e.p.symbol || 'untribed').toUpperCase();
    const c = counts.get(tribe) || 0;
    if (c >= perTribe) { skipped.push({ ref: `${e.p.author}/${e.p.permlink}`, reason: `per-tribe cap ${perTribe} reached for ${tribe}` }); continue; }
    counts.set(tribe, c + 1);
    picks.push(Object.freeze({
      kind: 'vote-intent',
      author: e.p.author,
      permlink: e.p.permlink,
      tribe,
      weight,                         // vote weight in basis points (10000 = 100%)
      rshares: round(e.rsh, 0),
      ageMinutes: Number.isFinite(e.age) ? round(e.age, 2) : null,
      reason: `curate ${tribe}: rshares ${round(e.rsh, 0)}${Number.isFinite(e.age) ? `, age ${round(e.age, 1)}m` : ''} — autovote @ ${weight / 100}%`,
      strategy: 'token-market-bot',
      dryRun: true,
      signer: null,
    }));
  }
  return {
    picks,
    reason: picks.length
      ? `curation: ${picks.length} pick(s) across ${counts.size} tribe(s) (floor ${minRshares}, ${perTribe}/tribe)`
      : `curation: no post cleared the floor (${eligible.length} eligible, all capped/skipped)`,
    skipped,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// TOP-LEVEL PLANNER (fetch-based; soft-fails to empty)
// ═══════════════════════════════════════════════════════════════════════════════════════════════

async function getJson(url) {
  try { const r = await _fetch(url); if (!r || !r.ok) return null; return await r.json(); } catch { return null; }
}

/**
 * planActions — fetch the live engine orderbook / tribe payouts (+ optional KulaSwap pool snapshot)
 * and return ALL the intended actions: MM ladder + LP rebalance + curation picks. NEVER signs/sends.
 *
 * @param {{engineApi?:string, market?:'melek-engine'|'hive-engine', symbol?:string, tribe?:string,
 *          pool?:object}} src
 *   engineApi  base URL of the MELEK-Engine read API (e.g. https://engine.alpha.melek.salon)
 *   symbol     the token whose market we make + curate
 *   tribe      tribe symbol for the curation payouts feed (defaults to `symbol`)
 *   pool       optional KulaSwap pool snapshot ({reserveA,reserveB,...}) for the LP leg
 * @param {object} [opts]  { mm:{spreadPct,ladders,size,maxNotionalHive}, lp:{target,band,...},
 *                           curation:{minRshares,perTribe,weight,...} }
 * @returns {Promise<{ok:boolean, symbol, actions:object[], market:object, lp:object|null,
 *                     curation:object, reason:string}>}
 */
export async function planActions(src = {}, opts = {}) {
  const safe = (reason, extra = {}) => ({
    ok: false, symbol: src && src.symbol, actions: [],
    market: { orders: [], reason }, lp: null, curation: { picks: [], reason, skipped: [] },
    reason, ...extra,
  });
  if (!src || typeof src !== 'object') return safe('plan: no source object');
  const symbol = String(src.symbol || '').toUpperCase();
  if (!symbol) return safe('plan: no symbol');
  const market = src.market || 'melek-engine';
  const base = String(src.engineApi || '').replace(/\/$/, '');
  const o = opts && typeof opts === 'object' ? opts : {};

  const actions = [];

  // ── 1. market making: fetch the orderbook, mid → ladder ───────────────────
  let mm = { orders: [], reason: 'mm: no engineApi — skipped' };
  if (base) {
    // engine exposes book under /contracts/orderbook or /api/orderbook; tolerate either shape.
    const ob = await getJson(`${base}/contracts/orderbook?symbol=${encodeURIComponent(symbol)}`)
      || await getJson(`${base}/api/orderbook?symbol=${encodeURIComponent(symbol)}`)
      || {};
    const mid = midPrice(ob);
    mm = isPos(mid)
      ? spreadOrders({ mid, symbol, market, ...(o.mm || {}) })
      : { orders: [], reason: 'mm: no determinable mid from orderbook — skipped' };
    actions.push(...mm.orders);
  }

  // ── 2. LP rebalance: only if a pool snapshot was provided ─────────────────
  let lp = null;
  if (src.pool && typeof src.pool === 'object') {
    lp = rebalanceLP(src.pool, o.lp || {});
    if (lp.intent) actions.push(lp.intent);
  }

  // ── 3. curation: fetch the tribe payouts, pick what to autovote ───────────
  let curation = { picks: [], reason: 'curation: no engineApi — skipped', skipped: [] };
  if (base) {
    const tribe = String(src.tribe || symbol).toUpperCase();
    const pays = await getJson(`${base}/contracts/payouts?symbol=${encodeURIComponent(tribe)}`)
      || await getJson(`${base}/api/payouts?symbol=${encodeURIComponent(tribe)}`)
      || [];
    // live engine returns a bare array; tolerate {posts}/{result} too.
    const list = Array.isArray(pays) ? pays : ((pays && (pays.posts || pays.result)) || []);
    // map the payout row shape onto curationPicks' post shape.
    const posts = (Array.isArray(list) ? list : []).map((p) => ({
      author: p.author,
      permlink: p.permlink,
      tribe,
      rshares: p.rshares ?? p.rewardWeight ?? p.weight ?? p.votes,
      ageMinutes: p.ageMinutes,
      alreadyVoted: p.alreadyVoted ?? (Array.isArray(p.voters) ? p.voters.includes(o.curator || 'hathor') : false),
    }));
    curation = curationPicks(posts, o.curation || {});
    actions.push(...curation.picks);
  }

  return {
    ok: actions.length > 0,
    symbol, market: mm, lp, curation, actions,
    reason: `plan(${symbol}): ${mm.orders.length} MM order(s), ${lp ? (lp.action === 'hold' ? 'LP hold' : '1 LP ' + lp.action) : 'no LP'}, ${curation.picks.length} curation pick(s)`,
  };
}

export default { midPrice, spreadOrders, rebalanceLP, curationPicks, planActions, __setFetch };

// ═══════════════════════════════════════════════════════════════════════════════════════════════
// CLI (guarded) — demo only; no network, no keys.
// ═══════════════════════════════════════════════════════════════════════════════════════════════
if (process.argv[1] && process.argv[1].endsWith('token-market-bot.mjs')) {
  console.log('token-market-bot — MM ladder + LP rebalance + tribe curation. DRY RUN only, NO keys, NO execution');
  console.log('─'.repeat(96));

  const ob = { bids: [{ price: 0.098, quantity: 100 }, { price: 0.095, quantity: 200 }],
    asks: [{ price: 0.102, quantity: 120 }, { price: 0.106, quantity: 180 }] };
  const mid = midPrice(ob);
  console.log(`\n[market making] mid = ${mid}`);
  const mm = spreadOrders({ mid, symbol: 'APIS', market: 'melek-engine', spreadPct: 0.02, ladders: 3, size: 10, maxNotionalHive: 50 });
  console.log(`  reason: ${mm.reason}`);
  for (const o of mm.orders) console.log(`  → ${o.side.toUpperCase().padEnd(4)} ${o.qtyToken} ${o.symbol} @ ${o.price} (${o.qtyHive} HIVE)  dryRun=${o.dryRun} signer=${o.signer}`);

  console.log('\n[LP rebalance] KulaSwap pool, target 50/50');
  for (const [label, pool] of [
    ['balanced (hold)', { reserveA: 1000, reserveB: 1000, priceA: 1, priceB: 1, tokenA: 'KULA', tokenB: 'PRANA' }],
    ['A under-weighted', { reserveA: 600, reserveB: 1400, priceA: 1, priceB: 1, tokenA: 'KULA', tokenB: 'PRANA' }],
    ['A over-weighted', { reserveA: 1500, reserveB: 500, priceA: 1, priceB: 1, tokenA: 'KULA', tokenB: 'PRANA' }],
  ]) {
    const r = rebalanceLP(pool, { target: 0.5, band: 0.05, stepHive: 10 });
    console.log(`  [${label}] ${r.action} — ${r.reason}`);
  }

  console.log('\n[curation] tribe posts');
  const posts = [
    { author: 'alice', permlink: 'p1', tribe: 'APIS', rshares: 5e9, ageMinutes: 5 },
    { author: 'bob', permlink: 'p2', tribe: 'APIS', rshares: 8e9, ageMinutes: 30 },
    { author: 'carol', permlink: 'p3', tribe: 'APIS', rshares: 2e7, ageMinutes: 5 },   // below floor
    { author: 'dave', permlink: 'p4', tribe: 'SCROLL', rshares: 6e9, ageMinutes: 5, alreadyVoted: true },
    { author: 'eve', permlink: 'p5', tribe: 'SCROLL', rshares: 4e9, ageMinutes: 5 },
  ];
  const cur = curationPicks(posts, { minRshares: 5e7, perTribe: 2, weight: 5000 });
  console.log(`  reason: ${cur.reason}`);
  for (const p of cur.picks) console.log(`  → VOTE @${p.author}/${p.permlink} [${p.tribe}] ${p.weight / 100}% — ${p.reason}`);

  console.log('\nEvery order/vote above is dryRun:true / signer:null by construction. Execution is a separate,');
  console.log('gated, MELEK-Signer-only concern (zero WIF on this host). This layer only DECIDES.');
}
