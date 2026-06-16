// he-external-listings.test.mjs — FULLY OFFLINE. Pure registry + helpers; no network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HE_EXTERNAL_LISTINGS, listingsFor, watchedHeTokens, usAccessibleListings,
  hasUsAccessibleMarket, coingeckoIds, symbolMapForVenue, allListings,
} from './he-external-listings.mjs';

test('registry covers the real HE-native external tokens (SPS/DEC/LEO)', () => {
  for (const t of ['SPS', 'DEC', 'LEO']) {
    assert.ok(Array.isArray(HE_EXTERNAL_LISTINGS[t]) && HE_EXTERNAL_LISTINGS[t].length, `${t} present`);
    assert.ok(listingsFor(t).length, `listingsFor(${t})`);
  }
  // case-insensitive
  assert.equal(listingsFor('sps').length, listingsFor('SPS').length);
  assert.deepEqual(listingsFor('NOPE'), []);
});

test('every listing has the required shape', () => {
  for (const row of allListings()) {
    assert.equal(typeof row.token, 'string');
    assert.equal(typeof row.venue, 'string');
    assert.equal(typeof row.symbol, 'string');
    assert.ok(['cex', 'dex'].includes(row.kind), `${row.token} kind`);
    assert.equal(typeof row.usAccessible, 'boolean');
    assert.ok(['high', 'medium', 'verify'].includes(row.confidence), `${row.token} confidence`);
    assert.ok(row.note && row.note.length > 0);
  }
});

test('US-accessibility is honored: Gate/MEXC are US-blocked, the DEX leg is US-accessible', () => {
  // SPS on Gate.io must be flagged US-blocked …
  const gate = listingsFor('SPS').find((l) => l.venue === 'Gate.io');
  assert.equal(gate.usAccessible, false);
  // … and SPS must STILL have a US-accessible path (the wrapped DEX version).
  assert.equal(hasUsAccessibleMarket('SPS'), true);
  assert.ok(usAccessibleListings('SPS').every((l) => l.usAccessible));
  assert.ok(usAccessibleListings('SPS').some((l) => l.kind === 'dex'));
});

test('symbolMapForVenue builds a { token: symbol } map for a named venue', () => {
  const gate = symbolMapForVenue('Gate.io');
  assert.equal(gate.SPS, 'SPS_USDT');
  // a venue nobody in the registry uses → empty map (never throws)
  assert.deepEqual(symbolMapForVenue('NoSuchExchange'), {});
});

test('coingeckoIds returns the de-duped oracle ids', () => {
  const ids = coingeckoIds();
  assert.ok(ids.includes('splintershards'));
  assert.ok(ids.includes('dark-energy-crystals'));
  assert.equal(ids.length, new Set(ids).size, 'de-duped');
});

test('watchedHeTokens is the broadened set (more than just the SWAP wrappers)', () => {
  const t = watchedHeTokens();
  assert.ok(t.includes('SPS') && t.includes('DEC') && t.includes('LEO'));
  assert.ok(t.length >= 3);
});
