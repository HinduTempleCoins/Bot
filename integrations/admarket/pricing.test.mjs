// pricing.test.mjs — offline, no network. Token money math + honest inventory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  TOKENS, isSupportedToken, tokenSpec, toBaseUnits, fromBaseUnits, amountStr,
  costOf, unitsAffordable, big, estimateInventory, surfaceOf, AUDITED_TRAFFIC, isModel,
} from './pricing.mjs';

test('only OUR tokens are payable', () => {
  for (const t of ['MELEK', 'APIS', 'PRANA', 'KULA']) assert.equal(isSupportedToken(t), true);
  assert.equal(isSupportedToken('USD'), false);
  assert.equal(isSupportedToken('BTC'), false);
  assert.equal(isSupportedToken(''), false);
  assert.equal(tokenSpec('prana').precision, 18); // case-insensitive
});

test('toBaseUnits/fromBaseUnits round-trip, no float loss, rejects over-precision', () => {
  assert.equal(toBaseUnits('1.5', 3), 1500n);
  assert.equal(toBaseUnits('50', 3), 50000n);
  assert.equal(toBaseUnits('1', 18), 10n ** 18n);
  assert.equal(fromBaseUnits(1500n, 3), '1.500');
  assert.equal(fromBaseUnits(10n ** 18n, 18), '1.000000000000000000');
  assert.equal(toBaseUnits('1.9999', 3), null);   // more precision than token → reject, don't round
  assert.equal(toBaseUnits('-1', 3), null);
  assert.equal(toBaseUnits('abc', 3), null);
  assert.equal(amountStr(50000n, 'MELEK'), '50.000 MELEK');
});

test('costOf: CPM per-1000, CPC per-click, floor favours advertiser', () => {
  const rate = toBaseUnits('2.000', 3);            // 2 MELEK / 1000 impressions
  assert.equal(costOf({ model: 'cpm', rate, impressions: 1000 }), 2000n);
  assert.equal(costOf({ model: 'cpm', rate, impressions: 5000 }), 10000n);
  assert.equal(costOf({ model: 'cpm', rate, impressions: 1 }), 2n);     // 2000/1000 = 2 base units
  assert.equal(costOf({ model: 'cpm', rate, impressions: 0 }), 0n);
  const cpc = toBaseUnits('0.100', 3);             // 0.1 MELEK / click
  assert.equal(costOf({ model: 'cpc', rate: cpc, clicks: 10 }), 1000n);
  assert.equal(costOf({ model: 'bogus', rate, impressions: 5 }), null);
});

test('unitsAffordable: impressions/clicks a budget buys', () => {
  const rate = toBaseUnits('2.000', 3);
  assert.equal(unitsAffordable({ model: 'cpm', rate, budget: toBaseUnits('50', 3) }), 25000n);
  const cpc = toBaseUnits('0.100', 3);
  assert.equal(unitsAffordable({ model: 'cpc', rate: cpc, budget: toBaseUnits('5', 3) }), 50n);
  assert.equal(unitsAffordable({ model: 'cpm', rate: 0n, budget: 1n }), null); // no divide-by-zero
});

test('big() coerces safe non-negative BigInts only', () => {
  assert.equal(big('100'), 100n);
  assert.equal(big(5), 5n);
  assert.equal(big(-1), null);
  assert.equal(big('1.5'), null);
  assert.equal(big('0x10'), null);
});

test('inventory: audited fallback, unknown → zero (never oversell), live analytics wins', () => {
  assert.equal(surfaceOf('law-top'), 'law');
  const law = estimateInventory('law-top');
  assert.equal(law.surface, 'law');
  assert.equal(law.source, 'audited');
  assert.ok(law.monthlyImpressions > 0);
  assert.deepEqual(estimateInventory('nosuch-top'), { surface: 'nosuch', monthlyImpressions: 0, dailyImpressions: 0, source: 'none' });
  // injected live aggregate takes precedence over the static table
  const aggregate = () => ({ topHosts: [['law.soapbox.community', 3000]], topPaths: [] });
  const live = estimateInventory('law-top', { aggregate, days: 30 });
  assert.equal(live.source, 'analytics');
  assert.equal(live.monthlyImpressions, 3000);
});

test('never throws on garbage', () => {
  assert.doesNotThrow(() => costOf(null));
  assert.doesNotThrow(() => unitsAffordable(undefined));
  assert.doesNotThrow(() => estimateInventory(null));
  assert.doesNotThrow(() => toBaseUnits({}, 3));
});
