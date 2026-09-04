// hive-engine-bridge-daemon.test.mjs — offline tests for the tick orchestration + key loader.
// No network, no real keys: edges (submit/broadcast/read) are injected fakes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  bridgedSymbols, loadBridgeKeys, depositTick, releaseTick,
  fetchConfirmedReleases, alreadyReleased, daemonManifest,
} from './hive-engine-bridge-daemon.mjs';

const A1 = '0x' + '1'.repeat(40);
const A2 = '0x' + '2'.repeat(40);
const REF = '0x' + 'ab'.repeat(32);

test('bridgedSymbols defaults to VKBT,CURE and parses env', () => {
  assert.deepEqual(bridgedSymbols({}), ['VKBT', 'CURE']);
  assert.deepEqual(bridgedSymbols({ HE_BRIDGE_SYMBOLS: 'vkbt, foo ,BAR' }), ['VKBT', 'FOO', 'BAR']);
});

test('loadBridgeKeys reads both cred files (structure only)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brkeys-'));
  const vp = join(dir, 'validators.json'), hp = join(dir, 'hive.json');
  writeFileSync(vp, JSON.stringify({ bot_signing_set: {
    shared: { address: A1, privateKey: '0x' + '1'.repeat(64) },
    bot: [{ address: A2, privateKey: '2'.repeat(64) }],
  } }));
  writeFileSync(hp, JSON.stringify({ bot_side: {
    shared: { wif: '5Jshared', pub: 'STMa' },
    bot: [{ wif: '5Jbot1', pub: 'STMb' }, { wif: '5Jbot2', pub: 'STMc' }],
  } }));
  const r = loadBridgeKeys({ BRIDGE_VALIDATORS_CRED: vp, BRIDGE_HIVE_SIGNERS_CRED: hp });
  assert.equal(r.ok, true);
  assert.equal(r.evm.length, 2);
  assert.equal(r.evm[1].privateKey, '0x' + '2'.repeat(64)); // 0x-prefix normalized
  assert.equal(r.hive.length, 3);
  assert.deepEqual(r.hive.map((h) => h.pub), ['STMa', 'STMb', 'STMc']);
});

test('loadBridgeKeys soft-fails without paths', () => {
  const r = loadBridgeKeys({});
  assert.equal(r.ok, false);
  assert.match(r.reason, /credential-paths/);
});

test('depositTick submits once per (ref,address) and is idempotent', async () => {
  const seen = new Set();
  const submits = [];
  const submitters = [
    { address: A1, submit: async (c) => { submits.push([A1, c.args[0]]); return '0xhash1'; } },
    { address: A2, submit: async (c) => { submits.push([A2, c.args[0]]); return '0xhash2'; } },
  ];
  const attestations = async () => ([{ args: [REF, '0xtid', A1, '100'], symbol: 'VKBT' }]);
  const r1 = await depositTick({ attestations, submitters, seen });
  assert.equal(r1.submitted.length, 2);      // both keys attested
  assert.equal(submits.length, 2);
  const r2 = await depositTick({ attestations, submitters, seen }); // second pass: nothing new
  assert.equal(r2.submitted.length, 0);
  assert.equal(r2.skipped.length, 2);
  assert.equal(submits.length, 2);
});

test('depositTick treats on-chain "already attested" revert as done (marks seen)', async () => {
  const seen = new Set();
  let calls = 0;
  const submitters = [{ address: A1, submit: async () => { calls++; throw new Error('execution reverted: AlreadyAttested'); } }];
  const attestations = async () => ([{ args: [REF, '0xtid', A1, '100'], symbol: 'CURE' }]);
  const r = await depositTick({ attestations, submitters, seen });
  assert.equal(r.submitted.length, 0);
  assert.equal(r.skipped.length, 1);
  assert.equal(r.failed.length, 0);
  const r2 = await depositTick({ attestations, submitters, seen });
  assert.equal(calls, 1); // not retried
  assert.equal(r2.skipped[0].reason, 'already-submitted-this-instance');
});

test('depositTick leaves real failures unseen for retry', async () => {
  const seen = new Set();
  let n = 0;
  const submitters = [{ address: A1, submit: async () => { n++; if (n === 1) throw new Error('timeout'); return '0xok'; } }];
  const attestations = async () => ([{ args: [REF, '0xtid', A1, '100'], symbol: 'VKBT' }]);
  const r1 = await depositTick({ attestations, submitters, seen });
  assert.equal(r1.failed.length, 1);
  const r2 = await depositTick({ attestations, submitters, seen });
  assert.equal(r2.submitted.length, 1); // retried and succeeded
});

