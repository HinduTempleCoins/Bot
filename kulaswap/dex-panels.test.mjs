// dex-panels.test.mjs — offline tests for the Pool/Farm/Borrow calculator helpers. No DOM, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { poolPanel, farmPanel, borrowPanel, ILLUSTRATIVE, cdpWiring, stakeWiring } from './dex-panels.mjs';
import { DEFAULT_CDP } from './kula-cdp.mjs';
import { MAINNET_ADDR } from './kula-config-addresses.mjs';

test('poolPanel: uses the live pool ratio when reserves are supplied', () => {
  // 1,000,000 KULA / 50,000 wMELEK → 1 KULA = 0.05 wMELEK
  const p = poolPanel({ kulaAmount: 1000, reservesKula: 1_000_000, reservesWmelek: 50_000 });
  assert.equal(p.priceKnown, true);
  assert.equal(p.price, 0.05);
  assert.equal(p.pairNeeded, 50); // 1000 * 0.05
  assert.ok(p.sharePct > 0 && p.sharePct < 1); // 1000 / 1,001,000
});

test('poolPanel: falls back to the illustrative ratio with no reserves', () => {
  const p = poolPanel({ kulaAmount: 100 });
  assert.equal(p.priceKnown, false);
  assert.equal(p.price, ILLUSTRATIVE.kulaPriceUsd);
  assert.equal(p.pairNeeded, Number((100 * ILLUSTRATIVE.kulaPriceUsd).toFixed(8)));
  assert.equal(p.sharePct, 0); // no reserves → share unknown → 0
});

test('poolPanel: soft-fails to zeros on empty input', () => {
  const p = poolPanel({});
  assert.equal(p.pairNeeded, 0);
  assert.equal(p.sharePct, 0);
});

test('farmPanel: boost is 1x at no lock and rises toward the cap', () => {
  const none = farmPanel({ stakedUsd: 1000, lockWeeks: 0 });
  const max = farmPanel({ stakedUsd: 1000, lockWeeks: ILLUSTRATIVE.veMaxWeeks });
  assert.equal(none.boost, 1);
  assert.ok(max.boost > none.boost);
  assert.ok(max.boost <= ILLUSTRATIVE.veMaxBoost + 1e-9);
  assert.equal(max.boostedApr, Number((max.baseApr * max.boost).toFixed(4)));
});

test('farmPanel: yearly reward scales with staked $ and boosted APR', () => {
  const p = farmPanel({ stakedUsd: 2000, lockWeeks: 104 }); // half the max lock
  assert.equal(p.yearlyRewardUsd, Number(((2000 * p.boostedApr) / 100).toFixed(2)));
});

test('farmPanel: soft-fails with no stake', () => {
  const p = farmPanel({});
  assert.ok(p.baseApr >= 0);
  assert.equal(p.yearlyRewardUsd, 0);
});

test('borrowPanel: max borrow honors the default LTV', () => {
  // 1000 KULA @ 0.05 = $50 collateral, maxLtv 0.5 → $25 borrowable, stable @ $1 → 25 stable
  const p = borrowPanel({ collateralKula: 1000, debtStable: 0 });
  const expected = Number(((1000 * ILLUSTRATIVE.kulaPriceUsd * DEFAULT_CDP.maxLtv) / ILLUSTRATIVE.stablePriceUsd).toFixed(8));
  assert.equal(p.maxBorrow, expected);
});

test('borrowPanel: no debt → infinite health, safe class', () => {
  const p = borrowPanel({ collateralKula: 1000, debtStable: 0 });
  assert.equal(p.healthFactor, Infinity);
  assert.equal(p.hfClass, 'hf-ok');
});

test('borrowPanel: heavy debt → unhealthy + danger class + overMax flagged', () => {
  const p = borrowPanel({ collateralKula: 1000, debtStable: 40 }); // way over the $25 max
  assert.ok(p.healthFactor < 1);
  assert.equal(p.hfClass, 'hf-bad');
  assert.equal(p.overMax, true);
  assert.ok(p.liquidationPrice > 0);
});

test('borrowPanel: moderate debt lands in the warn band', () => {
  // pick debt so 1 <= HF < 1.5. collateral $50, liqRatio 0.6 → collateralValue*lr = 30.
  // HF = 30 / debt. debt = 24 → HF = 1.25 (warn).
  const p = borrowPanel({ collateralKula: 1000, debtStable: 24 });
  assert.ok(p.healthFactor >= 1 && p.healthFactor < 1.5);
  assert.equal(p.hfClass, 'hf-warn');
});

// ── mainnet wiring seam ─────────────────────────────────────────────────────────────────────────────
test('cdpWiring: live on mainnet, bound to the real vault + mMELEK debt, chainId 712217', () => {
  const w = cdpWiring();
  assert.equal(w.live, true);
  assert.equal(w.vault, MAINNET_ADDR.cdpVault);
  assert.equal(w.collateral, MAINNET_ADDR.KULA);
  assert.equal(w.debtToken, MAINNET_ADDR.mMELEK); // NOT wMELEK
  assert.equal(w.chainId, 712217);
  const dep = w.deposit('1000000000000000000');
  assert.equal(dep.to, MAINNET_ADDR.cdpVault);
  assert.equal(dep.chainId, 712217);
  assert.ok(dep.data.startsWith('0xb6b55f25')); // deposit(uint256)
  assert.ok(w.borrow('1').data.startsWith('0xc5ebeaec')); // borrow(uint256)
  // approve targets: collateral approve → KULA token; debt approve → mMELEK token
  assert.equal(w.approveCollateral('1').to, MAINNET_ADDR.KULA);
  assert.equal(w.approveDebt('1').to, MAINNET_ADDR.mMELEK);
});

test('stakeWiring: live on mainnet, bound to veKULA, builds lock/withdraw', () => {
  const w = stakeWiring();
  assert.equal(w.live, true);
  assert.equal(w.veKula, MAINNET_ADDR.veKULA);
  assert.equal(w.chainId, 712217);
  const lk = w.lock('1000000000000000000', 365 * 86400);
  assert.equal(lk.to, MAINNET_ADDR.veKULA);
  assert.ok(lk.data.startsWith('0x1338736f')); // lock(uint256,uint256)
  assert.equal(w.approve('1').to, MAINNET_ADDR.KULA);
  assert.equal(w.withdraw().data, '0x3ccfd60b');
});
