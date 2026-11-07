// bridge-withdrawal-runner.test.mjs — offline. PRANA reads via a fake fetch (__setFetch); the MELEK
// release via a fake broadcaster. Asserts log decode, destination decode, 18->3dp down-scale, and that
// runOnce releases ONLY finalized native withdrawals, once per nonce, soft-failing on a broadcast throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fsmod from 'node:fs';
import {
  decodeWithdrawalLog, decodeDestination, scaleDownToNative, buildReleaseOp,
  loadConfig, fetchWithdrawals, runOnce, makeRunner, WITHDRAWAL_TOPIC0, __setFetch,
  ReleasedNonceStore, MemoryNonceStore,
} from './bridge-withdrawal-runner.mjs';

const TOKEN_ID = '0x' + 'ab'.repeat(32);             // stand-in wMELEK tokenId
const FROM = '0x1111111111111111111111111111111111111111';
const WRAPPED = '0x4C4a2f8c81640e47606d3fd77B353E87Ba015584';
// destinationRef = encodeBytes32String("alice-tests")
const DEST = '0x' + Buffer.from('alice-tests', 'ascii').toString('hex').padEnd(64, '0');

// build a raw GrapheneWithdrawal log. amount is an 18dp wei string.
function log({ nonce = 7, amount = '1500000000000000000', block = 10, tokenId = TOKEN_ID } = {}) {
  const u256 = (v) => BigInt(v).toString(16).padStart(64, '0');
  const addr32 = (a) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0');
  return {
    address: '0x04C89607413713Ec9775E14b954286519d836FEf',
    topics: [WITHDRAWAL_TOPIC0, '0x' + u256(nonce), tokenId, '0x' + addr32(FROM)],
    data: '0x' + addr32(WRAPPED) + u256(amount) + DEST.slice(2),
    blockNumber: '0x' + block.toString(16),
  };
}

const cfg = (over = {}) => loadConfig({
  PRANA_RPC_URL: 'http://prana.local/rpc',
  GRAPHENE_BRIDGE_ADDRESS: '0x04C89607413713Ec9775E14b954286519d836FEf',
  MELEK_BRIDGE_CUSTODY: 'melekbridge',
  BRIDGE_NATIVE_TOKEN_ID: TOKEN_ID,
  MELEK_NATIVE_SYMBOL: 'TESTS',
  CONFIRMATIONS: '12',
  ...over,
});

test('decodeWithdrawalLog pulls nonce/tokenId/from/amount/destinationRef', () => {
  const ev = decodeWithdrawalLog(log({ nonce: 9, amount: '2000000000000000000' }));
  assert.equal(ev.args.nonce, '9');
  assert.equal(ev.args.tokenId, TOKEN_ID);
  assert.equal(ev.args.from, FROM.toLowerCase());
  assert.equal(ev.args.amount, '2000000000000000000');
  assert.equal(ev.args.destinationRef, DEST);
  assert.equal(decodeWithdrawalLog({ topics: ['0xwrong'] }), null);
  assert.equal(decodeWithdrawalLog(null), null);
});

test('decodeDestination decodes a bytes32 account name; rejects junk', () => {
  assert.equal(decodeDestination(DEST), 'alice-tests');
  assert.equal(decodeDestination('0x' + '00'.repeat(32)), null);          // empty
  assert.equal(decodeDestination('0x' + Buffer.from('AB', 'ascii').toString('hex').padEnd(64, '0')), null); // uppercase invalid
  assert.equal(decodeDestination('not-hex'), null);
});

test('scaleDownToNative converts 18dp -> 3dp, flooring dust', () => {
  assert.deepEqual(scaleDownToNative('1500000000000000000'), { amount: '1.500', dust: '0', units: '1500' });
  assert.deepEqual(scaleDownToNative('1000000000000000000'), { amount: '1.000', dust: '0', units: '1000' });
  // sub-milli dust floored
  const d = scaleDownToNative('1500000000000999999');
  assert.equal(d.amount, '1.500');
  assert.equal(d.dust, '999999');
  assert.equal(scaleDownToNative('-1'), null);
});

