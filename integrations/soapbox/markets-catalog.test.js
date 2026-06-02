// Tests for the markets + api catalogs (structure + helper invariants). No live calls.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXCHANGES, CRYPTO_EXCHANGES, MARKETS, ASSETS as MKT_ASSETS,
  allExchanges, exchangesByAsset, usFriendly, cryptoExchanges, summary as mktSummary,
} from './markets-catalog.mjs';
import {
  DATA_APIS, allApis, keylessApis, pollableApis, apisByAsset, keyedApis, summary as apiSummary,
} from './api-catalog.mjs';

const US_VALUES = new Set(['full', 'partial', 'no', 'unknown']);

test('every exchange has the required fields and a valid us value', () => {
  for (const e of EXCHANGES) {
    assert.ok(e.name, 'name');
    assert.match(e.url, /^https?:\/\//, `url for ${e.name}`);
    assert.ok(MKT_ASSETS.includes(e.asset), `asset for ${e.name}`);
    assert.ok(US_VALUES.has(e.us), `us for ${e.name}: ${e.us}`);
  }
});

test('crypto exchanges count is substantial and typed CEX/DEX', () => {
  assert.ok(CRYPTO_EXCHANGES.length >= 40, `expected 40+ crypto exchanges, got ${CRYPTO_EXCHANGES.length}`);
  for (const e of CRYPTO_EXCHANGES) assert.ok(['CEX', 'DEX'].includes(e.type), `${e.name} type`);
});

test('all five asset classes are represented', () => {
  for (const a of MKT_ASSETS) assert.ok(exchangesByAsset(a).length > 0, `asset ${a} has venues`);
});

test('usFriendly filters to full/partial only', () => {
  for (const e of usFriendly('crypto')) assert.ok(e.us === 'full' || e.us === 'partial');
  assert.ok(usFriendly('crypto').length >= 10, 'enough US-friendly crypto venues');
  // US-friendly subset never exceeds the full set
  assert.ok(usFriendly().length <= allExchanges().length);
});

test('MARKETS rollup counts match the live filters', () => {
  for (const m of MARKETS) {
    assert.equal(m.venueCount, exchangesByAsset(m.asset).length);
    assert.equal(m.usFriendlyCount, usFriendly(m.asset).length);
  }
});

test('cryptoExchanges type filter works', () => {
  assert.ok(cryptoExchanges({ type: 'DEX' }).every((e) => e.type === 'DEX'));
  assert.equal(cryptoExchanges().length, CRYPTO_EXCHANGES.length);
});

test('markets summary is internally consistent', () => {
  const s = mktSummary();
  assert.equal(s.totalExchanges, EXCHANGES.length);
  assert.equal(s.crypto.cex + s.crypto.dex, CRYPTO_EXCHANGES.length);
});

test('every API entry has required fields and valid pollable tier', () => {
  const tiers = new Set(['constant', 'on-demand', 'keyed']);
  for (const a of DATA_APIS) {
    assert.ok(a.name, 'name');
    assert.match(a.base, /^https?:\/\//, `base for ${a.name}`);
    assert.equal(typeof a.keyless, 'boolean', `keyless for ${a.name}`);
    assert.ok(a.freeTier, `freeTier for ${a.name}`);
    assert.ok(tiers.has(a.pollable), `pollable for ${a.name}: ${a.pollable}`);
  }
});

test('keyless/keyed partition the catalog', () => {
  assert.equal(keylessApis().length + keyedApis().length, DATA_APIS.length);
  assert.ok(keylessApis().length >= 15, `expected many keyless APIs, got ${keylessApis().length}`);
  for (const a of keylessApis()) assert.equal(a.keyless, true);
});

test('keyed APIs are never marked pollable:constant', () => {
  for (const a of keyedApis()) assert.notEqual(a.pollable, 'constant', `${a.name} keyed but constant`);
});

test('pollableApis default returns constant tier', () => {
  assert.ok(pollableApis().every((a) => a.pollable === 'constant'));
  assert.ok(pollableApis('on-demand').every((a) => a.pollable === 'on-demand'));
});

test('apisByAsset includes multi sources for crypto/forex/stocks', () => {
  const cryptoApis = apisByAsset('crypto');
  assert.ok(cryptoApis.some((a) => a.name.includes('CoinGecko')));
  assert.ok(cryptoApis.some((a) => a.asset === 'multi'), 'multi sources surfaced for crypto');
  assert.ok(apisByAsset('macro').length > 0);
  assert.ok(allApis().length === DATA_APIS.length);
});

test('api summary is internally consistent', () => {
  const s = apiSummary();
  assert.equal(s.keyless + s.keyed, s.total);
});
