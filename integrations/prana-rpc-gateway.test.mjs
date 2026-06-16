// prana-rpc-gateway.test.mjs — offline tests for the method-whitelisted PRANA RPC gateway.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, handleRpc, isAllowedMethod, __setFetch } from './prana-rpc-gateway.mjs';

function mockRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h; },
    end(b) { this.body = b || ''; },
  };
}
// a fake POST request whose async-iteration yields the JSON body
function mockReq(method, payload) {
  const raw = payload == null ? '' : JSON.stringify(payload);
  return { method, async *[Symbol.asyncIterator]() { yield Buffer.from(raw); } };
}

test('isAllowedMethod: eth/net/web3 allowed, admin namespaces blocked', () => {
  for (const m of ['eth_call', 'eth_sendRawTransaction', 'eth_chainId', 'net_version', 'web3_clientVersion']) {
    assert.equal(isAllowedMethod(m), true, m);
  }
  for (const m of ['personal_unlockAccount', 'miner_start', 'debug_traceTransaction', 'txpool_content', 'admin_peers', '', null, 'eth']) {
    assert.equal(isAllowedMethod(m), false, String(m));
  }
});

test('handleRpc: forwards an allowed single call to the node', async () => {
  let sawBody = null;
  __setFetch(async (url, opts) => { sawBody = JSON.parse(opts.body); return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: '0x1a751' }) }; });
  const out = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] });
  __setFetch();
  assert.equal(out.result, '0x1a751');
  assert.equal(sawBody.method, 'eth_chainId'); // single object forwarded, not wrapped in an array
});

test('handleRpc: rejects a blocked method WITHOUT hitting the node', async () => {
  let called = false;
  __setFetch(async () => { called = true; return { ok: true, json: async () => ({}) }; });
  const out = await handleRpc({ jsonrpc: '2.0', id: 7, method: 'personal_unlockAccount', params: ['0xabc', 'pw'] });
  __setFetch();
  assert.equal(called, false);
  assert.equal(out.id, 7);
  assert.match(out.error.message, /not allowed/);
  assert.equal(out.error.code, -32601);
});

test('handleRpc: batch keeps order, mixes node results + synthesized errors', async () => {
  __setFetch(async (url, opts) => {
    const fwd = JSON.parse(opts.body); // only the allowed sub-batch reaches us
    assert.ok(Array.isArray(fwd));
    assert.equal(fwd.length, 2); // eth_chainId + net_version, NOT the blocked one
    return { ok: true, json: async () => fwd.map((c) => ({ jsonrpc: '2.0', id: c.id, result: `ok:${c.method}` })) };
  });
  const out = await handleRpc([
    { jsonrpc: '2.0', id: 1, method: 'eth_chainId' },
    { jsonrpc: '2.0', id: 2, method: 'debug_traceTransaction' }, // blocked
    { jsonrpc: '2.0', id: 3, method: 'net_version' },
  ]);
  __setFetch();
  assert.equal(out.length, 3);
  assert.equal(out[0].result, 'ok:eth_chainId');
  assert.match(out[1].error.message, /not allowed/); // position preserved
  assert.equal(out[2].result, 'ok:net_version');
});

test('handleRpc: node unreachable -> JSON-RPC error, never throws', async () => {
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  const out = await handleRpc({ jsonrpc: '2.0', id: 9, method: 'eth_blockNumber' });
  __setFetch();
  assert.equal(out.error.code, -32603);
  assert.match(out.error.message, /unreachable/);
});

test('handler: OPTIONS preflight returns 204 with CORS', async () => {
  const res = mockRes();
  await handler({ method: 'OPTIONS' }, res);
  assert.equal(res.code, 204);
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('handler: GET is rejected (POST only)', async () => {
  const res = mockRes();
  await handler({ method: 'GET' }, res);
  assert.equal(res.code, 405);
});

test('handler: full POST path forwards an allowed call + sets CORS', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 5, result: '0x10' }) }));
  const res = mockRes();
  await handler(mockReq('POST', { jsonrpc: '2.0', id: 5, method: 'eth_blockNumber' }), res);
  __setFetch();
  assert.equal(res.code, 200);
  assert.equal(res.headers['access-control-allow-origin'], '*');
  assert.equal(JSON.parse(res.body).result, '0x10');
});

test('handler: malformed JSON -> parse error, no throw', async () => {
  const res = mockRes();
  await handler({ method: 'POST', async *[Symbol.asyncIterator]() { yield Buffer.from('{not json'); } }, res);
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.body).error.code, -32700);
});