test('buildReleaseOp makes a standard Graphene transfer from custody', () => {
  const op = buildReleaseOp({ nonce: '7', destinationRef: DEST, amount: '1500000000000000000' }, cfg());
  assert.deepEqual(op, ['transfer', {
    from: 'melekbridge', to: 'alice-tests', amount: '1.500 TESTS', memo: 'MELEK bridge withdrawal #7',
  }]);
  // unusable destination -> null
  assert.equal(buildReleaseOp({ nonce: '7', destinationRef: '0x' + '00'.repeat(32), amount: '1' }, cfg()), null);
  // amount below native precision (units 0) -> null
  assert.equal(buildReleaseOp({ nonce: '7', destinationRef: DEST, amount: '100' }, cfg()), null);
});

function installFakeChain(logs, head = 100) {
  __setFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    let result = null;
    if (body.method === 'eth_blockNumber') result = '0x' + head.toString(16);
    else if (body.method === 'eth_getLogs') result = logs;
    return { json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  });
}

test('runOnce releases ONLY a finalized native withdrawal, once, with the right op', async () => {
  installFakeChain([log({ nonce: 7, amount: '1500000000000000000', block: 10 })], 100); // 90 confs
  const calls = [];
  const r = await runOnce(cfg(), (op, o) => { calls.push({ op, o }); return { id: '0xMELEK' }; }, {});
  assert.equal(r.ok, true);
  assert.equal(r.released.length, 1);
  assert.equal(r.released[0].nonce, '7');
  assert.equal(r.released[0].to, 'alice-tests');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].op[0], 'transfer');
  assert.equal(calls[0].op[1].amount, '1.500 TESTS');
  assert.equal(calls[0].o.keyType, 'active');
});

test('a shallow (unconfirmed) withdrawal is held, not released', async () => {
  installFakeChain([log({ nonce: 8, block: 95 })], 100); // only 5 confs < 12
  const calls = [];
  const r = await runOnce(cfg(), (op) => { calls.push(op); return 1; }, {});
  assert.equal(r.released.length, 0);
  assert.equal(calls.length, 0);
  assert.ok(r.skipped.some((s) => s.reason === 'awaiting-deep-prana-confirmation'));
});

test('a non-native tokenId is skipped (engine-side wrapper)', async () => {
  installFakeChain([log({ nonce: 9, tokenId: '0x' + 'cd'.repeat(32), block: 10 })], 100);
  const r = await runOnce(cfg(), () => 1, {});
  assert.equal(r.released.length, 0);
  assert.ok(r.skipped.some((s) => s.reason === 'non-native-token'));
});

test('idempotent: a second tick does not re-release the same nonce', async () => {
  installFakeChain([log({ nonce: 7, block: 10 })], 100);
  const calls = [];
  // Explicit MemoryNonceStore: makeRunner now PERSISTS by default, and a test must not touch
  // /var/lib. Passing the store also separates per-process idempotency from the across-restart
  // idempotency the next test covers.
  const runner = makeRunner((op) => { calls.push(op); return 1; }, cfg(), new MemoryNonceStore());
  const r1 = await runner.tick();
  const r2 = await runner.tick();
  assert.equal(r1.released.length, 1);
  assert.equal(r2.released.length, 0);
  assert.equal(calls.length, 1);
  assert.ok(r2.skipped.some((s) => s.reason === 'nonce-already-released'));
});

test('a broadcast throw soft-fails: recorded in failed[], nonce left for retry', async () => {
  installFakeChain([log({ nonce: 7, block: 10 })], 100);
  const ctx = {};
  const r1 = await runOnce(cfg(), () => { throw new Error('melek rpc down'); }, ctx);
  assert.equal(r1.ok, true);
  assert.equal(r1.released.length, 0);
  assert.equal(r1.failed.length, 1);
  assert.match(r1.failed[0].reason, /melek rpc down/);
  // retry with a working broadcaster succeeds
  const ok = [];
  const r2 = await runOnce(cfg(), (op) => { ok.push(op); return 1; }, ctx);
  assert.equal(r2.released.length, 1);
});

