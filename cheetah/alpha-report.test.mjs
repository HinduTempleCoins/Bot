// alpha-report.test.mjs — offline tests for the Cheetah → alpha.melek.salon report.
// Injects a fake condenser RPC (no network); verifies pull, verdicts, HTML render, soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRecentPosts, runCheetahOnPosts, reportHtml, __setFetch, esc } from './alpha-report.mjs';

const POSTS = [
  { author: 'alice', permlink: 'graphene-notes', title: 'Graphene notes', created: '2026-06-06T00:00:00',
    body: 'Graphene-family chains rely on delegated proof-of-stake. The witness slot is elected by stake-weighted voting and produces blocks in a round-robin schedule.' },
  { author: 'bob', permlink: 'borrowed', title: 'My take', created: '2026-06-06T01:00:00',
    body: 'Graphene-family chains rely on delegated proof-of-stake. The witness slot is elected by stake-weighted voting and produces blocks in a round-robin schedule. I think this is interesting.' },
  { author: 'carol', permlink: 'bananas', title: 'Bananas', created: '2026-06-06T02:00:00',
    body: 'I went to the store and bought some bananas. The cashier was friendly. I like bananas a lot today.' },
];

function fakeRpc(handler) {
  __setFetch(async (url, opts) => {
    const req = JSON.parse(opts.body);
    const result = handler(req.method, req.params);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  });
}

test('fetchRecentPosts normalizes condenser discussions', async () => {
  fakeRpc((method) => {
    assert.equal(method, 'condenser_api.get_discussions_by_created');
    return POSTS;
  });
  const posts = await fetchRecentPosts({ limit: 5 });
  assert.equal(posts.length, 3);
  assert.equal(posts[0].author, 'alice');
  __setFetch(null);
});

test('fetchRecentPosts soft-fails to [] with .error when RPC is down', async () => {
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  const posts = await fetchRecentPosts();
  assert.equal(posts.length, 0);
  assert.match(posts.error, /ECONNREFUSED/);
  __setFetch(null);
});

test('runCheetahOnPosts: copy detected as match, original as clear', async () => {
  const results = await runCheetahOnPosts(POSTS);
  assert.equal(results.length, 3);
  const bob = results.find((r) => r.author === 'bob');
  const alice = results.find((r) => r.author === 'alice');
  const carol = results.find((r) => r.author === 'carol');
  // bob copied alice (and vice-versa registers too) — both sides cross 0.5 Jaccard
  assert.equal(bob.verdict, 'match');
  assert.ok(bob.confidence >= 0.5);
  assert.match(bob.note, /alice\/graphene-notes|graphene-notes/);
  assert.ok(['match', 'related'].includes(alice.verdict)); // symmetric overlap
  // carol shares nothing
  assert.equal(carol.verdict, 'clear');
  assert.equal(carol.note, '');
});

test('reportHtml renders verdicts, escapes, and the live-head line', async () => {
  const results = await runCheetahOnPosts(POSTS);
  const html = reportHtml({
    results,
    head: { headBlock: 21282, witness: 'hathor', time: '2026-06-06T07:00:00' },
    generatedAt: '2026-06-06 07:00:00 UTC',
    rpcError: null,
  });
  assert.match(html, /Cheetah — live test runs/);
  assert.match(html, /\[TestNet not MELEK\]/); // public-guard testnet label is visible
  assert.match(html, /#21282/);
  assert.match(html, /@hathor/);
  assert.match(html, /MATCH|SEE ALSO/);
  assert.match(html, /ORIGINAL/);
  assert.match(html, /report\.json/);
  assert.ok(!html.includes('<script'), 'static report carries no script');
});

test('reportHtml says so when the RPC is unreachable (never invents data)', () => {
  const html = reportHtml({ results: [], head: null, generatedAt: 'now', rpcError: 'ECONNREFUSED' });
  assert.match(html, /RPC unreachable/);
  assert.match(html, /ECONNREFUSED/);
  assert.match(html, /No posts on the testnet yet/);
});

test('esc escapes html-significant characters', () => {
  assert.equal(esc('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
});
