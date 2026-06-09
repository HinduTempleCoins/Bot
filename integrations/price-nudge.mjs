// price-nudge.mjs — VKBT OUTBID-RATCHET market maker. Drives the token price UP by COMPETING with
// rival/"troll" bots at the top of the buy book — NOT by market-buying.
//
// Operator correction 2026-06-09: "The VKBT Bot is supposed to be COMPETING with the troll bots,
// to drive them up, not buying at market. Fix it." The earlier behaviour (≈1009 dust market-buys)
// is wrong. The correct play: find the TOP COMPETING BID (the highest buy order that is NOT ours),
// and place ONE clean resting LIMIT bid one increment above it to retake best-bid and ratchet the
// price up. A HIVE-Engine `buy` with a price is a RESTING LIMIT order unless it crosses the ask —
// so we cap the target below the best ask. We only ever BUY if a troll SELLS into our bid; we never
// cross the spread ourselves.
//
// PURE core: nudgePlan({ buyBook, sellBook, ourAccounts, lastNudge, dailyCount, config }) → intents.
// Runner run(symbol, { trader, state, config }) reads the book, plans, and (dry-run default) logs.
// Execution only via the INJECTED trader (angelicalist/trader.placeOrder + cancel) when LIVE.
//
//   node integrations/price-nudge.mjs VKBT            # dry-run: print the plan
//   import { nudgePlan, run } from './price-nudge.mjs'

import { market } from './hive-engine-market.mjs';
import { wallStrategy } from './wall-bot.mjs';
import { emitBotData } from '../tools/bot-data.mjs';

const DAY_MS = 24 * 60 * 60 * 1000;

// ── config from env (honours the .env.example "VAN KUSH MARKET MAKER" knobs) ───────────────────
export function loadConfig(env = process.env, opts = {}) {
  const n = (k, d) => {
    const v = opts[k] ?? env[k];
    const f = parseFloat(v);
    return Number.isFinite(f) ? f : d;
  };
  return {
    increment: n('MM_NUDGE_INCREMENT', 0.00000010),
    maxNudgesDay: n('MM_MAX_NUDGES_DAY', 10),
    nudgeInterval: n('MM_NUDGE_INTERVAL', 3600000),
    maxJump: n('MM_MAX_JUMP', 0.05),
    buyWallSize: n('MM_BUY_WALL_SIZE', 50),
    supportSize: n('MM_SUPPORT_SIZE', 25),
    minWhale: n('MM_MIN_WHALE', 100000),
    // fair-value CEILING above which we STOP ratcheting. No default — must be supplied, else HOLD.
    ceiling: opts.ceiling != null ? +opts.ceiling
      : (env.MM_CEILING != null && env.MM_CEILING !== '' ? parseFloat(env.MM_CEILING) : null),
    // optional support FLOOR for the deeper defensive buy wall (wall-bot)
    floor: opts.floor != null ? +opts.floor
      : (env.MM_FLOOR != null && env.MM_FLOOR !== '' ? parseFloat(env.MM_FLOOR) : null),
  };
}

function norm(orders) {
  return (orders || [])
    .map((o) => ({
      price: +o.price,
      quantity: +o.quantity,
      account: o.account,
      orderId: o._id ?? o.txId ?? o.orderId ?? null,
    }))
    .filter((o) => o.quantity > 0 && Number.isFinite(o.price));
}

// round to the increment's decimal precision so prices stay on-grid and don't drift in float noise.
function gridRound(price, increment) {
  const decimals = Math.max(0, Math.round(-Math.log10(increment)));
  return +price.toFixed(decimals);
}

/**
 * PURE: decide the outbid-ratchet plan.
 *  - top competing bid = highest buy order NOT owned by us
 *  - our bids = buy orders owned by us
 *  - if we're already best by ≥1 increment over the top competitor → HOLD (winning)
 *  - else target = topCompetingBid + increment, capped just below best ask (never cross)
 *  - guards (any fail → HOLD with reason): ceiling, max-jump, daily cap, interval, target>0
 *  - cancels our stale lower bids so we keep ONE clean top bid (the key fix vs the dust pile)
 *
 * @returns {{ action, reason, intents, target?, topCompetingBid?, ourBest?, bestAsk? }}
 */
