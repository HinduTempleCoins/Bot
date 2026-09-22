// wmelek-relayer-runner.test.mjs — offline. No network: the MELEK read goes through a fake fetch
// (__setFetch) that serves condenser_api.get_block (the RELIABLE deposit-detection path — the
// account_history plugin is empty on this fork), and the broadcast goes through a fake recorder.
//
// Asserts the loop detects deposits by BLOCK-SCANNING, only broadcasts FINALIZED, well-formed,
// not-yet-seen deposits, is idempotent across ticks AND across restarts (persistent cursor +
// processed-set), and soft-fails on bad input / read errors / broadcast errors — never throwing.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runOnce, makeRunner, normalizeHistory, normalizeBlocks, fetchByBlocks, fetchDeposits,
  loadConfig, MemoryCursorStore, FileCursorStore, __setFetch,
} from './wmelek-relayer-runner.mjs';

const CUSTODY = 'wmelek-bridge';

// ---- fake MELEK L1 (block-scan path) ---------------------------------------
// A transfer deposit as it would appear inside a block's operations.
const dep = (id, o = {}) => ({
  id,
  op: ['transfer', {
    from: o.from || 'alice', to: o.to || CUSTODY,
    amount: o.amount || '1.234 MELEK', memo: o.memo == null ? 'bob' : o.memo,
  }],
});

// blocks: { [blockNum]: [ {id, op}, ... ] }. Serves get_dynamic_global_properties, an EMPTY
// account_history (the whole reason we block-scan), and get_block per number.
function installChain({ blocks = {}, head = 100, irreversible = head, history = [] } = {}) {
  __setFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    let result = null;
    if (body.method === 'condenser_api.get_dynamic_global_properties') {
      result = { head_block_number: head, last_irreversible_block_num: irreversible };
    } else if (body.method === 'condenser_api.get_account_history') {
      result = history; // [] on MELEK mainnet — the plugin is not populated
    } else if (body.method === 'condenser_api.get_block') {
      const n = body.params[0];
      const items = blocks[n] || [];
      result = {
        transactions: items.map((it) => ({ operations: [it.op] })),
        transaction_ids: items.map((it) => it.id),
        block_id: `blk-${n}`,
      };
    }
    return { json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
  });
}

// small scan window so a tick reads a handful of blocks, not thousands
const cfg = (over = {}) => ({
  ...loadConfig({
    MELEK_RPC_URL: 'http://melek.local/rpc',
    WMELEK_BRIDGE_CUSTODY: CUSTODY,
    CONFIRMATIONS: '20',
    WMELEK_SCAN_WINDOW: '200',
  }),
  ...over,
});

function recorder() {
  const ops = [];
  const submit = async (op, d) => { ops.push({ op, dep: d }); return { ok: true, id: `mock-${ops.length}` }; };
  return { submit, ops };
}

// ---- config ----------------------------------------------------------------

test('loadConfig defaults custody, cursor store, scan window; pulls bridge/sidechain from engine', () => {
  const c = cfg();
  assert.equal(c.custody, CUSTODY);
  assert.ok(c.bridgeAccount, 'bridge account resolved from engine config');
  assert.ok(c.sidechainId, 'sidechain id resolved from engine config');
  assert.equal(c.confirmations, 20);
  assert.equal(c.scanWindow, 200);
  assert.ok(c.stateFile, 'a default state-file path is set');
  assert.equal(loadConfig({ MELEK_RPC_URL: 'x' }).custody, CUSTODY);
});

// ---- normalizers -----------------------------------------------------------

