// wmelek-relayer-runner.test.mjs — offline. No network: the MELEK read goes through a fake
// fetch (__setFetch), the broadcast goes through a fake recorder. Asserts the loop only
// broadcasts FINALIZED, well-formed, not-yet-seen deposits, is idempotent across ticks, is
// resumable (lastBlock cursor), and soft-fails on bad input / read errors / broadcast errors.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runOnce, makeRunner, normalizeHistory, fetchHistory, loadConfig, __setFetch,
} from './wmelek-relayer-runner.mjs';

const CUSTODY = 'wmelek-bridge';

// Two transfers to custody: one deep (block 10, FINAL at threshold 20), one fresh (block 99, NOT final),
// plus one with an unparseable memo-recipient that must be skipped.
function fakeHistoryRows() {
  return [
    [1, { trx_id: 'ref-final-deep', block: 10, op: ['transfer', { from: 'alice', to: CUSTODY, amount: '1.234 MELEK', memo: 'bob' }] }],
    [2, { trx_id: 'ref-fresh-shallow', block: 99, op: ['transfer', { from: 'carol', to: CUSTODY, amount: '5.000 MELEK', memo: 'dave' }] }],
    [3, { trx_id: 'ref-bad-memo', block: 11, op: ['transfer', { from: 'erin', to: CUSTODY, amount: '2.000 MELEK', memo: 'not a valid acct!' }] }],
  ];
}

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

// loadConfig reads bridgeAccount/sidechainId from engine/config (default net = testnet:
// sidechainId mse-testnet-melek, bridge account hathor) — both non-empty, which is all we need.
const cfg = () => loadConfig({
  MELEK_RPC_URL: 'http://melek.local/rpc',
  WMELEK_BRIDGE_CUSTODY: CUSTODY,
  CONFIRMATIONS: '20',
});

function recorder() {
  const ops = [];
  const submit = async (op, dep) => { ops.push({ op, dep }); return { ok: true, id: `mock-${ops.length}` }; };
  return { submit, ops };
}

test('loadConfig defaults custody and pulls bridge/sidechain from engine config', () => {
  const c = cfg();
  assert.equal(c.custody, CUSTODY);
  assert.ok(c.bridgeAccount, 'bridge account resolved from engine config');
  assert.ok(c.sidechainId, 'sidechain id resolved from engine config');
  assert.equal(c.confirmations, 20);
  // default custody when env unset
  assert.equal(loadConfig({ MELEK_RPC_URL: 'x' }).custody, CUSTODY);
});

test('normalizeHistory flattens op into {type,...data}', () => {
  const n = normalizeHistory(fakeHistoryRows());
  assert.equal(n.length, 3);
  assert.equal(n[0].trxId, 'ref-final-deep');
  assert.equal(n[0].blockNum, 10);
  assert.equal(n[0].op.type, 'transfer');
  assert.equal(n[0].op.to, CUSTODY);
  assert.equal(n[0].op.memo, 'bob');
});

test('normalizeHistory soft-handles junk rows', () => {
  assert.deepEqual(normalizeHistory(null), []);
  assert.deepEqual(normalizeHistory([[1], 'nope', [2, { op: ['x'] }]]), []);
});

test('fetchHistory returns history + irreversible head, soft-fails without rpc', async () => {
  installFakeChain();
  const r = await fetchHistory(cfg());
  assert.equal(r.ok, true);
  assert.equal(r.headBlock, 100);
  assert.equal(r.history.length, 3);
  const bad = await fetchHistory(loadConfig({ WMELEK_BRIDGE_CUSTODY: CUSTODY }));
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /no-melek-rpc/);
});