export function nudgePlan({ buyBook = [], sellBook = [], ourAccounts = [], lastNudge = 0, dailyCount = 0, now = Date.now(), config = loadConfig() } = {}) {
  const cfg = config;
  const ours = new Set((ourAccounts || []).map((a) => String(a).toLowerCase()));
  const bids = norm(buyBook).sort((a, b) => b.price - a.price);
  const asks = norm(sellBook).sort((a, b) => a.price - b.price);
  const bestAsk = asks.length ? asks[0].price : null;

  const ourBids = bids.filter((b) => ours.has(String(b.account || '').toLowerCase()));
  const competing = bids.filter((b) => !ours.has(String(b.account || '').toLowerCase()));
  const topCompeting = competing[0] || null;
  const ourBest = ourBids[0] || null;

  const hold = (reason, extra = {}) => ({ action: 'HOLD', reason, intents: [], topCompetingBid: topCompeting, ourBest, bestAsk, ...extra });

  // nothing to compete with: no rival bid in the book → hold (don't invent a price from nothing).
  if (!topCompeting) return hold('no competing bid in the book — nobody to outbid');

  // are we already winning? our best bid must beat the top competitor by ≥ one increment.
  const inc = cfg.increment;
  if (ourBest && ourBest.price >= topCompeting.price + inc - 1e-12) {
    return hold(`already best bid: ours ${ourBest.price} ≥ competitor ${topCompeting.price} + increment`);
  }

  // target = one increment above the top competing bid (ratchet up).
  let target = gridRound(topCompeting.price + inc, inc);

  // NEVER cross the ask: if target ≥ best ask, cap to just below it. If that cap can't stay above
  // the competitor (spread too tight), we can't ratchet without crossing → HOLD.
  let capped = false;
  if (bestAsk != null && target >= bestAsk) {
    target = gridRound(bestAsk - inc, inc);
    capped = true;
    if (target <= topCompeting.price + 1e-12) {
      return hold(`spread too tight: outbidding ${topCompeting.price} would cross the ask ${bestAsk}`, { bestAsk });
    }
  }
  if (!(target > 0)) return hold('computed target price is not positive');

  // ── GUARDS ──────────────────────────────────────────────────────────────────────────────────
  // fair-value CEILING: never ratchet unbounded. Required — if unset, refuse.
  if (cfg.ceiling == null || !Number.isFinite(cfg.ceiling)) {
    return hold('no fair-value ceiling configured (MM_CEILING) — refusing to ratchet unbounded');
  }
  if (target > cfg.ceiling) {
    return hold(`ceiling reached: target ${target} > ceiling ${cfg.ceiling}`, { target });
  }
  // max-jump: don't leap more than maxJump above the CURRENT best bid (whoever holds it).
  const currentBest = bids.length ? bids[0].price : topCompeting.price;
  const jumpCap = currentBest * (1 + cfg.maxJump);
  if (target > jumpCap + 1e-12) {
    return hold(`max-jump exceeded: target ${target} > ${(cfg.maxJump * 100).toFixed(0)}% over best bid ${currentBest}`, { target });
  }
  // daily cap
  if (dailyCount >= cfg.maxNudgesDay) {
    return hold(`daily cap reached: ${dailyCount}/${cfg.maxNudgesDay} nudges in 24h`, { target });
  }
  // interval since last nudge
  if (lastNudge && now - lastNudge < cfg.nudgeInterval) {
    const waitMs = cfg.nudgeInterval - (now - lastNudge);
    return hold(`interval not elapsed: ${Math.ceil(waitMs / 60000)}m until next nudge allowed`, { target });
  }

  // ── PLAN ────────────────────────────────────────────────────────────────────────────────────
  const intents = [];
  // cancel ALL our existing bids so we keep ONE clean top bid (no dust pile of stale orders).
  for (const b of ourBids) {
    if (b.orderId != null) intents.push({ action: 'CANCEL', orderId: b.orderId, price: b.price, reason: 'clear stale bid before re-bidding at top' });
  }
  intents.push({
    action: 'PLACE_LIMIT_BID',
    price: target,
    quantity: cfg.supportSize,
    reason: `outbid @${topCompeting.account} (${topCompeting.price}) by one increment${capped ? ' (capped below ask)' : ''} to retake best bid`,
  });

  // optional deeper defensive buy wall at the support floor (delegated to wall-bot).
  if (cfg.floor && cfg.buyWallSize) {
    const ws = wallStrategy({ buyBook, sellBook, floor: cfg.floor, wallSize: cfg.buyWallSize });
    const need = ws.intents.find((i) => i.action === 'PLACE_BUY_WALL');
    if (need) intents.push({ action: 'PLACE_BUY_WALL', price: need.price, quantity: need.quantity, reason: need.reason });
  }

  return { action: 'NUDGE', reason: `ratchet to ${target} (one increment over @${topCompeting.account})`, intents, target, topCompetingBid: topCompeting, ourBest, bestAsk, capped };
}

// ── injectable state (lastNudge + rolling 24h count). Default = in-memory; runner can inject fs. ──
export function emptyState() { return { lastNudge: 0, nudges: [] }; }
// keep only nudges within the last 24h, return the count.
export function dailyCountFromState(state, now = Date.now()) {
  const recent = (state.nudges || []).filter((t) => now - t < DAY_MS);
  return recent.length;
}

