// lesson-watcher.test.mjs — OFFLINE. The block-stream daemon with a fake RPC, fake chain activity and a
// fake signer: dry-run logs the exact ops and writes nothing; broadcast sends then commits; idempotent.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import os from 'node:os';
import { mkdtempSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadRegistry } from './instructional.mjs';
import { createWatcher, createStore, commentOpsIn, mightConcernWitness, makeRpc } from './lesson-watcher.mjs';
import { TutorialState } from './state.js';

const reg = loadRegistry({ dir: path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'instructional') });
const tmp = () => mkdtempSync(path.join(os.tmpdir(), 'lw-'));
const intro = { author: 'alice', permlink: 'hello', title: 'Hello', body: 'x'.repeat(260), tags: ['introduceyourself'], created: new Date().toISOString() };

function chain(blocks, lib) {
  return async (method, params) => {
    if (method === 'condenser_api.get_dynamic_global_properties') return { last_irreversible_block_num: lib };
    if (method === 'condenser_api.get_block') return blocks[params[0]] || { transactions: [] };
    if (method === 'condenser_api.get_content') return { root_author: 'hathor', root_permlink: reg.byId('how-to-post').permlink };
    throw new Error(`unexpected ${method}`);
  };
}
const block = (...ops) => ({ transactions: [{ transaction_id: 'tx1', operations: ops.map((o) => ['comment', o]) }] });
const lessonComment = (o = {}) => ({ author: 'alice', permlink: 'c1', parent_author: 'hathor', parent_permlink: reg.byId('how-to-post').permlink, title: '', body: 'done, check me', json_metadata: '{}', ...o });

function setup({ broadcast = false, broadcastOps = null, blocks, lib = 102 } = {}) {
  const dir = tmp();
  const state = new TutorialState({ path: path.join(dir, 'progress.json') });
  state.recordLesson('alice', 'sign-up', {});
  const logs = [];
  const store = createStore(dir);
  const w = createWatcher({
    rpc: chain(blocks, lib), registry: reg, store, broadcast, broadcastOps,
    handlerDeps: { state, fetchUserActivity: async () => ({ account: 'alice', posts: [intro], meta: { ok: true, errors: [] } }) },
    logJson: (o) => logs.push(o), log: () => {}, sleep: async () => {},
  });
  return { w, logs, state, store, dir };
}

test('commentOpsIn handles both op shapes; mightConcernWitness pre-filters', () => {
  const b = { transactions: [{ operations: [['vote', {}], ['comment', { author: 'a' }]] }, { operations: [{ type: 'comment_operation', value: { author: 'b' } }] }], transaction_ids: ['t0', 't1'] };
  const ops = commentOpsIn(b);
  assert.deepEqual(ops.map((o) => [o.op.author, o.trxId]), [['a', 't0'], ['b', 't1']]);
  assert.equal(mightConcernWitness({ parent_author: 'hathor', body: '' }), true);
  assert.equal(mightConcernWitness({ parent_author: 'bob', body: 'hey @hathor' }), true);
  assert.equal(mightConcernWitness({ parent_author: 'bob', body: 'hi @hathorian' }), false);
});

test('DRY-RUN: logs the exact ops it would broadcast, broadcasts nothing, records no progress', async () => {
  let sent = 0;
  const { w, logs, state } = setup({ blocks: { 101: block(lessonComment(), { author: 'bob', permlink: 'x', parent_author: 'carol', parent_permlink: 'y', body: 'unrelated' }) }, broadcastOps: async () => { sent++; } });
  const r = await w.catchUp({ from: 101 });
  assert.equal(r.processed, 2);
  assert.equal(sent, 0);
  assert.equal(logs.length, 1);
  assert.equal(logs[0].mode, 'dry-run');
  assert.equal(logs[0].would_broadcast, true);
  assert.equal(logs[0].kind, 'pass');
  assert.deepEqual(logs[0].ops.map((o) => o[0]), ['vote', 'comment']);
  assert.equal(logs[0].ops[0][1].permlink, 'hello');
  assert.equal(state.hasLesson('alice', 'how-to-post'), false);
});

test('idempotent: an EDIT of the same comment (same author/permlink) is not handled twice; cursor persists', async () => {
  const { w, logs, dir } = setup({ blocks: { 101: block(lessonComment()), 102: block(lessonComment({ body: 'done, check me (edited)' })) } });
  await w.catchUp({ from: 101 });
  assert.equal(logs.length, 1);
  const again = createStore(dir);
  assert.equal(again.cursor, 102);
  assert.equal(again.has('alice/c1'), true);
});