test('normalizeBlocks extracts only transfers addressed to custody', () => {
  const blocks = {
    10: [
      dep('tx-good', { memo: 'bob' }),
      dep('tx-other', { to: 'someoneelse' }),                 // wrong recipient account
      { id: 'tx-cj', op: ['custom_json', { id: 'x', json: '{}' }] }, // not a transfer
      { id: 'tx-vote', op: ['vote', { voter: 'v', author: 'a', permlink: 'p' }] },
    ],
  };
  const rawBlock = {
    block_num: 10,
    transactions: blocks[10].map((it) => ({ operations: [it.op] })),
    transaction_ids: blocks[10].map((it) => it.id),
  };
  const n = normalizeBlocks([rawBlock], CUSTODY);
  assert.equal(n.length, 1);
  assert.equal(n[0].trxId, 'tx-good');
  assert.equal(n[0].blockNum, 10);
  assert.equal(n[0].op.type, 'transfer');
  assert.equal(n[0].op.to, CUSTODY);
  assert.equal(n[0].op.memo, 'bob');
});

test('normalizeBlocks soft-handles junk and the {type,value} op shape', () => {
  assert.deepEqual(normalizeBlocks(null, CUSTODY), []);
  const objShape = {
    block_num: 5,
    transactions: [{ operations: [{ type: 'transfer_operation', value: { from: 'a', to: CUSTODY, amount: '2.000 MELEK', memo: '' } }] }],
    transaction_ids: ['tx-obj'],
  };
  const n = normalizeBlocks([objShape], CUSTODY);
  assert.equal(n.length, 1);
  assert.equal(n[0].op.type, 'transfer');
  assert.equal(n[0].op.from, 'a');
});

test('normalizeHistory still flattens account_history rows (opportunistic path)', () => {
  const rows = [[1, { trx_id: 't', block: 10, op: ['transfer', { from: 'a', to: CUSTODY, amount: '1.000 MELEK', memo: 'b' }] }]];
  const n = normalizeHistory(rows);
  assert.equal(n.length, 1);
  assert.equal(n[0].op.to, CUSTODY);
});

// ---- fetch layer -----------------------------------------------------------

