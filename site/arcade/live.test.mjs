// live.test.mjs — offline tests for the KULA Arcade live on-chain reader. Fully offline: fetch is injected
// via __setFetch and returns canned eth_call results (real testnet return-data shapes). No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';

// The reader gates eth_call on RPC + addresses being configured; set them before importing so the module
// captures non-empty values (env is read once at load). Values are dummies — fetch is fully mocked.
process.env.ARCADE_RPC_URL = 'http://test.local/rpc';
process.env.ARCADE_LOTTO_ADDR = '0x0000000000000000000000000000000000000001';
process.env.ARCADE_MARKET_ADDR = '0x0000000000000000000000000000000000000002';
const { __setFetch, readLotto, readMarkets, readAll, handler } = await import('./live.mjs');

const W = (hex) => hex.replace(/^0x/, '').padStart(64, '0');
const RESULT = (words) => '0x' + words.map(W).join('');

// A real getMarket(...) return: full 15-field Market struct = a dynamic tuple with a leading 0x20 offset.
// Fields (after the offset): [0]question-off [1]sourceRef [2]closeTime [3]disputeWindow [4]feeBps
// [5]disputeBond [6]yesPool [7]noPool [8]phase [9]proposed [10]outcome [11]proposedAt [12]disputer …
function marketReturn({ closeTime, disputeWindow, feeBps, yesPool, noPool, phase, outcome, question = 'Q?' }) {
  const head = [
    '1e0',                                   // question offset (points past the 15 head words)
    'a'.repeat(64).slice(0, 64),             // sourceRef (any 32 bytes)
    closeTime.toString(16), disputeWindow.toString(16), feeBps.toString(16), '0',
    yesPool.toString(16), noPool.toString(16), phase.toString(16), '0', outcome.toString(16),
    '0', '0', '0', '0',                      // proposedAt, disputer, distributable, winningPool
  ];
  const qhex = Buffer.from(question, 'utf8').toString('hex');
  const tail = [question.length.toString(16), qhex.padEnd(64, '0')];
  return '0x' + '20'.padStart(64, '0') + head.map(W).join('') + tail.map((x, i) => (i === 0 ? W(x) : x)).join('');
}

// route by selector in the request body
function mockFetch(routes) {
  return async (_url, opts) => {
    const body = JSON.parse(opts.body);
    const data = body.params[0].data;
    const sel = data.slice(0, 10);
    const arg = data.slice(10); // uint256 id (if any)
    const key = routes[sel + arg] ?? routes[sel];
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: key }) };
  };
}

test('readLotto decodes count + latest round (closed+drawn)', async () => {
  __setFetch(mockFetch({
    '0x127f0b3f': RESULT(['1']), // roundCount = 1
    // rounds(0): ticketPrice100, prize8000, treas1000, burn1000, tickets3, pool300, closed1, drawn1, commit485739, salt, winner
    ['0x8c65c81f' + W('0')]: RESULT(['64', '1f40', '3e8', '3e8', '3', '12c', '1', '1', '7676b',
      '96165160898b0db42f96b471972561aead3977afe32905da88e927bd2320b9d0',
      'f39fd6e51aad88f6f4ce6ab8827279cfffb92266']),
  }));
  const l = await readLotto();
  assert.equal(l.ok, true);
  assert.equal(l.count, 1);
  assert.equal(l.latest.ticketCount, 3);
  assert.equal(l.latest.prizePool, 300);
  assert.equal(l.latest.closed, true);
  assert.equal(l.latest.drawn, true);
  assert.equal(l.latest.prizeBps, 8000);
  assert.equal(l.latest.winner.toLowerCase(), '0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266');
});

test('readMarkets decodes a dynamic-tuple market correctly', async () => {
  __setFetch(mockFetch({
    '0xec979082': RESULT(['1']), // marketCount = 1
    ['0xeb44fdd3' + W('0')]: marketReturn({ closeTime: 1787791188, disputeWindow: 60, feeBps: 100, yesPool: 100, noPool: 50, phase: 0, outcome: 0 }),
  }));
  const mk = await readMarkets();
  assert.equal(mk.ok, true);
  assert.equal(mk.count, 1);
  const m = mk.list[0];
  assert.equal(m.closeTime, 1787791188);
  assert.equal(m.disputeWindow, 60);
  assert.equal(m.feeBps, 100);
  assert.equal(m.yesPool, '100');
  assert.equal(m.noPool, '50');
  assert.equal(m.phase, 'Open');
  assert.equal(m.yesPct, 66.66); // 100/150
});

test('soft-fails to unavailable when RPC returns not-ok', async () => {
  __setFetch(async () => ({ ok: false, json: async () => ({}) }));
  const l = await readLotto();
  assert.equal(l.ok, false);
  const mk = await readMarkets();
  assert.equal(mk.ok, false);
});

test('handler /api/live returns JSON and never throws', async () => {
  __setFetch(async () => ({ ok: false, json: async () => ({}) }));
  let code = 0, payload = '';
  const res = { setHeader() {}, writeHead(c) { code = c; }, end(b) { payload = b; } };
  await handler({ url: '/api/live', method: 'GET' }, res);
  assert.equal(code, 200);
  const j = JSON.parse(payload);
  assert.equal(j.ok, true);
  assert.ok(j.lotto && j.markets);
});

test('handler / renders an HTML page', async () => {
  __setFetch(async () => ({ ok: false, json: async () => ({}) }));
  let body = '';
  const res = { setHeader() {}, writeHead() {}, end(b) { body = b; } };
  await handler({ url: '/', method: 'GET' }, res);
  assert.match(body, /KULA Arcade/);
});
