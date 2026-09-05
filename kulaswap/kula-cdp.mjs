// kula-cdp.mjs — KULA as DeFi COLLATERAL: "lock KULA → borrow wMELEK".
//
// The keystone KULA sink + utility. A CDP (collateralized debt position) on PRANA:
//   1. lock KULA collateral into CDPVault           (KULA leaves circulation — the sink)
//   2. borrow wMELEK against it, up to a max LTV     (the utility — you must acquire+lock KULA to borrow)
//   3. repay wMELEK + accrued interest to unlock     (burns the borrowed wMELEK)
//   4. liquidate if the position falls below the liquidation ratio (collateral seized at a bonus)
//
// wMELEK is the PRANA-side wrapper of MELEK (the debt token the vault mints/burns); KULA is the
// collateral. This module is the OFF-CHAIN tuner + tx-descriptor builder for that on-chain vault:
//   - pure math: maxBorrow / healthFactor / liquidationPrice / accrueInterest
//   - UNSIGNED tx descriptors against CDPVault (deposit/borrow/repay/withdraw) — Akasha/MetaMask SIGNS;
//     we NEVER sign or broadcast here, only describe the call. Selectors are the real keccak256 4-byte
//     selectors of the CDPVault ABI (verified against the contract source).
//
// House style: pure arithmetic, soft-fail to safe shapes, NEVER throws. No network, no deps. Mirrors
// kula-farm.mjs / cp-amm.mjs. The CDP econ side; the burn/PoL sinks live in kula-econ.mjs (separate).

import { renderTvlBadge } from './kula-price-tvl.mjs'; // native-unit TVL badge (AMM-relative; no USD)

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };

// ── Default CDP params (off-chain mirror of the on-chain constructor args) ─────────────────────────
// maxLTV       — borrow up to this fraction of collateral USD value (Maker-style). 0.5 = 50%.
// liqRatio     — liquidation threshold > maxLTV: HF crosses 1 here. 0.6 = liquidate when debt/collateral
//                value exceeds 60% (i.e. collateral value < debt / 0.6). A buffer between borrow and
//                liquidation gives the borrower room before being liquidated.
// ratePerYear  — stability fee / borrow APR accrued on the wMELEK debt (continuous-ish, see accrueInterest).
// liqBonusBps  — collateral bonus a liquidator seizes over the repaid value (matches the engine).
export const DEFAULT_CDP = Object.freeze({
  maxLtv: 0.5,        // lock $100 of KULA → borrow up to $50 of wMELEK
  liqRatio: 0.6,      // liquidate once debt value exceeds 60% of collateral value
  ratePerYear: 0.05,  // 5% APR stability fee on the wMELEK debt
  liqBonusBps: 1000,  // 10% liquidation bonus (informational; enforced by CollateralLiquidationEngine)
});

/**
 * Max wMELEK borrowable against locked KULA.
 *   borrowable_wMELEK = (collateralKula * kulaPrice * maxLtv) / melekPrice
 * Prices are any consistent quote unit (USD); they only need to share a unit.
 * Soft-fails to 0 on bad/zero inputs.
 */
export function maxBorrow({ collateralKula, kulaPrice, melekPrice, maxLtv = DEFAULT_CDP.maxLtv } = {}) {
  const col = nn(collateralKula), kp = nn(kulaPrice), mp = nn(melekPrice);
  const ltv = Math.min(1, Math.max(0, nn(maxLtv)));
  if (mp <= 0 || kp <= 0 || col <= 0 || ltv <= 0) return 0;
  return round((col * kp * ltv) / mp, 8);
}

/**
 * Health factor (scaled to a plain ratio; matches the vault's 1e18-scaled healthFactor / 1e18).
 *   HF = (collateralValue * liqRatio) / debtValue
 * HF > 1 → safe; HF < 1 → liquidatable; no debt → Infinity (nothing to liquidate).
 */