test('fetchByBlocks returns deposits + head + scannedTo, soft-fails without rpc', async () => {
  installChain({ blocks: { 10: [dep('tx-a')] }, head: 100 });
  const r = await fetchByBlocks(cfg(), { fromBlock: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.headBlock, 100);
  assert.equal(r.scannedTo, 100);
  assert.equal(r.history.length, 1);
  assert.equal(r.history[0].trxId, 'tx-a');

  const bad = await fetchByBlocks(loadConfig({ WMELEK_BRIDGE_CUSTODY: CUSTODY }), {});
  assert.equal(bad.ok, false);
  assert.match(bad.reason, /no-melek-rpc/);
});

test('fetchDeposits falls through to block_scan when account_history is empty', async () => {
  installChain({ blocks: { 10: [dep('tx-a')] }, head: 100, history: [] });
  const r = await fetchDeposits(cfg(), { fromBlock: 0 });
  assert.equal(r.ok, true);
  assert.equal(r.via, 'block_scan');
  assert.equal(r.history.length, 1);
});

// ---- the loop: deposit detection + mint ------------------------------------

test('runOnce block-scans and broadcasts ONLY the finalized, well-formed deposit', async () => {
  // block 10 is final (head 100, threshold 20); block 99 is fresh (pending, not final)
  installChain({ blocks: { 10: [dep('ref-final-deep', { memo: 'bob', amount: '1.234 MELEK' })], 99: [dep('ref-fresh', { memo: 'dave' })] }, head: 100 });
  const { submit, ops } = recorder();
  const r = await runOnce(cfg(), submit, {});
  assert.equal(r.ok, true);
  assert.equal(r.via, 'block_scan');
  assert.equal(r.submitted.length, 1);
  assert.equal(r.submitted[0].ref, 'ref-final-deep');
  assert.equal(r.submitted[0].recipient, 'bob');
  assert.equal(r.submitted[0].amount, '1.234');
  assert.ok(r.pending.some((p) => p.ref === 'ref-fresh'), 'the fresh deposit is pending, not minted');
  assert.equal(ops.length, 1);
  // the broadcast op is exactly the bridge.mintWrapped custom_json, amount 1:1
  const env = JSON.parse(ops[0].op[1].json);
  assert.equal(env.contractName, 'bridge');
  assert.equal(env.contractAction, 'mintWrapped');
  assert.deepEqual(env.contractPayload, { to: 'bob', amount: '1.234', depositRef: 'ref-final-deep' });
});

test('blank memo credits the depositor (recipient = from)', async () => {
  installChain({ blocks: { 10: [dep('ref-blank', { from: 'erin', memo: '', amount: '2.000 MELEK' })] }, head: 100 });
  const { submit, ops } = recorder();
  const r = await runOnce(cfg(), submit, {});
  assert.equal(r.submitted.length, 1);
  assert.equal(JSON.parse(ops[0].op[1].json).contractPayload.to, 'erin');
});

test('a non-deposit block (no transfer to custody) is IGNORED — nothing minted', async () => {
  installChain({
    blocks: {
      10: [
        dep('tx-elsewhere', { to: 'someoneelse' }),
        { id: 'tx-cj', op: ['custom_json', { id: 'x', json: '{"a":1}' }] },
        { id: 'tx-vote', op: ['vote', { voter: 'v', author: 'a', permlink: 'p' }] },
      ],
    },
    head: 100,
  });
  const { submit, ops } = recorder();
  const r = await runOnce(cfg(), submit, {});
  assert.equal(r.ok, true);
  assert.equal(r.submitted.length, 0);
  assert.equal(ops.length, 0);
});

// ---- idempotency + resumability --------------------------------------------

test('runOnce is IDEMPOTENT across ticks (same ref never re-broadcast)', async () => {
  installChain({ blocks: { 10: [dep('ref-final-deep')] }, head: 100 });
  const { submit, ops } = recorder();
  const ctx = {};
  await runOnce(cfg(), submit, ctx);
  const r2 = await runOnce(cfg(), submit, ctx);
  assert.equal(ops.length, 1, 'only one broadcast after a second tick');
  // second tick resumes above the cursor -> the deposit block is not even re-scanned
  assert.equal(r2.submitted.length, 0);
});

test('runOnce advances the resumable cursor, held below any pending deposit', async () => {
  installChain({ blocks: { 10: [dep('ref-deep')], 99: [dep('ref-fresh', { memo: 'dave' })] }, head: 100 });
  const { submit } = recorder();
  const ctx = {};
  const r = await runOnce(cfg(), submit, ctx);
  // fresh deposit at 99 is pending -> cursor held at 98 so block 99 is re-scanned next tick
  assert.equal(r.pending.length, 1);
  assert.equal(ctx.lastBlock, 98);
  // once head advances so block 99 is final, it mints and the cursor moves on
  installChain({ blocks: { 10: [dep('ref-deep')], 99: [dep('ref-fresh', { memo: 'dave' })] }, head: 200 });
  const r2 = await runOnce(cfg(), submit, ctx);
  assert.equal(r2.pending.length, 0);
  assert.equal(r2.submitted.length, 1);
  assert.equal(r2.submitted[0].ref, 'ref-fresh');
  assert.equal(ctx.lastBlock, 200);
});

// ---- persistence across RESTARTS (no double-mint) --------------------------

test('RESTART via a shared store: cursor + processed-set persist, deposit not re-minted', async () => {
  installChain({ blocks: { 10: [dep('ref-once')] }, head: 100 });
  const store = new MemoryCursorStore();
  const { submit, ops } = recorder();

  const r1 = makeRunner(submit, cfg(), { store });
  await r1.tick();
  assert.equal(ops.length, 1, 'first run mints once');
  assert.ok(r1.seen.has('ref-once'));

  // simulate a process restart: a BRAND NEW runner loads state from the same store
  const r2 = makeRunner(submit, cfg(), { store });
  assert.ok(r2.seen.has('ref-once'), 'processed-set reloaded from the store');
  assert.ok(r2.lastBlock >= 100, 'cursor reloaded from the store');
  await r2.tick();
  assert.equal(ops.length, 1, 'restart does NOT re-mint');
});

test('processed-set dedups even when the block is RE-SCANNED (cursor rolled back / reorg)', async () => {
  installChain({ blocks: { 10: [dep('ref-once')] }, head: 100 });
  const store = new MemoryCursorStore();
  // pretend the ref was already minted but the cursor is at 0 -> block 10 gets re-scanned
  store.write({ cursor: 0, seen: ['ref-once'] });
  const { submit, ops } = recorder();
  const runner = makeRunner(submit, cfg(), { store });
  const r = await runner.tick();
  assert.equal(ops.length, 0, 'already-broadcast ref is not minted again on re-scan');
  assert.ok(r.skipped.some((s) => s.ref === 'ref-once' && /already-broadcast/.test(s.reason)));
});

test('FileCursorStore round-trips cursor+seen and treats corrupt state as a clean start', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wmelek-relayer-'));
  const path = join(dir, 'state.json');
  try {
    const s = new FileCursorStore(path);
    assert.deepEqual(s.read(), { cursor: 0, seen: [] }, 'no file yet = clean start');
    s.write({ cursor: 42, seen: ['a', 'b'] });
    assert.deepEqual(new FileCursorStore(path).read(), { cursor: 42, seen: ['a', 'b'] });
    const persisted = JSON.parse(readFileSync(path, 'utf8'));
    assert.equal(persisted.cursor, 42);
    // corrupt content -> read() returns null (runner then starts clean; on-chain idempotency backstops)
    writeFileSync(path, '{ not json');
    assert.equal(new FileCursorStore(path).read(), null);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('makeRunner persists to a FileCursorStore between ticks (survives a real restart)', async () => {
  installChain({ blocks: { 10: [dep('ref-file')] }, head: 100 });
  const dir = mkdtempSync(join(tmpdir(), 'wmelek-relayer-'));
  const path = join(dir, 'state.json');
  try {
    const { submit, ops } = recorder();
    const runner = makeRunner(submit, { ...cfg(), stateFile: path });
    await runner.tick();
    assert.equal(ops.length, 1);
    const onDisk = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(onDisk.seen.includes('ref-file'), 'processed ref written to disk');
    assert.ok(onDisk.cursor >= 100, 'cursor written to disk');
    // new runner from the same file: no re-mint
    const runner2 = makeRunner(submit, { ...cfg(), stateFile: path });
    await runner2.tick();
    assert.equal(ops.length, 1, 'file-backed restart does NOT re-mint');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

// ---- soft-fail (never throw) -----------------------------------------------

test('a broadcast failure leaves the ref UNSEEN and holds the cursor so the next pass retries', async () => {
  installChain({ blocks: { 10: [dep('ref-retry')] }, head: 100 });
  let calls = 0;
  const submit = async () => { calls += 1; if (calls === 1) throw new Error('signer unreachable'); return { ok: true }; };
  const ctx = {};
  const r1 = await runOnce(cfg(), submit, ctx);
  assert.equal(r1.failed.length, 1);
  assert.equal(r1.submitted.length, 0);
  assert.ok(ctx.lastBlock < 10, 'cursor held below the failed deposit so it is re-scanned');
  const r2 = await runOnce(cfg(), submit, ctx);
  assert.equal(r2.submitted.length, 1, 'retried and succeeded on the next pass');
});

test('runOnce soft-fails without a submit fn and on an RPC error (never throws)', async () => {
  installChain({ blocks: { 10: [dep('ref-a')] }, head: 100 });
  const noSubmit = await runOnce(cfg(), null, {});
  assert.equal(noSubmit.ok, false);
  assert.match(noSubmit.reason, /no-submit-fn/);

  __setFetch(async () => { throw new Error('boom'); });
  const readErr = await runOnce(cfg(), recorder().submit, {});
  assert.equal(readErr.ok, false); // soft-fail: returned a shape, did not throw
});

test('restore the global fetch after the suite', () => { __setFetch(); assert.ok(true); });
