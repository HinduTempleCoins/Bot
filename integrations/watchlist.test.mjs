// watchlist.test.mjs — OFFLINE tests for the integrations "what to watch" config.
// Run: node --test integrations/watchlist.test.mjs
//
// watchlist.mjs is pure config: no network, no clock, no fs, no keys. It reads
// process.env at import time. We test the default values via a static import, and
// the env-parsing / override behavior (the list() and num() seams) via cache-busted
// dynamic re-imports with env set/restored around each case. Fully offline.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  TRADE_ACCOUNT, CANDIDATE_ACCOUNTS, ISSUED_TOKENS, WATCH_TOKENS,
  SWAP_PAIRS, ARB_THRESHOLD, PARITY_TARGET, default as watchlist,
} from './watchlist.mjs';

// --- helper: import a FRESH copy of the module with a scoped env override ---------
// Cache-busting query string forces a re-evaluation so import-time env reads re-run.
let counter = 0;
async function freshWith(envOverrides) {
  const saved = {};
  for (const k of Object.keys(envOverrides)) {
    saved[k] = process.env[k];
    if (envOverrides[k] === undefined) delete process.env[k];
    else process.env[k] = envOverrides[k];
  }
  try {
    return await import(`./watchlist.mjs?fresh=${++counter}`);
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
}

// =================================================================================
// happy path — default values (env not set during this process's first import)
// =================================================================================

test('TRADE_ACCOUNT defaults to kalivankush', () => {
  // The default applies unless the operator set TRADE_ACCOUNT before launch.
  if (!process.env.TRADE_ACCOUNT) {
    assert.equal(TRADE_ACCOUNT, 'kalivankush');
  }
  assert.equal(typeof TRADE_ACCOUNT, 'string');
  assert.ok(TRADE_ACCOUNT.length > 0);
});

test('CANDIDATE_ACCOUNTS default list is the four forensics accounts', () => {
  if (!process.env.CANDIDATE_ACCOUNTS) {
    assert.deepEqual(CANDIDATE_ACCOUNTS, [
      'angelicalist', 'punicwax', 'vankush', 'kalivankush',
    ]);
  }
  assert.ok(Array.isArray(CANDIDATE_ACCOUNTS));
});

test('ISSUED_TOKENS default to VKBT, CURE', () => {
  if (!process.env.ISSUED_TOKENS) {
    assert.deepEqual(ISSUED_TOKENS, ['VKBT', 'CURE']);
  }
  assert.ok(Array.isArray(ISSUED_TOKENS));
});

test('WATCH_TOKENS default snapshot set', () => {
  if (!process.env.WATCH_TOKENS) {
    assert.deepEqual(WATCH_TOKENS, [
      // SPS/DEC/LEO trade on outside exchanges too, so the watchlist snapshots them for the
      // cross-venue price comparison (see he-external-listings.mjs).
      'VKBT', 'CURE', 'SWAP.LTC', 'SWAP.BLURT', 'SWAP.DOGE', 'BBH', 'SPS', 'DEC', 'LEO',
    ]);
  }
  assert.ok(Array.isArray(WATCH_TOKENS));
});

test('ARB_THRESHOLD and PARITY_TARGET default numbers', () => {
  if (!process.env.ARB_THRESHOLD) assert.equal(ARB_THRESHOLD, 0.03);
  if (!process.env.PARITY_TARGET) assert.equal(PARITY_TARGET, 1.0);
  assert.equal(typeof ARB_THRESHOLD, 'number');
  assert.equal(typeof PARITY_TARGET, 'number');
  assert.ok(!Number.isNaN(ARB_THRESHOLD));
  assert.ok(!Number.isNaN(PARITY_TARGET));
});

// =================================================================================
// SWAP_PAIRS map — shape and known mappings
// =================================================================================

test('SWAP_PAIRS maps wrapper tokens to coingecko ids', () => {
  assert.equal(SWAP_PAIRS['SWAP.BTC'], 'bitcoin');
  assert.equal(SWAP_PAIRS['SWAP.ETH'], 'ethereum');
  assert.equal(SWAP_PAIRS['SWAP.LTC'], 'litecoin');
  assert.equal(SWAP_PAIRS['SWAP.DOGE'], 'dogecoin');
  assert.equal(SWAP_PAIRS['SWAP.BLURT'], 'blurt');
  assert.equal(SWAP_PAIRS['SWAP.STEEM'], 'steem');
  assert.equal(SWAP_PAIRS['SWAP.HBD'], 'hive_dollar');
  assert.equal(SWAP_PAIRS['SWAP.EOS'], 'eos');
  assert.equal(SWAP_PAIRS['SWAP.MATIC'], 'matic-network');
});

test('SWAP_PAIRS is an object of string->string with no empty values', () => {
  assert.equal(typeof SWAP_PAIRS, 'object');
  assert.ok(SWAP_PAIRS !== null);
  const keys = Object.keys(SWAP_PAIRS);
  assert.ok(keys.length > 0);
  for (const k of keys) {
    assert.ok(k.startsWith('SWAP.'), `key ${k} should be a SWAP wrapper`);
    assert.equal(typeof SWAP_PAIRS[k], 'string');
    assert.ok(SWAP_PAIRS[k].length > 0);
  }
});

test('SWAP_PAIRS soft-miss: unknown token lookup returns undefined, never throws', () => {
  assert.equal(SWAP_PAIRS['SWAP.NOPE'], undefined);
  assert.equal(SWAP_PAIRS['not-a-key'], undefined);
});

// =================================================================================
// default export mirrors the named exports
// =================================================================================

test('default export carries all named exports', () => {
  assert.equal(watchlist.TRADE_ACCOUNT, TRADE_ACCOUNT);
  assert.deepEqual(watchlist.CANDIDATE_ACCOUNTS, CANDIDATE_ACCOUNTS);
  assert.deepEqual(watchlist.ISSUED_TOKENS, ISSUED_TOKENS);
  assert.deepEqual(watchlist.WATCH_TOKENS, WATCH_TOKENS);
  assert.deepEqual(watchlist.SWAP_PAIRS, SWAP_PAIRS);
  assert.equal(watchlist.ARB_THRESHOLD, ARB_THRESHOLD);
  assert.equal(watchlist.PARITY_TARGET, PARITY_TARGET);
});

// =================================================================================
// env overrides — the list() parsing seam
// =================================================================================

test('env override sets a custom TRADE_ACCOUNT (trimmed)', async () => {
  const m = await freshWith({ TRADE_ACCOUNT: '  hathor  ' });
  assert.equal(m.TRADE_ACCOUNT, 'hathor');
});

test('list() splits on commas and whitespace, trims, drops empties', async () => {
  const m = await freshWith({ ISSUED_TOKENS: ' VKBT , CURE,  BBH ' });
  assert.deepEqual(m.ISSUED_TOKENS, ['VKBT', 'CURE', 'BBH']);
});

test('list() splits on whitespace-only separators', async () => {
  const m = await freshWith({ WATCH_TOKENS: 'AAA  BBB\tCCC' });
  assert.deepEqual(m.WATCH_TOKENS, ['AAA', 'BBB', 'CCC']);
});

test('list() handles a single token', async () => {
  const m = await freshWith({ CANDIDATE_ACCOUNTS: 'solo' });
  assert.deepEqual(m.CANDIDATE_ACCOUNTS, ['solo']);
});

// =================================================================================
// soft-fail edges — empty / whitespace / missing env falls back, never throws
// =================================================================================

test('empty string env falls back to the default list', async () => {
  const m = await freshWith({ ISSUED_TOKENS: '' });
  assert.deepEqual(m.ISSUED_TOKENS, ['VKBT', 'CURE']);
});

test('whitespace-only env falls back to the default list', async () => {
  const m = await freshWith({ WATCH_TOKENS: '   \t  ' });
  assert.deepEqual(m.WATCH_TOKENS, [
    'VKBT', 'CURE', 'SWAP.LTC', 'SWAP.BLURT', 'SWAP.DOGE', 'BBH', 'SPS', 'DEC', 'LEO',
  ]);
});

test('list of only separators yields an empty array (filtered), never throws', async () => {
  const m = await freshWith({ CANDIDATE_ACCOUNTS: ' , , ,, ' });
  // non-empty trimmed string -> not fallback; split+filter removes all -> []
  assert.deepEqual(m.CANDIDATE_ACCOUNTS, []);
  assert.ok(Array.isArray(m.CANDIDATE_ACCOUNTS));
});

// =================================================================================
// soft-fail edges — the num() parsing seam
// =================================================================================

test('num() parses a valid numeric env override', async () => {
  const m = await freshWith({ ARB_THRESHOLD: '0.1', PARITY_TARGET: '2.5' });
  assert.equal(m.ARB_THRESHOLD, 0.1);
  assert.equal(m.PARITY_TARGET, 2.5);
});

test('num() falls back to default on non-numeric env (NaN guard)', async () => {
  const m = await freshWith({ ARB_THRESHOLD: 'not-a-number' });
  assert.equal(m.ARB_THRESHOLD, 0.03);
});

test('num() falls back to default on empty string env', async () => {
  const m = await freshWith({ PARITY_TARGET: '' });
  assert.equal(m.PARITY_TARGET, 1.0);
});

test('num() accepts zero as a valid override (not treated as missing)', async () => {
  const m = await freshWith({ ARB_THRESHOLD: '0' });
  assert.equal(m.ARB_THRESHOLD, 0);
});

test('num() accepts negative numbers', async () => {
  const m = await freshWith({ PARITY_TARGET: '-1' });
  assert.equal(m.PARITY_TARGET, -1);
});
