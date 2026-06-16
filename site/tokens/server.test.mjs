// server.test.mjs — offline tests for the tokens portal handler.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, esc, __setFetch } from './server.mjs';

function mockRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } };
}
const get = async (url) => { const res = mockRes(); await handler({ url, method: 'GET' }, res); return res; };

test('esc neutralizes html', () => {
  assert.equal(esc('<script>"x"'), '&lt;script&gt;&quot;x&quot;');
});

test('/ serves the tokens list page', async () => {
  const r = await get('/');
  assert.equal(r.code, 200);
  assert.match(r.body, /MELEK Tokens/);
  assert.match(r.body, /All tokens/);
  assert.match(r.body, /Alpha/); // alpha badge
});

test('/wallet has holdings + per-token toggle', async () => {
  const r = await get('/wallet');
  assert.equal(r.code, 200);
  assert.match(r.body, /Your holdings/);
  assert.match(r.body, /toggle it off/);
  assert.match(r.body, /melek_tokens_off/); // localStorage pref key
});

test('/earnings has the per-post earnings UI', async () => {
  const r = await get('/earnings');
  assert.equal(r.code, 200);
  assert.match(r.body, /all the SCOT tokens you'll earn|will this post earn/i);
  assert.match(r.body, /\/api\/earnings/);
});

test('nav links to the multi-chain automation portal', async () => {
  const r = await get('/');
  assert.match(r.body, /Steem.Blurt.Hive.MELEK/);
  assert.match(r.body, /auto\.alpha\.melek\.salon/);
});

test('/token/:SYMBOL links to the Nitrous tribe page', async () => {
  const r = await get('/token/ALPHA');
  assert.equal(r.code, 200);
  assert.match(r.body, /ALPHA/);
  assert.match(r.body, /nitrous\/ALPHA/);
});

test('/api/earnings projects across tribes (injected engine)', async () => {
  __setFetch(async (url) => {
    if (url.includes('/contracts/post-tags')) return { ok: true, json: async () => ({ tags: ['alphatribe'] }) };
    if (url.includes('/contracts/rewards')) return { ok: true, json: async () => ({ rules: [{ symbol: 'ALPHA', tag: 'alphatribe', enabled: true, emission: 1000, authorPct: 60, curve: 'linear' }] }) };
    if (url.includes('/contracts/payouts')) return { ok: true, json: async () => ({ posts: [{ author: 'a', permlink: 'b', weight: 250 }, { author: 'x', permlink: 'y', weight: 750 }] }) };
    return { ok: false, json: async () => ({}) };
  });
  const res = mockRes();
  await handler({ url: '/api/earnings?author=a&permlink=b', method: 'GET' }, res);
  __setFetch();
  assert.equal(res.code, 200);
  const d = JSON.parse(res.body);
  assert.equal(d.totalTokens, 1);
  assert.equal(d.earnings[0].symbol, 'ALPHA');
  assert.equal(d.earnings[0].total, 250);
  assert.equal(d.earnings[0].author, 150);
});

test('unknown route soft-404s, never throws', async () => {
  const r = await get('/nope');
  assert.equal(r.code, 404);
  assert.match(r.body, /Not found/);
});