test('runOnce soft-fails with no broadcaster / no rpc', async () => {
  assert.equal((await runOnce(cfg(), null, {})).reason, 'no-broadcaster');
  __setFetch(async () => { throw new Error('boom'); });
  const r = await runOnce(cfg(), () => 1, {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /boom/);
});

test('fetchWithdrawals soft-fails with no rpc configured', async () => {
  const r = await fetchWithdrawals(loadConfig({ GRAPHENE_BRIDGE_ADDRESS: '0xabc' }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-prana-rpc');
});

test('cleanup', () => { __setFetch(); });


// ── restart idempotency: the defect this module shipped with ───────────────────────────────────────
// The released set was a per-process `new Set()` with no cursor and a 5,000-block rescan, so a
// restart re-released every withdrawal in the window as real MELEK out of custody. Graphene
// transfers carry no duplicate protection, so nothing downstream would have caught it.
test('ACROSS RESTART: a new runner over the same store does not re-release', async () => {
  installFakeChain([log({ nonce: 7, block: 10 }), log({ nonce: 8, block: 11 })], 100);
  const calls = [];
  const bc = (op) => { calls.push(op); return 1; };
  const store = new MemoryNonceStore();

  const first = await makeRunner(bc, cfg(), store).tick();
  assert.equal(first.released.length, 2, 'both go out on the first run');
  assert.equal(calls.length, 2);

  // a fresh runner is a fresh process: same chain state, same store
  const second = await makeRunner(bc, cfg(), store).tick();
  assert.equal(second.released.length, 0, 'NOTHING may go out twice');
  assert.equal(calls.length, 2, 'no second broadcast — this is the money assertion');
  assert.ok(second.skipped.every((x) => x.reason === 'nonce-already-released'));
});

test('FAILS CLOSED: unreadable state refuses the whole tick rather than repaying', async () => {
  installFakeChain([log({ nonce: 7, block: 10 })], 100);
  const calls = [];
  const corrupt = { read: () => null, write: () => true };
  const r = await makeRunner((op) => { calls.push(op); return 1; }, cfg(), corrupt).tick();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'untrusted-state');
  assert.equal(calls.length, 0, 'a store we cannot read must release NOTHING');
});

test('FAILS CLOSED: a failed persist halts the tick after the release it could not record', async () => {
  installFakeChain([log({ nonce: 7, block: 10 }), log({ nonce: 8, block: 11 })], 100);
  const calls = [];
  const unwritable = { read: () => [], write: () => false };
  const r = await makeRunner((op) => { calls.push(op); return 1; }, cfg(), unwritable).tick();
  assert.equal(calls.length, 1, 'stops after the first release rather than continuing blind');
  assert.ok(r.failed.some((f) => /could-not-persist/.test(f.reason)));
});

test('ReleasedNonceStore: clean start on a missing file, round-trip, UNTRUSTED on corrupt', () => {
  const path = `${process.cwd()}/.tmp-wd-store-${process.pid}.json`;
  try {
    const st = new ReleasedNonceStore(path);
    assert.deepEqual(st.read(), [], 'no file yet is a clean first run, not a failure');
    assert.equal(st.write(new Set(['7', '8'])), true);
    assert.deepEqual(new ReleasedNonceStore(path).read(), ['7', '8'], 'round-trips');
    fsmod.writeFileSync(path, '{not json');
    assert.equal(new ReleasedNonceStore(path).read(), null, 'corrupt is UNTRUSTED, never a clean start');
    fsmod.writeFileSync(path, '{"released":"not-an-array"}');
    assert.equal(new ReleasedNonceStore(path).read(), null, 'wrong shape is untrusted too');
  } finally { try { fsmod.unlinkSync(path); } catch { /* ignore */ } }
});

test('persistence is ON by default — makeRunner with no store argument gets a real one', () => {
  const r = makeRunner(() => 1, cfg());
  assert.ok(r.ctx.store instanceof ReleasedNonceStore, 'the safe default must not be in-memory');
  assert.ok(loadConfig({}).stateFile, 'and a path is always configured');
});
