// kula-fee-discount.mjs — pay KulaSwap swap fees in KULA for a 25% discount (the BNB/FTT model),
// and the collected KULA is a DIRECT KULA BURN (the deflationary sink that was missing). Operator 2026-06-17.
//
// Two effects in one feature:
//   1. DEMAND  — you must hold KULA to get the cheaper fee → standing KULA buy pressure.
//   2. SINK    — the KULA paid as fees is burned (minus Hathor's protocol cut) → KULA goes deflationary.
//
// Default swap fee 0.30% (30 bps); paying in KULA → 25% off → effective 0.225% (22.5 bps), charged in KULA
// at the live KULA price. Pure float math (matches kula-econ.mjs/kula-quote.mjs), soft-fail to safe shapes,
// never throws, no network.

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };

export const DEFAULT_FEE_BPS = 30;        // 0.30% canonical swap fee
export const DEFAULT_DISCOUNT_BPS = 2500; // 25% off when paying in KULA
export const BPS = 10000;
// Hathor's share of the protocol's fee cut (the 0.05% of the 0.30% = 1/6). The rest of the KULA fee burns.
export const DEFAULT_HATHOR_SHARE_BPS = 1667;

/** The discounted effective fee in bps when paying in KULA. effective = feeBps × (1 − discount). */
export function effectiveFeeBps(feeBps = DEFAULT_FEE_BPS, discountBps = DEFAULT_DISCOUNT_BPS) {
  const f = nn(feeBps), d = Math.min(BPS, nn(discountBps));
  return round(f * (BPS - d) / BPS, 6);
}

/**
 * Quote the KULA-paid fee for a trade. tradeValueQuote = trade size in the quote unit (e.g. wMELEK/$);
 * kulaPriceQuote = price of 1 KULA in that same unit. Returns the normal vs discounted fee, the KULA you
 * pay, and your savings. Soft-fails to a safe { ok:false } shape.
 */
export function feeWithKulaDiscount({ tradeValueQuote, feeBps = DEFAULT_FEE_BPS, discountBps = DEFAULT_DISCOUNT_BPS, kulaPriceQuote } = {}) {
  const trade = nn(tradeValueQuote);
  const kp = nn(kulaPriceQuote);
  if (trade <= 0 || kp <= 0) return { ok: false, reason: 'bad-input' };
  const fBps = nn(feeBps);
  const effBps = effectiveFeeBps(fBps, discountBps);
  const normalFeeValue = round(trade * fBps / BPS, 8);       // fee if paid in-asset (no discount)
  const discountedFeeValue = round(trade * effBps / BPS, 8); // fee value when paying in KULA
  const kulaAmount = round(discountedFeeValue / kp, 8);      // KULA you actually pay
  const savings = round(normalFeeValue - discountedFeeValue, 8);
  return {
    ok: true,
    feeBps: round(fBps, 4),
    effectiveBps: effBps,
    discountBps: Math.min(BPS, nn(discountBps)),
    normalFeeValue,
    discountedFeeValue,
    kulaAmount,
    savings,
    savingsPct: round(Math.min(BPS, nn(discountBps)) / 100, 4), // e.g. 25
  };
}

/**
 * Route the collected KULA fee: Hathor takes her protocol cut, the REST is BURNED (the direct KULA sink).
 * Default hathorShareBps = 1667 (the 0.05/0.30 proportional cut). Soft-fails to safe zeros.
 */
export function routeKulaFee({ kulaAmount, hathorShareBps = DEFAULT_HATHOR_SHARE_BPS } = {}) {
  const amt = nn(kulaAmount);
  const h = Math.min(BPS, nn(hathorShareBps));
  const toHathor = round(amt * h / BPS, 8);
  const burned = round(amt - toHathor, 8);
  return { ok: amt > 0, toHathor, burned, hathorShareBps: h };
}

/** Is paying in KULA worth it vs in-asset? (Always yes by `savings` while discount>0, but expose it.) */
export function worthPayingInKula(quote) {
  return !!(quote && quote.ok && quote.savings > 0);
}
