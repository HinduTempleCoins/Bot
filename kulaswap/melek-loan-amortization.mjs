// melek-loan-amortization.mjs — the SELF-AMORTIZING MELEK loan model.
//
// The thesis: MELEK (Graphene/Steem-fork) is a PROOF-OF-STAKE, yield-bearing asset — powered-up MELEK
// earns curation + author rewards (an APR) just by being staked and voting. So a CDP borrower who
// borrows wMELEK (Market 1), bridges it back to MELEK and POWERS IT UP, earns staking yield that can
// SERVICE — and, if the staking APR beats the borrow APR, fully PAY OFF — the loan over time. The loan
// amortizes itself out of its own collateral's productivity. (Contrast a dead asset: there, debt only
// ever grows at the stability fee.)
//
// The math (continuous, per-unit-principal):
//   net carry rate  r_net = stakingApr − borrowApr
//   r_net > 0  → the position throws off more yield than it costs → SELF-AMORTIZING; principal is paid
//                down and the debt reaches zero in finite time.
//   r_net ≤ 0  → yield never covers the fee → payoff time is ∞ (debt never self-clears; the borrower
//                must add outside capital).
//
// Continuous payoff time (yield continuously applied against a continuously-compounding debt):
//   debt(t) = P·e^{borrowApr·t} − P·(stakingApr/borrowApr)·(e^{borrowApr·t} − 1)·... — but the clean,
//   standard closed form for "income stream y=P·stakingApr paid against a loan at rate borrowApr" is
//   the loan-amortization formula with payment = P·stakingApr:
//       t = −ln(1 − borrowApr·P / payment) / borrowApr
//         = −ln(1 − borrowApr / stakingApr) / borrowApr
//   which is finite iff stakingApr > borrowApr, and → ∞ as stakingApr → borrowApr⁺. This is the
//   textbook "time to pay off a loan with a fixed continuous payment" result, and matches netCarry's sign.
//
// House style: pure arithmetic, soft-fail to safe shapes, NEVER throws. No network, no deps.

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };

/**
 * Net annual carry on a MELEK CDP debt: the yield the staked MELEK throws off, minus the stability fee.
 *   netRate   = stakingApr − borrowApr           (can be negative)
 *   netIncome = debt * netRate                    (annual; the surplus/deficit serviced per year)
 * Returns { netRate, netIncome, selfAmortizing }. Soft-fails to zeros.
 */
export function netCarry({ debt = 0, borrowApr = 0, stakingApr = 0 } = {}) {
  const d = nn(debt), b = nn(borrowApr), s = nn(stakingApr);
  const netRate = round(s - b, 8);
  const netIncome = round(d * netRate, 8);
  return { netRate, netIncome, selfAmortizing: s > b };
}

/**
 * Time (in YEARS) for the staking income stream to fully pay off the loan, given the staking yield is
 * continuously applied against the debt accruing at borrowApr:
 *   t = −ln(1 − borrowApr / stakingApr) / borrowApr
 * Returns Infinity when stakingApr ≤ borrowApr (never self-pays). Special case borrowApr = 0: a
 * zero-fee loan is paid off linearly by the staking income → t = principal / (principal*stakingApr)
 * = 1 / stakingApr years. `principal` only scales nothing here (the ratio is principal-independent) but
 * is accepted for clarity and validated. Soft-fails to Infinity on bad input.
 */
export function payoffTime({ principal = 0, borrowApr = 0, stakingApr = 0 } = {}) {
  const p = nn(principal), b = nn(borrowApr), s = nn(stakingApr);
  if (p <= 0 || s <= 0) return Infinity;     // no principal or no yield → never self-pays meaningfully
  if (s <= b) return Infinity;               // yield doesn't beat the fee → never self-amortizes
  if (b === 0) return round(1 / s, 8);       // zero-fee loan: linear payoff in 1/stakingApr years
  const t = -Math.log(1 - b / s) / b;
  return Number.isFinite(t) && t > 0 ? round(t, 8) : Infinity;
}

/**
 * Does the loan pay for itself? True iff staking yield strictly exceeds the borrow APR (stability fee).
 * The clean breakeven: stakingApr === borrowApr → exactly carries the fee, never pays down principal
 * (payoff = ∞) → NOT self-amortizing (strict inequality required).
 */
export function isSelfAmortizing({ borrowApr = 0, stakingApr = 0 } = {}) {
  return nn(stakingApr) > nn(borrowApr);
}

/**
 * The breakeven staking APR: the staking yield at which the loan exactly carries its fee. Below it the
 * debt grows; above it the loan self-amortizes. Trivially equals borrowApr — surfaced as a function so
 * the UI can show "you need > X% APR for this to self-pay".
 */
export function breakevenStakingApr({ borrowApr = 0 } = {}) {
  return round(nn(borrowApr), 8);
}

/**
 * Project the debt balance after `years`, given continuous fee accrual offset by a continuous staking-
 * income payment of (principal * stakingApr) per year. Useful for charts / the UI preview.
 *   debt(t) = P·e^{b·t} − (P·s / b)·(e^{b·t} − 1)        (b > 0)
 *   debt(t) = P − P·s·t                                   (b = 0, linear)
 * Clamped at 0 (once paid off it stays paid off). Soft-fails to the principal.
 */
export function projectDebt({ principal = 0, borrowApr = 0, stakingApr = 0, years = 0 } = {}) {
  const p = nn(principal), b = nn(borrowApr), s = nn(stakingApr), t = nn(years);
  if (p <= 0) return 0;
  if (t <= 0) return round(p, 8);
  let debt;
  if (b === 0) {
    debt = p - p * s * t;
  } else {
    const e = Math.exp(b * t);
    debt = p * e - (p * s / b) * (e - 1);
  }
  return round(Math.max(0, debt), 8);
}

// CLI demo (guarded) — show when staking yield > stability fee the loan self-pays, and the breakeven.
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('melek-loan-amortization.mjs')) {
  const cases = [
    { label: 'yield beats fee', principal: 1000, borrowApr: 0.05, stakingApr: 0.12 },
    { label: 'at breakeven',    principal: 1000, borrowApr: 0.08, stakingApr: 0.08 },
    { label: 'fee beats yield', principal: 1000, borrowApr: 0.10, stakingApr: 0.04 },
    { label: 'zero-fee loan',   principal: 1000, borrowApr: 0.0,  stakingApr: 0.10 },
  ];
  for (const c of cases) {
    const carry = netCarry({ debt: c.principal, borrowApr: c.borrowApr, stakingApr: c.stakingApr });
    const t = payoffTime(c);
    console.log(`${c.label}: net=${carry.netRate} self=${carry.selfAmortizing}`,
      `payoff=${t === Infinity ? '∞' : t.toFixed(2) + 'y'}`,
      `breakeven=${breakevenStakingApr(c)} debt@5y=${projectDebt({ ...c, years: 5 })}`);
  }
}
