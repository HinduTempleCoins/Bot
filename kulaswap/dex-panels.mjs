// dex-panels.mjs — the Pool / Farm / Borrow calculator tabs for the KulaSwap UI.
//
// These panels surface the DeFi layer that already exists as pure, offline-tested logic
// (kula-cdp, kula-farm, kula-price-tvl) as honest INTERACTIVE CALCULATORS. They compute real
// numbers from the real models; they do NOT fabricate dashboards or promise yields. The compute
// helpers below are pure (no DOM, no network) and offline-tested; mountPanels() does the DOM wiring
// and is guarded so importing this module in a node test never touches the DOM.
//
// Prices: there is no live external oracle yet (kula-price-tvl externalRef() is off), so the
// Borrow/Farm panels use clearly-labelled PLACEHOLDER economics. The pool RATIO (Pool tab) is real
// when reserves are supplied. The UI copy states plainly that fiat/oracle values are placeholders.

import { maxBorrow, healthFactor, liquidationPrice, DEFAULT_CDP } from './kula-cdp.mjs';
import { poolApr, veBoost } from './kula-farm.mjs';
import { poolPrice } from './kula-price-tvl.mjs';

// Illustrative economics — placeholders until on-chain emissions / oracle reads are wired.
// Marked here in ONE place; the UI labels every figure derived from them as an estimate.
export const ILLUSTRATIVE = Object.freeze({
  kulaPriceUsd: 0.05,           // stand-in KULA price (also the pool ratio default if no reserves)
  stablePriceUsd: 1,            // the MELEK dollar-stable targets ~$1
  yearlyEmissionToPool: 250_000,// KULA/yr illustrative emission to the LP farm
  poolTvlUsd: 500_000,          // illustrative pool TVL the base APR is computed against
  veMaxWeeks: 208,              // 4-year max lock (veCRV-style)
  veMaxBoost: 2.5,
});

const num = (v) => { const n = Number.parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };
const fmt = (n, d = 4) => {
  if (!Number.isFinite(n)) return '∞';
  if (n === 0) return '0';
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return String(Number(n.toPrecision(d)));
};

// ── POOL: add-liquidity ratio + share ──────────────────────────────────────────────────────────────
/** Given a KULA deposit and the live pool reserves, the matching pair side and the resulting share.
 *  Falls back to the illustrative price when reserves are absent (pre-connect). Soft-fails to zeros. */
export function poolPanel({ kulaAmount, reservesKula = 0, reservesWmelek = 0 } = {}) {
  const k = num(kulaAmount);
  const pp = poolPrice(reservesKula, reservesWmelek);
  const price = pp.ok ? pp.priceKulaInWmelek : ILLUSTRATIVE.kulaPriceUsd; // wMELEK per KULA
  const pairNeeded = k > 0 ? k * price : 0;
  const rk = num(reservesKula);
  const sharePct = k > 0 && rk > 0 ? (k / (rk + k)) * 100 : 0;
  return {
    pairNeeded: Number(pairNeeded.toFixed(8)),
    sharePct: Number(sharePct.toFixed(6)),
    priceKnown: pp.ok,
    price: Number(price.toFixed(8)),
  };
}

// ── FARM: base APR (illustrative) × real veKULA boost ────────────────────────────────────────────────
/** Base APR from illustrative emissions/TVL, the REAL veBoost for the lock, the boosted APR, and the
 *  user's estimated yearly reward on their staked $. APR is an estimate, not a promise. */
export function farmPanel({ stakedUsd, lockWeeks } = {}) {
  const staked = num(stakedUsd);
  const baseApr = poolApr({
    yearlyEmissionToPool: ILLUSTRATIVE.yearlyEmissionToPool,
    kulaPriceUsd: ILLUSTRATIVE.kulaPriceUsd,
    poolTvlUsd: ILLUSTRATIVE.poolTvlUsd,
  });
  const boost = veBoost({ lockWeeks: num(lockWeeks), maxWeeks: ILLUSTRATIVE.veMaxWeeks, maxBoost: ILLUSTRATIVE.veMaxBoost });
  const boostedApr = Number((baseApr * boost).toFixed(4));
  const yearlyRewardUsd = Number(((staked * boostedApr) / 100).toFixed(2));
  return { baseApr, boost, boostedApr, yearlyRewardUsd };
}

// ── BORROW: CDP health calculator ────────────────────────────────────────────────────────────────────
/** Max borrow, health factor, and liquidation price for a collateral/debt pair, using the live CDP
 *  model and placeholder prices. HF classes: safe / warn (<1.5) / danger (<1). Soft-fails to zeros. */
