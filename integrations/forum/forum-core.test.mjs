// forum-core.test.mjs — offline unit tests for the MELEK forum engine. node --test, no network, no clock
// dependence (now is injected). Verifies thread/reply persistence + threading, scarce peer-merit standing,
// the new-account gate, board/recent listings, signature render, search, XSS-escaping, and never-throws.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createForum, makeMemoryStore, BOARDS, boardsByCategory, esc, FORUM_TOKEN,
} from './forum-core.mjs';
import { createPeerMerit } from '../peer-merit.mjs';

const T0 = Date.parse('2026-03-01T00:00:00Z');
const MIN = 60 * 1000;
const HR = 60 * 60 * 1000;

// helper: a forum whose accounts already cleared the gate (given merit), for tests not about gating.
function primedForum() {
  const merit = createPeerMerit({});
  const forum = createForum({ store: makeMemoryStore(), merit });
  return { forum, merit };
}
test('createThread + reply persist and thread correctly', async () => {
  const { forum, merit } = primedForum();
  // give hathor merit so it is privileged
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'hathor', 1, { now: T0 });
  const th = await forum.createThread({ board: 'general', author: 'hathor', title: 'Hello', body: 'body one', now: T0 });
  assert.equal(th.ok, true);
  assert.ok(th.thread.id);
  const r1 = await forum.reply({ threadId: th.thread.id, author: 'hathor', body: 'reply one', now: T0 + HR });
  assert.equal(r1.ok, true);
  const r2 = await forum.reply({ threadId: th.thread.id, author: 'hathor', body: 'nested', parentId: r1.post.id, now: T0 + 2 * HR });
  assert.equal(r2.ok, true);

  const view = await forum.thread(th.thread.id);
  assert.equal(view.title, 'Hello');
  assert.equal(view.replyCount, 2);
  assert.equal(view.posts.length, 3);
  // threading: root depth 0, r1 depth 1, r2 (child of r1) depth 2
  assert.equal(view.posts[0].depth, 0);
  assert.equal(view.posts[1].depth, 1);
  assert.equal(view.posts[2].depth, 2);
});

test('reply to a missing thread is rejected, not thrown', async () => {
  const { forum } = primedForum();
  const r = await forum.reply({ threadId: 'nope', author: 'x', body: 'hi', now: T0 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-such-thread');
});

test('createThread requires a real board and a title', async () => {
  const { forum, merit } = primedForum();
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'a', 1, { now: T0 });
  assert.equal((await forum.createThread({ board: 'not-a-board', author: 'a', title: 't', body: 'b', now: T0 })).reason, 'unknown-board');
  assert.equal((await forum.createThread({ board: 'general', author: 'a', title: '   ', body: 'b', now: T0 })).reason, 'title-required');
  assert.equal((await forum.createThread({ board: 'general', author: '', title: 't', body: 'b', now: T0 })).reason, 'invalid-account');
});

test('merit-award raises a post standing and is recorded', async () => {
  const { forum, merit } = primedForum();
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'author', 1, { now: T0 });     // author privileged
  await merit.grantAllotment('giver', { now: T0 });               // giver has 1 sendable
  const th = await forum.createThread({ board: 'general', author: 'author', title: 'x', body: 'b', now: T0 });
  assert.equal(await forum.postMerit(th.thread.id), 0);
  const aw = await forum.awardMerit({ from: 'giver', postId: th.thread.id, amount: 1, now: T0 + MIN });
  assert.equal(aw.ok, true);
  assert.equal(aw.postMerit, 1);
  assert.equal(await forum.postMerit(th.thread.id), 1);
  // the author's peer-merit received score also rose
  assert.equal(await merit.meritScore('author'), 2); // 1 from sponsor prime + 1 from giver
});

test('merit is scarce: cannot self-award your own post', async () => {
  const { forum, merit } = primedForum();
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'author', 1, { now: T0 });
  await merit.grantAllotment('author', { now: T0 }); // author even WITH sendable
  const th = await forum.createThread({ board: 'general', author: 'author', title: 'x', body: 'b', now: T0 });
  const self = await forum.awardMerit({ from: 'author', postId: th.thread.id, amount: 1, now: T0 + MIN });
  assert.equal(self.ok, false);
  assert.equal(self.reason, 'self-award');
  assert.equal(await forum.postMerit(th.thread.id), 0);
});

