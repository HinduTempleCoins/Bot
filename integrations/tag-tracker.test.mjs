// tag-tracker.test.mjs — offline tests for the MELEK tag tracker (trending-tags analytics).
// Injects canned condenser_api tag feeds; drives the board, leaderboard, velocity, and handler.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  tagStats, tagBoard, trendingTags, headline, renderBoard, renderLeaderboard, handler,
  __setFetch, configured, activeTags,
} from './tag-tracker.mjs';

const RPC = 'http://example.invalid:8090';
let saved;
beforeEach(() => { saved = { rpc: process.env.MELEK_RPC_URL, tags: process.env.TAG_TRACKER_TAGS, net: process.env.MELEK_NETWORK }; process.env.MELEK_RPC_URL = RPC; delete process.env.MELEK_NETWORK; });
afterEach(() => {
  for (const [k, v] of [['MELEK_RPC_URL', saved.rpc], ['TAG_TRACKER_TAGS', saved.tags], ['MELEK_NETWORK', saved.net]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  __setFetch(null);
});

// A tag feed with three posts of varying payout.
function post(author, permlink, title, pending, votes, children, created) {
  return { author, permlink, title, pending_payout_value: `${pending} MELEK`, total_payout_value: '0.000 MELEK', curator_payout_value: '0.000 MELEK', net_votes: votes, children, created };
}
const MELEK_FEED = [
  post('alice', 'p1', 'Hello MELEK', 12.5, 40, 3, '2026-08-24T10:00:00'),
  post('bob', 'p2', 'Second post', 5.0, 10, 1, '2026-08-24T09:00:00'),
  post('alice', 'p3', 'Third', 1.0, 2, 0, '2026-08-24T08:00:00'),
];

function fakeRpc(byTag) {
  return async (url, opts) => {
    const body = JSON.parse(opts.body);
    const tag = body.params?.[0]?.tag;
    const feed = byTag[tag] || [];
    // trending sorts by payout already in our fixture; created is recency (same list is fine offline)
    return { ok: true, json: async () => ({ jsonrpc: '2.0', id: 1, result: feed }) };
  };
}

test('tagStats aggregates posts, authors, payout, top', async () => {
  __setFetch(fakeRpc({ melek: MELEK_FEED }));
  const s = await tagStats('MELEK'); // also verifies normalization/lowercasing + #strip
  assert.equal(s.tag, 'melek');
  assert.equal(s.postCount, 3);
  assert.equal(s.uniqueAuthors, 2); // alice + bob
  assert.equal(s.totalPayout, 18.5); // 12.5 + 5 + 1
  assert.equal(s.top[0].author, 'alice'); // highest payout first
  assert.equal(s.top[0].payout, 12.5);
});

test('tagBoard found + sections ok', async () => {
  __setFetch(fakeRpc({ melek: MELEK_FEED }));
  const b = await tagBoard({ tag: 'melek' });
  assert.equal(b.found, true);
  assert.equal(b.sections.activity.ok, true);
  assert.equal(b.sections.top.ok, true);
  assert.equal(b.postCount, 3);
});

test('velocity computed against a prior snapshot', async () => {
  __setFetch(fakeRpc({ melek: MELEK_FEED }));
  const b = await tagBoard({ tag: 'melek', prev: { postCount: 1 } });
  assert.equal(b.velocity, 2); // 3 now − 1 before
});

test('empty tag → found:false, renderBoard shows no posts, never throws', async () => {
  __setFetch(fakeRpc({}));
  const b = await tagBoard({ tag: 'ghosttag' });
  assert.equal(b.found, false);
  assert.match(renderBoard(b), /No posts found/);
});

test('trendingTags leaderboard ranks by payout', async () => {
  process.env.TAG_TRACKER_TAGS = 'melek,art';
  __setFetch(fakeRpc({
    melek: MELEK_FEED,
    art: [post('carol', 'a1', 'Art', 3.0, 5, 0, '2026-08-24T07:00:00')],
  }));
  const lb = await trendingTags({});
  assert.equal(lb.tags.length, 2);
  assert.equal(lb.tags[0].tag, 'melek'); // 18.5 payout > 3.0
  assert.equal(lb.tags[1].tag, 'art');
});

test('activeTags reads env override, falls back to defaults', () => {
  process.env.TAG_TRACKER_TAGS = 'foo, bar , baz';
  assert.deepEqual(activeTags(), ['foo', 'bar', 'baz']);
  delete process.env.TAG_TRACKER_TAGS;
  assert.ok(activeTags().includes('melek'));
});

test('headline is one plain line', async () => {
  __setFetch(fakeRpc({ melek: MELEK_FEED }));
  const b = await tagBoard({ tag: 'melek' });
  assert.match(headline(b), /#melek/);
  assert.match(headline(b), /3 posts/);
});

test('renderBoard escapes hostile post titles', async () => {
  __setFetch(fakeRpc({ x: [post('m', 'p', '<script>evil</script>', 1, 1, 0, '2026-08-24T00:00:00')] }));
  const b = await tagBoard({ tag: 'x' });
  const html = renderBoard(b);
  assert.ok(!html.includes('<script>evil'));
  assert.match(html, /&lt;script&gt;evil/);
});

test('handler serves single-tag HTML', async () => {
  __setFetch(fakeRpc({ melek: MELEK_FEED }));
  const chunks = [];
  const res = { writeHead(c, h) { this.code = c; this.headers = h; }, end(s) { chunks.push(s); } };
  await handler({ url: '/?tag=melek', headers: { host: 'x' } }, res);
  assert.equal(res.code, 200);
  assert.match(chunks.join(''), /#melek/);
});

test('handler serves the leaderboard when no tag + JSON on /api', async () => {
  process.env.TAG_TRACKER_TAGS = 'melek';
  __setFetch(fakeRpc({ melek: MELEK_FEED }));
  const chunks = [];
  const res = { writeHead(c, h) { this.code = c; this.headers = h; }, end(s) { chunks.push(s); } };
  await handler({ url: '/api', headers: { host: 'x' } }, res);
  assert.match(res.headers['content-type'], /application\/json/);
  const data = JSON.parse(chunks.join(''));
  assert.ok(Array.isArray(data.tags));
  assert.equal(data.tags[0].tag, 'melek');
});

test('RPC unset → board soft-fails to found:false', async () => {
  delete process.env.MELEK_RPC_URL;
  assert.equal(configured(), false);
  const b = await tagBoard({ tag: 'melek' });
  assert.equal(b.found, false);
});

test('renderLeaderboard links each tag back to its board', async () => {
  const lb = { label: '[MELEK]', tags: [{ tag: 'melek', postCount: 3, totalPayout: 18.5, uniqueAuthors: 2 }] };
  const html = renderLeaderboard(lb);
  assert.match(html, /\?tag=melek/);
  assert.match(html, /Trending tags/);
});
