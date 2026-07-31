// herald/crossposter.test.mjs — OFFLINE. In-memory store, injected broadcaster + mocked fetch.
// Covers: per-chain tag caps + canonical backlink; broadcast to 2 chains + per-chain 24h pacing;
// no-broadcaster soft-fail; verifyPost live/not-found off a mocked RPC. Soft-fail-never-throw.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatForChain, canonicalBacklink, postToChains, verifyPost, postsFor, __setFetch, __setBroadcaster } from './crossposter.mjs';

function mem() {
  const m = new Map();
  return { fs: { read: (p) => (m.has(p) ? m.get(p) : null), write: (p, s) => m.set(p, s) }, file: 'mem://crosspost.json' };
}
const SOURCE = () => ({
  title: 'The Convergence',
  author: '@hathor',
  permlink: 'the-convergence',
  tags: ['#MELEK', 'convergence', 'ai', 'temple', 'witness', 'crypto', 'brujeria', 'zar', 'extra', 'melek'],
  canonicalUrl: 'https://melek.salon/@hathor/the-convergence',
  bodyMarkdown: 'A body of work.',
  targetChains: [],
});

test('formatForChain: caps tags per chain and appends the canonical backlink', () => {
  const src = SOURCE();
  const hive = formatForChain(src, 'hive');
  assert.equal(hive.tags.length, 5, 'Hive caps at 5');
  assert.equal(hive.tags[0], 'melek', 'lowercased, #-stripped, deduped first tag');
  const melek = formatForChain(src, 'melek');
  assert.equal(melek.tags.length, 8, 'MELEK/Blurt caps at 8');
  // dedupe: '#MELEK' and 'melek' collapse to one.
  assert.equal(melek.tags.filter((t) => t === 'melek').length, 1, 'deduped');
  // backlink ALWAYS appended.
  assert.match(melek.body, /---\n_Originally published at https:\/\/melek\.salon\/@hathor\/the-convergence_$/);
  assert.equal(canonicalBacklink('https://x.y/p'), '\n\n---\n_Originally published at https://x.y/p_');
  assert.equal(canonicalBacklink(''), '', 'no url → no backlink');
  // standard graphene comment op shape.
  assert.equal(melek.op[0], 'comment');
  assert.equal(melek.op[1].author, 'hathor');
  assert.equal(melek.op[1].parent_permlink, 'melek', 'category = first tag');
  // unsupported chain → soft-fail.
  assert.equal(formatForChain(src, 'ethereum').ok, false);
});

test('postToChains: posts to 2 chains; a 3rd post to the same chain within 24h is rate-limited', async () => {
  const o = mem();
  const calls = [];
  __setBroadcaster(async (chain, op) => { calls.push({ chain, op }); return { ok: true, txid: `tx-${chain}-${calls.length}` }; });

  // Two different chains in one call — both go through (cap is 2/day PER chain).
  const src = { ...SOURCE(), targetChains: ['melek', 'hive'] };
  const r1 = await postToChains(src, { ...o, now: 1_000_000 });
  assert.equal(r1.ok, true);
  assert.equal(r1.results.melek.ok, true);
  assert.equal(r1.results.melek.txid, 'tx-melek-1');
  assert.equal(r1.results.hive.ok, true);

  // Second melek post within 24h → still under cap (2), succeeds.
  const r2 = await postToChains({ ...SOURCE(), targetChains: ['melek'] }, { ...o, now: 1_000_000 + 60_000 });
  assert.equal(r2.results.melek.ok, true);

  // Third melek post within 24h → exceeds cap (2) → rate-limited, no new broadcast.
  const before = calls.length;
  const r3 = await postToChains({ ...SOURCE(), targetChains: ['melek'] }, { ...o, now: 1_000_000 + 120_000 });
  assert.equal(r3.results.melek.ok, false);
  assert.equal(r3.results.melek.skipped, 'rate-limited');
  assert.equal(calls.length, before, 'no broadcast on a rate-limited chain');

  // After the 24h window rolls off, melek posts again.
  const r4 = await postToChains({ ...SOURCE(), targetChains: ['melek'] }, { ...o, now: 1_000_000 + 25 * 60 * 60 * 1000 });
  assert.equal(r4.results.melek.ok, true, 'pacing window rolled off');

  // store recorded the successful melek posts + their permlinks.
  const hist = postsFor('melek', o);
  assert.ok(hist.length >= 3);
  assert.equal(hist[0].permlink, 'the-convergence');

  __setBroadcaster(null);
});

test('postToChains: NO broadcaster → soft-fail per chain, never throws', async () => {
  const o = mem();
  __setBroadcaster(null);
  const r = await postToChains({ ...SOURCE(), targetChains: ['melek', 'blurt'] }, { ...o, now: 5_000_000 });
  assert.equal(r.ok, true);
  assert.equal(r.results.melek.ok, false);
  assert.equal(r.results.melek.reason, 'no broadcaster');
  assert.equal(r.results.blurt.reason, 'no broadcaster');
  assert.deepEqual(postsFor('melek', o), [], 'nothing recorded');
});

test('verifyPost: found → live url; not-found → {ok:false}; asserts fetch args', async () => {
  const calls = [];
  __setFetch(async (url, init) => {
    calls.push({ url: String(url), init });
    const body = JSON.parse(init.body);
    // return a "found" post for the-convergence, empty otherwise.
    if (body.params[1] === 'the-convergence') return { json: async () => ({ result: { author: 'hathor', permlink: 'the-convergence' } }) };
    return { json: async () => ({ result: { author: '', permlink: '' } }) };
  });

  const ok = await verifyPost('melek', '@hathor', 'the-convergence');
  assert.equal(ok.ok, true);
  assert.equal(ok.live, true);
  assert.equal(ok.url, 'https://melek.salon/@hathor/the-convergence');
  // fetch called the RPC with condenser_api.get_content [author, permlink].
  assert.equal(calls.length, 1);
  const sent = JSON.parse(calls[0].init.body);
  assert.equal(sent.method, 'condenser_api.get_content');
  assert.deepEqual(sent.params, ['hathor', 'the-convergence']);

  const missing = await verifyPost('hive', 'hathor', 'ghost-post');
  assert.equal(missing.ok, false);
  assert.equal(missing.url, 'https://hive.blog/@hathor/ghost-post');

  __setFetch(null);
});

test('verifyPost: bad input + network error → soft-fail, never throws', async () => {
  assert.equal((await verifyPost('nope', 'a', 'b')).ok, false, 'unsupported chain');
  assert.equal((await verifyPost('melek', '', '')).ok, false, 'author + permlink required');
  __setFetch(async () => { throw new Error('down'); });
  const r = await verifyPost('melek', 'hathor', 'x');
  assert.equal(r.ok, false);
  assert.match(r.reason, /verify error/);
  __setFetch(null);
});
