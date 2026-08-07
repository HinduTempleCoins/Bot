// melek-chain-search.test.mjs — OFFLINE. Injected rpc (no network). Soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { searchMelek, esc } from './melek-chain-search.mjs';

const POSTS = [
  { author: 'hathor', permlink: 'melek-move-walk', title: 'MELEK Move: walk to earn', net_votes: 5,
    json_metadata: JSON.stringify({ tags: ['melek', 'move', 'walking'] }), body: 'Walk and the chain pays you rewards for walking.' },
  { author: 'rasma', permlink: 'a-flower', title: 'A flower photograph', net_votes: 1,
    json_metadata: JSON.stringify({ tags: ['photography'] }), body: 'A yellow flower in the village.' },
  { author: 'vankushfamily', permlink: 'soap', title: 'Van Kush soap making', net_votes: 2,
    json_metadata: JSON.stringify({ tags: ['vankush', 'soap'] }), body: 'Real soap from old recipes.' },
];
// a fake rpc that serves the same posts for any tag, and a couple of accounts
const fakeRpc = async (method, params) => {
  if (method.startsWith('get_discussions')) return POSTS;
  if (method === 'lookup_accounts') return ['walker1', 'walkingdead', 'hathor'];
  return null;
};

test('finds relevant posts and ranks title/tag matches first', async () => {
  const hits = await searchMelek('walking rewards', { rpc: fakeRpc, k: 8 });
  const posts = hits.filter((h) => h.kind === 'post');
  assert.ok(posts.length >= 1);
  assert.equal(posts[0].author, 'hathor');                       // strongest match (title+tag+body)
  assert.match(posts[0].link, /melek\.salon\/@hathor\/melek-move-walk/);
  assert.ok(posts[0].snippet.toLowerCase().includes('walk'));
  assert.ok(posts[0].score > 0 && posts[0].score <= 1);
});

test('query dedupes across tag batches and excludes non-matches', async () => {
  const hits = await searchMelek('soap', { rpc: fakeRpc });
  const authors = hits.filter((h) => h.kind === 'post').map((h) => h.author);
  assert.ok(authors.includes('vankushfamily'));
  assert.ok(!authors.includes('rasma'));                          // flower post doesn't match "soap"
  // dedupe: hathor/melek-move-walk appears once even though many tag batches return it
  const links = hits.map((h) => h.link);
  assert.equal(new Set(links).size, links.length);
});

test('surfaces account matches by name', async () => {
  const hits = await searchMelek('walking', { rpc: fakeRpc });
  const accts = hits.filter((h) => h.kind === 'account');
  assert.ok(accts.some((a) => a.title === '@walkingdead'));
  assert.ok(accts.every((a) => a.link.startsWith('https://melek.salon/@')));
});

test('empty / whitespace query returns []', async () => {
  assert.deepEqual(await searchMelek('', { rpc: fakeRpc }), []);
  assert.deepEqual(await searchMelek('  ', { rpc: fakeRpc }), []);
});

test('soft-fail: a throwing/dead rpc never throws, returns []', async () => {
  const dead = async () => { throw new Error('rpc down'); };
  const r = await searchMelek('anything', { rpc: dead });
  assert.deepEqual(r, []);
  const nullRpc = async () => null;
  assert.deepEqual(await searchMelek('anything', { rpc: nullRpc }), []);
});

test('esc escapes html', () => {
  assert.equal(esc('<b>&"'), '&lt;b&gt;&amp;&quot;');
});
