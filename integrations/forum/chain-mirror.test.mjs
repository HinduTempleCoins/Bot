// chain-mirror.test.mjs — offline tests for the forum's chain mirror. node --test, no network: every RPC
// call goes through an injected fetch that answers from fixtures.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createChainMirror, discussionToEntry, replyToEntry, tagForBoard, chainId, canonicalUrl,
  markdownToText, excerpt, isNoise,
} from './chain-mirror.mjs';
import { resolveBoard } from './boards.mjs';

const post = (o) => ({ author: 'hathor', permlink: 'p', category: 'melek', title: 'T', body: 'Body text.', created: '2026-10-18T23:25:12', children: 0, parent_author: '', json_metadata: '{}', ...o });

function fakeFetch(routes, calls = []) {
  return async (url, init) => {
    const { method, params } = JSON.parse(init.body);
    calls.push({ method, params });
    const result = routes(method, params);
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result }) };
  };
}

test('tagForBoard makes a valid chain category ([a-z0-9-] only)', () => {
  assert.equal(tagForBoard('general'), 'melek-forum-general');
  assert.equal(tagForBoard('make/images'), 'melek-forum-make-images');
  assert.equal(tagForBoard('city/austin-tx'), 'melek-forum-city-austin-tx');
  for (const b of ['crypto/bitcoin', 'make/type', 'history/ancient']) assert.match(tagForBoard(b), /^[a-z0-9-]+$/);
});

test('chainId and canonicalUrl are stable', () => {
  assert.equal(chainId('hathor', 'this-is-hathor'), 'm-hathor-this-is-hathor');
  assert.equal(canonicalUrl('hathor', 'this-is-hathor'), 'https://melek.salon/@hathor/this-is-hathor');
  assert.equal(canonicalUrl('hathor', 'this-is-hathor', 'hathor'), 'https://melek.salon/hathor/@hathor/this-is-hathor');
});

