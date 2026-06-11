// integrations/spend-gate.mjs
//
// Spend-budget + cooldown gate (PURE).
//
// Encodes the capital-protection rules from ITINERARY items 130-138
// (daily budget cap, micro-push sizing, major/micro cooldowns) as a
// deterministic decision function the price-pusher / wall-bot can
// consult BEFORE acting. No network, no keys, no IO, no clock —
// `nowMs` is always supplied by the caller.
//
// Soft-fail contract: bad / missing inputs never throw; they return
// { allow:false, reason:'invalid-input', ... }.
//
// House style: ESM .mjs, exported API, soft-fail-never-throw.

const HOUR_MS = 3600e3;

const isFiniteNum = (n) => typeof n === 'number' && Number.isFinite(n);
const isNonNegNum = (n) => isFiniteNum(n) && n >= 0;

// UTC day key as a stable string, e.g. "2026-06-11". Used for day-rollover.
export function dayKeyOf(nowMs) {
  if (!isFiniteNum(nowMs)) return null;
  const d = new Date(nowMs);
  if (Number.isNaN(d.getTime())) return null;
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function makeGate(opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};

  // Config with defaults. Coerce only sane numbers; fall back otherwise.
  const cfg = {
    dailyBudgetHive: isNonNegNum(o.dailyBudgetHive) ? o.dailyBudgetHive : 35,
    majorCooldownMs: isNonNegNum(o.majorCooldownMs) ? o.majorCooldownMs : 6 * HOUR_MS,
    microCooldownMs: isNonNegNum(o.microCooldownMs) ? o.microCooldownMs : 1 * HOUR_MS,
    microPushHive: isNonNegNum(o.microPushHive) ? o.microPushHive : 0.0001,
    maxPctIncreasePerSession: isNonNegNum(o.maxPctIncreasePerSession) ? o.maxPctIncreasePerSession : 0.05,
  };

  // remaining budget for the day, clamped at 0.
  function remaining(spentTodayHive) {
    if (!isNonNegNum(spentTodayHive)) return cfg.dailyBudgetHive;
    return Math.max(0, cfg.dailyBudgetHive - spentTodayHive);
  }

  // resetIfNewDay: tells the caller whether the persisted day key has
  // rolled over so it can zero the spent-today counter. Pure.
  function resetIfNewDay(nowMs, lastDayKey) {
    const dayKey = dayKeyOf(nowMs);
    if (dayKey === null) {
      // bad clock input: do not claim a new day, echo back what we got.
      return { newDay: false, dayKey: lastDayKey ?? null };
    }
    const newDay = dayKey !== lastDayKey;
    return { newDay, dayKey };
  }

  // check: the core decision. Returns a structured verdict, never throws.
  function check(input = {}) {
    const i = (input && typeof input === 'object') ? input : {};
    const {
      nowMs,
      action,
      amountHive,
      spentTodayHive,
      lastActionMs,
      lastPrice,
      proposedPrice,
    } = i;

    const fail = (reason, extra = {}) => ({
      allow: false,
      reason,
      remainingBudgetHive: isNonNegNum(spentTodayHive) ? remaining(spentTodayHive) : cfg.dailyBudgetHive,
      cooldownRemainingMs: 0,
      ...extra,
    });

    // --- input validation (soft-fail) ---
    if (!isFiniteNum(nowMs)) return fail('invalid-input');
    if (action !== 'major' && action !== 'micro') return fail('invalid-input');
    if (!isNonNegNum(spentTodayHive)) return fail('invalid-input');

    // For micro pushes, amount defaults to the configured micro size.
    let amount = amountHive;
    if (action === 'micro' && amount === undefined) amount = cfg.microPushHive;
    if (!isNonNegNum(amount)) return fail('invalid-input');

    const remainingBudgetHive = remaining(spentTodayHive);
    const cooldownMs = action === 'major' ? cfg.majorCooldownMs : cfg.microCooldownMs;

    // --- cooldown check ---
    // lastActionMs may be absent/null => no prior action => cooldown elapsed.
    let cooldownRemainingMs = 0;
    if (lastActionMs !== undefined && lastActionMs !== null) {
      if (!isFiniteNum(lastActionMs)) return fail('invalid-input');
      const elapsed = nowMs - lastActionMs;
      // A future lastActionMs (negative elapsed) is treated as full cooldown.
      const remMs = cooldownMs - Math.max(0, elapsed);
      cooldownRemainingMs = Math.max(0, remMs);
    }
    if (cooldownRemainingMs > 0) {
      return {
        allow: false,
        reason: 'cooldown',
        remainingBudgetHive,
        cooldownRemainingMs,
      };
    }

    // --- price-jump check (spam / runaway protection) ---
    // Only applies when both prices are provided and form a meaningful pair.
    if (lastPrice !== undefined && lastPrice !== null) {
      if (!isFiniteNum(lastPrice) || !isFiniteNum(proposedPrice)) return fail('invalid-input');
      if (lastPrice > 0) {
        const pct = (proposedPrice - lastPrice) / lastPrice;
        // tiny epsilon so a price exactly AT the limit is not rejected by
        // floating-point representation error (e.g. 1.05/1.0 -> 0.05000...4).
        const EPS = 1e-9;
        if (pct > cfg.maxPctIncreasePerSession + EPS) {
          return {
            allow: false,
            reason: 'price-jump',
            remainingBudgetHive,
            cooldownRemainingMs: 0,
          };
        }
      }
    } else if (proposedPrice !== undefined && proposedPrice !== null) {
      // proposedPrice supplied without a baseline: must still be a number.
      if (!isFiniteNum(proposedPrice)) return fail('invalid-input');
    }

    // --- budget check ---
    if (amount > remainingBudgetHive) {
      return {
        allow: false,
        reason: 'budget-exceeded',
        remainingBudgetHive,
        cooldownRemainingMs: 0,
      };
    }

    // all gates passed
    return {
      allow: true,
      reason: 'ok',
      remainingBudgetHive,
      cooldownRemainingMs: 0,
    };
  }

  return {
    config: { ...cfg },
    check,
    remaining,
    resetIfNewDay,
    dayKeyOf,
  };
}

const spendGate = { makeGate, dayKeyOf };
export default spendGate;
