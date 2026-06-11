/**
 * vesting-power-down.mjs — Graphene VESTS power-down schedule + conversion.
 *
 * Models the recurring "power down" (withdraw vesting) mechanic of a Graphene
 * chain: a stake of VESTS is paid out in equal weekly tranches over a fixed
 * number of weeks (Steem/Hive use 13). This is the *recurring withdrawal*, which
 * is distinct from engine/lib/lockup-schedule.mjs (one-shot token cliffs/linear
 * vests) and from karma/* (off-chain karma).
 *
 * Two concerns live here:
 *   1. powerDownSchedule / nextWithdrawal — the weekly tranche split of VESTS.
 *   2. vestsToTokens / tokensToVests — the VESTS<->backing-token rate, i.e.
 *      the "total_vesting_fund / total_vesting_shares" ratio a Graphene chain
 *      publishes. (On Steem/Hive this is the STEEM-power / VESTS price.)
 *
 * All functions are pure: no IO, no chain side effects. Soft-fail by
 * construction — NaN / negative / non-finite / missing inputs clamp to 0 or an
 * empty schedule, and nothing ever throws. Tranches are equal with the LAST
 * tranche absorbing any rounding remainder, so the conservation invariant
 *
 *     sum(vestsWithdrawn) === totalVests   (exactly)
 *
 * always holds.
 */

/** The default Graphene power-down period, in weekly tranches (Steem/Hive = 13).
 *  Configurable per call via the `weeks` argument. */
export const DEFAULT_POWER_DOWN_WEEKS = 13;

/** Coerce any input to a finite non-negative Number; NaN/negative/non-finite -> 0. */
function clampNonNeg(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return v;
}

/** Coerce any input to a non-negative integer; NaN/negative/non-finite -> 0. */
function clampNonNegInt(n) {
  return Math.floor(clampNonNeg(n));
}

/**
 * Equal weekly tranche schedule for powering down `totalVests` over `weeks`
 * tranches, beginning at week `startWeek` (default 1).
 *
 *   powerDownSchedule({ totalVests, weeks, startWeek })
 *     -> [{ week, vestsWithdrawn, vestsRemaining }]
 *
 * Each tranche withdraws floor(totalVests / weeks); the final tranche absorbs
 * the rounding remainder so the totals reconcile exactly. `vestsRemaining` is
 * the VESTS still vesting *after* that week's withdrawal (0 on the last row).
 * weeks <= 0 or totalVests <= 0 -> empty schedule.
 */
export function powerDownSchedule({ totalVests, weeks = DEFAULT_POWER_DOWN_WEEKS, startWeek = 1 } = {}) {
  const total = clampNonNeg(totalVests);
  const n = clampNonNegInt(weeks);
  const start = Math.max(1, clampNonNegInt(startWeek) || 1);
  if (total <= 0 || n <= 0) return [];

  const per = total / n;
  const rows = [];
  let withdrawnSoFar = 0;
  for (let i = 0; i < n; i++) {
    const last = i === n - 1;
    // Last tranche absorbs the remainder so the sum is exact.
    const vestsWithdrawn = last ? total - withdrawnSoFar : per;
    withdrawnSoFar += vestsWithdrawn;
    const vestsRemaining = last ? 0 : total - withdrawnSoFar;
    rows.push({
      week: start + i,
      vestsWithdrawn,
      vestsRemaining,
    });
  }
  return rows;
}

/**
 * The next pending power-down withdrawal given how many tranche-weeks have
 * already elapsed.
 *
 *   nextWithdrawal({ totalVests, weeks, weeksElapsed }) -> { vests, weeksRemaining }
 *
 * `vests` is the VESTS to be paid out at the next tranche (the remainder-bearing
 * final tranche if we are on the last week); `weeksRemaining` counts tranches
 * still owed including the next one. When the power-down is complete (or inputs
 * are degenerate) -> { vests: 0, weeksRemaining: 0 }.
 */
export function nextWithdrawal({ totalVests, weeks = DEFAULT_POWER_DOWN_WEEKS, weeksElapsed = 0 } = {}) {
  const schedule = powerDownSchedule({ totalVests, weeks });
  const elapsed = clampNonNegInt(weeksElapsed);
  if (schedule.length === 0 || elapsed >= schedule.length) {
    return { vests: 0, weeksRemaining: 0 };
  }
  const next = schedule[elapsed];
  return {
    vests: next.vestsWithdrawn,
    weeksRemaining: schedule.length - elapsed,
  };
}

/**
 * Convert VESTS to backing tokens at the chain's published vesting rate:
 *
 *   tokens = vests * (totalTokensBacking / totalVests)
 *
 *   vestsToTokens({ vests, totalVests, totalTokensBacking }) -> number
 *
 * Returns 0 when totalVests <= 0 (no meaningful rate) or any input is degenerate.
 */
export function vestsToTokens({ vests, totalVests, totalTokensBacking } = {}) {
  const v = clampNonNeg(vests);
  const tv = clampNonNeg(totalVests);
  const backing = clampNonNeg(totalTokensBacking);
  if (tv <= 0) return 0;
  return v * (backing / tv);
}

/**
 * Inverse of vestsToTokens: how many VESTS a token amount is worth at the same
 * rate.
 *
 *   vests = tokens * (totalVests / totalTokensBacking)
 *
 *   tokensToVests({ tokens, totalVests, totalTokensBacking }) -> number
 *
 * Returns 0 when totalTokensBacking <= 0 (no meaningful rate) or any input is
 * degenerate.
 */
export function tokensToVests({ tokens, totalVests, totalTokensBacking } = {}) {
  const t = clampNonNeg(tokens);
  const tv = clampNonNeg(totalVests);
  const backing = clampNonNeg(totalTokensBacking);
  if (backing <= 0) return 0;
  return t * (tv / backing);
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

// CLI: a worked example. Guarded so importing the module is side-effect free.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const totalVests = 13000;
  const weeks = DEFAULT_POWER_DOWN_WEEKS;
  const totalVestsOnChain = 1_000_000;
  const totalTokensBacking = 250_000; // backing-token fund

  const schedule = powerDownSchedule({ totalVests, weeks });
  console.log(`Power-down of ${totalVests} VESTS over ${weeks} weekly tranches:`);
  for (const row of schedule) {
    const tokens = vestsToTokens({
      vests: row.vestsWithdrawn,
      totalVests: totalVestsOnChain,
      totalTokensBacking,
    });
    console.log(
      `  week ${String(row.week).padStart(2)}: ` +
        `withdraw ${row.vestsWithdrawn.toFixed(3)} VESTS ` +
        `(~${tokens.toFixed(3)} tokens), ` +
        `remaining ${row.vestsRemaining.toFixed(3)} VESTS`,
    );
  }
  const sum = schedule.reduce((a, r) => a + r.vestsWithdrawn, 0);
  console.log(`  sum of tranches = ${sum} (conserves total: ${sum === totalVests})`);

  const next = nextWithdrawal({ totalVests, weeks, weeksElapsed: 3 });
  console.log(
    `After 3 weeks: next tranche ${next.vests.toFixed(3)} VESTS, ` +
      `${next.weeksRemaining} weeks remaining.`,
  );

  const roundTrip = tokensToVests({
    tokens: vestsToTokens({ vests: 1000, totalVests: totalVestsOnChain, totalTokensBacking }),
    totalVests: totalVestsOnChain,
    totalTokensBacking,
  });
  console.log(`Round-trip 1000 VESTS -> tokens -> VESTS = ${roundTrip}`);
}
