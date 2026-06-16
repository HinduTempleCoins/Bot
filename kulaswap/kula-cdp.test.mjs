// kula-cdp.test.mjs — offline tests for the KULA→wMELEK CDP helpers. node:test, no network, no deps.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  maxBorrow, healthFactor, liquidationPrice, accrueInterest,
  buildOpenVaultTx, buildBorrowTx, buildRepayTx, buildWithdrawTx, buildApproveTx,
  renderLendFragment, DEFAULT_CDP, CDP_SELECTORS,
} from './kula-cdp.mjs';

const VAULT = '0x' + '11'.repeat(20);
const WMELEK = '0x4C4a2f8c81640e47606d3fd77B353E87Ba015584';
const KULA = '0x4c5859f0F772848b2D91F1D83E2Fe57935348029';

// ── maxBorrow ──────────────────────────────────────────────────────────────────────────────────────
test('maxBorrow: worked example — 10000 KULA @ $0.05, wMELEK $0.50, 50% LTV → 500 wMELEK', () => {
  assert.equal(maxBorrow({ collateralKula: 10000, kulaPrice: 0.05, melekPrice: 0.50, maxLtv: 0.5 }), 500);
});

test('maxBorrow: scales with LTV', () => {
  assert.equal(maxBorrow({ collateralKula: 1000, kulaPrice: 1, melekPrice: 1, maxLtv: 0.66 }), 660);
});

test('maxBorrow: uses DEFAULT_CDP.maxLtv when omitted', () => {
  assert.equal(maxBorrow({ collateralKula: 1000, kulaPrice: 1, melekPrice: 1 }), 1000 * DEFAULT_CDP.maxLtv);
});

test('maxBorrow: soft-fails to 0 on zero/negative/missing inputs', () => {
  assert.equal(maxBorrow({ collateralKula: 0, kulaPrice: 1, melekPrice: 1 }), 0);
  assert.equal(maxBorrow({ collateralKula: 100, kulaPrice: 1, melekPrice: 0 }), 0); // div by zero guarded
  assert.equal(maxBorrow({ collateralKula: -5, kulaPrice: 1, melekPrice: 1 }), 0);
  assert.equal(maxBorrow({}), 0);
  assert.equal(maxBorrow(), 0);
  assert.equal(maxBorrow({ collateralKula: 'x', kulaPrice: 1, melekPrice: 1 }), 0);
});

test('maxBorrow: clamps maxLtv to [0,1]', () => {
  assert.equal(maxBorrow({ collateralKula: 100, kulaPrice: 1, melekPrice: 1, maxLtv: 5 }), 100);  // clamp to 1
  assert.equal(maxBorrow({ collateralKula: 100, kulaPrice: 1, melekPrice: 1, maxLtv: -1 }), 0);   // clamp to 0
});

// ── healthFactor ─────────────────────────────────────────────────────────────────────────────────────
test('healthFactor: 10000 KULA @ $0.05, debt 500 wMELEK @ $0.50, liqRatio 0.6 → HF 1.2', () => {
  // collateralValue=500, liqRatio 0.6 → 300; debtValue=250 → HF=300/250=1.2
  assert.equal(healthFactor({ collateralKula: 10000, kulaPrice: 0.05, debtMelek: 500, melekPrice: 0.50, liqRatio: 0.6 }), 1.2);
});

test('healthFactor: > 1 safe, < 1 liquidatable (price drop)', () => {
  const safe = healthFactor({ collateralKula: 10000, kulaPrice: 0.05, debtMelek: 250, melekPrice: 0.50, liqRatio: 0.6 });
  assert.ok(safe > 1, `expected safe HF > 1, got ${safe}`);
  // KULA halves to $0.025 → collateralValue 250 → *0.6=150; debt value 250 → HF 0.6 < 1
  const bad = healthFactor({ collateralKula: 10000, kulaPrice: 0.025, debtMelek: 500, melekPrice: 0.50, liqRatio: 0.6 });
  assert.ok(bad < 1, `expected liquidatable HF < 1, got ${bad}`);
});

test('healthFactor: no debt → Infinity (never liquidatable)', () => {
  assert.equal(healthFactor({ collateralKula: 100, kulaPrice: 1, debtMelek: 0, melekPrice: 1 }), Infinity);
});

test('healthFactor: debt but no collateral → 0 (fully liquidatable)', () => {
  assert.equal(healthFactor({ collateralKula: 0, kulaPrice: 1, debtMelek: 100, melekPrice: 1 }), 0);
});

