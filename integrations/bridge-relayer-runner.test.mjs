// bridge-relayer-runner.test.mjs — offline. No network: MELEK read goes through a fake
// fetch (__setFetch), the PRANA submit goes through a fake recorder. Asserts the loop only
// submits FINALIZED, well-formed, not-yet-seen deposits and soft-fails on bad input.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runOnce, makeRunner, normalizeHistory, fetchHistory, loadConfig, __setFetch,
} from './bridge-relayer-runner.mjs';

const CUSTODY = 'melek-bridge';
const RECIPIENT = '0x1111111111111111111111111111111111111111';
const TOKEN_ID = '0x' + 'ab'.repeat(32);   // stand-in for keccak256("MELEK")

// A fake condenser_api response. head props say head/irreversible = 100.
// Two transfers to custody: one deep (block 10, FINAL at threshold 20), one fresh (block 99, NOT final).
function fakeHistoryRows() {
  return [
    [1, {
      trx_id: 'ref-final-deep', block: 10, timestamp: '2026-06-16T00:00:00',
      op: ['transfer', { from: 'alice', to: CUSTODY, amount: '1.234 MELEK', memo: RECIPIENT }],
    }],
    [2, {
      trx_id: 'ref-fresh-shallow', block: 99, timestamp: '2026-06-16T00:10:00',
      op: ['transfer', { from: 'bob', to: CUSTODY, amount: '5.000 MELEK', memo: RECIPIENT }],
    }],
    [3, {
      trx_id: 'ref-no-dest', block: 11, timestamp: '2026-06-16T00:20:00',
      op: ['transfer', { from: 'carol', to: CUSTODY, amount: '2.000 MELEK', memo: 'hi no address here' }],
    }],
  ];
}

// Install a fake fetch that answers the two RPC methods the runner uses.
function installFakeChain(rows = fakeHistoryRows(), { headBlock = 100 } = {}) {
  __setFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    let result;
    if (body.method === 'condenser_api.get_dynamic_global_properties') {
      result = { head_block_number: headBlock, last_irreversible_block_num: headBlock };
    } else if (body.method === 'condenser_api.get_account_history') {
      result = rows;
    } else {
      result = null;
    }
    return { json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  });
}

const cfg = () => loadConfig({
  MELEK_RPC_URL: 'http://melek.local/rpc',
  PRANA_RPC_URL: 'http://prana.local/rpc',
  GRAPHENE_BRIDGE_ADDRESS: '0x04C89607413713Ec9775E14b954286519d836FEf',
  MELEK_BRIDGE_CUSTODY: CUSTODY,
  BRIDGE_TOKEN_ID: TOKEN_ID,
  CONFIRMATIONS: '20',
  PRANA_ATTESTER_KEY: 'fake-key-presence-only',
});

test('normalizeHistory flattens op into {type,...data}', () => {
  const n = normalizeHistory(fakeHistoryRows());
  assert.equal(n.length, 3);
  assert.equal(n[0].trxId, 'ref-final-deep');
  assert.equal(n[0].blockNum, 10);
  assert.equal(n[0].op.type, 'transfer');
  assert.equal(n[0].op.to, CUSTODY);
  assert.equal(n[0].op.memo, RECIPIENT);
});

test('normalizeHistory soft-handles junk rows', () => {
  assert.deepEqual(normalizeHistory(null), []);
  assert.deepEqual(normalizeHistory([null, [1], [2, {}], [3, { op: ['x'] }]]), []);
});

test('runOnce submits ONLY the finalized, well-formed deposit with correct args', async () => {
  installFakeChain();
  const calls = [];
  const submit = (call, dep) => { calls.push({ call, dep }); return { txHash: '0xfeed' }; };

  const ctx = {};
  const r = await runOnce(cfg(), submit, ctx);

  assert.equal(r.ok, true);
  assert.equal(r.headBlock, 100);
  // exactly ONE submitted: the deep/final one with a destination
  assert.equal(calls.length, 1);
  assert.equal(r.submitted.length, 1);
  assert.equal(r.submitted[0].ref, 'ref-final-deep');

  // correct (ref, tokenId, recipient, scaled amount): 1.234 MELEK @3dp -> 18dp.
  // For a plain transfer the deriver takes the tokenId from the asset symbol ("MELEK")
  // unless the memo carries TOKEN= — see "encoding the tokenId" below.
  const args = calls[0].call.args;
  assert.equal(calls[0].call.method, 'attestDeposit');
  assert.deepEqual(args, ['ref-final-deep', 'MELEK', RECIPIENT, '1234000000000000000']);

  // fresh one is pending (not final), no-dest one is skipped
  assert.ok(r.pending.some((p) => p.ref === 'ref-fresh-shallow'));
  assert.ok(r.skipped.some((s) => s.ref === 'ref-no-dest'));
  // and the seen-set now holds the submitted ref
  assert.ok(ctx.seen.has('ref-final-deep'));
});

