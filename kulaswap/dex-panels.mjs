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

import {
  maxBorrow, healthFactor, liquidationPrice, DEFAULT_CDP,
  buildOpenVaultTx, buildBorrowTx, buildRepayTx, buildWithdrawTx, buildApproveTx,
} from './kula-cdp.mjs';
import { poolApr, veBoost } from './kula-farm.mjs';
import { poolPrice } from './kula-price-tvl.mjs';
import {
  buildLockTx, buildIncreaseAmountTx, buildExtendLockTx, buildWithdrawTx as buildVeWithdrawTx,
  buildStakeApproveTx, VE_MAX_LOCK_SECONDS, SECONDS_PER_WEEK, veWeight, clampDuration,
} from './kula-stake.mjs';
import { MAINNET_ADDR, cdpMarketLive, veLive } from './kula-config-addresses.mjs';

const PRANA_MAINNET_CHAINID = 712217;

// ── MAINNET WIRING SEAM ───────────────────────────────────────────────────────────────────────────
// One place the Borrow/Stake CTAs consult to go from disabled→enabled. `live` is the zero-address guard
// (cdpMarketLive/veLive) — a zero vault/veKULA reads NOT live and the UI must refuse to build a tx. The
// returned builders are pre-bound to the live mainnet addresses + chainId 712217; each takes a human
// amount already scaled to BASE UNITS (the wallet layer scales; these never sign or broadcast).

/** Borrow (CDP) wiring for mainnet. `live:false` ⇒ keep the CTA disabled ("not live"). */
export function cdpWiring() {
  const A = MAINNET_ADDR;
  const live = cdpMarketLive();
  return {
    live,
    vault: A.cdpVault,
    collateral: A.KULA,          // the token the user locks
    debtToken: A.mMELEK,         // the synthetic the vault mints (NOT wMELEK)
    chainId: PRANA_MAINNET_CHAINID,
    maxLtv: DEFAULT_CDP.maxLtv,
    // approve KULA (before deposit) / approve mMELEK (before repay)
    approveCollateral: (amt) => live ? buildApproveTx({ token: A.KULA, vault: A.cdpVault, amountBaseUnits: amt, chainId: PRANA_MAINNET_CHAINID }) : null,
    approveDebt: (amt) => live ? buildApproveTx({ token: A.mMELEK, vault: A.cdpVault, amountBaseUnits: amt, chainId: PRANA_MAINNET_CHAINID }) : null,
    deposit: (amt) => live ? buildOpenVaultTx({ vault: A.cdpVault, amountBaseUnits: amt, chainId: PRANA_MAINNET_CHAINID }) : null,
    borrow: (amt) => live ? buildBorrowTx({ vault: A.cdpVault, amountBaseUnits: amt, chainId: PRANA_MAINNET_CHAINID }) : null,
    repay: (amt) => live ? buildRepayTx({ vault: A.cdpVault, amountBaseUnits: amt, chainId: PRANA_MAINNET_CHAINID }) : null,
    withdraw: (amt) => live ? buildWithdrawTx({ vault: A.cdpVault, amountBaseUnits: amt, chainId: PRANA_MAINNET_CHAINID }) : null,
  };
}

/** Stake (veKULA) wiring for mainnet. `live:false` ⇒ keep the CTA disabled ("not live"). */
export function stakeWiring() {
  const A = MAINNET_ADDR;
  const live = veLive();
  return {
    live,
    veKula: A.veKULA,
    kula: A.KULA,
    chainId: PRANA_MAINNET_CHAINID,
    maxLockSeconds: VE_MAX_LOCK_SECONDS,
    approve: (amt) => live ? buildStakeApproveTx({ kula: A.KULA, veKula: A.veKULA, amountBaseUnits: amt, chainId: PRANA_MAINNET_CHAINID }) : null,
    lock: (amt, durSec) => live ? buildLockTx({ veKula: A.veKULA, amountBaseUnits: amt, durationSeconds: durSec, chainId: PRANA_MAINNET_CHAINID }) : null,
    increaseAmount: (amt) => live ? buildIncreaseAmountTx({ veKula: A.veKULA, amountBaseUnits: amt, chainId: PRANA_MAINNET_CHAINID }) : null,
    extendLock: (durSec) => live ? buildExtendLockTx({ veKula: A.veKULA, newDurationSeconds: durSec, chainId: PRANA_MAINNET_CHAINID }) : null,
    withdraw: () => live ? buildVeWithdrawTx({ veKula: A.veKULA, chainId: PRANA_MAINNET_CHAINID }) : null,
  };
}

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

// ── STAKE: veKULA lock weight ──────────────────────────────────────────────────────────────────────
/** Given a KULA amount and a lock length in weeks, the clamped lock duration (seconds), the veKULA
 *  voting weight at lock start (amount * min(dur,max)/max — mirrors VoteEscrow.balanceOf), and that
 *  decay fraction as a %. Longer locks → weight closer to the full amount. Soft-fails to zeros. */
export function stakePanel({ amount, lockWeeks } = {}) {
  const a = num(amount);
  const durationSeconds = clampDuration(num(lockWeeks) * SECONDS_PER_WEEK);
  const weight = veWeight({ amount: a, secondsRemaining: durationSeconds });
  const weightPct = durationSeconds > 0
    ? (Math.min(durationSeconds, VE_MAX_LOCK_SECONDS) / VE_MAX_LOCK_SECONDS) * 100
    : 0;
  return { durationSeconds, weight: Number(weight.toFixed(6)), weightPct: Number(weightPct.toFixed(2)) };
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
    cMax.textContent = p.maxBorrow ? `${fmt(p.maxBorrow)} mMELEK` : '—';
    cHf.textContent = hf(p.healthFactor);
    cHf.className = `v ${p.hfClass}`;
    cLiq.textContent = p.liquidationPrice ? `${fmt(p.liquidationPrice)}` : '—';
  }
  on(cCol, 'input', renderBorrow); on(cDebt, 'input', renderBorrow);

  // STAKE (veKULA lock weight)
  const sAmt = $('stake-amt'), sWeeks = $('stake-weeks'), sWeight = $('stake-weight'), sUnlock = $('stake-unlock');
  function renderStake() {
    if (!sAmt) return;
    const p = stakePanel({ amount: sAmt.value, lockWeeks: sWeeks.value });
    sWeight.textContent = p.weight ? `${fmt(p.weight)} veKULA` : '—';
    if (sUnlock) {
      if (p.durationSeconds > 0) {
        const end = new Date(Date.now() + p.durationSeconds * 1000);
        sUnlock.textContent = `unlocks ${end.toISOString().slice(0, 10)} · ${fmt(p.weightPct, 3)}% weight`;
      } else sUnlock.textContent = '—';
    }
  }
  on(sAmt, 'input', renderStake); on(sWeeks, 'input', renderStake);

  return { renderPool, renderFarm, renderBorrow, renderStake };
}
