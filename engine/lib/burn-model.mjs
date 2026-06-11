/**
 * burn-model.mjs — pure token-burn / deflationary-supply math.
 *
 * For the "paywall / subscription burns tokens → deflationary pressure" model:
 * given a circulating supply and a stream of burns, compute the new supply, a
 * burn schedule over N periods, a geometric-decay supply projection, a
 * cross-chain burn-to-mint ratio, and a summary (total burned, final supply,
 * percent burned, half-life in periods).
 *
 * No chain, no network, no I/O. Everything is deterministic and numeric.
 *
 * Soft-fail discipline: every exported function validates its inputs and
 * returns { ok:false, error } on bad input rather than throwing. On success it
 * returns { ok:true, ... } (or the requested value alongside ok:true). NaN /
 * Infinity / negative / non-numeric inputs are treated as invalid where they
 * would corrupt the math, and clamped only where a sensible neutral exists.
 */

/** True iff x coerces to a finite number. */
function isFiniteNum(x) {
  return typeof x !== 'boolean' && Number.isFinite(Number(x));
}

/** Coerce to a finite number, or null if not finite. */
function num(x) {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

/** Coerce to a finite integer >= 0, or null. (Mirrors base-unit counts.) */
function toCount(x) {
  if (typeof x === 'boolean') return null;
  const n = Number(x);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

/**
 * applyBurn(supply, amount) -> { ok:true, supply } | { ok:false, error }
 *
 * Subtract `amount` burned tokens from circulating `supply`. Integer base-unit
 * counts. Rejects negative inputs and over-burn (amount > supply). A zero burn
 * is the identity and is allowed.
 */
export function applyBurn(supply, amount) {
  const s = toCount(supply);
  const a = toCount(amount);
  if (s === null) return { ok: false, error: 'supply must be a non-negative finite number' };
  if (a === null) return { ok: false, error: 'amount must be a non-negative finite number' };
  if (a > s) return { ok: false, error: 'over-burn: amount exceeds circulating supply' };
  return { ok: true, supply: s - a };
}

/**
 * burnSchedule({ initialSupply, burnPerPeriod, periods })
 *   -> { ok:true, schedule:[{period, burned, remaining, cumulativeBurned, pctBurned}] }
 *    | { ok:false, error }
 *
 * Fixed amount burned each period until either `periods` is reached or the
 * supply is exhausted. The final period's burn is clamped so remaining never
 * goes negative (no over-burn); once supply hits 0 the schedule stops early.
 * pctBurned is cumulativeBurned / initialSupply * 100 (0 when initialSupply 0).
 */
export function burnSchedule({ initialSupply, burnPerPeriod, periods } = {}) {
  const init = toCount(initialSupply);
  const per = toCount(burnPerPeriod);
  const n = toCount(periods);
  if (init === null) return { ok: false, error: 'initialSupply must be a non-negative finite number' };
  if (per === null) return { ok: false, error: 'burnPerPeriod must be a non-negative finite number' };
  if (n === null) return { ok: false, error: 'periods must be a non-negative finite integer' };

  const schedule = [];
  let remaining = init;
  let cumulative = 0;
  for (let p = 1; p <= n; p++) {
    if (remaining <= 0) break; // supply exhausted; stop early
    const burned = Math.min(per, remaining);
    remaining -= burned;
    cumulative += burned;
    const pctBurned = init === 0 ? 0 : (cumulative / init) * 100;
    schedule.push({ period: p, burned, remaining, cumulativeBurned: cumulative, pctBurned });
  }
  return { ok: true, schedule };
}

/**
 * projectSupply({ initialSupply, burnRatePct, periods })
 *   -> { ok:true, table:[{period, burned, remaining, cumulativeBurned, pctBurned}] }
 *    | { ok:false, error }
 *
 * Geometric decay: each period burns burnRatePct% of the *current* supply, so
 * remaining = initialSupply * (1 - r)^period. Unlike burnSchedule this keeps
 * fractional supply (Number, not floored) since it's a projection, not a ledger.
 * burnRatePct is clamped to [0, 100]. A 0% rate is the identity (no decay).
 */
export function projectSupply({ initialSupply, burnRatePct, periods } = {}) {
  const init = num(initialSupply);
  const ratePct = num(burnRatePct);
  const n = toCount(periods);
  if (init === null || init < 0) return { ok: false, error: 'initialSupply must be a non-negative finite number' };
  if (ratePct === null || ratePct < 0) return { ok: false, error: 'burnRatePct must be a non-negative finite number' };
  if (n === null) return { ok: false, error: 'periods must be a non-negative finite integer' };

  const r = Math.min(ratePct, 100) / 100; // fraction burned per period, 0..1
  const table = [];
  let remaining = init;
  let cumulative = 0;
  for (let p = 1; p <= n; p++) {
    const burned = remaining * r;
    remaining -= burned;
    cumulative += burned;
    const pctBurned = init === 0 ? 0 : (cumulative / init) * 100;
    table.push({ period: p, burned, remaining, cumulativeBurned: cumulative, pctBurned });
  }
  return { ok: true, table };
}

/**
 * burnToMintRatio({ burned, mintRate })
 *   -> { ok:true, minted } | { ok:false, error }
 *
 * Cross-chain burn-to-mint: `mintRate` tokens minted on the destination chain
 * per token burned on the source. minted = burned * mintRate. Burned must be a
 * non-negative integer base-unit count; mintRate a non-negative finite number.
 */
export function burnToMintRatio({ burned, mintRate } = {}) {
  const b = toCount(burned);
  const rate = num(mintRate);
  if (b === null) return { ok: false, error: 'burned must be a non-negative finite number' };
  if (rate === null || rate < 0) return { ok: false, error: 'mintRate must be a non-negative finite number' };
  return { ok: true, minted: b * rate };
}

/**
 * summarize(schedule)
 *   -> { ok:true, totalBurned, finalSupply, finalPctBurned, halfLifePeriods }
 *    | { ok:false, error }
 *
 * `schedule` is the array emitted by burnSchedule().schedule or
 * projectSupply().table — each row { period, burned, remaining,
 * cumulativeBurned, pctBurned }. Summarizes the last row.
 *
 * halfLifePeriods: the first period at which cumulativeBurned >= 50% of the
 * implied initial supply (final remaining + total burned). null if supply never
 * reaches half burned within the schedule (or schedule is empty).
 */
export function summarize(schedule) {
  if (!Array.isArray(schedule)) return { ok: false, error: 'schedule must be an array' };
  if (schedule.length === 0) {
    return { ok: true, totalBurned: 0, finalSupply: 0, finalPctBurned: 0, halfLifePeriods: null };
  }
  const last = schedule[schedule.length - 1];
  const totalBurned = isFiniteNum(last && last.cumulativeBurned) ? Number(last.cumulativeBurned) : 0;
  const finalSupply = isFiniteNum(last && last.remaining) ? Number(last.remaining) : 0;
  const initialSupply = finalSupply + totalBurned;
  const finalPctBurned = initialSupply === 0 ? 0 : (totalBurned / initialSupply) * 100;

  let halfLifePeriods = null;
  if (initialSupply > 0) {
    const half = initialSupply / 2;
    for (const row of schedule) {
      const cum = isFiniteNum(row && row.cumulativeBurned) ? Number(row.cumulativeBurned) : 0;
      if (cum >= half) {
        halfLifePeriods = isFiniteNum(row && row.period) ? Number(row.period) : null;
        break;
      }
    }
  }
  return { ok: true, totalBurned, finalSupply, finalPctBurned, halfLifePeriods };
}

// CLI worked example (guarded so importing this module is side-effect-free).
if (process.argv[1] && process.argv[1].endsWith('burn-model.mjs')) {
  const initialSupply = 1_000_000;
  console.log('burn-model worked example');
  console.log('  initialSupply:', initialSupply);

  const ab = applyBurn(initialSupply, 250_000);
  console.log('  applyBurn(1,000,000, 250,000):', ab);
  console.log('  applyBurn over-burn:', applyBurn(100, 200));

  const sched = burnSchedule({ initialSupply, burnPerPeriod: 100_000, periods: 12 });
  console.log('  burnSchedule (100k/period, 12 periods):');
  for (const row of sched.schedule) {
    console.log(
      `    p${row.period}: burned=${row.burned} remaining=${row.remaining} ` +
        `pctBurned=${row.pctBurned.toFixed(2)}%`,
    );
  }
  console.log('  summarize(schedule):', summarize(sched.schedule));

  const proj = projectSupply({ initialSupply, burnRatePct: 10, periods: 8 });
  console.log('  projectSupply (10%/period, 8 periods), final row:', proj.table[proj.table.length - 1]);
  console.log('  summarize(projection):', summarize(proj.table));

  console.log('  burnToMintRatio (1000 burned @ 0.5):', burnToMintRatio({ burned: 1000, mintRate: 0.5 }));
}