test('memo TOKEN= pins the exact bytes32 tokenId the contract expects', async () => {
  installFakeChain([
    [1, {
      trx_id: 'ref-token-pinned', block: 10, timestamp: '2026-06-16T00:00:00',
      op: ['transfer', { from: 'dave', to: CUSTODY, amount: '1.000 MELEK', memo: `${RECIPIENT} TOKEN=${TOKEN_ID}` }],
    }],
  ]);
  const calls = [];
  const r = await runOnce(cfg(), (c) => { calls.push(c); return 1; }, {});
  assert.equal(r.submitted.length, 1);
  assert.deepEqual(calls[0].args, ['ref-token-pinned', TOKEN_ID, RECIPIENT, '1000000000000000000']);
});

test('a re-run does NOT resubmit the same ref (idempotent)', async () => {
  installFakeChain();
  const calls = [];
  const submit = (call) => { calls.push(call); return { ok: true }; };

  const runner = makeRunner(submit, cfg());
  const r1 = await runner.tick();
  const r2 = await runner.tick();

  assert.equal(r1.submitted.length, 1);
  assert.equal(r2.submitted.length, 0);                 // nothing new submitted
  assert.equal(calls.length, 1);                        // submit called exactly once total
  assert.ok(r2.skipped.some((s) => s.reason === 'already-submitted-by-this-instance'));
});

test('a deposit with no destination is skipped, never submitted', async () => {
  // ONLY the no-dest deposit, made deep/final so finality is not what filters it
  installFakeChain([
    [1, {
      trx_id: 'ref-no-dest', block: 10, timestamp: '2026-06-16T00:00:00',
      op: ['transfer', { from: 'carol', to: CUSTODY, amount: '2.000 MELEK', memo: 'no 0x here' }],
    }],
  ]);
  const calls = [];
  const r = await runOnce(cfg(), (c) => { calls.push(c); }, {});
  assert.equal(calls.length, 0);
  assert.equal(r.submitted.length, 0);
  assert.ok(r.skipped.some((s) => s.ref === 'ref-no-dest'));
});

test('submit throwing soft-fails: recorded in failed[], ref left UNSEEN for retry', async () => {
  installFakeChain();
  let throws = 0;
  const submitThrows = () => { throws++; throw new Error('prana rpc down'); };

  const ctx = {};
  const r1 = await runOnce(cfg(), submitThrows, ctx);
  assert.equal(r1.ok, true);                             // loop did NOT crash
  assert.equal(r1.submitted.length, 0);
  assert.equal(r1.failed.length, 1);
  assert.equal(r1.failed[0].ref, 'ref-final-deep');
  assert.ok(r1.failed[0].reason.includes('prana rpc down'));
  assert.equal(ctx.seen.has('ref-final-deep'), false);  // NOT marked seen -> retryable

  // next pass with a working submit retries and succeeds
  const ok = [];
  const r2 = await runOnce(cfg(), (c) => { ok.push(c); return 1; }, ctx);
  assert.equal(r2.submitted.length, 1);
  assert.equal(ok.length, 1);
});

test('runOnce soft-fails on a missing submit fn', async () => {
  installFakeChain();
  const r = await runOnce(cfg(), null, {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-submit-fn');
});

test('fetchHistory soft-fails when the MELEK read throws (no crash, safe shape)', async () => {
  __setFetch(async () => { throw new Error('network boom'); });
  const r = await fetchHistory(cfg());
  assert.equal(r.ok, false);
  assert.deepEqual(r.history, []);
  assert.ok(r.reason.includes('network boom'));
});

test('fetchHistory soft-fails with no RPC configured', async () => {
  const r = await fetchHistory(loadConfig({ MELEK_BRIDGE_CUSTODY: CUSTODY }));
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-melek-rpc');
});

test('loadConfig defaults confirmations to 20 and never exposes the key value', () => {
  const c = loadConfig({ PRANA_ATTESTER_KEY: 'super-secret-wif' });
  assert.equal(c.confirmations, 20);
  assert.equal(c.keyPresent, true);
  assert.equal(c.melekRpc, '');
  // the config object carries presence, never the secret
  assert.equal(JSON.stringify(c).includes('super-secret-wif'), false);
});

// restore the global fetch after the suite
test('cleanup', () => { __setFetch(); });
