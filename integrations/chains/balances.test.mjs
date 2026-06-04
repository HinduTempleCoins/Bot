// balances.test.mjs — OFFLINE tests for integrations/chains/balances.mjs.
//
// Read-only, keyless balance reader. Drives it through the injected __setFetch seam (no network,
// no keys — addresses are public). Covers loadAddresses (explicit + env), chainBalance for an
// EVM chain and an esplora (BTC) chain, multi-address summing, the unknown-chain / no-address
// guards, the cardano needsKey flag, and allBalances aggregation with USD pricing.
//
//   node --test integrations/chains/balances.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadAddresses, chainBalance, allBalances, __setFetch } from './balances.mjs';
import { CHAINS } from './multichain.mjs';

function json(body) { return { ok: true, status: 200, json: async () => body }; }

// Pick a representative chain of each kind from the live CHAINS directory so the tests
// stay valid if endpoints change.
const evmName = Object.keys(CHAINS).find((n) => CHAINS[n].kind === 'evm');
const esploraName = Object.keys(CHAINS).find((n) => CHAINS[n].kind === 'esplora');
const priceonlyName = Object.keys(CHAINS).find((n) => CHAINS[n].kind === 'priceonly');

test('loadAddresses: explicit arg wins, untouched', async () => {
  const explicit = { ethereum: '0xabc' };
  assert.deepEqual(await loadAddresses(explicit), explicit);
});

test('loadAddresses: fills from MELEK_ADDR_<CHAIN> env for a chain not already configured', async () => {
  // Use a config-driven base (no file required) so the env fallback is the only source.
  const base = await loadAddresses();              // whatever the box already has (may be {})
  const name = Object.keys(CHAINS).find((n) => !base[n]);
  assert.ok(name, 'expected at least one chain absent from any local config');
  const key = `MELEK_ADDR_${name.toUpperCase()}`;
  const prev = process.env[key];
  process.env[key] = '0xdeadbeef';
  try {
    const map = await loadAddresses();
    assert.equal(map[name], '0xdeadbeef');
  } finally {
    if (prev === undefined) delete process.env[key]; else process.env[key] = prev;
  }
});

test('loadAddresses: malformed config file warns once but still soft-fails to env/empty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'melek-balances-'));
  const bad = join(dir, 'wallet-config.json');
  writeFileSync(bad, '{ this is not: valid json ]');     // malformed on purpose
  const prevCfg = process.env.MELEK_WALLET_CONFIG;
  process.env.MELEK_WALLET_CONFIG = bad;
  const origWarn = console.warn;
  const warnings = [];
  console.warn = (...a) => warnings.push(a.join(' '));
  try {
    const map = await loadAddresses();                   // must NOT throw
    assert.equal(typeof map, 'object');                  // returns the fallback object
    assert.equal(warnings.length, 1, 'warns exactly once on malformed config');
    assert.match(warnings[0], /wallet-config/);
    assert.match(warnings[0], /malformed/);
  } finally {
    console.warn = origWarn;
    if (prevCfg === undefined) delete process.env.MELEK_WALLET_CONFIG; else process.env.MELEK_WALLET_CONFIG = prevCfg;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('loadAddresses: malformed config still merges env MELEK_ADDR_<CHAIN> fallback', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'melek-balances-'));
  const bad = join(dir, 'wallet-config.json');
  writeFileSync(bad, 'not json at all');
  const name = Object.keys(CHAINS)[0];
  const envKey = `MELEK_ADDR_${name.toUpperCase()}`;
  const prevCfg = process.env.MELEK_WALLET_CONFIG;
  const prevAddr = process.env[envKey];
  process.env.MELEK_WALLET_CONFIG = bad;
  process.env[envKey] = '0xfeedface';
  const origWarn = console.warn; console.warn = () => {};
  try {
    const map = await loadAddresses();
    assert.equal(map[name], '0xfeedface');   // env fallback survives a broken file
  } finally {
    console.warn = origWarn;
    if (prevCfg === undefined) delete process.env.MELEK_WALLET_CONFIG; else process.env.MELEK_WALLET_CONFIG = prevCfg;
    if (prevAddr === undefined) delete process.env[envKey]; else process.env[envKey] = prevAddr;
    rmSync(dir, { recursive: true, force: true });
  }
});

test('chainBalance: unknown chain returns an error, never throws', async () => {
  const r = await chainBalance('not-a-chain', '0xabc');
  assert.equal(r.error, 'unknown chain');
});

test('chainBalance: missing address returns "no address configured"', async () => {
  const r = await chainBalance(evmName || 'ethereum', '');
  assert.equal(r.error, 'no address configured');
});

