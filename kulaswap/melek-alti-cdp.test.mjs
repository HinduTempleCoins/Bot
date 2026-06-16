// melek-alti-cdp.test.mjs — OFFLINE. Market-2 CDP helpers (lock wMELEK → borrow ALTI). Pure math +
// unsigned tx descriptors + UI fragment. No network, no signing.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_ALTI_CDP, maxBorrowAlti, healthFactor, liquidationPrice, accrueInterest,
  buildDepositTx, buildBorrowTx, buildRepayTx, buildWithdrawTx, buildApproveTx,
  ALTI_CDP_SELECTORS, renderBorrowFragment,
} from './melek-alti-cdp.mjs';

test('maxBorrowAlti = collateral * melekPrice * ltv / altiPrice', () => {
  // $500 MELEK at 40% LTV = $200 of ALTI; ALTI $0.02 → 10000 ALTI
  assert.equal(maxBorrowAlti({ collateralMelek: 1000, melekPrice: 0.5, altiPrice: 0.02 }), 10000);
  assert.equal(maxBorrowAlti({ collateralMelek: 1000, melekPrice: 0.5, altiPrice: 0.02, maxLtv: 0.2 }), 5000);
});

test('maxBorrowAlti soft-fails to 0 on bad/zero/negative input (never throws)', () => {
  assert.equal(maxBorrowAlti(), 0);
  assert.equal(maxBorrowAlti({ collateralMelek: 0, melekPrice: 1, altiPrice: 1 }), 0);
  assert.equal(maxBorrowAlti({ collateralMelek: 1000, melekPrice: 0.5, altiPrice: 0 }), 0, 'no altiPrice → 0');
  assert.equal(maxBorrowAlti({ collateralMelek: -5, melekPrice: 1, altiPrice: 1 }), 0);
  assert.equal(maxBorrowAlti({ collateralMelek: 'x', melekPrice: 'y', altiPrice: 'z' }), 0);
});

test('maxBorrowAlti clamps maxLtv into [0,1]', () => {
  // ltv clamped to 1 → full collateral value in ALTI
  assert.equal(maxBorrowAlti({ collateralMelek: 100, melekPrice: 1, altiPrice: 1, maxLtv: 5 }), 100);
  assert.equal(maxBorrowAlti({ collateralMelek: 100, melekPrice: 1, altiPrice: 1, maxLtv: -1 }), 0);
});

test('healthFactor: >1 safe, <1 liquidatable, Infinity when no debt', () => {
  // 1000 MELEK @ $0.5 = $500, liqRatio 0.5 → $250 covers; debt 10000 ALTI @ $0.02 = $200 → HF 1.25
  assert.equal(healthFactor({ collateralMelek: 1000, melekPrice: 0.5, debtAlti: 10000, altiPrice: 0.02 }), 1.25);
  assert.equal(healthFactor({ collateralMelek: 1000, melekPrice: 0.5, debtAlti: 0, altiPrice: 0.02 }), Infinity);
  // price of MELEK halves → HF halves → below 1
  assert.ok(healthFactor({ collateralMelek: 1000, melekPrice: 0.25, debtAlti: 10000, altiPrice: 0.02 }) < 1);
});

test('healthFactor: debt but no collateral → 0 (fully liquidatable), never throws', () => {
  assert.equal(healthFactor({ collateralMelek: 0, melekPrice: 0.5, debtAlti: 100, altiPrice: 0.02 }), 0);
  assert.equal(healthFactor(), Infinity, 'no args → no debt → Infinity');
});

test('liquidationPrice is the MELEK price where HF = 1', () => {
  const args = { collateralMelek: 1000, debtAlti: 10000, altiPrice: 0.02, liqRatio: 0.5 };
  const lp = liquidationPrice(args); // (10000*0.02)/(1000*0.5) = 200/500 = 0.4
  assert.equal(lp, 0.4);
  // at that MELEK price the HF should be exactly 1
  assert.equal(healthFactor({ collateralMelek: 1000, melekPrice: lp, debtAlti: 10000, altiPrice: 0.02, liqRatio: 0.5 }), 1);
});

test('liquidationPrice soft-fails to 0 with no debt / no collateral', () => {
  assert.equal(liquidationPrice({ collateralMelek: 1000, debtAlti: 0, altiPrice: 0.02 }), 0);
  assert.equal(liquidationPrice({ collateralMelek: 0, debtAlti: 100, altiPrice: 0.02 }), 0);
  assert.equal(liquidationPrice(), 0);
});

