// site/status/server.test.mjs — offline. All probes go through a fake fetch (__setFetch). Asserts each
// probe kind judges UP/DOWN correctly, soft-fails to DOWN (never throws), and the handler renders the board.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, CHECKS, runAll, handler, __setFetch } from './server.mjs';

// A fake fetch that answers every probe kind as healthy.
function allHealthy() {
  __setFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      let result;
      if (body.method === 'eth_chainId') result = '0x1a751';
      else if (body.method === 'eth_call') result = '0x' + '0'.repeat(24) + '4C4a2f8c81640e47606d3fd77B353E87Ba015584'.toLowerCase();
      else if (body.method === 'condenser_api.get_dynamic_global_properties') result = { head_block_number: 12345 };
      else result = '0x1';
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
    }
    // GET: text bodies for contains-probes
    const text = url.includes('soapbox.community/') ? 'SoapBox Community home'
      : url.includes('staking') ? '{"ok":true,"totalDelegated":"100"}'
      : url.includes('paymaster') ? '{"boundary":"... SIGNS nothing ..."}'
      : url.includes('kula.money') ? 'KulaSwap — multi-chain swap'
      : 'hello';
    return { ok: true, status: 200, text: async () => text };
  });
}

test('esc neutralizes html', () => { assert.equal(esc('<b>'), '&lt;b&gt;'); });

test('runAll: all green when every probe is healthy', async () => {
  allHealthy();
  const { results, summary } = await runAll();
  assert.equal(results.length, CHECKS.length);
  assert.equal(summary.allUp, true);
  assert.equal(summary.up, summary.total);
  // bridge probe judged from a nonzero address
  const bridge = results.find((r) => r.name.startsWith('Bridge'));
  assert.equal(bridge.ok, true);
  __setFetch();
});

test('a 500 / wrong chainId / zero-address each go DOWN, never throw', async () => {
  __setFetch(async (url, opts) => {
    if (opts && opts.method === 'POST') {
      const body = JSON.parse(opts.body);
      let result;
      if (body.method === 'eth_chainId') result = '0xdead';                 // wrong chain
      else if (body.method === 'eth_call') result = '0x' + '0'.repeat(64);  // zero address (unregistered)
      else if (body.method === 'condenser_api.get_dynamic_global_properties') result = {}; // missing prop
      else result = null;
      return { ok: true, json: async () => ({ jsonrpc: '2.0', id: body.id, result }) };
    }
    return { ok: false, status: 503, text: async () => 'down' };            // every HTTP down
  });
  const { results, summary } = await runAll();
  assert.equal(summary.up, 0);
  assert.ok(results.every((r) => r.ok === false));
  assert.equal(results.find((r) => r.name === 'PRANA RPC').detail, '0xdead');
  assert.match(results.find((r) => r.name.startsWith('Bridge')).detail, /zero/);
  __setFetch();
});

test('contains-probe fails when the needle is absent', async () => {
  __setFetch(async () => ({ ok: true, status: 200, text: async () => 'unrelated body' }));
  const { results } = await runAll();
  const home = results.find((r) => r.name === 'Ecosystem home');
  assert.equal(home.ok, false);
  assert.match(home.detail, /missing/);
  __setFetch();
});

test('a thrown fetch soft-fails the probe to DOWN', async () => {
  __setFetch(async () => { throw new Error('network boom'); });
  const { results, summary } = await runAll();
  assert.equal(summary.up, 0);
  assert.ok(results.every((r) => r.ok === false));
  __setFetch();
});

function mockRes() { return { code: 0, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } }; }

test('GET / renders the board with UP/DOWN dots', async () => {
  allHealthy();
  const res = mockRes();
  await handler({ method: 'GET', url: '/' }, res);
  assert.equal(res.code, 200);
  assert.match(res.body, /MELEK ecosystem status/);
  assert.match(res.body, /All systems operational/);
  __setFetch();
});

test('GET /api/status returns 200 all-up / 503 when degraded', async () => {
  allHealthy();
  let res = mockRes();
  await handler({ method: 'GET', url: '/api/status' }, res);
  assert.equal(res.code, 200);
  assert.equal(JSON.parse(res.body).summary.allUp, true);
  __setFetch(async () => { throw new Error('down'); });
  res = mockRes();
  await handler({ method: 'GET', url: '/api/status' }, res);
  assert.equal(res.code, 503);
  __setFetch();
});

test('cleanup', () => { __setFetch(); });