test('merit is scarce: cannot award with no sendable balance', async () => {
  const { forum, merit } = primedForum();
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'author', 1, { now: T0 });
  const th = await forum.createThread({ board: 'general', author: 'author', title: 'x', body: 'b', now: T0 });
  // "broke" has never received a faucet allotment → 0 sendable
  const res = await forum.awardMerit({ from: 'broke', postId: th.thread.id, amount: 1, now: T0 + MIN });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'insufficient-sendable');
});

test('awardMerit on a missing post soft-fails', async () => {
  const { forum } = primedForum();
  const res = await forum.awardMerit({ from: 'x', postId: 'ghost', amount: 1, now: T0 });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'no-such-post');
});

test('new-account gate rate-limits, and merit lifts it', async () => {
  const { forum, merit } = primedForum();
  // "newbie" has zero merit → rate-limited between posts
  const t1 = await forum.createThread({ board: 'general', author: 'newbie', title: 'first', body: 'b', now: T0 });
  assert.equal(t1.ok, true);
  const t2 = await forum.createThread({ board: 'general', author: 'newbie', title: 'second', body: 'b', now: T0 + 1000 });
  assert.equal(t2.ok, false);
  assert.equal(t2.reason, 'rate-limited');
  // after the interval passes, allowed again
  const t3 = await forum.createThread({ board: 'general', author: 'newbie', title: 'third', body: 'b', now: T0 + 2 * MIN });
  assert.equal(t3.ok, true);
  // give newbie merit → privileged → no rate-limit even back-to-back
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'newbie', 1, { now: T0 });
  const a = await forum.createThread({ board: 'general', author: 'newbie', title: 'p1', body: 'b', now: T0 + 3 * MIN });
  const b = await forum.createThread({ board: 'general', author: 'newbie', title: 'p2', body: 'b', now: T0 + 3 * MIN + 1 });
  assert.equal(a.ok, true);
  assert.equal(b.ok, true, 'privileged account is not rate-limited');
});

test('canPost + meetsThreshold reflect the gate', async () => {
  const { forum, merit } = primedForum();
  const before = await forum.canPost('u', T0);
  assert.equal(before.ok, true); // never posted → allowed
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'u', 1, { now: T0 });
  const priv = await forum.canPost('u', T0);
  assert.equal(priv.privileged, true);
  assert.equal(await forum.meetsThreshold('u', 1), true);
  assert.equal(await forum.meetsThreshold('nobody', 1), false);
});

test('board listing ranks by merit + recency; recentThreads spans boards', async () => {
  const { forum, merit } = primedForum();
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'a', 1, { now: T0 });
  await merit.grantAllotment('giver', { now: T0 });
  const plain = await forum.createThread({ board: 'general', author: 'a', title: 'plain', body: 'b', now: T0 });
  const hot = await forum.createThread({ board: 'general', author: 'a', title: 'hot', body: 'b', now: T0 + MIN });
  await forum.awardMerit({ from: 'giver', postId: hot.thread.id, amount: 1, now: T0 + 2 * MIN });
  const other = await forum.createThread({ board: 'economy', author: 'a', title: 'econ', body: 'b', now: T0 + 3 * MIN });

  const gen = await forum.board('general', { now: T0 + 3 * MIN });
  assert.equal(gen.length, 2);
  assert.equal(gen[0].title, 'hot', 'merit-boosted thread ranks first');
  assert.equal(gen[0].meritTotal, 1);

  const recent = await forum.recentThreads(10);
  assert.equal(recent.length, 3);
  assert.equal(recent[0].title, 'econ', 'most recent activity first across boards');
  void plain; void other;
});

test('board() returns [] for unknown board; boards() grouped by category', async () => {
  const { forum } = primedForum();
  assert.deepEqual(await forum.board('nope', { now: T0 }), []);
  const groups = forum.boards();
  assert.ok(groups.length >= 1);
  assert.ok(groups.every((g) => g.category && Array.isArray(g.boards)));
  // every board id present exactly once across the grouping
  const flat = groups.flatMap((g) => g.boards.map((b) => b.id));
  assert.equal(flat.length, BOARDS.length);
});

