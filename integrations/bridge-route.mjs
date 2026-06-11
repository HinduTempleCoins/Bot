// bridge-route.mjs — PURE cross-chain profit-routing PLANNER (backlog #162; supports #158).
//
// Items 158/162: "HIVE bot → Bridge → Coinbase Wallet bot" / "Transfer HIVE profits → USDC → ETH".
// This module ONLY computes the leg plan and net output given rates/fees the CALLER supplies.
//
// IT DOES NOT: execute a bridge, hold or touch keys, sign or broadcast, or hit the network. There
// are NO hard-coded prices and NO addresses anywhere in here — every rate is a parameter. It is
// pure arithmetic over numbers the caller provides, so it is public-safe by construction. Execution
// is a separate, gated, MELEK-Signer-only concern (zero-WIF rule).
//
// A "leg" converts one asset to the next:  out = in * rate − feeUsd,  where
//   feeUsd = (in_value_usd * feeBps/10000) + fixedFee.
// Fees are accounted in USD so a multi-asset hop (HIVE→USDC→ETH) has a single comparable fee total.
// The USD value of a leg's input is in*hiveUsd for the first leg, then carried as the running USD
// notional through the chain (USDC ≈ its own USD value; downstream legs value their input at the
// USD notional flowing in, which is conserved net of fees).
//
//   import { planRoute, defaultLegs, breakEven, describe } from './integrations/bridge-route.mjs';
//   const plan = planRoute({ amountHive: 1000, hiveUsd: 0.30, legs: defaultLegs() });
//
// CLI:  node integrations/bridge-route.mjs            # demo with inline rates

// ── pure helpers (no env, no I/O) ───────────────────────────────────────────────────────────
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}
const num = (n, d = 0) => (Number.isFinite(n) ? n : d);
const round = (n, dp = 8) => {
  if (!Number.isFinite(n)) return 0;
  const f = 10 ** dp;
  return Math.round(n * f) / f;
};

/**
 * A representative HIVE → USDC → ETH leg template. RATES ARE PARAMETERS — the caller passes the
 * live prices in; the defaults here are illustrative placeholders, NOT a price oracle.
 *
 * @param {{hiveToUsdc?:number, usdcToEth?:number}} rates  illustrative; override with live numbers
 * @returns {Array<{from:string,to:string,rate:number,feeBps:number,fixedFee:number}>}
 */
export function defaultLegs(rates = {}) {
  // hiveToUsdc: USDC out per 1 HIVE in (≈ HIVE price in USD, net of slippage).
  // usdcToEth:  ETH out per 1 USDC in (≈ 1 / ETH price in USD).
  const hiveToUsdc = num(rates.hiveToUsdc, 0.30); // illustrative only
  const usdcToEth = num(rates.usdcToEth, 0.0004); // illustrative only (~$2500 ETH)
  return [
    { from: 'HIVE', to: 'USDC', rate: hiveToUsdc, feeBps: 25, fixedFee: 0.5 },
    { from: 'USDC', to: 'ETH', rate: usdcToEth, feeBps: 30, fixedFee: 2.0 },
  ];
}

/**
 * Compute the full leg plan and net output.
 *
 * Soft-fail rules (never throws):
 *   - amountHive <= 0 (or non-finite) → { finalAmount: 0, ... , steps: [] }.
 *   - a leg with a missing/invalid rate → that step is flagged { ok:false }, contributes 0 out,
 *     and the chain stops there (downstream legs can't run without an input). Earlier steps still
 *     report their real numbers.
 *
 * @param {{amountHive:number, hiveUsd:number, legs:Array}} args
 * @returns {{steps:Array, finalAmount:number, finalAsset:string, totalFeeUsd:number, effectiveRate:number}}
 */
