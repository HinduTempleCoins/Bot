// price-push-plan.mjs — PURE, READ-ONLY patient price-push PLANNER. No network, no keys.
//
// Backlog 9286d74c92 / queue items 52/130/131/132. Composes wall-cost's costToPush
// output into a *patient* push schedule:
//
//   - "major" push  = buy THROUGH the sell wall to lift the floor toward targetPrice,
//                      but only when the wall cost fits a small per-push USD budget AND
//                      the major-cooldown (default 6h) has elapsed since the last major.
//   - "micro" push  = a tiny anchor buy (default 0.0001 of value, a single rung) placed
//                      when a major isn't warranted yet but the micro-cooldown (default 1h)
//                      has elapsed since the last micro. Keeps a visible bid present.
//   - "wait"        = neither is eligible; returns the soonest eligibleAt timestamp.
//
// The planner only *plans*. It never broadcasts, never signs, never touches the chain.
// Deterministic given the timestamps you pass in. Soft-fails to {action:'wait'} on any
// bad input — it never throws.
//
//   node integrations/price-push-plan.mjs   (runs a fixture)

import { costToPush } from './wall-cost.mjs';

// Defaults (overridable per-call).
export const MICRO_AMOUNT = 0.0001;        // micro-anchor size (queue item 52)
export const MAJOR_COOLDOWN_MS = 6 * 60 * 60 * 1000;  // 6h between major pushes
export const MICRO_COOLDOWN_MS = 1 * 60 * 60 * 1000;  // 1h between micro pushes

function num(x) {
  const n = +x;
  return Number.isFinite(n) ? n : NaN;
}

// cooldownRemaining: how long (ms) until a cooldown window elapses, given the last
// action timestamp, the window length, and now. Never negative; 0 means eligible now.
// A missing/invalid lastTs means "never acted" → eligible now → 0. Soft-fails to 0.
export function cooldownRemaining(lastTs, windowMs, nowTs) {
  const last = num(lastTs);
  const win = num(windowMs);
  const now = num(nowTs);
  if (!Number.isFinite(now)) return 0;
  if (!Number.isFinite(win) || win <= 0) return 0;
  if (!Number.isFinite(last)) return 0; // never acted → eligible
  const elapsed = now - last;
  if (elapsed >= win) return 0;
  const remaining = win - elapsed;
  return remaining > 0 ? remaining : 0;
}

// affordable: is a USD cost within the per-push budget? Soft-fails to false.
export function affordable(costUsd, maxUsd) {
  const cost = num(costUsd);
  const max = num(maxUsd);
  if (!Number.isFinite(cost) || !Number.isFinite(max)) return false;
  if (max <= 0) return false;
  if (cost < 0) return false;
  return cost <= max;
}

