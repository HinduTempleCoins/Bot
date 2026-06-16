// melek-alti-cdp.mjs — CDP MARKET 2: "lock MELEK/wMELEK → borrow ALTI".
//
// The second one-directional CDP market in the MELEK/KULA DeFi DAG:
//   Market 1 (kula-cdp.mjs):  lock KULA   → borrow wMELEK   (wMELEK lent from a bridge reserve)
//   Market 2 (THIS file):     lock wMELEK → borrow ALTI     (ALTI MINTED Maker-style by the vault)
//
// The graph KULA → wMELEK → ALTI is a DAG (one-way), terminating at ALTI: ALTI is the debt-of-last-
// resort, collateral for NOTHING. So there is no cycle — see cdp-loop-safety.mjs for the proof.
//
// ALTI is the SoapBox delegation-mining token (NutBox "PNUTs"). It is MINTABLE: the on-chain path is a
// CDPVaultV2 whose `debtToken` is ALTI and which holds ALTI's MINTER_ROLE — so borrowing MINTS ALTI and
// repaying BURNS it (ERC20Burnable), exactly the Maker DAI model. ALTI is uncapped on testnet, so the
// only thing keeping it sound is the OVERCOLLATERALIZATION enforced by the vault (debt ≤ collateral*LTV).
//
// This module is the OFF-CHAIN tuner + tx-descriptor builder mirroring kula-cdp.mjs, but with
// collateral=MELEK/wMELEK and debt=ALTI:
//   - pure math: maxBorrowAlti / healthFactor / liquidationPrice / accrueInterest
//   - UNSIGNED tx descriptors against the Market-2 CDPVault (deposit/borrow/repay/withdraw + approve)
//   - a Borrow-tab UI fragment (all interpolation esc()'d)
//
// House style: pure arithmetic, soft-fail to safe shapes, NEVER throws. No network, no deps. We NEVER
// sign or broadcast — only describe the call; Akasha/MetaMask signs. Selectors are the real keccak256
// 4-byte selectors of the CDPVault ABI (identical signatures to Market 1; verified vs CDPVault.sol).

import { ADDR } from './kula-config-addresses.mjs';

const nn = (x) => { const v = +x; return Number.isFinite(v) && v >= 0 ? v : 0; };
const round = (x, d = 8) => { const f = +(+x).toFixed(d); return Number.isFinite(f) ? f : 0; };

// ── Default Market-2 CDP params (off-chain mirror of the on-chain constructor args) ─────────────────
// MELEK-collateral / ALTI-debt. ALTI is mint-on-borrow, so the cushion is everything: a CONSERVATIVE
// maxLtv (lower than Market 1's 0.5) because ALTI is a thinner, freshly-minted reward token and MELEK
// is the system's core asset we don't want over-leveraged.
//   maxLtv      — borrow up to this fraction of MELEK collateral USD value. 0.4 = 40%.
//   liqRatio    — liquidation threshold (> maxLtv): HF crosses 1 here. 0.5 = liquidate when debt value
//                 exceeds 50% of collateral value.
//   ratePerYear — stability fee / borrow APR accrued on the ALTI debt.
//   liqBonusBps — collateral bonus a liquidator seizes (informational; enforced by the engine).
export const DEFAULT_ALTI_CDP = Object.freeze({
  maxLtv: 0.4,        // lock $100 of MELEK → borrow up to $40 of ALTI
  liqRatio: 0.5,      // liquidate once ALTI debt value exceeds 50% of MELEK collateral value
  ratePerYear: 0.08,  // 8% APR stability fee on the ALTI debt (higher than M1 — thinner debt token)
  liqBonusBps: 1000,  // 10% liquidation bonus (informational; enforced by CollateralLiquidationEngine)
});

/**
 * Max ALTI mintable/borrowable against locked MELEK collateral.
 *   borrowable_ALTI = (collateralMelek * melekPrice * maxLtv) / altiPrice
 * Prices share any consistent quote unit (USD). Soft-fails to 0 on bad/zero inputs.
 */
export function maxBorrowAlti({ collateralMelek, melekPrice, altiPrice, maxLtv = DEFAULT_ALTI_CDP.maxLtv } = {}) {
  const col = nn(collateralMelek), mp = nn(melekPrice), ap = nn(altiPrice);
  const ltv = Math.min(1, Math.max(0, nn(maxLtv)));
  if (ap <= 0 || mp <= 0 || col <= 0 || ltv <= 0) return 0;
  return round((col * mp * ltv) / ap, 8);
}

/**
 * Health factor (plain ratio; matches the vault's 1e18-scaled healthFactor / 1e18).
 *   HF = (collateralValue * liqRatio) / debtValue
 * HF > 1 → safe; HF < 1 → liquidatable; no debt → Infinity.
 */
