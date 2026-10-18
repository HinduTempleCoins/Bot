// build.test.mjs — OFFLINE tests for the Admin Page generator (fake RPC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchAdminPosts, renderAdminPage, firstImage, excerpt } from './build.mjs';

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