test('runOnce broadcasts ONLY the finalized, well-formed deposit', async () => {
  installFakeChain();
  const { submit, ops } = recorder();
  const r = await runOnce(cfg(), submit, {});
  assert.equal(r.ok, true);
  assert.equal(r.submitted.length, 1);
  assert.equal(r.submitted[0].ref, 'ref-final-deep');
  assert.equal(r.submitted[0].recipient, 'bob');
  assert.equal(r.submitted[0].amount, '1.234');
  // the fresh one is pending (not final); nothing else broadcast
  assert.ok(r.pending.some((p) => p.ref === 'ref-fresh-shallow'));
  assert.equal(ops.length, 1);
  // the broadcast op is the bridge.mintWrapped custom_json
  const env = JSON.parse(ops[0].op[1].json);
  assert.equal(env.contractName, 'bridge');
  assert.equal(env.contractAction, 'mintWrapped');
  assert.deepEqual(env.contractPayload, { to: 'bob', amount: '1.234', depositRef: 'ref-final-deep' });
});

test('blank-memo deposit credits the depositor (recipient = from)', async () => {
  // make the blank-memo deposit final by lowering its block into the finalized zone
  installFakeChain([
    [3, { trx_id: 'ref-blank-memo', block: 10, op: ['transfer', { from: 'erin', to: CUSTODY, amount: '2.000 MELEK', memo: '' }] }],
  ]);
  const { submit, ops } = recorder();
  const r = await runOnce(cfg(), submit, {});
  assert.equal(r.submitted.length, 1);
  assert.equal(JSON.parse(ops[0].op[1].json).contractPayload.to, 'erin');
});

test('runOnce is IDEMPOTENT across ticks (same ref never re-broadcast)', async () => {
  installFakeChain();
  const { submit, ops } = recorder();
  const ctx = {};
  await runOnce(cfg(), submit, ctx);
  const r2 = await runOnce(cfg(), submit, ctx);
  assert.equal(ops.length, 1, 'still only one broadcast after a second tick');
  assert.ok(r2.skipped.some((s) => s.ref === 'ref-final-deep' && /already-broadcast/.test(s.reason)));
});

test('runOnce advances the resumable lastBlock cursor', async () => {
  installFakeChain();
  const { submit } = recorder();
  const ctx = {};
  const r = await runOnce(cfg(), submit, ctx);
  // fresh deposit is pending, so cursor is NOT advanced past finalized block 10 yet
  // (guard: cursor only advances when nothing pending/failed)
  assert.equal(r.pending.length, 1);
  assert.equal(ctx.lastBlock, 0);
  // once everything is final, the cursor advances
  installFakeChain(fakeHistoryRows(), { headBlock: 200 });
  const r2 = await runOnce(cfg(), submit, ctx);
  assert.equal(r2.pending.length, 0);
  assert.equal(ctx.lastBlock, 99);
});

test('a broadcast failure leaves the ref UNSEEN so the next pass retries', async () => {
  installFakeChain();
  let calls = 0;
  const submit = async () => { calls += 1; if (calls === 1) throw new Error('signer unreachable'); return { ok: true }; };
  const ctx = {};
  const r1 = await runOnce(cfg(), submit, ctx);
  assert.equal(r1.failed.length, 1);
  assert.equal(r1.submitted.length, 0);
  const r2 = await runOnce(cfg(), submit, ctx);
  assert.equal(r2.submitted.length, 1, 'retried and succeeded on the next pass');
});

test('runOnce soft-fails without a submit fn and on a read error', async () => {
  installFakeChain();
  const noSubmit = await runOnce(cfg(), null, {});
  assert.equal(noSubmit.ok, false);
  assert.match(noSubmit.reason, /no-submit-fn/);

  __setFetch(async () => { throw new Error('boom'); });
  const readErr = await runOnce(cfg(), recorder().submit, {});
  assert.equal(readErr.ok, false);
});

test('makeRunner keeps a persistent seen-set + cursor across ticks', async () => {
  installFakeChain();
  const { submit, ops } = recorder();
  const runner = makeRunner(submit, cfg());
  await runner.tick();
  await runner.tick();
  assert.equal(ops.length, 1);
  assert.ok(runner.seen.has('ref-final-deep'));
});

test('restore the global fetch after the suite', () => { __setFetch(); assert.ok(true); });