export function healthFactor({ collateralMelek, melekPrice, debtAlti, altiPrice, liqRatio = DEFAULT_ALTI_CDP.liqRatio } = {}) {
  const col = nn(collateralMelek), mp = nn(melekPrice), debt = nn(debtAlti), ap = nn(altiPrice);
  const lr = Math.min(1, Math.max(0, nn(liqRatio)));
  const debtValue = debt * ap;
  if (debtValue <= 0) return Infinity;            // no debt → never liquidatable
  if (col <= 0 || mp <= 0 || lr <= 0) return 0;   // debt but no/zero collateral → fully liquidatable
  const collateralValue = col * mp;
  return round((collateralValue * lr) / debtValue, 8);
}

/**
 * MELEK price at which the position becomes liquidatable (HF = 1):
 *   liqPrice = (debtAlti * altiPrice) / (collateralMelek * liqRatio)
 * Below this MELEK price the collateral no longer covers the ALTI debt at the liq ratio.
 * Soft-fails to 0 (no debt or no collateral → no meaningful liquidation price).
 */
export function liquidationPrice({ collateralMelek, debtAlti, altiPrice, liqRatio = DEFAULT_ALTI_CDP.liqRatio } = {}) {
  const col = nn(collateralMelek), debt = nn(debtAlti), ap = nn(altiPrice);
  const lr = Math.min(1, Math.max(0, nn(liqRatio)));
  if (col <= 0 || lr <= 0 || debt <= 0 || ap <= 0) return 0;
  return round((debt * ap) / (col * lr), 8);
}

/**
 * Accrue simple interest (stability fee) on an ALTI debt over `seconds` at `ratePerYear`.
 * Simple (linear per-second) accrual; returns { interest, total }. Soft-fails to principal, zero interest.
 */
export function accrueInterest({ debt, ratePerYear, seconds } = {}) {
  const d = nn(debt), r = nn(ratePerYear), s = nn(seconds);
  const SECONDS_PER_YEAR = 365 * 24 * 60 * 60; // 31,536,000
  if (d <= 0 || r <= 0 || s <= 0) return { interest: 0, total: round(d, 8) };
  const interest = round((d * r * s) / SECONDS_PER_YEAR, 8);
  return { interest, total: round(d + interest, 8) };
}

// ── ABI encoding (minimal, offline — identical shape to kula-cdp.mjs) ────────────────────────────────
// The Market-2 CDPVault has the SAME ABI as Market 1's (it is a CDPVault/CDPVaultV2 instance), so the
// selectors are identical. Amounts are BASE UNITS (wei-scale) as a decimal string/number/BigInt; token
// decimals are applied by the wallet layer, not here.

