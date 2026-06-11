/**
 * config.test.mjs — OFFLINE tests for the Melek-Engine config & genesis knobs.
 *
 * Pure data module: two exported objects (`config`, `genesis`) resolved from
 * env defaults at import time. No network, no fs. We assert the documented
 * shape, the parsing seams (rpcNodes split/trim/filter), and the load-bearing
 * tokenomics invariants (supply caps, precision range, gated DEX seams).
 *
 * Run: node --test engine/config.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { config, genesis } from '../config.mjs';

test('config exports a populated object with the core knobs', () => {
  assert.equal(typeof config, 'object');
  assert.ok(config.sidechainId.length > 0);
  assert.equal(config.addressPrefix, 'TST');
  assert.equal(typeof config.chainId, 'string');
  assert.equal(config.chainId.length, 64); // sha256 hex chain id
});

test('rpcNodes is parsed into a trimmed, non-empty array of URLs', () => {
  assert.ok(Array.isArray(config.rpcNodes));
  assert.ok(config.rpcNodes.length >= 1, 'at least one RPC node');
  for (const node of config.rpcNodes) {
    assert.equal(typeof node, 'string');
    assert.notEqual(node, '', 'no empty entries (filter(Boolean))');
    assert.equal(node, node.trim(), 'each entry is trimmed');
  }
});

test('numeric knobs are coerced to numbers, not strings', () => {
  assert.equal(typeof config.startBlock, 'number');
  assert.equal(typeof config.apiPort, 'number');
  assert.equal(typeof config.freeTxPerAccountPerBlock, 'number');
  assert.equal(typeof config.maxTxPerAccountPerBlock, 'number');
  assert.equal(typeof config.rateLimitPerMin, 'number');
  // hard ceiling must dominate the free allowance (DoS discipline)
  assert.ok(config.maxTxPerAccountPerBlock >= config.freeTxPerAccountPerBlock);
});

test('precisionRange and symbol limits are sane', () => {
  assert.deepEqual(config.precisionRange, [0, 8]);
  assert.ok(config.precisionRange[0] <= config.precisionRange[1]);
  assert.equal(typeof config.symbolMaxLength, 'number');
  assert.ok(config.symbolMaxLength > 0);
});

test('both PRANA DEX seams are present but gated OFF (inert)', () => {
  assert.equal(config.seams.gateway.enabled, false);
  assert.equal(config.seams.dexSettlement.enabled, false);
  // empty edge case: no accounts registered until PRANA exists
  assert.deepEqual(config.seams.gateway.registeredAccounts, []);
  assert.deepEqual(config.seams.dexSettlement.registeredAccounts, []);
});

test('genesis declares the APIS fee token and DRONE miner token', () => {
  assert.equal(genesis.feeToken, 'APIS');
  assert.equal(genesis.minerToken, 'DRONE');
  assert.ok(genesis.issuer.length > 0);
  assert.equal(genesis.tokens.length, 2);
});

test('genesis tokens carry consistent, in-range precision and cap flags', () => {
  const [lo, hi] = config.precisionRange;
  const symbols = genesis.tokens.map((t) => t.symbol);
  // the two named genesis tokens are exactly the declared fee/miner tokens
  assert.ok(symbols.includes(genesis.feeToken));
  assert.ok(symbols.includes(genesis.minerToken));

  for (const t of genesis.tokens) {
    assert.ok(t.precision >= lo && t.precision <= hi, `${t.symbol} precision in range`);
    assert.ok(t.symbol.length <= config.symbolMaxLength, `${t.symbol} within symbol length`);
    assert.equal(typeof t.maxSupply, 'string', 'supply is a string (big-int safe)');
    assert.equal(typeof t.supplyCapImmutable, 'boolean');
  }

  // DRONE is the hard-fixed governance token; APIS has a soft (mintable) cap.
  const drone = genesis.tokens.find((t) => t.symbol === 'DRONE');
  const apis = genesis.tokens.find((t) => t.symbol === 'APIS');
  assert.equal(drone.supplyCapImmutable, true);
  assert.equal(apis.supplyCapImmutable, false);
});
