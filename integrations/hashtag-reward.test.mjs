// hashtag-reward.test.mjs — offline tests for the deterministic hashtag-reward calculator.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  esc,
  extractCampaignTags,
  eligiblePosts,
  computeRewards,
  renderPayoutTable,
} from './hashtag-reward.mjs';

test('esc() escapes HTML metacharacters', () => {
  assert.equal(esc(`<b>"a"&'</b>`), '&lt;b&gt;&quot;a&quot;&amp;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
});

test('extractCampaignTags is case-insensitive and returns lowercased campaign keys', () => {
  const got = extractCampaignTags('Loving #MELEK and #VanKush', ['melek', 'vankush', 'other']);
  assert.deepEqual(got, ['melek', 'vankush']);
});

test('extractCampaignTags returns [] when no campaign tag present or no campaign tags given', () => {
  assert.deepEqual(extractCampaignTags('#random only', ['melek']), []);
  assert.deepEqual(extractCampaignTags('#melek', []), []);
  assert.deepEqual(extractCampaignTags(null, ['melek']), []);
});

test('eligiblePosts filters by body tag and by explicit tags array', () => {
  const posts = [
    { author: 'a', body: 'go #melek' },
    { author: 'b', body: 'nope', tags: ['MELEK'] },
    { author: 'c', body: 'nothing here' },
  ];
  const elig = eligiblePosts(posts, ['melek']);
  assert.deepEqual(elig.map((p) => p.author), ['a', 'b']);
});

test('eligiblePosts oncePerAuthor dedupes to the first post per author', () => {
  const posts = [
    { author: 'bob', body: 'first #melek' },
    { author: 'bob', body: 'second #melek' },
    { author: 'alice', body: '#melek too' },
  ];
  const all = eligiblePosts(posts, ['melek']);
  assert.equal(all.length, 3);
  const deduped = eligiblePosts(posts, ['melek'], { oncePerAuthor: true });
  assert.deepEqual(deduped.map((p) => p.body), ['first #melek', '#melek too']);
});

test('eligiblePosts soft-fails on non-array / no campaign tags', () => {
  assert.deepEqual(eligiblePosts(null, ['melek']), []);
  assert.deepEqual(eligiblePosts([{ author: 'a', body: '#melek' }], []), []);
});

test('computeRewards equal weighting splits evenly, one row per author', () => {
  const posts = [
    { author: 'alice', body: '#melek', votes: 50, comments: 5 },
    { author: 'bob', body: '#melek', votes: 0, comments: 0 },
    { author: 'bob', body: 'second #melek', votes: 0, comments: 0 },
  ];
  const r = computeRewards({ posts, campaignTags: ['melek'], budget: 100, weightBy: 'equal' });
  assert.equal(r.distributions.length, 2);
  // equal weight => 50 / 50, regardless of engagement.
  for (const d of r.distributions) assert.equal(d.reward, 50);
  // bob carries 2 posts but is paid once.
  const bob = r.distributions.find((d) => d.author === 'bob');
  assert.equal(bob.posts, 2);
  assert.equal(r.totalDistributed, 100);
  assert.equal(r.leftover, 0);
});

test('computeRewards engagement weighting splits by votes+comments+1', () => {
  const posts = [
    { author: 'alice', body: '#melek', votes: 8, comments: 1 }, // weight 10
    { author: 'bob', body: '#melek', votes: 0, comments: 0 }, // weight 1
  ];
  const r = computeRewards({ posts, campaignTags: ['melek'], budget: 110, weightBy: 'engagement' });
  const alice = r.distributions.find((d) => d.author === 'alice');
  const bob = r.distributions.find((d) => d.author === 'bob');
  assert.equal(alice.weight, 10);
  assert.equal(bob.weight, 1);
  assert.equal(alice.reward, 100);
  assert.equal(bob.reward, 10);
  assert.equal(r.totalDistributed, 110);
  assert.equal(r.leftover, 0);
});

test('rounding never overspends and leftover is exact', () => {
  // 3 equal authors, budget 100 -> 10000 cents / 3 = 3333 each, 1 cent leftover.
  const posts = [
    { author: 'a', body: '#melek' },
    { author: 'b', body: '#melek' },
    { author: 'c', body: '#melek' },
  ];
  const r = computeRewards({ posts, campaignTags: ['melek'], budget: 100, weightBy: 'equal' });
  for (const d of r.distributions) assert.equal(d.reward, 33.33);
  assert.equal(r.totalDistributed, 99.99);
  assert.equal(r.leftover, 0.01);
  // invariant: distributed + leftover === budget, and we never exceed budget.
  assert.equal(Math.round((r.totalDistributed + r.leftover) * 100), 10000);
  assert.ok(r.totalDistributed <= 100);
});

test('computeRewards soft-fails: no eligible posts -> empty distributions + full leftover', () => {
  const r = computeRewards({ posts: [{ author: 'a', body: 'no tag' }], campaignTags: ['melek'], budget: 50 });
  assert.deepEqual(r.distributions, []);
  assert.equal(r.totalDistributed, 0);
  assert.equal(r.leftover, 50);
});

test('computeRewards soft-fails: NaN/garbage budget -> 0', () => {
  const posts = [{ author: 'a', body: '#melek' }];
  const bad = computeRewards({ posts, campaignTags: ['melek'], budget: 'oops' });
  assert.equal(bad.totalDistributed, 0);
  assert.equal(bad.leftover, 0);
  assert.equal(bad.distributions[0].reward, 0);
  // no args at all does not throw.
  const empty = computeRewards();
  assert.deepEqual(empty.distributions, []);
  assert.equal(empty.totalDistributed, 0);
  assert.equal(empty.leftover, 0);
});

test('renderPayoutTable returns esc()d lines with a footer and never throws', () => {
  const r = computeRewards({
    posts: [{ author: '<b>eve</b>', body: '#melek' }],
    campaignTags: ['melek'],
    budget: 20,
  });
  const table = renderPayoutTable(r);
  assert.ok(table.includes('&lt;b&gt;eve&lt;/b&gt;'));
  assert.ok(table.includes('reward=20.00'));
  assert.ok(table.includes('distributed=20.00'));
  assert.ok(table.includes('leftover=0.00'));
  // garbage input soft-fails to a footer-only table.
  const safe = renderPayoutTable(null);
  assert.ok(safe.includes('distributed=0.00'));
});