test('chainBalance: EVM reads eth_getBalance and converts wei → ether', { skip: !evmName }, async () => {
  __setFetch(async () => json({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' })); // 1e18 wei = 1 ETH
  const r = await chainBalance(evmName, '0xabc');
  __setFetch(null);
  assert.equal(r.chain, evmName);
  assert.equal(r.balance, 1);
});

test('chainBalance: esplora (BTC-like) computes funded - spent over 1e8', { skip: !esploraName }, async () => {
  __setFetch(async () => json({ chain_stats: { funded_txo_sum: 150000000, spent_txo_sum: 50000000 } }));
  const r = await chainBalance(esploraName, 'bc1qexample');
  __setFetch(null);
  assert.equal(r.balance, 1); // (1.5 - 0.5) BTC
});

test('chainBalance: an array of addresses sums their balances', { skip: !evmName }, async () => {
  __setFetch(async () => json({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' })); // 1 ETH each
  const r = await chainBalance(evmName, ['0xa', '0xb']);
  __setFetch(null);
  assert.equal(r.balance, 2);
  assert.equal(r.addresses, 2);
});

test('chainBalance: a thrown fetch becomes { error }, never propagates', { skip: !evmName }, async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const r = await chainBalance(evmName, '0xabc');
  __setFetch(null);
  assert.ok(r.error, 'soft-fails to an error field');
  assert.equal(r.balance, undefined);
});

test('chainBalance: cardano (priceonly) flags needsKey rather than failing', { skip: !priceonlyName }, async () => {
  const r = await chainBalance(priceonlyName, 'addr1example');
  assert.ok(r.needsKey, 'priceonly chains report needsKey');
  assert.equal(r.error, undefined);
});

test('allBalances: aggregates configured chains and attaches usdValue', { skip: !evmName }, async () => {
  __setFetch(async () => json({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' })); // 1 unit
  const cg = CHAINS[evmName].cg;
  const out = await allBalances({ [evmName]: '0xabc' }, { prices: { [cg]: { usd: 2000 } } });
  __setFetch(null);
  assert.equal(out.configured, 1);
  assert.equal(out.totalChains, Object.keys(CHAINS).length);
  const row = out.balances.find((b) => b.chain === evmName);
  assert.equal(row.balance, 1);
  assert.equal(row.usdValue, 2000);
});

// ---------------------------------------------------------------------------
// PRANA — dormant EVM chain: lights up when PRANA_RPC_URL is set, soft-fails when not.
// ---------------------------------------------------------------------------
test('chainBalance(prana): with PRANA_RPC_URL set, reads eth_getBalance via the injected RPC', async () => {
  const prev = process.env.PRANA_RPC_URL;
  process.env.PRANA_RPC_URL = 'https://rpc.prana.test'; // NAME only; injected fetch handles transport
  let hitUrl = null, body = null;
  __setFetch(async (url, opts) => { hitUrl = url; body = JSON.parse(opts.body); return json({ jsonrpc: '2.0', id: 1, result: '0xde0b6b3a7640000' }); }); // 1 PRANA
  try {
    const r = await chainBalance('prana', '0xabc');
    assert.equal(r.chain, 'prana');
    assert.equal(r.balance, 1);
    assert.equal(hitUrl, 'https://rpc.prana.test');
    assert.equal(body.method, 'eth_getBalance');
  } finally {
    __setFetch(null);
    if (prev === undefined) delete process.env.PRANA_RPC_URL; else process.env.PRANA_RPC_URL = prev;
  }
});

test('chainBalance(prana): with PRANA_RPC_URL UNSET, soft-fails to {error} and never throws (no fetch)', async () => {
  const prev = process.env.PRANA_RPC_URL;
  delete process.env.PRANA_RPC_URL;
  let called = false;
  __setFetch(async () => { called = true; return json({}); });
  try {
    let r, threw = false;
    try { r = await chainBalance('prana', '0xabc'); } catch { threw = true; }
    assert.equal(threw, false, 'must not throw when dormant');
    assert.ok(r.error, 'dormant prana returns an error row');
    assert.equal(r.balance, undefined);
    assert.equal(called, false, 'no RPC nodes → never hits the network');
  } finally {
    __setFetch(null);
    if (prev === undefined) delete process.env.PRANA_RPC_URL; else process.env.PRANA_RPC_URL = prev;
  }
});

test('__setFetch(null) restores the default seam without throwing', () => {
  assert.doesNotThrow(() => __setFetch(null));
});
