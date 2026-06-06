// commands/alpha-report.test.mjs — offline tests for the !commands → alpha.melek.salon page.
// Injects a fake condenser RPC (no network); verifies content pull, wild-command detection,
// the demo runner, HTML render, and soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fetchRecentContent, runMenuOnContent, runDemo, reportHtml, liveDeps, __setFetch, esc,
} from './alpha-report.mjs';

const POSTS = [
  { author: 'alice', permlink: 'hello-melek', title: 'Hello', created: '2026-06-06T00:00:00',
    body: 'My first post on the MELEK testnet. No commands here.' },
  { author: 'bob', permlink: 'asking-hathor', title: 'Asking', created: '2026-06-06T01:00:00',
    body: '!balance @alice' },
];

const REPLIES = {
  'alice/hello-melek': [
    { author: 'carol', permlink: 're-hello', created: '2026-06-06T02:00:00', body: '!help' },
    { author: 'hathor', permlink: 're-own', created: '2026-06-06T02:01:00', body: '!price btc' }, // witness's own — skipped
  ],
  'bob/asking-hathor': [],
};

function fakeRpc(extra = {}) {
  __setFetch(async (url, opts) => {
    const req = JSON.parse(opts.body);
    const route = (method, params) => {
      if (method === 'condenser_api.get_discussions_by_created') return POSTS;
      if (method === 'condenser_api.get_content_replies') return REPLIES[`${params[0]}/${params[1]}`] || [];
      if (extra[method]) return extra[method](params);
      throw new Error(`unexpected rpc ${method}`);
    };
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: route(req.method, req.params) }) };
  });
}

test('fetchRecentContent pulls posts and their replies', async () => {
  fakeRpc();
  const content = await fetchRecentContent({ limit: 5 });
  assert.equal(content.length, 4); // 2 posts + 2 replies
  assert.equal(content[0].kind, 'post');
  assert.ok(content.some((c) => c.kind === 'reply' && c.author === 'carol'));
  __setFetch(null);
});

test('fetchRecentContent soft-fails to [] with .error when RPC is down', async () => {
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  const content = await fetchRecentContent();
  assert.equal(content.length, 0);
  assert.match(content.error, /ECONNREFUSED/);
  __setFetch(null);
});

test('runMenuOnContent finds !commands in the wild, skips the witness itself', async () => {
  fakeRpc();
  const content = await fetchRecentContent();
  const deps = { getAccount: async () => ({ balance: '10.000 TESTS', vesting_shares: '5.000000 VESTS' }) };
  const wild = await runMenuOnContent(content, deps);
  __setFetch(null);
  // bob's !balance and carol's !help — hathor's own !price is skipped
  assert.equal(wild.length, 2);
  const bob = wild.find((w) => w.author === 'bob');
  assert.match(bob.reply, /@alice/);
  assert.match(bob.reply, /10\.000 TESTS/);
  const carol = wild.find((w) => w.author === 'carol');
  assert.match(carol.reply, /Available commands/);
  assert.ok(!wild.some((w) => w.author === 'hathor'));
});

test('runDemo runs every demo invocation through the menu', async () => {
  const deps = {
    getAccount: async () => ({ balance: '1.000 TESTS', vesting_shares: '1.000000 VESTS', post_count: 2 }),
    getWitness: async () => ({ url: 'https://witness.melek.salon', signing_key: 'TST7abc', last_confirmed_block_num: 42, total_missed: 0 }),
    getPrice: async () => ({ usd: 65000, sources: 3, confident: true }),
    getTutorialProgress: async () => ({ stages: [{ key: 'intro_post', label: 'Post an introduction', complete: true }], next: null }),
  };
  const demo = await runDemo(deps);
  assert.equal(demo.length, 6);
  assert.ok(demo.every((d) => typeof d.reply === 'string' && d.reply.length > 0));
  assert.match(demo.find((d) => d.command === '!signup').reply, /How to get a MELEK account/);
  assert.match(demo.find((d) => d.command === '!witness hathor').reply, /witness\.melek\.salon/);
});

test('liveDeps getTutorialProgress returns null for unknown account', async () => {
  fakeRpc({ 'condenser_api.get_accounts': () => [] });
  const prog = await liveDeps().getTutorialProgress('ghost');
  assert.equal(prog, null);
  __setFetch(null);
});

test('reportHtml renders menu, demo, wild rows, and the live-head line', () => {
  const html = reportHtml({
    demo: [{ command: '!help', reply: 'Available commands:\n!balance...' }],
    wild: [{ author: 'bob', permlink: 'p', created: 'now', kind: 'reply', command: '!balance @alice', reply: '@alice\nLiquid: 10' }],
    head: { headBlock: 31337, witness: 'hathor', time: '2026-06-06T07:00:00' },
    generatedAt: '2026-06-06 07:00:00 UTC',
    rpcError: null,
  });
  assert.match(html, /!commands — Hathor's deterministic menu/);
  assert.match(html, /#31337/);
  assert.match(html, /@hathor/);
  assert.match(html, /!signup/); // menu list includes the new commands
  assert.match(html, /!tutorial/);
  assert.match(html, /dry-run/);
  assert.match(html, /report\.json/);
  assert.ok(!html.includes('<script'), 'static report carries no script');
});

test('reportHtml says so when the RPC is unreachable (never invents data)', () => {
  const html = reportHtml({ demo: [], wild: [], head: null, generatedAt: 'now', rpcError: 'ECONNREFUSED' });
  assert.match(html, /RPC unreachable/);
  assert.match(html, /ECONNREFUSED/);
  assert.match(html, /No !commands found/);
});

test('esc escapes html-significant characters', () => {
  assert.equal(esc('<b a="1">&\''), '&lt;b a=&quot;1&quot;&gt;&amp;&#39;');
});
