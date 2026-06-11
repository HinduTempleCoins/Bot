// tutorial-progress.test.mjs — OFFLINE tests for read-chain tutorial progress detection.
// All chain readers are fakes; no network. node:test + node:assert/strict.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { progress, STAGE_KEYS, CRITERIA, esc } from './tutorial-progress.mjs';

// ── fixtures ────────────────────────────────────────────────────────────────────────────────────
function emptyDeps() {
  return {
    getPosts: () => [],
    getComments: () => [],
    getVotes: () => [],
    getWitnessVotes: () => [],
    getTransfersToVesting: () => [],
  };
}

function fullDeps() {
  return {
    getPosts: () => [
      { author: 'alice', body: 'i'.repeat(250), tags: ['introduceyourself'] },
      { author: 'alice', body: 'k'.repeat(900), tags: ['howto', 'guide'] },
    ],
    getComments: () => [
      { author: 'alice', parent_author: 'bob', body: 'c'.repeat(85) },
      { author: 'alice', parent_author: 'carol', body: 'c'.repeat(85) },
      { author: 'alice', parent_author: 'dan', body: 'c'.repeat(85) },
    ],
    getVotes: () => [{ voter: 'eve', author: 'alice', permlink: 'p', weight: 10000 }],
    getWitnessVotes: () => ['someverywitness'],
    getTransfersToVesting: () => [{ from: 'alice', to: 'alice', amount: '5.000 MELEK' }],
  };
}

function keyMap(result) {
  return Object.fromEntries(result.stages.map((s) => [s.key, s.done]));
}

// ── 0%: nothing done ────────────────────────────────────────────────────────────────────────────
test('0% — empty chain data → no stages done', async () => {
  const r = await progress('alice', emptyDeps());
  assert.equal(r.pctComplete, 0);
  assert.equal(r.nextStage, 'intro_post');
  assert.equal(r.stages.length, 6);
  for (const s of r.stages) assert.equal(s.done, false);
  // stage order preserved
  assert.deepEqual(r.stages.map((s) => s.key), STAGE_KEYS);
});

// ── 100%: everything done ─────────────────────────────────────────────────────────────────────
test('100% — full chain data → all stages done', async () => {
  const r = await progress('alice', fullDeps());
  assert.equal(r.pctComplete, 100);
  assert.equal(r.nextStage, null);
  for (const s of r.stages) assert.equal(s.done, true, `${s.key} should be done`);
});

// ── partial: intro + share only (2 of 6) ─────────────────────────────────────────────────────
test('partial — intro_post + share_what_you_know only → 33.33%, next is engage', async () => {
  const deps = emptyDeps();
  deps.getPosts = () => [
    { author: 'alice', body: 'i'.repeat(300), tags: ['introduction'] },
    { author: 'alice', body: 'k'.repeat(1200), tags: ['howto'] },
  ];
  const r = await progress('alice', deps);
  const m = keyMap(r);
  assert.equal(m.intro_post, true);
  assert.equal(m.share_what_you_know, true);
  assert.equal(m.engage_three_posts, false);
  assert.equal(r.pctComplete, 33.33);
  // next undone stage in canonical order is engage_three_posts
  assert.equal(r.nextStage, 'engage_three_posts');
});

// ── intro_post threshold edges ──────────────────────────────────────────────────────────────
test('intro_post — short body fails, right-tag long body passes', async () => {
  const tooShort = emptyDeps();
  tooShort.getPosts = () => [{ body: 'x'.repeat(CRITERIA.intro_post.min_body_chars - 1), tags: ['introduceyourself'] }];
  assert.equal(keyMap(await progress('a', tooShort)).intro_post, false);

  const wrongTag = emptyDeps();
  wrongTag.getPosts = () => [{ body: 'x'.repeat(500), tags: ['random'] }];
  assert.equal(keyMap(await progress('a', wrongTag)).intro_post, false);

  // tag via json_metadata string is also honored
  const viaJM = emptyDeps();
  viaJM.getPosts = () => [{ body: 'x'.repeat(500), json_metadata: JSON.stringify({ tags: ['introducing'] }) }];
  assert.equal(keyMap(await progress('a', viaJM)).intro_post, true);
});

// ── engage_three_posts: distinct authors + self-exclusion + length ───────────────────────────
test('engage_three_posts — excludes self-parent, needs 3 distinct authors', async () => {
  // three comments but only two distinct non-self authors → not done
  const twoAuthors = emptyDeps();
  twoAuthors.getComments = () => [
    { parent_author: 'bob', body: 'c'.repeat(90) },
    { parent_author: 'bob', body: 'c'.repeat(90) },
    { parent_author: 'carol', body: 'c'.repeat(90) },
  ];
  assert.equal(keyMap(await progress('alice', twoAuthors)).engage_three_posts, false);

  // includes a comment on alice's own post (excluded) → only 2 valid → not done
  const withSelf = emptyDeps();
  withSelf.getComments = () => [
    { parent_author: 'alice', body: 'c'.repeat(90) },
    { parent_author: 'bob', body: 'c'.repeat(90) },
    { parent_author: 'carol', body: 'c'.repeat(90) },
  ];
  assert.equal(keyMap(await progress('alice', withSelf)).engage_three_posts, false);

  // short comments don't count
  const shortish = emptyDeps();
  shortish.getComments = () => [
    { parent_author: 'bob', body: 'short' },
    { parent_author: 'carol', body: 'short' },
    { parent_author: 'dan', body: 'short' },
  ];
  assert.equal(keyMap(await progress('alice', shortish)).engage_three_posts, false);
});

