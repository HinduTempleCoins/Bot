// streamer.test.mjs — the L1 follower. Offline: `fetch` is stubbed, no node is ever contacted.
//
// The batching path is the reason this file exists. Catch-up folds hundreds of thousands of blocks
// into deterministic state, so the things that MUST hold are: every block folded exactly once, in
// order, and a hole in the chain halts rather than being skipped.

import test from 'node:test';
import assert from 'node:assert/strict';

// The retry knobs are read once at module load, so they are set BEFORE the dynamic import below.
// Without this the batch-refused fallback test spends 12s in exponential backoff it does not need.
process.env.MELEK_ENGINE_RPC_RETRIES = '0';
process.env.MELEK_ENGINE_STREAM_DELAY_MS = '0';
const { extractOps, extractSocialOps, getBlocks, streamRange } = await import('../lib/streamer.mjs');
const { config } = await import('../config.mjs');

const realFetch = globalThis.fetch;

/** A block whose id encodes its number, so ordering assertions are readable. */
const blockAt = (n) => ({ block_id: `id-${n}`, transactions: [], transaction_ids: [] });

/**
 * Stub fetch with a chain that has blocks 1..head. `opts.shuffle` returns batch rows out of order
 * (a batch response is not required to preserve request order); `opts.failBatch` refuses arrays.
 */
function stubChain(head, opts = {}) {
  const calls = { batches: 0, singles: 0 };
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    if (Array.isArray(body)) {
      if (opts.failBatch) throw new Error('batch refused');
      calls.batches++;
      const rows = body.map((c) => {
        const n = c.params[0];
        return { jsonrpc: '2.0', id: c.id, result: n <= head ? blockAt(n) : null };
      });
      if (opts.shuffle) rows.reverse();
      return { ok: true, json: async () => rows };
    }
    calls.singles++;
    const n = body.params[0];
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: n <= head ? blockAt(n) : null }) };
  };
  return calls;
}

/** Minimal engine that records the order it was asked to fold. */
function recorder() {
  const seen = [];
  return { seen, process() {}, commitBlock(n, id) { seen.push([n, id]); return `h${n}`; } };
}

test.afterEach(() => { globalThis.fetch = realFetch; });

test('getBlocks returns one entry per requested block, aligned to the numbers asked for', async () => {
  stubChain(1000);
  const blocks = await getBlocks(500, 5);
  assert.equal(blocks.length, 5);
  blocks.forEach((b, i) => assert.equal(b.block_id, `id-${500 + i}`));
});

test('a batch response that comes back out of order is realigned by id, not by position', async () => {
  stubChain(1000, { shuffle: true });
  const blocks = await getBlocks(700, 4);
  assert.deepEqual(blocks.map((b) => b.block_id), ['id-700', 'id-701', 'id-702', 'id-703']);
});

test('blocks past the head come back null rather than throwing', async () => {
  stubChain(102);
  const blocks = await getBlocks(100, 5);
  assert.deepEqual(blocks.map((b) => (b ? b.block_id : null)), ['id-100', 'id-101', 'id-102', null, null]);
});

test('streamRange folds every block exactly once, in order', async () => {
  stubChain(1000);
  const eng = recorder();
  const n = await streamRange(eng, 1, 250, { batchSize: 100 });
  assert.equal(n, 250);
  assert.equal(eng.seen.length, 250);
  assert.deepEqual(eng.seen.map((s) => s[0]), Array.from({ length: 250 }, (_, i) => i + 1));
});

test('batching is actually used — 250 blocks is 3 round trips, not 250', async () => {
  const calls = stubChain(1000);
  await streamRange(recorder(), 1, 250, { batchSize: 100 });
  assert.equal(calls.batches, 3);
  assert.equal(calls.singles, 0);
});

test('a missing block halts the fold there and does not skip past the hole', async () => {
  stubChain(120); // chain only has 1..120
  const eng = recorder();
  const n = await streamRange(eng, 100, 200, { batchSize: 50 });
  assert.equal(n, 21, 'folded 100..120 and stopped');
  assert.equal(eng.seen.at(-1)[0], 120);
});

test('a node that refuses batches still makes progress, one block at a time', async () => {
  const calls = stubChain(1000, { failBatch: true });
  const eng = recorder();
  const n = await streamRange(eng, 1, 5, { batchSize: 100 });
  assert.equal(n, 5);
  assert.equal(calls.singles, 5);
  assert.deepEqual(eng.seen.map((s) => s[0]), [1, 2, 3, 4, 5]);
});

test('extractOps takes only this sidechain, and derives the signer from the auth arrays', () => {
  const block = {
    block_id: 'b1',
    transaction_ids: ['tx1'],
    transactions: [{
      operations: [
        ['custom_json', { id: config.sidechainId, required_auths: ['alice'], required_posting_auths: [], json: '{"a":1}' }],
        ['custom_json', { id: 'some-other-chain', required_auths: ['mallory'], json: '{"a":2}' }],
        ['custom_json', { id: config.sidechainId, required_auths: [], required_posting_auths: ['bob'], json: '{"a":3}' }],
        ['custom_json', { id: config.sidechainId, required_auths: [], required_posting_auths: [], json: '{"a":4}' }],
      ],
    }],
  };
  const ops = extractOps(block, 7);
  assert.equal(ops.length, 2, 'other sidechains and unsigned ops are ignored');
  assert.deepEqual(ops.map((o) => [o.sender, o.authLevel]), [['alice', 'active'], ['bob', 'posting']]);
  assert.equal(ops[0].blockNum, 7);
});

test('extractSocialOps reads comments and votes, with the category as the first tag', () => {
  const block = {
    block_id: 'b2',
    transaction_ids: ['tx1'],
    transactions: [{
      operations: [
        ['comment', { author: 'a', permlink: 'p', parent_permlink: 'melek', json_metadata: '{"tags":["prana"]}' }],
        ['vote', { voter: 'v', author: 'a', permlink: 'p' }],
        ['transfer', { from: 'a', to: 'b' }],
      ],
    }],
  };
  const out = extractSocialOps(block, 9);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].tags, ['melek', 'prana']);
  assert.equal(out[1].kind, 'vote');
});
