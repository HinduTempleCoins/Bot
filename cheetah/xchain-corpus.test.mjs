// xchain-corpus.test.mjs — fully offline. The fetch seam is injected; no socket is ever opened.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  chainCall, toCorpusEntry, fetchAuthorOnChain, fetchCrossChainCorpus,
  isLikelySelfCrossPost, CHAIN_LIST, __setFetch, __resetFetch,
} from './xchain-corpus.mjs';

const ok = (result) => ({ ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) });
const HIVE = { chain: 'hive', rpc: 'https://api.hive.blog', view: (a, p) => `https://peakd.com/@${a}/${p}` };

test('the sibling chains are the Graphene family, and no key is involved', () => {
  assert.deepEqual(CHAIN_LIST, ['hive', 'blurt', 'steem']);
});

test('chainCall returns the result and never throws on a dead chain', async () => {
  __setFetch(async () => ok({ head_block_number: 7 }));
  assert.deepEqual(await chainCall('https://x', 'm', []), { head_block_number: 7 });

  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(await chainCall('https://x', 'm', []), null, 'a down chain is null, not a throw');

  __setFetch(async () => ({ ok: false, json: async () => ({}) }));
  assert.equal(await chainCall('https://x', 'm', []), null, 'a non-200 is null');

  __setFetch(async () => ok(null) && { ok: true, json: async () => ({ error: { message: 'nope' } }) });
  assert.equal(await chainCall('https://x', 'm', []), null, 'a JSON-RPC error is null');
  __resetFetch();
});

test('a post with no body is not corpus — it cannot be compared against', () => {
  assert.equal(toCorpusEntry({ author: 'a', permlink: 'p', body: '   ' }, 'hive', HIVE.view), null);
  assert.equal(toCorpusEntry({ author: 'a' }, 'hive', HIVE.view), null);
  assert.equal(toCorpusEntry(null, 'hive', HIVE.view), null);
});

test('a usable post becomes an entry carrying its chain and a human URL', () => {
  const e = toCorpusEntry({ author: 'udabeu', permlink: 'confusery', body: 'text', created: '2026-10-24' }, 'hive', HIVE.view);
  assert.equal(e.chain, 'hive');
  assert.equal(e.url, 'https://peakd.com/@udabeu/confusery');
  assert.equal(e.crossChain, true, 'the flag is what lets the caller credit rather than accuse');
});

test('comments and other authors are excluded from an author blog fetch', async () => {
  __setFetch(async () => ok([
    { author: 'udabeu', permlink: 'a', body: 'one' },
    { author: 'udabeu', permlink: 'c', body: 'reply', parent_author: 'someone' }, // a comment
    { author: 'someoneelse', permlink: 'b', body: 'two' },                        // a resteem
  ]));
  const got = await fetchAuthorOnChain('udabeu', HIVE, { limit: 10 });
  assert.equal(got.length, 1);
  assert.equal(got[0].permlink, 'a');
  __resetFetch();
});

test('an empty author name never reaches the network', async () => {
  let called = false;
  __setFetch(async () => { called = true; return ok([]); });
  assert.deepEqual(await fetchAuthorOnChain('', HIVE), []);
  assert.equal(called, false);
  __resetFetch();
});

test('the corpus de-duplicates and counts per chain', async () => {
  __setFetch(async () => ok([{ author: 'u', permlink: 'p1', body: 'b' }]));
  const { corpus, perChain } = await fetchCrossChainCorpus(['u', 'u', ''], { chains: ['hive', 'blurt'] });
  assert.equal(corpus.length, 2, 'one entry per chain, the duplicate author collapsed');
  assert.deepEqual(Object.keys(perChain), ['hive', 'blurt']);
  assert.equal(perChain.hive, 1);
  __resetFetch();
});

test('one dead chain does not take the corpus down with it', async () => {
  __setFetch(async (url) => {
    if (String(url).includes('blurt')) throw new Error('down');
    return ok([{ author: 'u', permlink: 'p', body: 'b' }]);
  });
  const { corpus, perChain } = await fetchCrossChainCorpus(['u'], { chains: ['hive', 'blurt'] });
  assert.equal(perChain.blurt, 0);
  assert.equal(perChain.hive, 1);
  assert.equal(corpus.length, 1);
  __resetFetch();
});

test('maxAuthors bounds the work so a busy chain cannot stall a poll', async () => {
  let calls = 0;
  __setFetch(async () => { calls += 1; return ok([]); });
  await fetchCrossChainCorpus(Array.from({ length: 50 }, (_, i) => `a${i}`), { chains: ['hive'], maxAuthors: 5 });
  assert.equal(calls, 5);
  __resetFetch();
});

test('the same name on a sibling chain is a cross-post to credit, not a theft to flag', () => {
  const post = { author: 'udabeu', permlink: 'confusery' };
  assert.equal(isLikelySelfCrossPost(post, { author: 'UDABEU', crossChain: true }), true, 'case-insensitive');
  assert.equal(isLikelySelfCrossPost(post, { author: 'thief', crossChain: true }), false);
  assert.equal(isLikelySelfCrossPost(post, { author: 'udabeu' }), false, 'a same-chain match is not a cross-post');
  assert.equal(isLikelySelfCrossPost(null, null), false);
});
