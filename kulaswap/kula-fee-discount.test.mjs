// kula-fee-discount.test.mjs — offline, pure. node --test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  effectiveFeeBps, feeWithKulaDiscount, routeKulaFee, worthPayingInKula,
  DEFAULT_FEE_BPS, DEFAULT_DISCOUNT_BPS,
} from './kula-fee-discount.mjs';

test('effectiveFeeBps applies the 25% discount: 30 → 22.5', () => {
  assert.equal(effectiveFeeBps(30, 2500), 22.5);
  assert.equal(effectiveFeeBps(), 22.5); // defaults
  assert.equal(effectiveFeeBps(30, 0), 30); // no discount
  assert.equal(effectiveFeeBps(30, 10000), 0); // 100% off
});

test('feeWithKulaDiscount: a $1,000 trade → 0.225% in KULA, 25% savings', () => {
  const q = feeWithKulaDiscount({ tradeValueQuote: 1000, kulaPriceQuote: 0.1 });
  assert.equal(q.ok, true);
  assert.equal(q.normalFeeValue, 3);       // 0.30% of 1000
  assert.equal(q.discountedFeeValue, 2.25); // 0.225%
  assert.equal(q.kulaAmount, 22.5);        // 2.25 / 0.1
  assert.equal(q.savings, 0.75);
  assert.equal(q.savingsPct, 25);
  assert.equal(q.effectiveBps, 22.5);
});

test('feeWithKulaDiscount soft-fails on bad input', () => {
  assert.equal(feeWithKulaDiscount({ tradeValueQuote: 0, kulaPriceQuote: 1 }).ok, false);
  assert.equal(feeWithKulaDiscount({ tradeValueQuote: 100, kulaPriceQuote: 0 }).ok, false);
  assert.equal(feeWithKulaDiscount({}).ok, false);
});

test('routeKulaFee: Hathor cut + the rest BURNED (direct KULA sink)', () => {
  const r = routeKulaFee({ kulaAmount: 22.5 }); // default hathorShareBps 1667
  assert.equal(r.ok, true);
  // 1667 bps of 22.5 ≈ 3.75075 to Hathor, rest burned
  assert.equal(r.toHathor, +(22.5 * 1667 / 10000).toFixed(8));
  assert.equal(r.burned, +(22.5 - r.toHathor).toFixed(8));
  // all-burn variant
  assert.equal(routeKulaFee({ kulaAmount: 10, hathorShareBps: 0 }).burned, 10);
  assert.equal(routeKulaFee({ kulaAmount: 0 }).ok, false);
});

test('worthPayingInKula true while a discount exists', () => {
  assert.equal(worthPayingInKula(feeWithKulaDiscount({ tradeValueQuote: 1000, kulaPriceQuote: 0.1 })), true);
  assert.equal(worthPayingInKula(feeWithKulaDiscount({ tradeValueQuote: 1000, kulaPriceQuote: 0.1, discountBps: 0 })), false);
  assert.equal(worthPayingInKula(null), false);
});

test('exports sane defaults', () => {
  assert.equal(DEFAULT_FEE_BPS, 30);
  assert.equal(DEFAULT_DISCOUNT_BPS, 2500);
});
