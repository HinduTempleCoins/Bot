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

test('every page has the nav bar + shared client session', async () => {
  mockChain(SAMPLE);
  const r = await call('/');
  assert.match(r.html, /nav class=tabs/);
  assert.match(r.html, /window\.CONGRESS/);          // shared signer session
  assert.match(r.html, />Home<[\s\S]*>Search<[\s\S]*>Messages</); // nav tabs
});

test('post cards have interactive like + reply buttons', async () => {
  mockChain(SAMPLE);
  const r = await call('/');
  assert.match(r.html, /data-act=like/);
  assert.match(r.html, /data-act=reply/);
  assert.match(r.html, /data-author="hathor"/);
});

test('/search with no query shows the search box only', async () => {
  const r = await call('/search');
  assert.equal(r.code, 200);
  assert.match(r.html, /form class=search/);
  assert.match(r.html, /Search posts by tag/);
});

test('/search?q=politics renders results from that tag', async () => {
  mockChain(SAMPLE);
  const r = await call('/search?q=politics');
  assert.equal(r.code, 200);
  assert.match(r.html, /#politics/);
  assert.match(r.html, /gm from the MELEK chain/);
});

test('/search sanitizes the query (no injection)', async () => {
  mockChain([]);
  const r = await call('/search?q=%3Cscript%3E');
  assert.equal(r.code, 200);
  assert.doesNotMatch(r.html, /<script>alert/i);
});
