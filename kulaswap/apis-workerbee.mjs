// apis-workerbee.mjs — "WorkerBee" virtual mining for KULA: LOCK wMELEK → passively MINT APIS over time.
//
// THE MECHANIC (Hive-Engine WORKERBEE / BeeSwarm, re-mapped to MELEK):
//   Hive-Engine: stake WORKERBEE → each tick a stake-weighted lottery mints BEE; expected BEE per tick
//                ∝ yourStake / totalStake × emission.
//   MELEK/KULA:  LOCK wMELEK (= the staked WORKERBEE miner) → passively MINT APIS (= the mined BEE).
//                Locked wMELEK is the "virtual miner"; APIS drips at your stake-weighted share of emission.
//
//   This is the REASON to lock wMELEK: a passive APIS yield. It is NOT a loan (cf. kula-cdp.mjs, which
//   borrows wMELEK against KULA) — so there is NO debt, NO liquidation, NO cycle/loop risk. You lock, you
//   accrue, you claim, you (optionally, after any lock period) unlock. Nothing is owed.
//
// WHAT THIS MODULE IS: the PURE, LAYER-AGNOSTIC mechanics (rate math, accrual checkpoints, the per-tick
// stake-weighted lottery with INJECTED rng for determinism, lock-period enforcement, a UI fragment).
// It is the off-chain tuner + the canonical math that BOTH candidate on-chain layers (PRANA contract or
// engine-side staking) must agree with. See APIS_WORKERBEE.md for the layer decision + on-chain wiring.
//
// House style (matches kula-cdp.mjs / kula-farm.mjs): pure arithmetic, soft-fail to safe shapes, NEVER
// throws, NO network, NO deps, NO Math.random in the module (rng is injected for the lottery). esc() all
// HTML interpolation. node:test offline suite in apis-workerbee.test.mjs.

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };
const SECONDS_PER_DAY = 86400;

// ── Default WorkerBee params (off-chain mirror of the on-chain constructor args) ───────────────────────
// emissionPerDay — total APIS minted per day across ALL locked wMELEK (the pool emission). Split
//                  pro-rata by stake share, exactly like BeeSwarm's per-tick emission.
// lockDays       — minimum lock before wMELEK can be unlocked (0 = unlock anytime; "forever" = a far
//                  lockUntil, see claimable()). The miner keeps accruing while locked.
// halvingDays    — optional: emissionPerDay halves every `halvingDays` (0 / falsy = no halving). Mirrors
//                  a BEE-style decaying emission. Applied at the period granularity in apisAccrued.
export const DEFAULT_WORKERBEE = Object.freeze({
  emissionPerDay: 1000,  // 1000 APIS/day across the whole virtual hive
  lockDays: 0,           // generic default; the canonical MELEK model is FOREVER (see below)
  halvingDays: 0,        // no halving by default
});

// The canonical MELEK model (operator 2026-06-16): wMELEK is FOREVER-LOCKED — there is no unstake.
// Forever-locked wMELEK mints APIS-Hash (the permanent mining-power unit, the staked-WORKERBEE
// equivalent), and APIS-Hash mines APIS forever. Use these for the real mechanic.
export const FOREVER = Infinity;
/** Forever-lock state for `stakedWmelek` (no unstake; mines APIS forever). lockUntil=Infinity. */
export function foreverLock(stakedWmelek, opts = {}) {
  return { stakedWmelek: Math.max(0, +stakedWmelek || 0), lockUntil: FOREVER, ...opts };
}
/**
 * apisHash — the permanent mining-power minted by forever-locking wMELEK (the WORKERBEE equivalent),
 * 1:1 with the locked wMELEK. This is what mines APIS; it is non-redeemable (the wMELEK is locked forever).
 */
export function apisHash(stakedWmelek) { const n = +stakedWmelek; return Number.isFinite(n) && n > 0 ? n : 0; }

/**
 * apisRate — your APIS/day = emissionPerDay × (yourStake / totalStake).
 * The expected-value drip: the deterministic share BeeSwarm pays you on average.
 * Soft-fails to 0 on bad/zero inputs (no stake, no pool, no emission).
 */