export function planRoute(args = {}) {
  const amountHive = num(args.amountHive, 0);
  const hiveUsd = num(args.hiveUsd, 0);
  const legs = Array.isArray(args.legs) ? args.legs : [];

  const empty = (asset) => ({
    steps: [], finalAmount: 0, finalAsset: asset || 'HIVE', totalFeeUsd: 0, effectiveRate: 0,
  });

  if (!(amountHive > 0)) return empty(legs[0] && legs[0].from);
  if (!legs.length) return empty('HIVE'); // no legs → no route executed

  let running = amountHive;        // amount of the CURRENT asset flowing into the next leg
  let runningUsd = amountHive * hiveUsd; // USD notional of that amount (for fee math)
  let curAsset = legs.length ? legs[0].from : 'HIVE';
  let totalFeeUsd = 0;
  const steps = [];
  let halted = false;

  for (const leg of legs) {
    if (halted) break;
    const from = (leg && leg.from) || curAsset;
    const to = (leg && leg.to) || '?';
    const inAmt = round(running);
    const rate = leg ? leg.rate : undefined;
    const rateOk = Number.isFinite(rate) && rate > 0;

    if (!rateOk) {
      // missing/invalid rate → flag the step, produce no output, stop the chain.
      steps.push({ from, to, in: inAmt, out: 0, feeUsd: 0, ok: false });
      running = 0;
      curAsset = to;
      halted = true;
      break;
    }

    const feeBps = num(leg.feeBps, 0);
    const fixedFee = num(leg.fixedFee, 0);
    const feeUsd = round((runningUsd * feeBps) / 10000 + fixedFee, 6);

    // Convert, then subtract the fee. Fee is in USD; express it in OUTPUT-asset units via `rate`
    // (out per 1 input asset, where input ≈ runningUsd USD), so feeOut = feeUsd/inputUsdPerUnit*rate.
    // Simpler & robust: gross out = in*rate; the USD fee removes runningUsd*feeFrac+fixed of notional,
    // and the surviving USD notional carries forward. We compute out from surviving notional.
    const grossOut = inAmt * rate;
    const survivingUsd = Math.max(0, runningUsd - feeUsd);
    // out scaled by the fraction of notional that survived the fee.
    const out = round(runningUsd > 0 ? grossOut * (survivingUsd / runningUsd) : 0);

    totalFeeUsd = round(totalFeeUsd + feeUsd, 6);
    steps.push({ from, to, in: inAmt, out, feeUsd, ok: true });

    running = out;
    runningUsd = survivingUsd;
    curAsset = to;
  }

  const finalAmount = round(running);
  // effectiveRate: final asset units out per 1 HIVE in.
  const effectiveRate = amountHive > 0 ? round(finalAmount / amountHive) : 0;

  return {
    steps,
    finalAmount,
    finalAsset: curAsset,
    totalFeeUsd: round(totalFeeUsd, 6),
    effectiveRate,
  };
}

/**
 * Minimum destination-asset USD price at which the route does NOT lose USD value — i.e. the price
 * the final asset must clear so that (finalAmount * price) ≥ the starting USD notional.
 *
 * Needs hiveUsd to know the starting notional; if it's omitted we fall back to summing the legs'
 * own valuation, but the honest break-even needs the HIVE→USD anchor, so pass it when you can.
 *
 * @param {{amountHive:number, hiveUsd?:number, legs:Array}} args
 * @returns {{ok:boolean, breakEvenPrice:number, startUsd:number, finalAmount:number, finalAsset:string}}
 */
export function breakEven(args = {}) {
  const amountHive = num(args.amountHive, 0);
  const hiveUsd = num(args.hiveUsd, 0);
  const plan = planRoute({ amountHive, hiveUsd, legs: args.legs });
  const startUsd = round(amountHive * hiveUsd, 6);

  if (!(amountHive > 0) || !(plan.finalAmount > 0) || !(startUsd > 0)) {
    return {
      ok: false,
      breakEvenPrice: 0,
      startUsd,
      finalAmount: plan.finalAmount,
      finalAsset: plan.finalAsset,
    };
  }
  // value preserved when finalAmount * price >= startUsd  →  price >= startUsd/finalAmount.
  const breakEvenPrice = round(startUsd / plan.finalAmount, 6);
  return {
    ok: true,
    breakEvenPrice,
    startUsd,
    finalAmount: plan.finalAmount,
    finalAsset: plan.finalAsset,
  };
}

/**
 * Human-readable multi-line plan summary. esc()'d on every interpolation so it is safe to drop
 * straight into an HTML <pre>/log without injection.
 *
 * @param {ReturnType<typeof planRoute>} plan
 * @returns {string}
 */
export function describe(plan = {}) {
  const steps = Array.isArray(plan.steps) ? plan.steps : [];
  const lines = [];
  lines.push('Cross-chain profit-routing plan');
  if (!steps.length) {
    lines.push('  (no executable steps — zero/invalid amount or empty leg set)');
  }
  for (let i = 0; i < steps.length; i++) {
    const s = steps[i] || {};
    const flag = s.ok === false ? '  [SKIPPED — missing rate]' : '';
    lines.push(
      `  ${esc(i + 1)}. ${esc(s.from)} → ${esc(s.to)}: ` +
      `${esc(s.in)} ${esc(s.from)} → ${esc(s.out)} ${esc(s.to)} ` +
      `(fee $${esc(s.feeUsd)})${esc(flag)}`,
    );
  }
  lines.push(`  Final: ${esc(plan.finalAmount)} ${esc(plan.finalAsset)}`);
  lines.push(`  Total fees: $${esc(plan.totalFeeUsd)}`);
  lines.push(`  Effective rate: ${esc(plan.effectiveRate)} ${esc(plan.finalAsset)} per HIVE`);
  return lines.join('\n');
}

// ── CLI demo (inline rates only; no network, no keys) ────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('bridge-route.mjs')) {
  const legs = defaultLegs({ hiveToUsdc: 0.30, usdcToEth: 0.0004 });
  const plan = planRoute({ amountHive: 1000, hiveUsd: 0.30, legs });
  console.log(describe(plan));
  const be = breakEven({ amountHive: 1000, hiveUsd: 0.30, legs });
  console.log(
    `\nBreak-even ${be.finalAsset} price to preserve $${be.startUsd}: ` +
    `$${be.breakEvenPrice} (got ${be.finalAmount} ${be.finalAsset})`,
  );
}
