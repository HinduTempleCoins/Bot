// build.test.mjs — OFFLINE tests for the Admin Page generator (fake RPC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAdminPosts, fetchWitnessAccounts, renderAdminPage, firstImage, excerpt, loadRanks, TABS } from './build.mjs';

const post = (author, permlink, created, extra = {}) => ({ author, permlink, created, category: 'melek', title: `T ${permlink}`,
  body: 'Hello **world** ![x](https://img.example/a.png) more text', json_metadata: '{}', parent_author: '', ...extra });
const rpc = (byAccount) => async (_u, o) => {
  const tag = JSON.parse(o.body).params[0].tag;
  if (tag === 'dead') throw new Error('down');
  return { json: async () => ({ result: byAccount[tag] || [] }) };
};

test('merges admins newest first, drops reblogs and duplicates, survives a dead account', async () => {
  const posts = await fetchAdminPosts({ admins: ['alice', 'dead', 'bob'], fetch: rpc({
    alice: [post('alice', 'a1', '2026-10-10T00:00:00'), post('carol', 'reblogged', '2026-10-12T00:00:00')],
    bob: [post('bob', 'b1', '2026-10-11T00:00:00'), post('bob', 'b1', '2026-10-11T00:00:00')],
  }) });
  assert.deepEqual(posts.map((p) => p.permlink), ['b1', 'a1']);
});

test('page escapes titles, links each post on melek.salon, and shows the first image', () => {
  const html = renderAdminPage([post('alice', 'a1', '2026-10-10T00:00:00', { title: '<script>x</script>' })], { admins: ['alice'] });
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /https:\/\/melek\.salon\/melek\/@alice\/a1/);
  assert.match(html, /img\.example\/a\.png/);
  assert.match(html, /Sign up/);
});

test('helpers: first image from metadata or body; excerpt strips markdown', () => {
  assert.equal(firstImage({ json_metadata: '{"image":["https://m/i.jpg"]}', body: '' }), 'https://m/i.jpg');
  assert.equal(firstImage({ json_metadata: '', body: '<img src="https://h/i.png">' }), 'https://h/i.png');
  assert.equal(excerpt('# Title\n**bold** [link](https://x) ![i](https://y)'), 'Title bold link');
});

test('excerpt keeps underscores and dashes inside links and words', () => {
  assert.match(excerpt('Watch https://youtu.be/EKz?si=g03NAH3X5_xO9oYf now — a well-known one'), /g03NAH3X5_xO9oYf/);
});

test('tab bar on both pages marks the current one; witness page lists the active witnesses', async () => {
  const admin = renderAdminPage([], { admins: ['alice'] });
  assert.match(admin, /<a href="https:\/\/melek\.salon\/" class=on aria-current=page>Admin Updates<\/a>/);
  for (const t of ['All Posts', 'Groups', 'Witness Updates']) assert.ok(admin.includes(`>${t}</a>`));
  assert.ok(!/>Hot<\/a>|>Trending<\/a>/.test(admin), 'Hot/Trending are sorts inside All Posts, not tabs');
  const wit = renderAdminPage([], { admins: ['hathor', 'bob'], page: 'witness' });
  assert.match(wit, /<h1>Witness Updates<\/h1>/);
  assert.match(wit, /class=on aria-current=page>Witness Updates/);
  assert.match(wit, /rel=canonical href="https:\/\/melek\.salon\/witness-updates"/);
});

test('fetchWitnessAccounts keeps block producers, always includes hathor, soft-fails', async () => {
  const f = async () => ({ json: async () => ({ result: [
    { owner: 'bob', last_confirmed_block_num: 10 }, { owner: 'idle', last_confirmed_block_num: 0 }, { owner: 'hathor', last_confirmed_block_num: 5 }] }) });
  assert.deepEqual(await fetchWitnessAccounts({ fetch: f }), ['hathor', 'bob']);
  assert.deepEqual(await fetchWitnessAccounts({ fetch: async () => { throw new Error('down'); } }), ['hathor']);
});

test('tab order: Admin, Witness, Ranked Users, All Posts, Groups', () => {
  assert.deepEqual(TABS.map((t) => t.label), ['Admin Updates', 'Witness Updates', 'Ranked Users', 'All Posts', 'Groups']);
});

test('ranks: only the ladder ranks count, highest first; bad file soft-fails to none', () => {
  const r = loadRanks('x', () => JSON.stringify({ alice: { rank: 'Member', by: 'hathor', ts: 1 }, bob: { rank: 'Legendary', by: 'hathor' },
    eve: { rank: 'Supreme Overlord' }, 'BAD NAME': { rank: 'Member' } }));
  assert.deepEqual(Object.keys(r), ['bob', 'alice']);
  assert.deepEqual(loadRanks('x', () => { throw new Error('missing'); }), {});
});

test('Ranked Users page: rank badge on each post, and an empty ladder says so', () => {
  const html = renderAdminPage([post('alice', 'a1', '2026-10-10T00:00:00')], { admins: ['alice'], page: 'ranked', ranks: { alice: { rank: 'Full Member' } } });
  assert.match(html, /<span class=rank>Full Member<\/span>/);
  assert.match(html, /class=on aria-current=page>Ranked Users/);
  assert.match(renderAdminPage([], { admins: [], page: 'ranked' }), /Nobody has been ranked yet/);
});