export function apisRate({ stakedWmelek, totalStaked, emissionPerDay = DEFAULT_WORKERBEE.emissionPerDay } = {}) {
  const s = nn(stakedWmelek), t = nn(totalStaked), e = nn(emissionPerDay);
  if (s <= 0 || t <= 0 || e <= 0) return 0;
  const share = Math.min(1, s / t); // your own stake is part of the total; share ∈ (0,1]
  return round(e * share, 8);
}

/**
 * apisAccrued — APIS minted over `days` at your stake share. Linear in time when no halving.
 * With halvingDays set, emission halves every halvingDays; we integrate piecewise across whole-and-
 * fractional halving periods so the total is exact and deterministic. Soft-fails to 0.
 */
export function apisAccrued({
  stakedWmelek, totalStaked,
  emissionPerDay = DEFAULT_WORKERBEE.emissionPerDay,
  days, halvingDays = DEFAULT_WORKERBEE.halvingDays,
} = {}) {
  const d = nn(days);
  if (d <= 0) return 0;
  const baseRate = apisRate({ stakedWmelek, totalStaked, emissionPerDay });
  if (baseRate <= 0) return 0;
  const hv = nn(halvingDays);
  if (hv <= 0) return round(baseRate * d, 8);

  // Piecewise halving: rate in period k (0-indexed) is baseRate / 2^k, each period hv days long.
  let remaining = d, k = 0, total = 0;
  // cap iterations so a tiny halvingDays can't loop unbounded; after ~60 halvings the rate is dust.
  while (remaining > 0 && k < 64) {
    const span = Math.min(remaining, hv);
    total += (baseRate / Math.pow(2, k)) * span;
    remaining -= span;
    k += 1;
  }
  return round(total, 8);
}

/**
 * expectedMine — expected APIS minted for `stake` of `totalStake` over one tick of `emissionPerTick`.
 * This is the lottery's EXPECTED VALUE: E[mined] = emissionPerTick × stake/totalStake. lotteryDraw
 * realizes the variance around this; over many fair draws the average converges here. Soft-fails to 0.
 */
export function expectedMine({ stake, totalStake, emissionPerTick } = {}) {
  const s = nn(stake), t = nn(totalStake), e = nn(emissionPerTick);
  if (s <= 0 || t <= 0 || e <= 0) return 0;
  return round(e * Math.min(1, s / t), 8);
}

/**
 * lotteryDraw — the per-tick stake-weighted lottery (BeeSwarm's variance model). One winner per tick
 * takes the WHOLE emissionPerTick; the probability you win = stake/totalStake. `rngFloat` is an
 * injected uniform in [0,1) (NO Math.random here — pass crypto/seeded rng at the call site for
 * determinism in tests). Returns the APIS you mined THIS tick: emissionPerTick if you won, else 0.
 *
 * Win rule: you win iff rngFloat < stake/totalStake. Over many ticks with fair rng your average per
 * tick → emissionPerTick × stake/totalStake = expectedMine() (the drip). Soft-fails to 0.
 */
export function lotteryDraw(stake, totalStake, emissionPerTick, rngFloat) {
  const s = nn(stake), t = nn(totalStake), e = nn(emissionPerTick);
  let r = +rngFloat;
  if (!Number.isFinite(r)) return 0;
  if (r < 0) r = 0; if (r >= 1) r = 0.999999999;
  if (s <= 0 || t <= 0 || e <= 0) return 0;
  const p = Math.min(1, s / t);
  return r < p ? round(e, 8) : 0;
}

/**
 * claimable — accrued-but-unclaimed APIS for a position checkpoint `state` as of `now` (ms epoch).
 *   state = {
 *     stakedWmelek,            // current locked wMELEK
 *     totalStaked,             // pool total at the checkpoint (caller refreshes; on-chain reads live)
 *     emissionPerDay,          // pool emission
 *     halvingDays?,            // optional decaying emission
 *     lastClaim,               // ms epoch of the last claim/checkpoint (accrual start)
 *     lockUntil?,              // ms epoch the wMELEK is locked until (Infinity / a far value = "forever")
 *   }
 * Accrual runs from lastClaim → now (never negative). lockUntil does NOT stop accrual — a locked miner
 * keeps mining; lockUntil only gates UNSTAKE (see canUnstake). Soft-fails to a safe { apis, ... } shape.
 */
