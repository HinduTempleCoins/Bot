/**
 * lockup-schedule.mjs — pure vesting/lockup schedule calculator.
 *
 * For the long-lock token designs in the backlog (e.g. the PUCO 900-day lock,
 * id 6788b3b2be). All math is integer base-unit math in the spirit of
 * decimal.mjs: `total` is a count of the smallest unit, and every result is an
 * exact integer split of that total. No floats touch a balance — proportional
 * splits use BigInt and floor toward `locked`, so the conservation invariant
 *
 *     locked + unlocked === total   (exactly; remainder goes to locked)
 *
 * always holds. Soft-fail by construction: NaN / negative / non-finite inputs
 * clamp to 0, currentDay past the end fully vests, nothing ever throws.
 *
 * This is a calculator, not a transfer mechanism — it computes "how much is
 * unlocked at day N". It performs no IO and has no chain side effects.
 */

/** Coerce any input to a non-negative integer; NaN/negative/non-finite -> 0. */
function clampNonNegInt(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.floor(v);
}

/**
 * Coerce a quantity to a non-negative BigInt count of base units.
 * NaN/negative/non-finite/fractional-noise -> 0n. Accepts BigInt, integer
 * Number, or an all-digits string.
 */
function clampBaseUnits(n) {
  if (typeof n === 'bigint') return n < 0n ? 0n : n;
  if (typeof n === 'string') {
    const s = n.trim();
    if (!/^\d+$/.test(s)) return 0n;
    return BigInt(s);
  }
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0n;
  return BigInt(Math.floor(v));
}

/**
 * Cliff unlock: nothing unlocks until `elapsedDays >= lockDays`, then the full
 * amount unlocks at once.
 *
 *   cliffUnlock({ total, lockDays, elapsedDays }) -> { locked, unlocked }
 *
 * locked + unlocked === total exactly.
 */
export function cliffUnlock({ total, lockDays, elapsedDays } = {}) {
  const t = clampBaseUnits(total);
  const lock = clampNonNegInt(lockDays);
  const elapsed = clampNonNegInt(elapsedDays);
  const reached = elapsed >= lock;
  const unlocked = reached ? t : 0n;
  const locked = t - unlocked;
  return { locked, unlocked };
}

/**
 * Linear vesting: nothing before `startDay`; proportional between start and
 * start + durationDays; fully vested at/after the end.
 *
 *   linearVest({ total, startDay, durationDays, currentDay }) -> { vested, remaining }
 *
 * vested + remaining === total exactly. The proportional split floors toward
 * `remaining` (vested = floor(total * progressDays / durationDays)), so a
 * partial day never over-vests; the rounding remainder stays locked.
 * durationDays <= 0 means an instantaneous unlock at startDay.
 */
export function linearVest({ total, startDay, durationDays, currentDay } = {}) {
  const t = clampBaseUnits(total);
  const start = clampNonNegInt(startDay);
  const duration = clampNonNegInt(durationDays);
  const current = clampNonNegInt(currentDay);

  let vested;
  if (current < start) {
    vested = 0n;
  } else if (duration <= 0 || current >= start + duration) {
    // instantaneous unlock at start, or past the end -> fully vested
    vested = t;
  } else {
    const progress = BigInt(current - start); // 1..duration-1
    vested = (t * progress) / BigInt(duration); // floor division
  }
  const remaining = t - vested;
  return { vested, remaining };
}

/**
 * Deterministic milestone table for a linear vest from day 0 over
 * `durationDays`, sampled at `steps` evenly spaced points plus the endpoint.
 *
 *   scheduleTable({ total, durationDays, steps }) -> [{ day, cumulativeUnlocked }]
 *
 * Rows are sorted by day, the final row is always { day: durationDays,
 * cumulativeUnlocked: total }, and cumulativeUnlocked is non-decreasing. With
 * steps <= 0 or durationDays <= 0 the table is the single fully-unlocked row at
 * day = durationDays.
 */
export function scheduleTable({ total, durationDays, steps } = {}) {
  const t = clampBaseUnits(total);
  const duration = clampNonNegInt(durationDays);
  const n = clampNonNegInt(steps);

  if (duration <= 0 || n <= 0) {
    return [{ day: duration, cumulativeUnlocked: t }];
  }

  const days = new Set();
  for (let i = 1; i <= n; i++) {
    days.add(Math.floor((duration * i) / n));
  }
  days.add(duration); // always include the endpoint

  const rows = [...days]
    .filter((d) => d >= 0 && d <= duration)
    .sort((a, b) => a - b)
    .map((day) => {
      const { vested } = linearVest({
        total: t,
        startDay: 0,
        durationDays: duration,
        currentDay: day,
      });
      return { day, cumulativeUnlocked: vested };
    });

  // Guarantee the final row reaches `total` exactly.
  if (rows.length === 0) {
    rows.push({ day: duration, cumulativeUnlocked: t });
  } else {
    rows[rows.length - 1].cumulativeUnlocked = t;
  }
  return rows;
}

/** Escape a string for safe HTML interpolation. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
