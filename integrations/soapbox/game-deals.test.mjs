// game-deals.test.mjs — offline tests for the CheapShark digital-price reader.
// All network calls are stubbed via __setFetch with canned JSON; no live calls, no keys.
// Run: node --test integrations/soapbox/game-deals.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dealsFor, bestPrice, storeList, storeDirectory, storeName, normalizeDeal,
  KNOWN_STORES, renderDeals, dataNote, __setFetch,
} from './game-deals.mjs';

// CheapShark /deals returns a flat array of deal rows.
function dealsFetch(rows, { ok = true } = {}) {
  return async () => ({ ok, json: async () => rows });
}
function throwingFetch() { return async () => { throw new Error('network down'); }; }

const hkDeals = [
  { title: 'Hollow Knight', storeID: '1', salePrice: '7.49', normalPrice: '14.99', savings: '50.030020', dealID: 'abc1' },
  { title: 'Hollow Knight', storeID: '25', salePrice: '14.99', normalPrice: '14.99', savings: '0', dealID: 'def2' },
  { title: 'Hollow Knight', storeID: '7', salePrice: '6.74', normalPrice: '14.99', savings: '55.0', dealID: 'ghi3' },
  { title: 'Hollow Knight bad', storeID: '1', salePrice: null, normalPrice: '9.99', dealID: 'zzz9' }, // null price → dropped
];

test('dealsFor normalizes + sorts ascending by price, drops unusable rows', async () => {
  __setFetch(dealsFetch(hkDeals));
  const out = await dealsFor('Hollow Knight');
  __setFetch(null);
  assert.equal(out.length, 3); // the null-price row is dropped
  assert.deepEqual(out.map((d) => d.price), [6.74, 7.49, 14.99]); // ascending
  assert.equal(out[0].store, 'GOG'); // storeID 7
  assert.equal(out[0].savings, 55); // rounded to 1dp
  assert.ok(out[0].dealUrl.includes('dealID=ghi3'));
});

test('dealsFor soft-fails to [] on network error / empty query / non-array', async () => {
  __setFetch(throwingFetch());
  assert.deepEqual(await dealsFor('Anything'), []);
  __setFetch(null);
  assert.deepEqual(await dealsFor(''), []);
  assert.deepEqual(await dealsFor('   '), []);
  __setFetch(async () => ({ ok: true, json: async () => ({ not: 'an array' }) }));
  assert.deepEqual(await dealsFor('x'), []);
  __setFetch(null);
});

test('bestPrice returns the cheapest deal with comparison count, null when none', async () => {
  __setFetch(dealsFetch(hkDeals));
  const best = await bestPrice('Hollow Knight');
  __setFetch(null);
  assert.equal(best.price, 6.74);
  assert.equal(best.store, 'GOG');
  assert.equal(best.comparedAcross, 3);

  __setFetch(dealsFetch([]));
  assert.equal(await bestPrice('Nothing'), null);
  __setFetch(null);
});

test('storeList returns active stores only, normalized', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ([
    { storeID: '1', storeName: 'Steam', isActive: '1' },
    { storeID: '99', storeName: 'Defunct Store', isActive: '0' }, // dropped (inactive)
    { storeID: '7', storeName: 'GOG' }, // missing isActive → kept
    { nope: true }, // no storeID → dropped
  ]) }));
  const stores = await storeList();
  __setFetch(null);
  assert.deepEqual(stores.map((s) => s.storeID).sort(), ['1', '7']);
  assert.ok(stores.every((s) => s.isActive));
});

test('storeName + storeDirectory: live map wins, KNOWN_STORES fallback otherwise', () => {
  assert.equal(storeName('1'), 'Steam'); // built-in
  assert.equal(storeName('25'), 'Epic Games Store');
  assert.equal(storeName('9999'), 'Store 9999'); // unknown
  const dir = storeDirectory([{ storeID: '1', storeName: 'Steam (live)' }]);
  assert.equal(storeName('1', dir), 'Steam (live)'); // live directory overrides
  assert.equal(storeName('7', dir), 'GOG'); // not in live dir → fallback to KNOWN_STORES
  assert.ok(KNOWN_STORES['1'] === 'Steam');
});

test('normalizeDeal handles bad input + retail fallback', () => {
  assert.equal(normalizeDeal(null), null);
  assert.equal(normalizeDeal({ salePrice: null }), null);
  const d = normalizeDeal({ storeID: '1', salePrice: '5.00' }); // no normalPrice
  assert.equal(d.price, 5);
  assert.equal(d.retail, 5); // falls back to price
  assert.equal(d.savings, null);
  assert.equal(d.dealUrl, null); // no dealID
});

test('renderDeals escapes + renders a table, with empty fallback', () => {
  const html = renderDeals('<b>Hollow Knight</b>', [
    { store: 'GOG', price: 6.74, retail: 14.99, savings: 55, dealUrl: 'https://x/deal?dealID=ghi3' },
    { store: 'Steam', price: 7.49, retail: 14.99, savings: 50, dealUrl: null },
  ]);
  assert.ok(!html.includes('<b>Hollow Knight</b>'));
  assert.ok(html.includes('&lt;b&gt;'));
  assert.ok(html.includes('$6.74'));
  assert.ok(html.includes('55%'));
  assert.ok(html.includes('view →'));
  assert.ok(html.includes('source: CheapShark'));

  const empty = renderDeals('Nothing', []);
  assert.ok(empty.includes('No current digital deals'));
  assert.ok(empty.includes('</section>'));
});

test('dataNote names CheapShark + live caveat', () => {
  assert.match(dataNote(), /CheapShark/);
  assert.match(dataNote(), /live/i);
});