// nextAction: decide the next patient push action.
//
//   {
//     book,            // raw sell-side order book (array of {price, quantity})
//     currentFloor,    // current low ask (optional; informational)
//     targetPrice,     // price to lift the floor toward (in HIVE/quote terms)
//     lastMajorTs,     // ms timestamp of the last major push (or null/undefined)
//     lastMicroTs,     // ms timestamp of the last micro push (or null/undefined)
//     nowTs,           // ms "now"
//     hivePerUsd,      // HIVE per 1 USD — converts wall HIVE cost into USD
//     maxUsdPerPush,   // per-push USD budget cap
//     microAmount,     // override micro size (default MICRO_AMOUNT)
//     majorCooldownMs, // override major cooldown (default 6h)
//     microCooldownMs, // override micro cooldown (default 1h)
//   }
//
// Returns:
//   {
//     action: 'major' | 'micro' | 'wait',
//     reason: string,
//     estCostHive: number,   // HIVE the action would spend (best estimate)
//     estCostUsd: number,    // that cost in USD
//     eligibleAt: number|null// for 'wait', the ms timestamp the soonest action unlocks
//   }
//
// Logic (in order):
//   1. Compute wall cost-to-push from the book toward targetPrice.
//   2. MAJOR if the wall cost in USD is affordable (<= maxUsdPerPush) AND the major
//      cooldown has elapsed.
//   3. else MICRO (anchor) if the micro cooldown has elapsed.
//   4. else WAIT, reporting the soonest of the two relevant cooldowns as eligibleAt.
//
// Pure, deterministic, soft-fails to {action:'wait', reason:'bad-input', ...} on garbage.
export function nextAction(opts = {}) {
  const fail = (reason) => ({
    action: 'wait',
    reason,
    estCostHive: 0,
    estCostUsd: 0,
    eligibleAt: null,
  });

  if (!opts || typeof opts !== 'object') return fail('bad-input');

  const {
    book,
    targetPrice,
    lastMajorTs,
    lastMicroTs,
    nowTs,
    hivePerUsd,
    maxUsdPerPush,
  } = opts;

  const now = num(nowTs);
  if (!Number.isFinite(now)) return fail('bad-input');

  const microAmount = Number.isFinite(+opts.microAmount) && +opts.microAmount > 0
    ? +opts.microAmount : MICRO_AMOUNT;
  const majorCooldownMs = Number.isFinite(+opts.majorCooldownMs) && +opts.majorCooldownMs > 0
    ? +opts.majorCooldownMs : MAJOR_COOLDOWN_MS;
  const microCooldownMs = Number.isFinite(+opts.microCooldownMs) && +opts.microCooldownMs > 0
    ? +opts.microCooldownMs : MICRO_COOLDOWN_MS;

  const hpu = num(hivePerUsd);
  const budget = num(maxUsdPerPush);

  // costToPush soft-fails internally; this gives {hiveCost, ordersConsumed, newFloor}.
  const wall = costToPush(book, targetPrice);
  const wallHive = Number.isFinite(wall.hiveCost) ? wall.hiveCost : 0;

  // Convert HIVE cost → USD. hivePerUsd is HIVE per 1 USD, so USD = HIVE / hivePerUsd.
  const usdFromHive = (hive) =>
    (Number.isFinite(hpu) && hpu > 0) ? hive / hpu : NaN;

  const majorRemaining = cooldownRemaining(lastMajorTs, majorCooldownMs, now);
  const microRemaining = cooldownRemaining(lastMicroTs, microCooldownMs, now);

  // --- MAJOR? ---
  // Only if there's actually a wall to push (ordersConsumed > 0), the USD cost is
  // affordable, and the major cooldown has elapsed.
  const wallUsd = usdFromHive(wallHive);
  const canAffordMajor =
    wall.ordersConsumed > 0 &&
    Number.isFinite(wallUsd) &&
    affordable(wallUsd, budget);

  if (canAffordMajor && majorRemaining === 0) {
    return {
      action: 'major',
      reason: 'wall affordable and major cooldown elapsed',
      estCostHive: wallHive,
      estCostUsd: wallUsd,
      eligibleAt: now,
    };
  }

  // --- MICRO (anchor)? ---
  // The micro is a tiny anchor at/near the floor. Its HIVE cost ≈ microAmount * floor
  // price (a single small rung). Falls back to just microAmount in HIVE if no floor.
  const floorPrice =
    Number.isFinite(+wall.newFloor) && +wall.newFloor > 0 ? +wall.newFloor
    : (Number.isFinite(+opts.currentFloor) && +opts.currentFloor > 0 ? +opts.currentFloor
    : NaN);
  const microHive = Number.isFinite(floorPrice) ? microAmount * floorPrice : microAmount;
  const microUsd = usdFromHive(microHive);

  if (microRemaining === 0) {
    return {
      action: 'micro',
      reason: canAffordMajor
        ? 'major on cooldown; placing micro anchor'
        : 'wall not affordable; placing micro anchor',
      estCostHive: microHive,
      estCostUsd: Number.isFinite(microUsd) ? microUsd : 0,
      eligibleAt: now,
    };
  }

  // --- WAIT ---
  // Soonest eligible: if the wall is affordable, the major unlocks at majorRemaining;
  // otherwise only the micro can fire, unlocking at microRemaining. Report the soonest
  // of the relevant cooldowns.
  const candidates = [];
  if (canAffordMajor) candidates.push(majorRemaining);
  candidates.push(microRemaining); // micro is always a possible next action
  const soonest = Math.min(...candidates);
  const eligibleAt = now + soonest;

  return {
    action: 'wait',
    reason: canAffordMajor
      ? 'wall affordable but both cooldowns active'
      : 'wall not affordable and micro on cooldown',
    estCostHive: canAffordMajor ? wallHive : microHive,
    estCostUsd: canAffordMajor
      ? (Number.isFinite(wallUsd) ? wallUsd : 0)
      : (Number.isFinite(microUsd) ? microUsd : 0),
    eligibleAt,
  };
}

if (process.argv[1] && process.argv[1].endsWith('price-push-plan.mjs')) {
  const book = [
    { price: 0.0100, quantity: 100 },
    { price: 0.0120, quantity: 250 },
    { price: 0.0150, quantity: 400 },
    { price: 0.0200, quantity: 1000 },
  ];
  const HOUR = 60 * 60 * 1000;
  const now = 10_000_000_000;
  console.log('Patient price-push planner (pure, no network, no keys)');

  // Affordable wall + cooldowns elapsed → major.
  const a = nextAction({
    book, targetPrice: 0.0150,
    lastMajorTs: now - 7 * HOUR, lastMicroTs: now - 2 * HOUR,
    nowTs: now, hivePerUsd: 3, maxUsdPerPush: 5,
  });
  console.log('  major case  :', a.action, '-', a.reason, `($${a.estCostUsd.toFixed(4)})`);

  // Major on cooldown but micro free → micro.
  const b = nextAction({
    book, targetPrice: 0.0150,
    lastMajorTs: now - 1 * HOUR, lastMicroTs: now - 2 * HOUR,
    nowTs: now, hivePerUsd: 3, maxUsdPerPush: 5,
  });
  console.log('  micro case  :', b.action, '-', b.reason);

  // Both on cooldown → wait, with eligibleAt.
  const c = nextAction({
    book, targetPrice: 0.0150,
    lastMajorTs: now - 1 * HOUR, lastMicroTs: now - 0.5 * HOUR,
    nowTs: now, hivePerUsd: 3, maxUsdPerPush: 5,
  });
  console.log('  wait case   :', c.action, '-', c.reason, 'eligibleAt +' +
    ((c.eligibleAt - now) / HOUR).toFixed(2) + 'h');

  // Unaffordable wall, micro free → micro anchor.
  const d = nextAction({
    book, targetPrice: 0.0150,
    lastMajorTs: now - 7 * HOUR, lastMicroTs: now - 2 * HOUR,
    nowTs: now, hivePerUsd: 3, maxUsdPerPush: 0.001,
  });
  console.log('  unaffordable:', d.action, '-', d.reason);

  console.log('  cooldownRemaining(now-30m, 1h, now) =',
    (cooldownRemaining(now - 0.5 * HOUR, HOUR, now) / HOUR).toFixed(2) + 'h');
  console.log('  affordable(4, 5) =', affordable(4, 5), ' affordable(9, 5) =', affordable(9, 5));
  console.log('  bad input → ', nextAction(null).action);
}