/**
 * Runner. Reads the book, computes the plan, logs intents. DRY-RUN by default — executes ONLY when
 * opts.live === true AND a trader is injected. The trader is angelicalist/trader (placeOrder/cancel);
 * its OWN dry-run + key gating still applies, so this is doubly safe.
 *
 * NOTE on the SWAP.LTC bleed guard in trader.runPresets(): that guard blocks one-way BUY
 * accumulation with no selling leg. It lives in runPresets(), NOT in placeOrder(). This module calls
 * placeOrder() directly for price-support bids, so the bleed guard does not (and should not) block a
 * resting support bid — a support bid is intentional one-sided price defense, not a bleed. We keep
 * VKBT out of trade-presets so the two systems don't fight.
 */
export async function run(symbol = 'VKBT', { trader = null, state = null, config = null, ourAccounts = null, live = false, now = Date.now(), bookLimit = 50, _book = null } = {}) {
  const cfg = config || loadConfig();
  const st = state || emptyState();
  const accts = ourAccounts || (process.env.MM_OUR_ACCOUNTS || 'angelicalist,kalivankush').split(',').map((s) => s.trim()).filter(Boolean);

  let buyBook = [], sellBook = [];
  if (_book) { buyBook = _book.buyBook || []; sellBook = _book.sellBook || []; }   // offline injection (tests)
  else {
    try { [buyBook, sellBook] = await Promise.all([market.buyBook(symbol, bookLimit), market.sellBook(symbol, bookLimit)]); }
    catch (e) { return { symbol, error: e.message, action: 'HOLD', reason: 'book fetch failed', intents: [] }; }
  }

  const dailyCount = dailyCountFromState(st, now);
  const plan = nudgePlan({ buyBook, sellBook, ourAccounts: accts, lastNudge: st.lastNudge, dailyCount, now, config: cfg });

  const executed = [];
  if (plan.action === 'NUDGE' && live && trader) {
    for (const i of plan.intents) {
      try {
        if (i.action === 'CANCEL' && typeof trader.cancel === 'function') {
          executed.push({ ...i, result: await trader.cancel({ symbol, orderId: i.orderId, type: 'buy' }) });
        } else if (i.action === 'PLACE_LIMIT_BID') {
          executed.push({ ...i, result: await trader.placeOrder({ side: 'buy', symbol, quantity: i.quantity, price: i.price }) });
        } else if (i.action === 'PLACE_BUY_WALL') {
          executed.push({ ...i, result: await trader.placeOrder({ side: 'buy', symbol, quantity: i.quantity, price: i.price }) });
        }
      } catch (e) { executed.push({ ...i, error: e.message }); }
    }
    // record the nudge in state (rolling window) only when we actually placed a bid live.
    st.lastNudge = now;
    st.nudges = [...(st.nudges || []).filter((t) => now - t < DAY_MS), now];
  }

  const summary = `${symbol}: ${plan.action} — ${plan.reason}` + (live && trader ? ` [LIVE: ${executed.length} ops]` : ' [dry-run]');
  try { emitBotData('price-nudge', { summary, data: { symbol, live: !!(live && trader), dailyCount, plan, executed } }); } catch { /* soft-fail */ }
  return { symbol, ...plan, dailyCount, live: !!(live && trader), executed, summary, state: st };
}

if (process.argv[1] && process.argv[1].endsWith('price-nudge.mjs')) {
  const symbol = process.argv[2] || 'VKBT';
  const cfg = loadConfig();
  const r = await run(symbol, { config: cfg, live: false }).catch((e) => ({ error: e.message }));
  console.log(`VKBT price-nudge (OUTBID-RATCHET) — ${symbol}  [dry-run / read-only]`);
  console.log('─'.repeat(64));
  if (r.error) { console.log('  error:', r.error); }
  else {
    console.log(`  ceiling: ${cfg.ceiling == null ? '(UNSET — will HOLD; set MM_CEILING)' : cfg.ceiling}  increment: ${cfg.increment}  supportSize: ${cfg.supportSize}`);
    console.log(`  top competing bid: ${r.topCompetingBid ? `${r.topCompetingBid.price} ×${r.topCompetingBid.quantity} @${r.topCompetingBid.account}` : '—'}`);
    console.log(`  our best bid:      ${r.ourBest ? `${r.ourBest.price} ×${r.ourBest.quantity}` : '—'}   best ask: ${r.bestAsk ?? '—'}`);
    console.log(`  daily nudges used: ${r.dailyCount}/${cfg.maxNudgesDay}`);
    console.log(`\n  PLAN: [${r.action}] ${r.reason}`);
    for (const i of r.intents) console.log(`    • ${i.action}${i.price != null ? ` @ ${i.price}` : ''}${i.quantity != null ? ` ×${i.quantity}` : ''}${i.orderId != null ? ` (order ${i.orderId})` : ''} — ${i.reason}`);
    console.log('\n  → NEVER a market buy. Bids REST below the ask; we buy only if a troll sells into us.');
    console.log('  → Execution gated on an injected trader + live=true + the angelicalist key (off-repo).');
  }
}