test('markdownToText strips images and turns links into readable text with the URL', () => {
  const t = markdownToText('# Head\n\n![img](https://x/y.png)\nSee [the guide](https://kula.money/bridge-guide.html) and **bold**.');
  assert.match(t, /^## Head/);
  assert.doesNotMatch(t, /y\.png/);
  assert.match(t, /the guide \(https:\/\/kula\.money\/bridge-guide\.html\)/);
  assert.match(t, /and bold\./);
});

test('excerpt cuts at a paragraph boundary and marks the cut', () => {
  const long = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} ${'word '.repeat(12)}`).join('\n\n');
  const e = excerpt(long, 500);
  assert.ok(e.length <= 503);
  assert.match(e, /…$/);
});

test('isNoise drops the melektest smoke posts', () => {
  assert.equal(isNoise(post({ category: 'melektest' })), true);
  assert.equal(isNoise(post({ permlink: 'image-test', body: 'x' })), true);
  assert.equal(isNoise(post({})), false);
});

test('a blog post becomes an Announcements thread with an excerpt and the canonical link', () => {
  const e = discussionToEntry(post({ permlink: 'hello', title: 'Hello', body: 'x '.repeat(2000) }), { kind: 'blog', resolveBoard });
  assert.equal(e.id, 'm-hathor-hello');
  assert.equal(e.board, 'announcements');
  assert.equal(e.parentId, null);
  assert.equal(e.src, 'chain');
  assert.match(e.body, /Read the full post on melek\.salon: https:\/\/melek\.salon\/melek\/@hathor\/hello$/);
  assert.ok(e.body.length < 2000);
  assert.equal(e.ts, Date.parse('2026-10-18T23:25:12Z'));
});

test('a blog post in a mapped category lands on the mapped board', () => {
  const e = discussionToEntry(post({ category: 'biohacking' }), { kind: 'blog', resolveBoard });
  assert.equal(e.board, 'nootropics');
});

test('a melek-forum-* post becomes a full-body thread on its board; reply_to attaches it to a seed thread', () => {
  const boardForTag = (tag) => (tag === 'melek-forum-make-images' ? 'make/images' : null);
  const t = discussionToEntry(post({ author: 'alice', permlink: 'forum-1', category: 'melek-forum-make-images', title: 'My method', body: 'Seed 42, 8 steps.', json_metadata: JSON.stringify({ app: 'melek-forum', board: 'make/images' }) }), { kind: 'forum', boardForTag, resolveBoard });
  assert.equal(t.board, 'make/images');
  assert.equal(t.parentId, null);
  assert.equal(t.body, 'Seed 42, 8 steps.');
  const r = discussionToEntry(post({ author: 'bob', permlink: 're-1', category: 'melek-forum-make-images', title: 'Re: x', body: 'Try CFG 1.5.', json_metadata: JSON.stringify({ app: 'melek-forum', board: 'make/images', reply_to: 'lcm-steps' }) }), { kind: 'forum', boardForTag, resolveBoard });
  assert.equal(r.threadId, 'lcm-steps');
  assert.equal(r.parentId, 'lcm-steps');
  assert.equal(r.title, '');
  // unknown category → null
  assert.equal(discussionToEntry(post({ category: 'melek-forum-nope' }), { kind: 'forum', boardForTag, resolveBoard }), null);
});

test('replyToEntry nests a chain reply under its parent', () => {
  const parent = { id: 'm-hathor-x', threadId: 'm-hathor-x', board: 'announcements' };
  const r = replyToEntry({ author: 'carol', permlink: 're-x', body: 'Thanks — the bridge worked.', created: '2026-10-19T01:00:00' }, parent);
  assert.equal(r.parentId, 'm-hathor-x');
  assert.equal(r.threadId, 'm-hathor-x');
  assert.equal(r.author, 'carol');
});

test('refresh reads blogs, forum categories and replies through the injected fetch, and reports new entries', async () => {
  const calls = [];
  const fetch = fakeFetch((method, params) => {
    if (method === 'condenser_api.get_discussions_by_blog') {
      if (params[0].tag === 'hathor') return [post({ permlink: 'a', title: 'A', children: 1 }), post({ author: 'someone', permlink: 'reblog' }), post({ permlink: 'spam', category: 'melektest' })];
      return [post({ author: 'melek', permlink: 'b', title: 'B' })];
    }
    if (method === 'condenser_api.get_discussions_by_created') {
      if (params[0].tag === 'melek-forum-general') return [post({ author: 'dave', permlink: 'forum-9', category: 'melek-forum-general', title: 'Q', json_metadata: '{"board":"general"}' })];
      return [];
    }
    if (method === 'condenser_api.get_content_replies') return [{ author: 'erin', permlink: 're-a', body: 'reply', created: '2026-10-19T00:00:00', children: 0 }];
    return null;
  }, calls);
  const got = [];
  const m = createChainMirror({ fetch, resolveBoard, boardTags: () => [{ board: 'general', tag: 'melek-forum-general' }], onNew: (e) => got.push(...e) });
  const fresh = await m.refresh();
  const ids = m.entries().map((e) => e.id).sort();
  assert.deepEqual(ids, ['m-dave-forum-9', 'm-erin-re-a', 'm-hathor-a', 'm-melek-b']);
  assert.equal(fresh.length, 4);
  assert.equal(got.length, 4);
  assert.ok(calls.some((c) => c.method === 'condenser_api.get_content_replies'));
  // second refresh with identical data reports nothing new
  const again = await m.refresh();
  assert.equal(again.length, 0);
  assert.equal(m.status.lastOk, true);
});

test('refresh soft-fails when the RPC is unreachable and keeps the last good mirror', async () => {
  const m = createChainMirror({ fetch: async () => { throw new Error('down'); }, resolveBoard, boardTags: () => [] });
  m.load([{ kind: 'post', id: 'm-hathor-kept', threadId: 'm-hathor-kept', board: 'announcements', author: 'hathor', title: 'Kept', body: 'x', parentId: null, ts: 1, seq: 0, src: 'chain' }]);
  await assert.doesNotReject(() => m.refresh());
  assert.equal(m.entries().length, 1);
  assert.equal(m.status.lastOk, false);
});

test('load ignores anything that is not a chain post', () => {
  const m = createChainMirror({ fetch: async () => ({ ok: false }) });
  m.load([{ kind: 'post', id: 'x', src: 'local' }, { kind: 'merit', src: 'chain' }, null, { kind: 'post', id: 'm-a-b', src: 'chain' }]);
  assert.deepEqual(m.entries().map((e) => e.id), ['m-a-b']);
});