export function healthFactor({ collateralKula, kulaPrice, debtMelek, melekPrice, liqRatio = DEFAULT_CDP.liqRatio } = {}) {
  const col = nn(collateralKula), kp = nn(kulaPrice), debt = nn(debtMelek), mp = nn(melekPrice);
  const lr = Math.min(1, Math.max(0, nn(liqRatio)));
  const debtValue = debt * mp;
  if (debtValue <= 0) return Infinity;        // no debt → never liquidatable
  if (col <= 0 || kp <= 0 || lr <= 0) return 0; // debt but no/zero collateral → fully liquidatable
  const collateralValue = col * kp;
  return round((collateralValue * lr) / debtValue, 8);
}

/**
 * KULA price at which the position becomes liquidatable (HF = 1):
 *   liqPrice = (debtMelek * melekPrice) / (collateralKula * liqRatio)
 * Below this KULA price the collateral no longer covers the debt at the liq ratio.
 * Soft-fails to 0 (no debt or no collateral → no meaningful liquidation price).
 */
export function liquidationPrice({ collateralKula, debtMelek, melekPrice, liqRatio = DEFAULT_CDP.liqRatio } = {}) {
  const col = nn(collateralKula), debt = nn(debtMelek), mp = nn(melekPrice);
  const lr = Math.min(1, Math.max(0, nn(liqRatio)));
  if (col <= 0 || lr <= 0 || debt <= 0 || mp <= 0) return 0;
  return round((debt * mp) / (col * lr), 8);
}

/**
 * Accrue simple interest (stability fee) on a wMELEK debt over `seconds` at `ratePerYear`.
 * Simple (not compounded) — matches a per-second linear accrual a vault commonly uses; returns
 * { interest, total }. Soft-fails to the principal with zero interest.
 */
export function accrueInterest({ debt, ratePerYear, seconds } = {}) {
  const d = nn(debt), r = nn(ratePerYear), s = nn(seconds);
  const SECONDS_PER_YEAR = 365 * 24 * 60 * 60; // 31,536,000
  if (d <= 0 || r <= 0 || s <= 0) return { interest: 0, total: round(d, 8) };
  const interest = round((d * r * s) / SECONDS_PER_YEAR, 8);
  return { interest, total: round(d + interest, 8) };
}

// ── ABI encoding (minimal, offline) ────────────────────────────────────────────────────────────────
// No ethers/web3 dependency (tests run offline, no deps). We hand-encode the two arg shapes the
// CDPVault ABI uses: a single uint256, and (address,uint256) for the ERC20 approve. uint amounts are
// expressed in BASE UNITS (wei-scale) as a decimal string or BigInt — we do NOT apply token decimals
// here (the wallet layer / caller scales human → base units).

const SELECTORS = Object.freeze({
  deposit:  '0xb6b55f25', // deposit(uint256)
  borrow:   '0xc5ebeaec', // borrow(uint256)
  repay:    '0x371fd8e6', // repay(uint256)
  withdraw: '0x2e1a7d4d', // withdraw(uint256)
  approve:  '0x095ea7b3', // approve(address,uint256)  (ERC20, for the lock/repay approvals)
});

/** Encode a non-negative integer (decimal string, number, or BigInt) as a 32-byte hex word. */
function encUint(amount) {
  let v;
  try { v = BigInt(typeof amount === 'number' ? Math.trunc(amount) : (amount ?? 0)); }
  catch { v = 0n; }
  if (v < 0n) v = 0n;
  return v.toString(16).padStart(64, '0');
}

/** Encode a 20-byte address as a 32-byte hex word (left-padded). Soft-fails to the zero word. */
function encAddress(addr) {
  const s = String(addr || '').toLowerCase().replace(/^0x/, '');
  if (!/^[0-9a-f]{40}$/.test(s)) return '0'.repeat(64);
  return s.padStart(64, '0');
}