export function claimable(state = {}, now = Date.now()) {
  const s = state || {};
  const last = nn(s.lastClaim);
  const t = nn(now);
  const elapsedMs = t > last ? t - last : 0;
  const days = elapsedMs / (SECONDS_PER_DAY * 1000);
  const apis = apisAccrued({
    stakedWmelek: s.stakedWmelek,
    totalStaked: s.totalStaked,
    emissionPerDay: s.emissionPerDay,
    halvingDays: s.halvingDays,
    days,
  });
  return {
    apis,
    days: round(days, 8),
    ratePerDay: apisRate({ stakedWmelek: s.stakedWmelek, totalStaked: s.totalStaked, emissionPerDay: s.emissionPerDay }),
    asOf: t,
  };
}

/**
 * canUnstake — whether the locked wMELEK can be withdrawn at `now`. true if no lockUntil, or now >=
 * lockUntil. A lockUntil of Infinity (or any far-future value) models "lock maybe forever". Accrual is
 * unaffected; this only gates the principal withdrawal. Soft-fails to true only when there is no lock.
 */
export function canUnstake(state = {}, now = Date.now()) {
  const lockUntil = (state || {}).lockUntil;
  if (lockUntil == null) return true;
  const lu = +lockUntil;
  if (!Number.isFinite(lu)) return false; // Infinity / NaN lockUntil = locked (forever)
  return nn(now) >= lu;
}

/**
 * checkpoint — produce a NEW position state after a stake/unstake/claim at `now`. Crystallizes the APIS
 * accrued so far (returned as `claimed`) and resets lastClaim, so changing stake never retroactively
 * re-rates past accrual (MasterChef _harvest semantics, but pure/off-chain). Pass deltaStake (+lock /
 * -unlock) and an optional new totalStaked / lockUntil. Soft-fails to a safe shape; refuses an unlock
 * that exceeds the position or that violates the lock period (returns the unchanged state + error).
 */
export function checkpoint(state = {}, { deltaStake = 0, totalStaked, lockUntil, now = Date.now() } = {}) {
  const s = state || {};
  const acc = claimable(s, now);
  const cur = nn(s.stakedWmelek);
  const dv = +deltaStake;
  const delta = Number.isFinite(dv) ? dv : 0;

  if (delta < 0) {
    const want = -delta;
    if (want > cur) return { ...s, error: 'unstake exceeds locked amount', claimed: acc.apis };
    if (!canUnstake(s, now)) return { ...s, error: 'lock period not elapsed', claimed: acc.apis };
  }

  const nextStake = round(Math.max(0, cur + delta), 8);
  return {
    stakedWmelek: nextStake,
    totalStaked: totalStaked === undefined ? nn(s.totalStaked) : nn(totalStaked),
    emissionPerDay: s.emissionPerDay === undefined ? DEFAULT_WORKERBEE.emissionPerDay : nn(s.emissionPerDay),
    halvingDays: s.halvingDays === undefined ? DEFAULT_WORKERBEE.halvingDays : nn(s.halvingDays),
    lastClaim: nn(now),
    lockUntil: lockUntil === undefined ? s.lockUntil : lockUntil,
    claimed: acc.apis, // APIS crystallized by this checkpoint (the caller mints/credits it)
  };
}

// ── UI fragment ("Mine APIS" tab) ──────────────────────────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * renderMineFragment — HTML string (all interpolation esc()'d) for the "Mine APIS" tab: lock-wMELEK
 * input → APIS/day + projected accrual. PURE: figures computed from the same helpers so the preview
 * matches what the chain enforces. `onMine` is a global JS fn name the host wires to lock (default
 * 'apisWorkerbeeMine'). projectDays drives the projected total (default 30).
 */