test('accrueInterest: simple linear per-year fee, soft-fails to principal', () => {
  const oneYear = 365 * 24 * 60 * 60;
  const r = accrueInterest({ debt: 1000, ratePerYear: 0.08, seconds: oneYear });
  assert.equal(r.interest, 80, '8% of 1000 over a year');
  assert.equal(r.total, 1080);
  assert.deepEqual(accrueInterest({ debt: 1000, ratePerYear: 0, seconds: oneYear }), { interest: 0, total: 1000 });
  assert.deepEqual(accrueInterest(), { interest: 0, total: 0 });
});

test('default Market-2 params are conservative (lower LTV than Market 1)', () => {
  assert.ok(DEFAULT_ALTI_CDP.maxLtv < 0.5, 'M2 LTV below M1 0.5 — ALTI is a thinner minted token');
  assert.ok(DEFAULT_ALTI_CDP.liqRatio > DEFAULT_ALTI_CDP.maxLtv, 'liq buffer above borrow LTV');
});

test('tx descriptors carry the right selectors, PRANA chainId, value 0x0', () => {
  const vault = '0x' + '22'.repeat(20);
  const amt = '1000000000000000000'; // 1e18
  assert.equal(buildDepositTx({ vault, amountBaseUnits: amt }).data.slice(0, 10), ALTI_CDP_SELECTORS.deposit);
  assert.equal(buildBorrowTx({ vault, amountBaseUnits: amt }).data.slice(0, 10), ALTI_CDP_SELECTORS.borrow);
  assert.equal(buildRepayTx({ vault, amountBaseUnits: amt }).data.slice(0, 10), ALTI_CDP_SELECTORS.repay);
  assert.equal(buildWithdrawTx({ vault, amountBaseUnits: amt }).data.slice(0, 10), ALTI_CDP_SELECTORS.withdraw);
  for (const tx of [buildDepositTx({ vault, amountBaseUnits: amt }), buildBorrowTx({ vault, amountBaseUnits: amt })]) {
    assert.equal(tx.value, '0x0');
    assert.equal(tx.chainId, 108369);
    assert.equal(tx.to, vault);
    assert.equal(tx.data.length, 10 + 64, 'selector + one uint256 word');
  }
});

test('borrow descriptor encodes the amount correctly (1e18 → de0b6b3a7640000)', () => {
  const tx = buildBorrowTx({ vault: '0x' + '22'.repeat(20), amountBaseUnits: '1000000000000000000' });
  assert.ok(tx.data.endsWith('de0b6b3a7640000'.padStart(64, '0')));
});

test('buildApproveTx encodes (vault spender, amount) and targets the TOKEN', () => {
  const token = '0xFD471836031dc5108809D173A067e8486B9047A3'; // ALTI
  const vault = '0x' + '22'.repeat(20);
  const tx = buildApproveTx({ token, vault, amountBaseUnits: '5' });
  assert.equal(tx.to, token, 'approve targets the token contract');
  assert.equal(tx.data.slice(0, 10), ALTI_CDP_SELECTORS.approve);
  assert.equal(tx.data.length, 10 + 128, 'selector + address word + amount word');
  assert.ok(tx.data.toLowerCase().includes('22'.repeat(20)), 'vault address encoded as spender');
});

test('descriptors soft-fail on bad amounts to a zero word (never throw)', () => {
  const tx = buildBorrowTx({ vault: '0x' + '22'.repeat(20), amountBaseUnits: 'not-a-number' });
  assert.equal(tx.data.slice(10), '0'.repeat(64));
  const neg = buildBorrowTx({ vault: '0x' + '22'.repeat(20), amountBaseUnits: -100 });
  assert.equal(neg.data.slice(10), '0'.repeat(64), 'negative clamps to 0');
});

test('renderBorrowFragment is escaped HTML and shows the previewed figures', () => {
  const html = renderBorrowFragment({ collateralMelek: 1000, melekPrice: 0.5, altiPrice: 0.02 });
  assert.match(html, /Borrow ALTI against MELEK/);
  assert.match(html, /10000 ALTI/, 'max borrowable shown');
  assert.match(html, /meleAltiCdpBorrow\(\)/, 'default borrow handler wired');
  assert.match(html, /40% LTV/);
});

test('renderBorrowFragment escapes a hostile onBorrow handler name (no injection)', () => {
  const html = renderBorrowFragment({ onBorrow: '"><script>alert(1)</script>' });
  assert.ok(!html.includes('<script>alert(1)'), 'script tag escaped');
  assert.match(html, /&lt;script&gt;/);
});

test('renderBorrowFragment never throws on empty/garbage input', () => {
  assert.doesNotThrow(() => renderBorrowFragment());
  assert.doesNotThrow(() => renderBorrowFragment({ collateralMelek: 'x', melekPrice: null, altiPrice: undefined }));
});