test('signature renders valid HTML with the account and FORUM merit', async () => {
  const { forum, merit } = primedForum();
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'hathor', 1, { now: T0 });
  const sig = await forum.signature('hathor', { account: 'hathor', renName: 'hathor.melek', balances: { liquid: '10 MELEK' }, postCount: 3 });
  assert.match(sig, /forum-sig/);
  assert.match(sig, /<svg/);
  assert.match(sig, new RegExp(FORUM_TOKEN));
  assert.match(sig, /hathor/);
});

test('search matches titles and bodies, ranked by recency', async () => {
  const { forum, merit } = primedForum();
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'a', 1, { now: T0 });
  await forum.createThread({ board: 'general', author: 'a', title: 'Phoenix Protocol', body: 'about the corpus', now: T0 });
  await forum.createThread({ board: 'economy', author: 'a', title: 'tokens', body: 'mentions phoenix inside body', now: T0 + HR });
  const hits = await forum.search('phoenix');
  assert.equal(hits.length, 2);
  assert.equal(hits[0].title, 'tokens'); // most recent activity first
  assert.deepEqual(await forum.search('   '), []); // empty query → []
  assert.deepEqual(await forum.search('zzznomatch'), []);
});

test('XSS: hostile titles/bodies are escaped by esc() and stored raw', async () => {
  const { forum, merit } = primedForum();
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'a', 1, { now: T0 });
  const evil = '<script>alert(1)</script>';
  const th = await forum.createThread({ board: 'general', author: 'a', title: evil, body: `body ${evil}`, now: T0 });
  assert.equal(th.ok, true);
  // esc() neutralises the markup
  const e = esc(th.thread.title);
  assert.ok(!e.includes('<script>'));
  assert.match(e, /&lt;script&gt;/);
  // the raw value is preserved in the store (escaping is a render concern)
  assert.equal(th.thread.title, evil);
});

test('title/body length clamps guard storage', async () => {
  const { forum, merit } = primedForum();
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'a', 1, { now: T0 });
  const th = await forum.createThread({ board: 'general', author: 'a', title: 'x'.repeat(500), body: 'y'.repeat(50000), now: T0 });
  assert.ok(th.thread.title.length <= 160);
  assert.ok(th.thread.body.length <= 20000);
});

test('never throws on garbage input', async () => {
  const { forum } = primedForum();
  await assert.doesNotReject(async () => {
    await forum.createThread();
    await forum.createThread({ board: null, author: null, title: null, body: null, now: 'x' });
    await forum.reply();
    await forum.reply({ threadId: 42, author: {}, body: [], now: NaN });
    await forum.awardMerit();
    await forum.awardMerit({ from: null, postId: undefined });
    await forum.thread(undefined);
    await forum.board(undefined, {});
    await forum.recentThreads('nope');
    await forum.search(undefined);
    await forum.signature(null, null);
    await forum.canPost(null);
    await forum.grantAllotment(null);
  });
});

test('boardsByCategory preserves first-seen category order', () => {
  const groups = boardsByCategory([
    { id: 'x', title: 'X', category: 'B' },
    { id: 'y', title: 'Y', category: 'A' },
    { id: 'z', title: 'Z', category: 'B' },
  ]);
  assert.deepEqual(groups.map((g) => g.category), ['B', 'A']);
  assert.equal(groups[0].boards.length, 2);
});

test('persistence: a second forum over the same store sees prior threads and continues seq', async () => {
  const store = makeMemoryStore();
  const merit = createPeerMerit({});
  await merit.grantAllotment('sponsor', { now: T0 });
  await merit.sendMerit('sponsor', 'a', 1, { now: T0 });
  const f1 = createForum({ store, merit });
  const th = await f1.createThread({ board: 'general', author: 'a', title: 'kept', body: 'b', now: T0 });
  assert.equal(th.ok, true);
  const f2 = createForum({ store, merit });
  const view = await f2.thread(th.thread.id);
  assert.equal(view.title, 'kept');
  const r = await f2.reply({ threadId: th.thread.id, author: 'a', body: 'more', now: T0 + HR });
  assert.equal(r.ok, true);
  assert.notEqual(r.post.id, th.thread.id, 'seq continued — new id, no collision');
});