/** Assemble a tx descriptor. value defaults to '0x0' — CDP ops move ERC20s, never native PRANA.
 *  `chainId` defaults to PRANA MAINNET (712217) — the live CDP. Testnet callers pass 108369.
 *  (the live CDPVault lives on 712217 — see kula-config-addresses.mjs MAINNET_ADDR). */
function descriptor(to, selector, dataWords, label, chainId = 712217) {
  return {
    to: String(to || ''),
    data: selector + dataWords.join(''),
    value: '0x0',
    method: label,
    chainId,
  };
}

/**
 * UNSIGNED tx to LOCK (deposit) KULA collateral into the vault: CDPVault.deposit(uint256 amount).
 * `amount` is KULA in BASE UNITS. Requires a prior ERC20 approve of the vault to pull KULA — use
 * buildApproveTx for that. Returns a descriptor the wallet signs; never signs here.
 */
export function buildOpenVaultTx({ vault, amountBaseUnits, chainId } = {}) {
  return descriptor(vault, SELECTORS.deposit, [encUint(amountBaseUnits)], 'deposit', chainId);
}

/** UNSIGNED tx to BORROW the debt token against locked KULA: CDPVault.borrow(uint256 amount).
 *  On mainnet the debt token is mMELEK (MelekBorrowNote), NOT wMELEK — see MAINNET_ADDR. */
export function buildBorrowTx({ vault, amountBaseUnits, chainId } = {}) {
  return descriptor(vault, SELECTORS.borrow, [encUint(amountBaseUnits)], 'borrow', chainId);
}

/** UNSIGNED tx to REPAY the debt token (burns it, frees collateral): CDPVault.repay(uint256 amount).
 *  Requires a prior ERC20 approve of the vault to pull the debt token — buildApproveTx({token: mMELEK}). */
export function buildRepayTx({ vault, amountBaseUnits, chainId } = {}) {
  return descriptor(vault, SELECTORS.repay, [encUint(amountBaseUnits)], 'repay', chainId);
}

/** UNSIGNED tx to WITHDRAW (unlock) freed KULA collateral: CDPVault.withdraw(uint256 amount). */
export function buildWithdrawTx({ vault, amountBaseUnits, chainId } = {}) {
  return descriptor(vault, SELECTORS.withdraw, [encUint(amountBaseUnits)], 'withdraw', chainId);
}

/**
 * UNSIGNED ERC20 approve so the VAULT can pull the user's token: token.approve(vault, amount).
 * Needed before deposit (approve KULA) and before repay (approve wMELEK). The `to` is the TOKEN
 * contract; the spender encoded in the data is the VAULT.
 */
export function buildApproveTx({ token, vault, amountBaseUnits, chainId } = {}) {
  return descriptor(token, SELECTORS.approve, [encAddress(vault), encUint(amountBaseUnits)], 'approve', chainId);
}

export const CDP_SELECTORS = SELECTORS;

// ── UI fragment (Akasha "Borrow" tab / tokens portal) ───────────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * Render the lend/borrow fragment as an HTML string (all interpolation esc()'d). Shows: lock-KULA
 * amount → max borrowable wMELEK + health factor + liquidation price → a Borrow button the host wires
 * to hand the descriptor to the wallet. PURE: computes the figures from the same helpers above so the
 * preview matches what the chain will enforce. `onBorrow` is the name of a global JS fn the host page
 * defines to receive the descriptor (default 'kulaCdpBorrow').
 *
 * `tvl` is OPTIONAL and ADDITIVE: pass { lockedKula, lockedWmelek, positions, priceKulaInWmelek } and a
 * native-unit Total-Value-Locked badge (from kula-price-tvl.mjs) is rendered at the top. Omitted (the
 * default) → no badge, so existing callers/tests are unaffected.
 */
