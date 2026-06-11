import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  scorePosts,
  distributePool,
  summarize,
  esc,
} from './scot-tag-distribution.mjs';

const sumShares = (perPost) => perPost.reduce((s, p) => s + p.share, 0);

test('scorePosts: tag-weighted score = sum(weight * rshares)', () => {
  const posts = [
    { permlink: 'a', tags: ['photo', 'art'], rshares: 100 },
    { permlink: 'b', tags: ['art'], rshares: 50 },
  ];
  const out = scorePosts(posts, { tagWeights: { photo: 2, art: 3 } });
  // a: 2*100 + 3*100 = 500 ; b: 3*50 = 150
  assert.equal(out[0].score, 500);
  assert.equal(out[1].score, 150);
  assert.deepEqual(out[0].matchedTags, ['photo', 'art']);
});

test('scorePosts: a post with no configured tag scores 0', () => {
  const posts = [
    { permlink: 'a', tags: ['photo'], rshares: 100 },
    { permlink: 'b', tags: ['random'], rshares: 9999 },
  ];
  const out = scorePosts(posts, { tagWeights: { photo: 1 } });
  assert.equal(out[0].score, 100);
  assert.equal(out[1].score, 0);
  assert.deepEqual(out[1].matchedTags, []);
});

test('scorePosts: tags[] without weights default to 1', () => {
  const out = scorePosts([{ permlink: 'a', tags: ['x'], rshares: 7 }], {
    tags: ['x'],
  });
  assert.equal(out[0].score, 7);
});

test('scorePosts: no config means every carried tag weighs 1', () => {
  const out = scorePosts([{ permlink: 'a', tags: ['x', 'y'], rshares: 10 }], {});
  assert.equal(out[0].score, 20);
});

test('scorePosts: does not mutate inputs', () => {
  const posts = [{ permlink: 'a', tags: ['x'], rshares: 1 }];
  const frozen = JSON.stringify(posts);
  scorePosts(posts, { tagWeights: { x: 5 } });
  assert.equal(JSON.stringify(posts), frozen);
});

test('distributePool: conservation — shares sum EXACTLY to poolUnits', () => {
  const scored = scorePosts(
    [
      { permlink: 'a', tags: ['t'], rshares: 1 },
      { permlink: 'b', tags: ['t'], rshares: 1 },
      { permlink: 'c', tags: ['t'], rshares: 1 },
    ],
    { tagWeights: { t: 1 } }
  );
  // 1000 / 3 = 333.33 -> largest-remainder must still total 1000 exactly.
  const r = distributePool({ poolUnits: 1000, posts: scored, authorPct: 50 });
  assert.equal(sumShares(r.perPost), 1000);
  assert.equal(r.totalScore, 3);
});

test('distributePool: author/curation split conserves each share', () => {
  const r = distributePool({
    poolUnits: 101,
    posts: [{ permlink: 'a', score: 1 }],
    authorPct: 50,
  });
  const p = r.perPost[0];
  assert.equal(p.share, 101);
  assert.equal(p.author + p.curation, 101);
  assert.equal(p.author, 50); // floor(101*50/100)
  assert.equal(p.curation, 51); // remainder absorbed by curation here
});

test('distributePool: proportional by score', () => {
  const r = distributePool({
    poolUnits: 100,
    posts: [
      { permlink: 'a', score: 75 },
      { permlink: 'b', score: 25 },
    ],
    authorPct: 100,
  });
  assert.equal(r.perPost[0].share, 75);
  assert.equal(r.perPost[1].share, 25);
  assert.equal(sumShares(r.perPost), 100);
});

test('distributePool: dust (Hamilton remainder) goes to top-scored post', () => {
  // scores 1,1,1 over pool 100 -> 33,33,33 floor, remainder 1 to top.
  // All fracs equal -> tie-break by permlink -> "a" wins the unit.
  const r = distributePool({
    poolUnits: 100,
    posts: [
      { permlink: 'b', score: 1 },
      { permlink: 'a', score: 1 },
      { permlink: 'c', score: 1 },
    ],
  });
  assert.equal(sumShares(r.perPost), 100);
  assert.equal(r.dust, 1);
  // 'a' (lowest permlink, equal frac) absorbs the extra unit.
  const a = r.perPost.find((p) => p.permlink === 'a');
  assert.equal(a.share, 34);
});

test('distributePool: zero total score parks whole pool as dust on top post', () => {
  const r = distributePool({
    poolUnits: 500,
    posts: [
      { permlink: 'z', score: 0 },
      { permlink: 'a', score: 0 },
    ],
  });
  assert.equal(r.totalScore, 0);
  assert.equal(r.dust, 500);
  assert.equal(sumShares(r.perPost), 500);
  // tie-break by permlink among equal (zero) scores -> 'a'
  const a = r.perPost.find((p) => p.permlink === 'a');
  assert.equal(a.share, 500);
});

test('distributePool: soft-fail — empty posts yields empty perPost, pool as dust', () => {
  const r = distributePool({ poolUnits: 100, posts: [] });
  assert.deepEqual(r.perPost, []);
  assert.equal(r.dust, 100);
  assert.equal(r.totalScore, 0);
});

test('distributePool: soft-fail — zero pool yields zero shares', () => {
  const r = distributePool({
    poolUnits: 0,
    posts: [{ permlink: 'a', score: 5 }],
  });
  assert.equal(sumShares(r.perPost), 0);
  assert.equal(r.perPost[0].share, 0);
});

test('distributePool: soft-fail — garbage inputs never throw', () => {
  assert.doesNotThrow(() => distributePool());
  assert.doesNotThrow(() => distributePool({ poolUnits: NaN, posts: 'nope' }));
  assert.doesNotThrow(() =>
    distributePool({ poolUnits: -50, posts: [null, 42, { permlink: 'a' }] })
  );
  const r = distributePool({
    poolUnits: Infinity,
    posts: [{ permlink: 'a', score: -1 }],
  });
  assert.equal(r.totalScore, 0);
});

test('distributePool: authorPct clamps out-of-range and non-numeric', () => {
  const hi = distributePool({
    poolUnits: 100,
    posts: [{ permlink: 'a', score: 1 }],
    authorPct: 999,
  });
  assert.equal(hi.perPost[0].author, 100);
  assert.equal(hi.perPost[0].curation, 0);

  const bad = distributePool({
    poolUnits: 100,
    posts: [{ permlink: 'a', score: 1 }],
    authorPct: 'xyz',
  });
  assert.equal(bad.perPost[0].author, 50); // falls back to 50
});

test('summarize: renders a table and esc()s interpolation', () => {
  const r = distributePool({
    poolUnits: 100,
    posts: [{ permlink: 'a<b>', score: 1 }],
    authorPct: 50,
  });
  const md = summarize(r);
  assert.match(md, /SCOT tag-based pool distribution/);
  assert.match(md, /a&lt;b&gt;/); // permlink escaped
  assert.ok(!md.includes('a<b>'));
});

test('summarize: soft-fail on garbage', () => {
  assert.doesNotThrow(() => summarize());
  assert.doesNotThrow(() => summarize(null));
  const md = summarize({ perPost: 'nope', dust: NaN, totalScore: -1 });
  assert.match(md, /posts: \*\*0\*\*/);
});

test('esc: escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});
