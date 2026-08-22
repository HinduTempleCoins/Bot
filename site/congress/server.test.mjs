import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, homePage, esc, __setFetch } from './server.mjs';

function mockChain(posts) {
  __setFetch(async (_url, opts) => {
    const body = JSON.parse(opts.body);
    let result = null;
    if (body.method === 'condenser_api.get_discussions_by_created') result = posts;
    if (body.method === 'condenser_api.get_discussions_by_blog') result = posts;
    if (body.method === 'condenser_api.get_content') result = posts[0] || {};
    if (body.method === 'condenser_api.get_content_replies') result = [];
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
}
const SAMPLE = [{
  author: 'hathor', permlink: 'hello-congress', title: '', body: 'gm from the MELEK chain. **markdown** stripped.',
  created: new Date(Date.now() - 3600e3).toISOString().replace('Z', ''), children: 2, net_votes: 5,
  active_votes: [{}, {}, {}], pending_payout_value: '1.234 TBD',
}];

function call(path) {
  return new Promise((resolve) => {
    const chunks = [];
    const res = {
      writeHead(code, headers) { this.code = code; this.headers = headers; },
      end(s) { chunks.push(s || ''); resolve({ code: this.code || 200, headers: this.headers || {}, html: chunks.join('') }); },
    };
    handler({ url: path, method: 'GET' }, res);
  });
}

test('esc escapes html', () => {
  assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
});

test('homePage renders the timeline from the chain, markdown stripped', async () => {
  mockChain(SAMPLE);
  const html = await homePage();
  assert.match(html, /Congress/);
  assert.match(html, /ALPHA · TESTNET/);
  assert.match(html, /@hathor/);
  assert.match(html, /gm from the MELEK chain/);
  assert.doesNotMatch(html, /\*\*markdown\*\*/); // markdown stripped
  assert.match(html, /Login with MELEK/); // composer present
});

test('empty timeline soft-fails to an empty-state, never throws', async () => {
  mockChain([]);
  const html = await homePage();
  assert.match(html, /No posts yet/);
});

test('unreachable RPC still renders (soft-fail)', async () => {
  __setFetch(async () => ({ ok: false }));
  const html = await homePage();
  assert.match(html, /No posts yet|testnet RPC is unreachable/);
});

test('/health returns ok', async () => {
  const r = await call('/health');
  assert.equal(r.code, 200);
  assert.equal(r.html, 'ok');
});

test('profile route renders an account timeline', async () => {
  mockChain(SAMPLE);
  const r = await call('/@hathor');
  assert.equal(r.code, 200);
  assert.match(r.html, /@hathor/);
  assert.match(r.html, /← timeline/);
});

test('single-post route renders the post', async () => {
  mockChain(SAMPLE);
  const r = await call('/post/hathor/hello-congress');
  assert.equal(r.code, 200);
  assert.match(r.html, /gm from the MELEK chain/);
  assert.match(r.html, /Replies/);
});

test('unknown route 404s', async () => {
  const r = await call('/nope');
  assert.equal(r.code, 404);
});