export function borrowPanel({ collateralKula, debtStable, prices } = {}) {
  const kulaPrice = num(prices && prices.kulaPrice) || ILLUSTRATIVE.kulaPriceUsd;
  const melekPrice = num(prices && prices.melekPrice) || ILLUSTRATIVE.stablePriceUsd;
  const col = num(collateralKula), debt = num(debtStable);
  const max = maxBorrow({ collateralKula: col, kulaPrice, melekPrice, maxLtv: DEFAULT_CDP.maxLtv });
  const hf = healthFactor({ collateralKula: col, kulaPrice, debtMelek: debt, melekPrice, liqRatio: DEFAULT_CDP.liqRatio });
  const liq = liquidationPrice({ collateralKula: col, debtMelek: debt, melekPrice, liqRatio: DEFAULT_CDP.liqRatio });
  let hfClass = 'hf-ok';
  if (Number.isFinite(hf) && hf > 0) { if (hf < 1) hfClass = 'hf-bad'; else if (hf < 1.5) hfClass = 'hf-warn'; }
  const overMax = debt > 0 && max > 0 && debt > max;
  return {
    maxBorrow: max,
    healthFactor: hf,
    liquidationPrice: liq,
    hfClass,
    overMax,
    kulaPrice, melekPrice,
  };
}

// ── DOM wiring (browser only) ────────────────────────────────────────────────────────────────────────
/** Wire the three calculator panels. `getReserves()` (optional) returns { reservesKula, reservesWmelek }
 *  from the live pool so the Pool tab uses the real ratio; without it the illustrative price is used. */
export function mountPanels(doc = document, { getReserves } = {}) {
  const $ = (id) => doc.getElementById(id);
  const on = (el, ev, fn) => el && el.addEventListener(ev, fn);
  const hf = (n) => (Number.isFinite(n) ? fmt(n, 3) : '∞ (no debt)');

  // POOL
  const lpKula = $('lp-kula'), lpPair = $('lp-pair'), lpShare = $('lp-share'), lpNote = $('lp-note');
  function renderPool() {
    if (!lpKula) return;
    const r = (getReserves && getReserves()) || {};
    const p = poolPanel({ kulaAmount: lpKula.value, reservesKula: r.reservesKula, reservesWmelek: r.reservesWmelek });
    lpPair.textContent = p.pairNeeded ? `${fmt(p.pairNeeded)} wMELEK` : '—';
    lpShare.textContent = p.sharePct ? `${fmt(p.sharePct)}%` : '—';
    lpNote.textContent = p.priceKnown
      ? `At the live pool ratio: 1 KULA = ${fmt(p.price)} wMELEK.`
      : 'Using an illustrative ratio — connect to read the live pool.';
  }
  on(lpKula, 'input', renderPool);

  // FARM
  const fTvl = $('farm-tvl'), fLock = $('farm-lock'), fApr = $('farm-apr'), fBoost = $('farm-boost'), fBoosted = $('farm-boosted');
  function renderFarm() {
    if (!fTvl) return;
    const p = farmPanel({ stakedUsd: fTvl.value, lockWeeks: fLock.value });
    fApr.textContent = `${fmt(p.baseApr)}%`;
    fBoost.textContent = `${fmt(p.boost, 3)}×`;
    fBoosted.textContent = p.yearlyRewardUsd
      ? `${fmt(p.boostedApr)}%  ·  ≈ $${fmt(p.yearlyRewardUsd)}/yr`
      : `${fmt(p.boostedApr)}%`;
  }
  on(fTvl, 'input', renderFarm); on(fLock, 'input', renderFarm);

  // BORROW
  const cCol = $('cdp-coll'), cDebt = $('cdp-debt'), cMax = $('cdp-max'), cHf = $('cdp-hf'), cLiq = $('cdp-liq');
  function renderBorrow() {
    if (!cCol) return;
    const p = borrowPanel({ collateralKula: cCol.value, debtStable: cDebt.value });
    cMax.textContent = p.maxBorrow ? `${fmt(p.maxBorrow)} stable` : '—';
    cHf.textContent = hf(p.healthFactor);
    cHf.className = `v ${p.hfClass}`;
    cLiq.textContent = p.liquidationPrice ? `${fmt(p.liquidationPrice)}` : '—';
  }
  on(cCol, 'input', renderBorrow); on(cDebt, 'input', renderBorrow);

  return { renderPool, renderFarm, renderBorrow };
}