test('healthFactor: garbage inputs soft-fail (no throw)', () => {
  assert.equal(healthFactor(), Infinity);            // no debt
  assert.equal(healthFactor({ debtMelek: 'x', melekPrice: 'y' }), Infinity);
});

// ── liquidationPrice ─────────────────────────────────────────────────────────────────────────────────
test('liquidationPrice: 10000 KULA, debt 500 @ $0.50, liqRatio 0.6 → $0.04166667 / KULA', () => {
  // (500*0.50)/(10000*0.6) = 250/6000 = 0.041666..
  assert.equal(liquidationPrice({ collateralKula: 10000, debtMelek: 500, melekPrice: 0.50, liqRatio: 0.6 }), 0.04166667);
});

test('liquidationPrice: at that KULA price HF crosses 1', () => {
  const liqPx = liquidationPrice({ collateralKula: 10000, debtMelek: 500, melekPrice: 0.50, liqRatio: 0.6 });
  const hf = healthFactor({ collateralKula: 10000, kulaPrice: liqPx, debtMelek: 500, melekPrice: 0.50, liqRatio: 0.6 });
  assert.ok(Math.abs(hf - 1) < 1e-4, `HF at liq price should be ~1, got ${hf}`);
});

test('liquidationPrice: soft-fails to 0 with no debt / no collateral', () => {
  assert.equal(liquidationPrice({ collateralKula: 100, debtMelek: 0, melekPrice: 1 }), 0);
  assert.equal(liquidationPrice({ collateralKula: 0, debtMelek: 100, melekPrice: 1 }), 0);
  assert.equal(liquidationPrice(), 0);
});

// ── accrueInterest ─────────────────────────────────────────────────────────────────────────────────
test('accrueInterest: 5% APR on 500 over 1 year → 25 interest, 525 total', () => {
  const r = accrueInterest({ debt: 500, ratePerYear: 0.05, seconds: 365 * 24 * 60 * 60 });
  assert.equal(r.interest, 25);
  assert.equal(r.total, 525);
});

test('accrueInterest: 30 days proportional', () => {
  const r = accrueInterest({ debt: 500, ratePerYear: 0.05, seconds: 30 * 86400 });
  assert.equal(r.interest, 2.05479452);
  assert.equal(r.total, 502.05479452);
});

test('accrueInterest: zero rate / zero time → principal, no interest', () => {
  assert.deepEqual(accrueInterest({ debt: 100, ratePerYear: 0, seconds: 1000 }), { interest: 0, total: 100 });
  assert.deepEqual(accrueInterest({ debt: 100, ratePerYear: 0.05, seconds: 0 }), { interest: 0, total: 100 });
  assert.deepEqual(accrueInterest(), { interest: 0, total: 0 });
});

// ── tx descriptors ────────────────────────────────────────────────────────────────────────────────
const WORD = (h) => h.padStart(64, '0');
const ONE_E18 = '1000000000000000000';
const ONE_E18_WORD = '0000000000000000000000000000000000000000000000000de0b6b3a7640000';

test('buildOpenVaultTx encodes CDPVault.deposit(uint256)', () => {
  const tx = buildOpenVaultTx({ vault: VAULT, amountBaseUnits: ONE_E18 });
  assert.equal(tx.to, VAULT);
  assert.equal(tx.value, '0x0');
  assert.equal(tx.chainId, 108369);
  assert.equal(tx.method, 'deposit');
  assert.equal(tx.data, CDP_SELECTORS.deposit + ONE_E18_WORD);
  assert.ok(tx.data.startsWith('0xb6b55f25'));
});

test('buildBorrowTx encodes CDPVault.borrow(uint256)', () => {
  const tx = buildBorrowTx({ vault: VAULT, amountBaseUnits: ONE_E18 });
  assert.equal(tx.data, '0xc5ebeaec' + ONE_E18_WORD);
  assert.equal(tx.method, 'borrow');
});

test('buildRepayTx encodes CDPVault.repay(uint256)', () => {
  const tx = buildRepayTx({ vault: VAULT, amountBaseUnits: ONE_E18 });
  assert.equal(tx.data, '0x371fd8e6' + ONE_E18_WORD);
  assert.equal(tx.method, 'repay');
});