export function renderLendFragment({
  collateralKula = 0,
  kulaPrice = 0,
  melekPrice = 0,
  maxLtv = DEFAULT_CDP.maxLtv,
  liqRatio = DEFAULT_CDP.liqRatio,
  debtMelek = 0,
  onBorrow = 'kulaCdpBorrow',
  tvl = null,
} = {}) {
  const col = nn(collateralKula);
  const borrowable = maxBorrow({ collateralKula: col, kulaPrice, melekPrice, maxLtv });
  // Preview HF/liqPrice for borrowing the FULL borrowable (worst case) unless a debt is given.
  const debt = nn(debtMelek) || borrowable;
  const hf = healthFactor({ collateralKula: col, kulaPrice, debtMelek: debt, melekPrice, liqRatio });
  const liqPx = liquidationPrice({ collateralKula: col, debtMelek: debt, melekPrice, liqRatio });
  const hfTxt = hf === Infinity ? '∞ (no debt)' : hf.toFixed(2);
  const hfClass = hf === Infinity || hf >= 1.5 ? 'ok' : hf >= 1 ? 'warn' : 'bad';
  const fn = esc(onBorrow);

  // Optional TVL badge at the top (native units, AMM-relative — no fake USD). Soft: skip on bad input.
  let tvlBadge = '';
  if (tvl && typeof tvl === 'object') {
    try { tvlBadge = renderTvlBadge(tvl); } catch { tvlBadge = ''; }
  }

  return [
    '<div class="kula-cdp" data-kula-cdp>',
    tvlBadge,
    '<h3>Borrow wMELEK against KULA</h3>',
    '<p class="cdp-sub">Lock KULA collateral, borrow wMELEK up to ',
    esc((maxLtv * 100).toFixed(0)), '% LTV. Repay to unlock. Locked KULA leaves circulation.</p>',
    '<label>Lock KULA<input type="number" min="0" step="any" value="', esc(col),
      '" data-cdp-collateral></label>',
    '<dl class="cdp-stats">',
    '<dt>Max borrowable</dt><dd data-cdp-borrowable>', esc(borrowable), ' wMELEK</dd>',
    '<dt>Health factor</dt><dd class="hf-', hfClass, '" data-cdp-hf>', esc(hfTxt), '</dd>',
    '<dt>Liquidation price</dt><dd data-cdp-liqprice>', esc(liqPx), ' / KULA</dd>',
    '<dt>Liquidation ratio</dt><dd>', esc((liqRatio * 100).toFixed(0)), '%</dd>',
    '</dl>',
    '<button type="button" data-cdp-borrow onclick="', fn, '()">Lock &amp; Borrow</button>',
    '<p class="cdp-warn">If KULA falls to the liquidation price your collateral can be liquidated. ',
    'Borrow below the max for a safety buffer.</p>',
    '</div>',
  ].join('');
}

// CLI demo (guarded) — a worked example of the lock→borrow→liquidation flow.
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('kula-cdp.mjs')) {
  const collateralKula = 10000, kulaPrice = 0.05, melekPrice = 0.50; // $500 of KULA, wMELEK $0.50
  const borrowable = maxBorrow({ collateralKula, kulaPrice, melekPrice });
  console.log(`Lock ${collateralKula} KULA @ $${kulaPrice} ($${collateralKula * kulaPrice}) →`,
    `max borrow ${borrowable} wMELEK (@ $${melekPrice}, ${DEFAULT_CDP.maxLtv * 100}% LTV)`);
  const debtMelek = borrowable;
  console.log('Health factor at full borrow:',
    healthFactor({ collateralKula, kulaPrice, debtMelek, melekPrice }));
  console.log('Liquidation KULA price:',
    liquidationPrice({ collateralKula, debtMelek, melekPrice }));
  console.log('Interest after 30d on the debt:',
    accrueInterest({ debt: debtMelek, ratePerYear: DEFAULT_CDP.ratePerYear, seconds: 30 * 86400 }));
  console.log('borrow tx:', buildBorrowTx({ vault: '0x' + '11'.repeat(20), amountBaseUnits: '1000000000000000000' }));
}
