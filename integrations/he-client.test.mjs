// he-client.test.mjs — offline coverage for the resilient HIVE-Engine read client. Exercises the
// multi-node FAILOVER (first node throws → next succeeds), the JSON-RPC error → throw mapping, and
// the historyPage URL/parse path — all via the injectable fetch seam. No network is touched.
//
// NOTE: HE_RPC_NODES / HE_HISTORY_NODES / HE_CACHE_TTL_MS are read at import time, so this file sets
// them on process.env BEFORE the dynamic import below. The disk cache is left off (TTL 0).

import { test } from 'node:test';
import assert from 'node:assert/strict';

process.env.HE_RPC_NODES = 'https://node-a.test/contracts,https://node-b.test/contracts';
process.env.HE_HISTORY_NODES = 'https://hist-a.test/accountHistory,https://hist-b.test/accountHistory';
process.env.HE_CACHE_TTL_MS = '0';

const { find, findOne, historyPage, withFailover, NODES, __setFetch } = await import('./he-client.mjs');

function jsonResponse(body, { ok = true, status = 200 } = {}) {
  return { ok, status, async json() { return body; } };
}

test('NODES reflects the env-configured node lists', () => {
  assert.deepEqual(NODES.RPC_NODES, ['https://node-a.test/contracts', 'https://node-b.test/contracts']);
  assert.equal(NODES.HISTORY_NODES.length, 2);
});

test('find: first node throws (network) → second node succeeds (failover)', async () => {
  const calls = [];
  __setFetch(async (url, opts) => {
    calls.push(url);
    if (url.includes('node-a')) throw new Error('ECONNRESET');
    return jsonResponse({ jsonrpc: '2.0', id: 1, result: [{ symbol: 'VKBT', supply: '1000' }] });
  });
  try {
    const rows = await find('tokens', 'tokens', { symbol: 'VKBT' }, 1);
    assert.deepEqual(calls, ['https://node-a.test/contracts', 'https://node-b.test/contracts']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].symbol, 'VKBT');
  } finally { __setFetch(null); }
});

test('find: first node HTTP 500 → second node succeeds (failover on non-ok)', async () => {
  __setFetch(async (url) => {
    if (url.includes('node-a')) return jsonResponse({}, { ok: false, status: 500 });
    return jsonResponse({ result: [{ symbol: 'CURE' }] });
  });
  try {
    const rows = await find('tokens', 'tokens', { symbol: 'CURE' }, 1);
    assert.equal(rows[0].symbol, 'CURE');
  } finally { __setFetch(null); }
});

test('find: JSON-RPC error body throws (per node) and propagates when ALL nodes fail', async () => {
  __setFetch(async () => jsonResponse({ error: { message: 'bad query' } }));
  try {
    await assert.rejects(() => find('tokens', 'tokens', { symbol: 'X' }, 1), /bad query/);
  } finally { __setFetch(null); }
});

test('find: result defaults to [] when the node returns no result field', async () => {
  __setFetch(async () => jsonResponse({ jsonrpc: '2.0', id: 1 }));
  try {
    const rows = await find('tokens', 'tokens', { symbol: 'EMPTY' }, 1);
    assert.deepEqual(rows, []);
  } finally { __setFetch(null); }
});

test('findOne: returns the first row, or null when empty', async () => {
  __setFetch(async () => jsonResponse({ result: [{ a: 1 }, { a: 2 }] }));
  try { assert.deepEqual(await findOne('c', 't', {}), { a: 1 }); } finally { __setFetch(null); }
  __setFetch(async () => jsonResponse({ result: [] }));
  try { assert.equal(await findOne('c', 't', {}), null); } finally { __setFetch(null); }
});

test('historyPage: builds the query URL + parses JSON, with failover', async () => {
  let used;
  __setFetch(async (url) => {
    if (url.includes('hist-a')) throw new Error('timeout');
    used = url;
    return jsonResponse([{ symbol: 'SWAP.HIVE', timestamp: 1 }]);
  });
  try {
    const rows = await historyPage('kalivankush', { limit: 2, offset: 0 });
    assert.ok(used.startsWith('https://hist-b.test/accountHistory?'));
    assert.ok(used.includes('account=kalivankush'));
    assert.ok(used.includes('limit=2'));
    assert.equal(rows.length, 1);
  } finally { __setFetch(null); }
});

test('withFailover: returns first success; throws last error if all fail', async () => {
  const r = await withFailover(['a', 'b'], async (n) => { if (n === 'a') throw new Error('no'); return n; });
  assert.equal(r, 'b');
  await assert.rejects(() => withFailover(['a', 'b'], async () => { throw new Error('all dead'); }), /all dead/);
});