// ── share_what_you_know: must NOT be an intro ──────────────────────────────────────────────────
test('share_what_you_know — long intro-tagged post does not count', async () => {
  const intro = emptyDeps();
  intro.getPosts = () => [{ body: 'x'.repeat(1000), tags: ['introduceyourself'] }];
  assert.equal(keyMap(await progress('a', intro)).share_what_you_know, false);
});

// ── first_organic_upvote: excludes hathor + downvotes ──────────────────────────────────────────
test('first_organic_upvote — hathor and downvotes excluded', async () => {
  const onlyHathor = emptyDeps();
  onlyHathor.getVotes = () => [{ voter: 'hathor', weight: 10000 }];
  assert.equal(keyMap(await progress('a', onlyHathor)).first_organic_upvote, false);

  const downvote = emptyDeps();
  downvote.getVotes = () => [{ voter: 'eve', weight: -5000 }];
  assert.equal(keyMap(await progress('a', downvote)).first_organic_upvote, false);

  const ok = emptyDeps();
  ok.getVotes = () => [{ voter: 'eve', weight: 1 }];
  assert.equal(keyMap(await progress('a', ok)).first_organic_upvote, true);
});

// ── power_up: amount threshold + from-self ─────────────────────────────────────────────────────
test('power_up — below threshold fails, >=1 MELEK passes', async () => {
  const below = emptyDeps();
  below.getTransfersToVesting = () => [{ from: 'alice', amount: '0.500 MELEK' }];
  assert.equal(keyMap(await progress('alice', below)).power_up, false);

  const ok = emptyDeps();
  ok.getTransfersToVesting = () => [{ from: 'alice', amount: '1.000 TESTS' }];
  assert.equal(keyMap(await progress('alice', ok)).power_up, true);
});

// ── vote_for_a_witness: string and object shapes ──────────────────────────────────────────────
test('vote_for_a_witness — accepts string list and {witness,approve} objects', async () => {
  const strList = emptyDeps();
  strList.getWitnessVotes = () => ['w1'];
  assert.equal(keyMap(await progress('a', strList)).vote_for_a_witness, true);

  const objApprove = emptyDeps();
  objApprove.getWitnessVotes = () => [{ witness: 'w1', approve: true }];
  assert.equal(keyMap(await progress('a', objApprove)).vote_for_a_witness, true);

  const objDisapprove = emptyDeps();
  objDisapprove.getWitnessVotes = () => [{ witness: 'w1', approve: false }];
  assert.equal(keyMap(await progress('a', objDisapprove)).vote_for_a_witness, false);
});

// ── soft-fail: throwing readers, missing readers, garbage ──────────────────────────────────────
test('soft-fail — throwing/missing/garbage readers never throw, yield 0%', async () => {
  const throwing = {
    getPosts: () => { throw new Error('rpc down'); },
    getComments: async () => { throw new Error('rpc down'); },
    getVotes: 'not a function',
    getWitnessVotes: undefined,
    // getTransfersToVesting omitted entirely
  };
  const r = await progress('alice', throwing);
  assert.equal(r.pctComplete, 0);
  assert.equal(r.nextStage, 'intro_post');
  assert.equal(r.stages.length, 6);
});

test('soft-fail — no deps at all, and null account', async () => {
  const r1 = await progress('alice');
  assert.equal(r1.pctComplete, 0);
  const r2 = await progress(null, {});
  assert.equal(r2.pctComplete, 0);
  assert.equal(r2.stages.length, 6);
});

test('soft-fail — readers returning non-arrays / malformed records', async () => {
  const deps = {
    getPosts: () => ({ not: 'an array' }),
    getComments: () => [null, 42, { parent_author: 'bob', body: 'c'.repeat(90) }],
    getVotes: () => 'nope',
    getWitnessVotes: () => [null, '', { foo: 'bar' }],
    getTransfersToVesting: () => [{ amount: 'NaN MELEK' }],
  };
  const r = await progress('alice', deps);
  // malformed comments: only 1 valid author → engage not done; everything else false
  assert.equal(r.pctComplete, 0);
  assert.equal(keyMap(r).engage_three_posts, false);
});

// ── shape + esc sanity ─────────────────────────────────────────────────────────────────────────
test('return shape is well-formed and pctComplete is rounded to 2dp', async () => {
  const deps = emptyDeps();
  // mark exactly one stage done → 1/6 = 16.67
  deps.getPosts = () => [{ body: 'x'.repeat(250), tags: ['introduction'] }];
  const r = await progress('a', deps);
  assert.equal(r.pctComplete, 16.67);
  assert.ok(Array.isArray(r.stages));
  for (const s of r.stages) {
    assert.equal(typeof s.key, 'string');
    assert.equal(typeof s.done, 'boolean');
  }
});

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(esc(null), '');
});