const SELECTORS = Object.freeze({
  deposit:  '0xb6b55f25', // deposit(uint256)
  borrow:   '0xc5ebeaec', // borrow(uint256)
  repay:    '0x371fd8e6', // repay(uint256)
  withdraw: '0x2e1a7d4d', // withdraw(uint256)
  approve:  '0x095ea7b3', // approve(address,uint256)  (ERC20, for lock/repay approvals)
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

/** Assemble a tx descriptor. value '0x0' — CDP ops move ERC20s, never native PRANA. */
function descriptor(to, selector, dataWords, label) {
  return {
    to: String(to || ''),
    data: selector + dataWords.join(''),
    value: '0x0',
    method: label,
    chainId: 108369, // PRANA
  };
}

/**
 * UNSIGNED tx to LOCK (deposit) MELEK/wMELEK collateral into the Market-2 vault:
 * CDPVault.deposit(uint256 amount). `amount` is wMELEK in BASE UNITS. Requires a prior ERC20 approve of
 * the vault to pull wMELEK — use buildApproveTx({ token: wMELEK, vault }). Returns a wallet-signs descriptor.
 */
export function buildDepositTx({ vault, amountBaseUnits } = {}) {
  return descriptor(vault, SELECTORS.deposit, [encUint(amountBaseUnits)], 'deposit');
}

/** UNSIGNED tx to BORROW (mint) ALTI against locked MELEK: CDPVault.borrow(uint256 amount). */
export function buildBorrowTx({ vault, amountBaseUnits } = {}) {
  return descriptor(vault, SELECTORS.borrow, [encUint(amountBaseUnits)], 'borrow');
}

/** UNSIGNED tx to REPAY ALTI debt (burns it, frees collateral): CDPVault.repay(uint256 amount).
 *  Requires a prior ERC20 approve of the vault to pull ALTI — use buildApproveTx({ token: ALTI, vault }). */
export function buildRepayTx({ vault, amountBaseUnits } = {}) {
  return descriptor(vault, SELECTORS.repay, [encUint(amountBaseUnits)], 'repay');
}

/** UNSIGNED tx to WITHDRAW (unlock) freed MELEK collateral: CDPVault.withdraw(uint256 amount). */
export function buildWithdrawTx({ vault, amountBaseUnits } = {}) {
  return descriptor(vault, SELECTORS.withdraw, [encUint(amountBaseUnits)], 'withdraw');
}

/**
 * UNSIGNED ERC20 approve so the VAULT can pull the user's token: token.approve(vault, amount).
 * Needed before deposit (approve wMELEK) and before repay (approve ALTI). `to` is the TOKEN contract;
 * the spender encoded in the data is the VAULT.
 */
export function buildApproveTx({ token, vault, amountBaseUnits } = {}) {
  return descriptor(token, SELECTORS.approve, [encAddress(vault), encUint(amountBaseUnits)], 'approve');
}

export const ALTI_CDP_SELECTORS = SELECTORS;

// ── UI fragment (Akasha "Borrow ALTI" tab / tokens portal) ───────────────────────────────────────────
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/**
 * Render the Market-2 borrow fragment as an HTML string (all interpolation esc()'d). Lock wMELEK →
 * max mintable ALTI + health factor + liquidation MELEK price → a Borrow button the host wires to hand
 * the descriptor to the wallet. PURE: figures come from the same helpers, so the preview matches the
 * chain's enforcement. `onBorrow` is the global JS fn the host page defines (default 'meleAltiCdpBorrow').
 */
export function renderBorrowFragment({
  collateralMelek = 0,
  melekPrice = 0,
  altiPrice = 0,
  maxLtv = DEFAULT_ALTI_CDP.maxLtv,
  liqRatio = DEFAULT_ALTI_CDP.liqRatio,
  debtAlti = 0,
  onBorrow = 'meleAltiCdpBorrow',
} = {}) {
  const col = nn(collateralMelek);
  const borrowable = maxBorrowAlti({ collateralMelek: col, melekPrice, altiPrice, maxLtv });
  // Preview HF/liqPrice for borrowing the FULL borrowable (worst case) unless a debt is given.
  const debt = nn(debtAlti) || borrowable;
  const hf = healthFactor({ collateralMelek: col, melekPrice, debtAlti: debt, altiPrice, liqRatio });
  const liqPx = liquidationPrice({ collateralMelek: col, debtAlti: debt, altiPrice, liqRatio });
  const hfTxt = hf === Infinity ? '∞ (no debt)' : hf.toFixed(2);
  const hfClass = hf === Infinity || hf >= 1.5 ? 'ok' : hf >= 1 ? 'warn' : 'bad';
  const fn = esc(onBorrow);

  return [
    '<div class="melek-alti-cdp" data-alti-cdp>',
    '<h3>Borrow ALTI against MELEK</h3>',
    '<p class="cdp-sub">Lock wMELEK collateral, mint ALTI up to ',
    esc((maxLtv * 100).toFixed(0)), '% LTV. Repay to unlock. Borrowing mints ALTI; repaying burns it.</p>',
    '<label>Lock wMELEK<input type="number" min="0" step="any" value="', esc(col),
      '" data-alti-collateral></label>',
    '<dl class="cdp-stats">',
    '<dt>Max borrowable</dt><dd data-alti-borrowable>', esc(borrowable), ' ALTI</dd>',
    '<dt>Health factor</dt><dd class="hf-', hfClass, '" data-alti-hf>', esc(hfTxt), '</dd>',
    '<dt>Liquidation price</dt><dd data-alti-liqprice>', esc(liqPx), ' / MELEK</dd>',
    '<dt>Liquidation ratio</dt><dd>', esc((liqRatio * 100).toFixed(0)), '%</dd>',
    '</dl>',
    '<button type="button" data-alti-borrow onclick="', fn, '()">Lock &amp; Borrow ALTI</button>',
    '<p class="cdp-warn">If MELEK falls to the liquidation price your collateral can be liquidated. ',
    'Borrow below the max for a safety buffer.</p>',
    '</div>',
  ].join('');
}

// CLI demo (guarded) — a worked Market-2 lock→borrow→liquidation example.
if (typeof process !== 'undefined' && process.argv[1] && process.argv[1].endsWith('melek-alti-cdp.mjs')) {
  const collateralMelek = 1000, melekPrice = 0.50, altiPrice = 0.02; // $500 of MELEK, ALTI $0.02
  const borrowable = maxBorrowAlti({ collateralMelek, melekPrice, altiPrice });
  console.log(`Lock ${collateralMelek} wMELEK @ $${melekPrice} ($${collateralMelek * melekPrice}) →`,
    `max borrow ${borrowable} ALTI (@ $${altiPrice}, ${DEFAULT_ALTI_CDP.maxLtv * 100}% LTV)`);
  const debtAlti = borrowable;
  console.log('Health factor at full borrow:',
    healthFactor({ collateralMelek, melekPrice, debtAlti, altiPrice }));
  console.log('Liquidation MELEK price:',
    liquidationPrice({ collateralMelek, debtAlti, altiPrice }));
  console.log('Interest after 30d on the ALTI debt:',
    accrueInterest({ debt: debtAlti, ratePerYear: DEFAULT_ALTI_CDP.ratePerYear, seconds: 30 * 86400 }));
  console.log('borrow tx:', buildBorrowTx({ vault: '0x' + '22'.repeat(20), amountBaseUnits: '1000000000000000000' }));
  console.log('on-chain addrs:', { wMELEK: ADDR.wMELEK, ALTI: ADDR.ALTI, DelegationMint: ADDR.DelegationMint });
}