test('buildWithdrawTx encodes CDPVault.withdraw(uint256)', () => {
  const tx = buildWithdrawTx({ vault: VAULT, amountBaseUnits: ONE_E18 });
  assert.equal(tx.data, '0x2e1a7d4d' + ONE_E18_WORD);
  assert.equal(tx.method, 'withdraw');
});

test('buildApproveTx encodes ERC20 approve(spender=vault, amount) on the token contract', () => {
  const tx = buildApproveTx({ token: KULA, vault: VAULT, amountBaseUnits: ONE_E18 });
  assert.equal(tx.to, KULA); // approve is sent to the TOKEN, not the vault
  // data = selector + addr(vault) + amount
  const expectAddr = WORD('11'.repeat(20)); // vault left-padded
  assert.equal(tx.data, '0x095ea7b3' + expectAddr + ONE_E18_WORD);
  assert.equal(tx.method, 'approve');
});

test('approve for wMELEK repay flow points spender at the vault', () => {
  const tx = buildApproveTx({ token: WMELEK, vault: VAULT, amountBaseUnits: ONE_E18 });
  assert.equal(tx.to, WMELEK);
  assert.ok(tx.data.includes('11'.repeat(20).padStart(64, '0')));
});

test('descriptors: amount=0 and garbage encode to a zero word, never throw', () => {
  assert.equal(buildBorrowTx({ vault: VAULT, amountBaseUnits: 0 }).data, '0xc5ebeaec' + WORD('0'));
  assert.equal(buildBorrowTx({ vault: VAULT, amountBaseUnits: 'not-a-number' }).data, '0xc5ebeaec' + WORD('0'));
  assert.equal(buildBorrowTx({ vault: VAULT, amountBaseUnits: -5 }).data, '0xc5ebeaec' + WORD('0')); // negative clamped
  assert.equal(buildBorrowTx({}).to, '');           // missing vault → empty to, no throw
  assert.doesNotThrow(() => buildBorrowTx());
});

test('descriptors: accepts BigInt and number amounts', () => {
  assert.equal(buildBorrowTx({ vault: VAULT, amountBaseUnits: 10n ** 18n }).data, '0xc5ebeaec' + ONE_E18_WORD);
  assert.equal(buildBorrowTx({ vault: VAULT, amountBaseUnits: 255 }).data, '0xc5ebeaec' + WORD('ff'));
});

test('buildApproveTx: bad address soft-fails to zero address word', () => {
  const tx = buildApproveTx({ token: KULA, vault: 'nope', amountBaseUnits: ONE_E18 });
  assert.equal(tx.data, '0x095ea7b3' + WORD('0') + ONE_E18_WORD);
});

// ── UI fragment ──────────────────────────────────────────────────────────────────────────────────
test('renderLendFragment: shows borrowable, HF, liq price; escapes; wires onBorrow', () => {
  const html = renderLendFragment({ collateralKula: 10000, kulaPrice: 0.05, melekPrice: 0.50 });
  assert.match(html, /Borrow wMELEK against KULA/);
  assert.match(html, /500 wMELEK/);             // max borrowable
  assert.match(html, /0\.04166667 \/ KULA/);    // liq price (full-borrow worst case)
  assert.match(html, /kulaCdpBorrow\(\)/);      // default borrow hook
  assert.match(html, /data-cdp-collateral/);
});

test('renderLendFragment: custom onBorrow name is escaped, no raw injection', () => {
  const html = renderLendFragment({ collateralKula: 1, kulaPrice: 1, melekPrice: 1, onBorrow: '"><img src=x>' });
  assert.ok(!html.includes('"><img src=x>'), 'must escape the onBorrow handler name');
  assert.match(html, /&quot;&gt;&lt;img/);
});

test('renderLendFragment: no debt (zero collateral) → safe shape, no throw', () => {
  assert.doesNotThrow(() => renderLendFragment());
  const html = renderLendFragment({ collateralKula: 0, kulaPrice: 0, melekPrice: 0 });
  assert.match(html, /0 wMELEK/);
});

test('CDP_SELECTORS match the verified CDPVault ABI selectors', () => {
  assert.equal(CDP_SELECTORS.deposit, '0xb6b55f25');
  assert.equal(CDP_SELECTORS.borrow, '0xc5ebeaec');
  assert.equal(CDP_SELECTORS.repay, '0x371fd8e6');
  assert.equal(CDP_SELECTORS.withdraw, '0x2e1a7d4d');
  assert.equal(CDP_SELECTORS.approve, '0x095ea7b3');
});