test('releaseTick broadcasts once per nonce, respects in-process + on-chain idempotency', async () => {
  const released = new Set();
  const casts = [];
  const releases = async () => ([{ op: ['custom_json', {}], nonce: '7', symbol: 'VKBT', amount: '1.5', toAccount: 'alice' }]);
  const broadcast = async (op) => { casts.push(op); return { id: 'trx7' }; };
  const r1 = await releaseTick({ releases, broadcast, released, isReleased: async () => false });
  assert.equal(r1.released.length, 1);
  assert.equal(casts.length, 1);
  const r2 = await releaseTick({ releases, broadcast, released, isReleased: async () => false });
  assert.equal(r2.skipped.length, 1); // in-process nonce set
  assert.equal(casts.length, 1);
});

test('releaseTick skips a nonce already released on-chain (memo check)', async () => {
  const released = new Set();
  const casts = [];
  const releases = async () => ([{ op: ['custom_json', {}], nonce: '9', symbol: 'CURE', amount: '2', toAccount: 'bob' }]);
  const broadcast = async (op) => { casts.push(op); return { id: 'x' }; };
  const r = await releaseTick({ releases, broadcast, released, isReleased: async () => true });
  assert.equal(r.released.length, 0);
  assert.equal(casts.length, 0);
  assert.equal(r.skipped[0].reason, 'on-chain-already-released');
});

test('fetchConfirmedReleases bounds toBlock by confirmations (offline fetch)', async () => {
  let capturedParams = null;
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (body.method === 'eth_blockNumber') return { json: async () => ({ result: '0x64' }) }; // head=100
    if (body.method === 'eth_getLogs') { capturedParams = body.params[0]; return { json: async () => ({ result: [] }) }; }
    return { json: async () => ({ result: null }) };
  };
  const wcfg = { pranaRpc: 'http://x', bridgeAddress: '0x' + 'a'.repeat(40), withdrawalTopic0: '0xtopic', lookbackBlocks: 50 };
  const ops = await fetchConfirmedReleases(wcfg, { fetch: fakeFetch, confirmations: 12 });
  assert.deepEqual(ops, []);
  assert.equal(capturedParams.toBlock, '0x' + (100 - 12).toString(16)); // 0x58
});

test('fetchConfirmedReleases soft-fails to [] with no config', async () => {
  assert.deepEqual(await fetchConfirmedReleases(null, {}), []);
  assert.deepEqual(await fetchConfirmedReleases({ pranaRpc: '', bridgeAddress: '' }, {}), []);
});

test('alreadyReleased matches the bridge-withdraw memo marker', async () => {
  const fakeFetch = async () => ({ ok: true, json: async () => ([
    { from: 'kula-bridge', memo: 'bridge-withdraw:42', symbol: 'VKBT' },
    { from: 'kula-bridge', memo: 'something-else', symbol: 'VKBT' },
  ]) });
  assert.equal(await alreadyReleased({ historyUrl: 'http://h', custody: 'kula-bridge', symbol: 'VKBT', nonce: '42', fetch: fakeFetch }), true);
  assert.equal(await alreadyReleased({ historyUrl: 'http://h', custody: 'kula-bridge', symbol: 'VKBT', nonce: '99', fetch: fakeFetch }), false);
});

test('daemonManifest prints addresses only, no secrets, and reports key load', () => {
  const dir = mkdtempSync(join(tmpdir(), 'brman-'));
  const vp = join(dir, 'v.json'), hp = join(dir, 'h.json');
  writeFileSync(vp, JSON.stringify({ bot_signing_set: { shared: { address: A1, privateKey: '0x' + '1'.repeat(64) }, bot: [] } }));
  writeFileSync(hp, JSON.stringify({ bot_side: { shared: { wif: '5Jx', pub: 'STMpub' }, bot: [] } }));
  const m = daemonManifest({ BRIDGE_VALIDATORS_CRED: vp, BRIDGE_HIVE_SIGNERS_CRED: hp, HE_BRIDGE_CUSTODY: 'kula-bridge' });
  assert.equal(m.keys.loaded, true);
  assert.equal(m.keys.evmValidators, 1);
  assert.deepEqual(m.keys.evmAddresses, [A1]);
  assert.deepEqual(m.keys.hivePubs, ['STMpub']);
  const s = JSON.stringify(m);
  assert.ok(!s.includes('1'.repeat(64)), 'no EVM private in manifest');
  assert.ok(!s.includes('5Jx'), 'no WIF in manifest');
});