test('BROADCAST: sends vote+comment through the injected signer, then commits progress with the tx id', async () => {
  const sent = [];
  const { w, logs, state } = setup({ broadcast: true, blocks: { 101: block(lessonComment()) }, broadcastOps: async (ops) => { sent.push(ops); return { id: 'tx-abc' }; } });
  await w.catchUp({ from: 101 });
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].map((o) => o[0]), ['vote', 'comment']);
  assert.equal(logs[0].txId, 'tx-abc');
  assert.equal(state.hasLesson('alice', 'how-to-post'), true);
});

test('BROADCAST failure: not committed, not marked processed, the block is retried', async () => {
  let n = 0;
  const { w, state, store } = setup({ broadcast: true, blocks: { 101: block(lessonComment()) }, broadcastOps: async () => { n++; if (n === 1) throw new Error('signer: scope'); return { id: 't2' }; } });
  await assert.rejects(w.catchUp({ from: 101 }));
  assert.equal(state.hasLesson('alice', 'how-to-post'), false);
  assert.equal(store.has('alice/c1'), false);
  await w.catchUp({ from: 101 });
  assert.equal(state.hasLesson('alice', 'how-to-post'), true);
});

test('starts at the current irreversible block when there is no cursor', async () => {
  const { w } = setup({ blocks: {}, lib: 500 });
  const r = await w.catchUp();
  assert.equal(r.processed, 1);
  assert.equal(r.cursor, 500);
});

test('finality: a stalled LIB is warned about; head mode follows head − lag', async () => {
  const logs = [];
  const rpc = async (m) => (m === 'condenser_api.get_dynamic_global_properties'
    ? { head_block_number: 5000, last_irreversible_block_num: 100 } : { transactions: [] });
  const irr = createWatcher({ rpc, registry: reg, store: createStore(null), log: (x) => logs.push(x) });
  assert.equal((await irr.catchUp()).lib, 100);
  assert.match(logs.join('\n'), /finality stalled — head 5000, last irreversible 100/);
  const head = createWatcher({ rpc, registry: reg, store: createStore(null), log: () => {}, finality: 'head', headLag: 30 });
  assert.equal((await head.catchUp()).lib, 4970);
});

test('broadcastEach: one op per tx; a landed vote counts even if the reply fails; a failed vote throws', async () => {
  const { broadcastEach } = await import('./lesson-watcher.mjs');
  const vote = ['vote', {}], comment = ['comment', {}];
  const ok = await broadcastEach([vote, comment], async (ops) => { if (ops[0][0] === 'comment') throw new Error('bandwidth'); return { id: 'v1' }; });
  assert.equal(ok.id, 'v1');
  assert.equal(ok.results[1].ok, false);
  await assert.rejects(broadcastEach([vote, comment], async (ops) => { if (ops[0][0] === 'vote') throw new Error('scope'); return { id: 'c' }; }), /vote failed: scope/);
  await assert.rejects(broadcastEach([comment], async () => { throw new Error('down'); }), /broadcast failed/);
  const sent = [];
  await broadcastEach([vote, comment], async (ops) => { sent.push(ops.length); return { id: 'x' }; });
  assert.deepEqual(sent, [1, 1]);
});

test('makeRpc surfaces RPC errors (the run loop backs off on them)', async () => {
  const rpc = makeRpc({ url: 'http://x', fetch: async () => ({ json: async () => ({ error: { message: 'boom' } }) }) });
  await assert.rejects(rpc('m', []), /boom/);
  const ok = makeRpc({ url: 'http://x', fetch: async () => ({ json: async () => ({ result: 7 }) }) });
  assert.equal(await ok('m'), 7);
});

test('run(): backs off on RPC trouble and stops cleanly', async () => {
  const sleeps = [];
  let calls = 0;
  const w = createWatcher({
    rpc: async () => { calls++; throw new Error('down'); }, registry: reg, store: createStore(null),
    log: () => {}, sleep: async (ms) => { sleeps.push(ms); if (sleeps.length >= 3) w.stop(); },
  });
  await w.run();
  assert.deepEqual(sleeps, [1000, 2000, 4000]);
  assert.equal(calls, 3);
});