export function renderMineFragment({
  stakedWmelek = 0,
  totalStaked = 0,
  emissionPerDay = DEFAULT_WORKERBEE.emissionPerDay,
  halvingDays = DEFAULT_WORKERBEE.halvingDays,
  lockDays = DEFAULT_WORKERBEE.lockDays,
  projectDays = 30,
  onMine = 'apisWorkerbeeMine',
} = {}) {
  const stake = nn(stakedWmelek);
  // Include the user's own would-be stake in the total so a fresh hive (totalStaked 0) still previews.
  const total = Math.max(nn(totalStaked), stake);
  const perDay = apisRate({ stakedWmelek: stake, totalStaked: total, emissionPerDay });
  const projected = apisAccrued({ stakedWmelek: stake, totalStaked: total, emissionPerDay, halvingDays, days: projectDays });
  const sharePct = total > 0 ? round((Math.min(1, stake / total)) * 100, 4) : 0;
  const fn = esc(onMine);
  const lockTxt = nn(lockDays) > 0 ? `${esc(lockDays)}-day lock` : 'unlock anytime';

  return [
    '<div class="apis-workerbee" data-apis-workerbee>',
    '<h3>Mine APIS — lock wMELEK</h3>',
    '<p class="wb-sub">Lock wMELEK as a virtual WorkerBee and passively mint APIS, pro-rata to your ',
    'share of the hive. Not a loan: no debt, no liquidation. ', esc(lockTxt), '.</p>',
    '<label>Lock wMELEK<input type="number" min="0" step="any" value="', esc(stake),
      '" data-wb-stake></label>',
    '<dl class="wb-stats">',
    '<dt>Your hive share</dt><dd data-wb-share>', esc(sharePct), '%</dd>',
    '<dt>APIS / day</dt><dd data-wb-rate>', esc(perDay), ' APIS</dd>',
    '<dt>Projected (', esc(projectDays), 'd)</dt><dd data-wb-projected>', esc(projected), ' APIS</dd>',
    '<dt>Hive emission</dt><dd>', esc(emissionPerDay), ' APIS/day',
      nn(halvingDays) > 0 ? ` (halves every ${esc(halvingDays)}d)` : '', '</dd>',
    '</dl>',
    '<button type="button" data-wb-mine onclick="', fn, '()">Lock &amp; Mine</button>',
    '<p class="wb-note">Your rate falls as the hive grows (more locked wMELEK = smaller share of the ',
    'same emission). Claim accrued APIS anytime; unlock your wMELEK after the lock period.</p>',
    '</div>',
  ].join('');
}

// CLI demo (guarded) — a worked example of the lock→mine→project flow + a lottery fairness sanity check.
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('apis-workerbee.mjs')) {
  const stakedWmelek = 1000, totalStaked = 10000, emissionPerDay = 1000;
  const perDay = apisRate({ stakedWmelek, totalStaked, emissionPerDay });
  console.log(`Lock ${stakedWmelek} wMELEK of ${totalStaked} total @ ${emissionPerDay} APIS/day emission`);
  console.log(`  → ${perDay} APIS/day  (share ${(stakedWmelek / totalStaked * 100).toFixed(1)}%)`);
  console.log(`  → 30-day total: ${apisAccrued({ stakedWmelek, totalStaked, emissionPerDay, days: 30 })} APIS`);
  console.log(`  → 30-day total WITH 10-day halving: ${apisAccrued({ stakedWmelek, totalStaked, emissionPerDay, days: 30, halvingDays: 10 })} APIS`);

  // Lottery fairness: many ticks with a simple seeded LCG (NOT Math.random — deterministic).
  let seed = 123456789;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const ticks = 200000, emissionPerTick = 1;
  let won = 0;
  for (let i = 0; i < ticks; i++) won += lotteryDraw(stakedWmelek, totalStaked, emissionPerTick, rng());
  const avg = won / ticks, expected = expectedMine({ stake: stakedWmelek, totalStake: totalStaked, emissionPerTick });
  console.log(`Lottery over ${ticks} ticks: avg/tick=${avg.toFixed(5)} vs expected=${expected} (drift ${((avg - expected) / expected * 100).toFixed(2)}%)`);
}
