/**
 * engine.test.mjs — deterministic execution, auth checks, supply-cap
 * immutability, precision discipline, rate metering, and the gated seams.
 *
 * Run: node --test engine/test/engine.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { State } from '../lib/state.mjs';
import { Engine } from '../lib/engine.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { tokens } from '../contracts/tokens.mjs';
import { toBaseUnits, fromBaseUnits, maxSupplyBaseUnits } from '../lib/decimal.mjs';
import { config } from '../config.mjs';

function fresh() {
  const s = new State(null); // in-memory, no file
  bootstrapGenesis(s);
  return s;
}

// helper: build a custom_json op for the engine
function op(sender, action, payload, { authLevel = 'active', blockNum = 1, txId = 't' } = {}) {
  return {
    sender,
    authLevel,
    blockNum,
    blockId: 'b',
    txId,
    json: JSON.stringify({ contractName: 'tokens', contractAction: action, contractPayload: payload }),
  };
}

test('genesis: APIS + DRONE created and minted to issuer', () => {
  const s = fresh();
  const apis = s.findOne('tokens', { symbol: 'APIS' });
  const drone = s.findOne('tokens', { symbol: 'DRONE' });
  assert.ok(apis && drone);
  assert.equal(apis.issuer, config.seams ? 'hathor' : 'hathor');
  const bal = s.findOne('balances', { account: 'hathor', symbol: 'APIS' });
  assert.equal(fromBaseUnits(BigInt(bal.balance), 3), '1000000.000');
  // DRONE supply cap is immutable
  assert.equal(drone.supplyCapImmutable, true);
});

test('decimal: base-unit round trip, no floats', () => {
  assert.equal(toBaseUnits('1.5', 3), 1500n);
  assert.equal(fromBaseUnits(1500n, 3), '1.500');
  assert.equal(toBaseUnits('100', 0), 100n);
  assert.throws(() => toBaseUnits('1.5555', 3), /precision/);
  assert.throws(() => toBaseUnits('-5', 3), /malformed/);
  assert.throws(() => toBaseUnits('1e3', 3), /malformed/);
});

test('create: charges 100 APIS fee and registers token', () => {
  const s = fresh();
  const e = new Engine(s);
  const r = e.process(op('hathor', 'create', { symbol: 'TESTTOK', name: 'Test', precision: 3, maxSupply: '1000' }));
  assert.equal(r.ok, true);
  const tok = s.findOne('tokens', { symbol: 'TESTTOK' });
  assert.equal(tok.issuer, 'hathor');
  // fee burned: 1,000,000 - 100 = 999,900
  const bal = s.findOne('balances', { account: 'hathor', symbol: 'APIS' });
  assert.equal(fromBaseUnits(BigInt(bal.balance), 3), '999900.000');
});

test('create: rejects bad symbol + duplicate', () => {
  const s = fresh();
  const e = new Engine(s);
  assert.equal(e.process(op('hathor', 'create', { symbol: 'lower', name: 'x', precision: 3, maxSupply: '10' }, { blockNum: 1 })).ok, false);
  assert.equal(e.process(op('hathor', 'create', { symbol: 'ELEVENCHARS', name: 'x', precision: 3, maxSupply: '10' }, { blockNum: 2 })).ok, false);
  assert.equal(e.process(op('hathor', 'create', { symbol: 'DUP', name: 'x', precision: 3, maxSupply: '10' }, { blockNum: 3, txId: 't1' })).ok, true);
  assert.equal(e.process(op('hathor', 'create', { symbol: 'DUP', name: 'x', precision: 3, maxSupply: '10' }, { blockNum: 4, txId: 't2' })).ok, false);
});

test('issue: issuer-only, respects maxSupply', () => {
  const s = fresh();
  const e = new Engine(s);
  e.process(op('hathor', 'create', { symbol: 'CAP', name: 'Capped', precision: 0, maxSupply: '100' }));
  // non-issuer cannot issue
  const bad = tokens.issue(s, { sender: 'mallory', blockNum: 1 }, { symbol: 'CAP', to: 'mallory', quantity: '1' });
  assert.equal(bad.ok, false);
  assert.match(bad.error, /only issuer/);
  // issuer can, up to cap
  assert.equal(tokens.issue(s, { sender: 'hathor', blockNum: 1 }, { symbol: 'CAP', to: 'alice', quantity: '100' }).ok, true);
  // exceeding cap fails
  const over = tokens.issue(s, { sender: 'hathor', blockNum: 1 }, { symbol: 'CAP', to: 'alice', quantity: '1' });
  assert.equal(over.ok, false);
  assert.match(over.error, /maxSupply/);
});

test('issue: DRONE immutable cap can never be exceeded', () => {
  const s = fresh();
  // DRONE genesis already minted full 1,000,000. Any further issue must fail.
  const r = tokens.issue(s, { sender: 'hathor', blockNum: 1 }, { symbol: 'DRONE', to: 'hathor', quantity: '1' });
  assert.equal(r.ok, false);
  assert.match(r.error, /immutable/);
});

test('transfer: moves balance, rejects overdraw + self', () => {
  const s = fresh();
  const e = new Engine(s);
  // transfer 1000 APIS hathor->alice (free first tx, then would burn fee — use block isolation)
  assert.equal(e.process(op('hathor', 'transfer', { symbol: 'APIS', to: 'alice', quantity: '1000' })).ok, true);
  assert.equal(fromBaseUnits(BigInt(s.findOne('balances', { account: 'alice', symbol: 'APIS' }).balance), 3), '1000.000');
  // overdraw
  assert.equal(tokens.transfer(s, { sender: 'alice' }, { symbol: 'APIS', to: 'bob', quantity: '99999' }).ok, false);
  // self
  assert.equal(tokens.transfer(s, { sender: 'alice' }, { symbol: 'APIS', to: 'alice', quantity: '1' }).ok, false);
});

test('stake/unstake: liquid<->stake bucket conservation', () => {
  const s = fresh();
  const before = BigInt(s.findOne('balances', { account: 'hathor', symbol: 'DRONE' }).balance);
  assert.equal(tokens.stake(s, { sender: 'hathor' }, { symbol: 'DRONE', quantity: '500' }).ok, true);
  const row = s.findOne('balances', { account: 'hathor', symbol: 'DRONE' });
  assert.equal(BigInt(row.stake), toBaseUnits('500', 3));
  assert.equal(tokens.unstake(s, { sender: 'hathor' }, { symbol: 'DRONE', quantity: '500' }).ok, true);
  assert.equal(BigInt(s.findOne('balances', { account: 'hathor', symbol: 'DRONE' }).balance), before);
});

test('auth: value ops require active auth, posting rejected', () => {
  const s = fresh();
  const e = new Engine(s);
  const r = e.process(op('hathor', 'transfer', { symbol: 'APIS', to: 'alice', quantity: '1' }, { authLevel: 'posting' }));
  assert.equal(r.ok, false);
  assert.match(r.error, /active auth/);
});

test('auth: signer taken from op, never from payload', () => {
  const s = fresh();
  const e = new Engine(s);
  // payload claims a different "from"; engine must ignore it and use op.sender=mallory
  const r = e.process(op('mallory', 'transfer', { symbol: 'APIS', to: 'victim', quantity: '1', from: 'hathor' }));
  // mallory has no APIS -> insufficient balance (proves it used mallory, not hathor)
  assert.equal(r.ok, false);
  assert.match(r.error, /insufficient/);
});

test('rate metering: free allowance then fee, hard cap at 20/block', () => {
  const s = fresh();
  const e = new Engine(s);
  // give alice APIS to pay resource fees
  e.process(op('hathor', 'transfer', { symbol: 'APIS', to: 'alice', quantity: '10' }, { blockNum: 1 }));
  let okCount = 0;
  for (let i = 0; i < 25; i++) {
    const r = e.process(op('alice', 'transfer', { symbol: 'APIS', to: 'bob', quantity: '0.001' }, { blockNum: 2, txId: 'a' + i }));
    if (r.ok) okCount++;
    else if (i >= 20) assert.match(r.error, /rate limit/);
  }
  assert.ok(okCount <= 20, 'never more than 20 tx/account/block succeed');
});

test('determinism: same op sequence -> identical state hash', () => {
  function run() {
    const s = fresh();
    const e = new Engine(s);
    e.process(op('hathor', 'create', { symbol: 'DET', name: 'Det', precision: 2, maxSupply: '500' }, { blockNum: 1 }));
    e.process(op('hathor', 'issue', { symbol: 'DET', to: 'alice', quantity: '100' }, { blockNum: 2 }));
    e.process(op('alice', 'transfer', { symbol: 'DET', to: 'bob', quantity: '40' }, { blockNum: 3 }));
    return s.hash();
  }
  assert.equal(run(), run());
});

test('maxSupply ceiling: rejects above Number.MAX_SAFE_INTEGER', () => {
  const s = fresh();
  const e = new Engine(s);
  const huge = (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString();
  const r = e.process(op('hathor', 'create', { symbol: 'BIG', name: 'x', precision: 0, maxSupply: huge }));
  assert.equal(r.ok, false);
  assert.match(r.error, /ceiling/);
});

test('seams: gateway + dexSettlement disabled by default', async () => {
  const { gateway, dexSettlement } = await import('../contracts/seams.mjs');
  assert.equal(config.seams.gateway.enabled, false);
  assert.equal(config.seams.dexSettlement.enabled, false);
  assert.equal(gateway.deposit(null, { sender: 'x' }, {}).ok, false);
  assert.match(gateway.deposit(null, { sender: 'x' }, {}).error, /disabled/);
  assert.equal(dexSettlement.settle(null, { sender: 'x' }, {}).ok, false);
});

test('extractOps: only matching sidechain id + auth-derived sender', async () => {
  const { extractOps } = await import('../lib/streamer.mjs');
  const block = {
    block_id: 'abc',
    transactions: [
      { operations: [['custom_json', { id: config.sidechainId, required_active_auths: ['alice'], required_posting_auths: [], json: '{"contractName":"tokens","contractAction":"transfer","contractPayload":{}}' }]] },
      // Steem-fork style: active auth carried in `required_auths`
      { operations: [['custom_json', { id: config.sidechainId, required_auths: ['carol'], required_posting_auths: [], json: '{"contractName":"tokens","contractAction":"create","contractPayload":{}}' }]] },
      { operations: [['custom_json', { id: 'other-chain', required_active_auths: ['bob'], json: '{}' }]] },
      { operations: [['transfer', { from: 'x', to: 'y' }]] },
    ],
  };
  const ops = extractOps(block, 42);
  assert.equal(ops.length, 2);
  assert.equal(ops[0].sender, 'alice');
  assert.equal(ops[0].authLevel, 'active');
  assert.equal(ops[0].blockNum, 42);
  assert.equal(ops[1].sender, 'carol');
  assert.equal(ops[1].authLevel, 'active');
});
