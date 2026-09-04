/**
 * Tests for tutorial/detector.js. Uses node's built-in test runner.
 *
 *   node --test tutorial/detector.test.js
 *
 * Or via the npm script:
 *
 *   npm test
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectIntroPost,
  detectEngageThreePosts,
  detectShareWhatYouKnow,
  detectFirstOrganicUpvote,
  detectPowerUp,
  detectWitnessVote,
  detectSetProfile,
  detectFollowThreeAuthors,
  detectSendFirstTransfer,
  detectDelegateSomeMp,
  detectCompletedStages,
  nextStageFor,
} from './detector.js';

const longBody = (n) => 'x'.repeat(n);

test('detectIntroPost: tag match + min body length', () => {
  const posts = [
    { tags: ['introduction'], body: longBody(300) },
  ];
  const match = detectIntroPost(posts);
  assert.ok(match, 'tagged post with sufficient body should match');
});

test('detectIntroPost: parses tags from json_metadata when tags array absent', () => {
  const posts = [
    { json_metadata: JSON.stringify({ tags: ['introduceyourself'] }), body: longBody(300) },
  ];
  assert.ok(detectIntroPost(posts), 'json_metadata-encoded tags should be honored');
});

test('detectIntroPost: rejects too-short body even with right tag', () => {
  const posts = [{ tags: ['introduction'], body: longBody(50) }];
  assert.equal(detectIntroPost(posts), null);
});

test('detectIntroPost: rejects wrong tag', () => {
  const posts = [{ tags: ['photography'], body: longBody(300) }];
  assert.equal(detectIntroPost(posts), null);
});

test('detectEngageThreePosts: requires 3 comments on 3 distinct authors', () => {
  const comments = [
    { author: 'alice', parent_author: 'bob', body: longBody(100) },
    { author: 'alice', parent_author: 'carol', body: longBody(100) },
    { author: 'alice', parent_author: 'dave', body: longBody(100) },
  ];
  assert.ok(detectEngageThreePosts(comments));
});

test('detectEngageThreePosts: rejects when same parent_author repeats', () => {
  const comments = [
    { author: 'alice', parent_author: 'bob', body: longBody(100) },
    { author: 'alice', parent_author: 'bob', body: longBody(100) },
    { author: 'alice', parent_author: 'bob', body: longBody(100) },
  ];
  assert.equal(detectEngageThreePosts(comments), null);
});

test('detectEngageThreePosts: rejects self-comments', () => {
  const comments = [
    { author: 'alice', parent_author: 'alice', body: longBody(100) },
    { author: 'alice', parent_author: 'bob', body: longBody(100) },
    { author: 'alice', parent_author: 'carol', body: longBody(100) },
  ];
  assert.equal(detectEngageThreePosts(comments), null);
});

test('detectEngageThreePosts: rejects too-short comments', () => {
  const comments = [
    { author: 'alice', parent_author: 'bob', body: longBody(50) },
    { author: 'alice', parent_author: 'carol', body: longBody(50) },
    { author: 'alice', parent_author: 'dave', body: longBody(50) },
  ];
  assert.equal(detectEngageThreePosts(comments), null);
});

test('detectShareWhatYouKnow: long-enough post that is not tagged as intro', () => {
  const posts = [{ tags: ['howto'], body: longBody(1000) }];
  assert.ok(detectShareWhatYouKnow(posts));
});

test('detectShareWhatYouKnow: rejects intro-tagged post even if long', () => {
  const posts = [{ tags: ['introduction'], body: longBody(1000) }];
  assert.equal(detectShareWhatYouKnow(posts), null);
});

test('detectFirstOrganicUpvote: returns earliest non-Hathor positive vote', () => {
  const votes = [
    { voter: 'hathor', weight: 10000, time: '2026-01-01' },
    { voter: 'carol', weight: 5000, time: '2026-01-03' },
    { voter: 'bob', weight: 5000, time: '2026-01-02' },
  ];
  const match = detectFirstOrganicUpvote(votes);
  assert.equal(match?.voter, 'bob', 'should pick earliest non-hathor positive vote');
});

test('detectFirstOrganicUpvote: ignores zero-weight votes', () => {
  const votes = [{ voter: 'bob', weight: 0, time: '2026-01-01' }];
  assert.equal(detectFirstOrganicUpvote(votes), null);
});

test('detectPowerUp: matches transfer >= 1 MELEK', () => {
  const transfers = [{ amount: '2.500 MELEK' }];
  assert.ok(detectPowerUp(transfers));
});

test('detectPowerUp: rejects below threshold', () => {
  const transfers = [{ amount: '0.500 MELEK' }];
  assert.equal(detectPowerUp(transfers), null);
});

test('detectWitnessVote: at least one approval', () => {
  const votes = [{ witness: 'hathor', approve: true }];
  assert.ok(detectWitnessVote(votes));
});

test('detectWitnessVote: rejects unapprovals', () => {
  const votes = [{ witness: 'hathor', approve: false }];
  assert.equal(detectWitnessVote(votes), null);
});

test('detectCompletedStages: returns shape with all ten Tier-A keys', () => {
  const result = detectCompletedStages({});
  for (const k of ['intro_post', 'engage_three_posts', 'share_what_you_know', 'first_organic_upvote', 'power_up', 'vote_for_a_witness', 'set_profile', 'follow_three_authors', 'send_first_transfer', 'delegate_some_mp']) {
    assert.ok(k in result, `result should include ${k}`);
    assert.equal(result[k].complete, false);
    assert.equal(result[k].evidence, null);
  }
});

test('nextStageFor: empty activity returns stage 1', () => {
  const stage = nextStageFor({});
  assert.equal(stage?.key, 'intro_post');
});

test('nextStageFor: after intro post completes, returns stage 2', () => {
  const activity = {
    posts: [{ tags: ['introduction'], body: longBody(300) }],
  };
  const stage = nextStageFor(activity);
  assert.equal(stage?.key, 'engage_three_posts');
});

test('nextStageFor: all complete returns null', () => {
  const activity = {
    posts: [
      { tags: ['introduction'], body: longBody(300) },
      { tags: ['howto'], body: longBody(1000) },
    ],
    comments: [
      { author: 'me', parent_author: 'a', body: longBody(100) },
      { author: 'me', parent_author: 'b', body: longBody(100) },
      { author: 'me', parent_author: 'c', body: longBody(100) },
    ],
    votes_received: [{ voter: 'someone', weight: 5000, time: '2026-01-01' }],
    transfers_to_vesting: [{ amount: '1.500 MELEK' }],
    witness_votes: [{ witness: 'hathor', approve: true }],
    account: 'me',
    profile: { name: 'Me', about: 'here' },
    follows: [{ following: 'a' }, { following: 'b' }, { following: 'c' }],
    transfers_sent: [{ to: 'a', amount: '0.100 MELEK' }],
    delegations: [{ delegatee: 'a', amount_mp: '5.000' }],
  };
  assert.equal(nextStageFor(activity), null);
});

// ---- stages 7-10: the Tier-A primitives the chain reader satisfies ----

test('detectSetProfile: any one required field is enough; empty strings do not count', () => {
  assert.equal(detectSetProfile(null), null);
  assert.equal(detectSetProfile({}), null);
  assert.equal(detectSetProfile({ name: '   ' }), null);
  assert.deepEqual(detectSetProfile({ about: 'a witness' }), { field: 'about', value: 'a witness' });
  // a field outside require_fields_any_of does not satisfy it
  assert.equal(detectSetProfile({ location: 'Dallas' }), null);
});

test('detectFollowThreeAuthors: counts DISTINCT accounts and excludes self', () => {
  assert.equal(detectFollowThreeAuthors([], 'me'), null);
  // three records but only two distinct
  assert.equal(detectFollowThreeAuthors(
    [{ following: 'a' }, { following: 'a' }, { following: 'b' }], 'me'), null);
  // self does not count toward the three
  assert.equal(detectFollowThreeAuthors(
    [{ following: 'a' }, { following: 'b' }, { following: 'me' }], 'me'), null);
  const hit = detectFollowThreeAuthors(
    [{ following: 'a' }, { following: 'B' }, { following: 'c' }], 'me');
  assert.equal(hit?.count, 3);
  // bare names are accepted too, and case is normalised
  assert.equal(detectFollowThreeAuthors(['a', 'b', 'c'], 'me')?.count, 3);
});

test('detectSendFirstTransfer: honours the minimum and excludes self-sends', () => {
  assert.equal(detectSendFirstTransfer([], 'me'), null);
  assert.equal(detectSendFirstTransfer([{ to: 'a', amount: '0.000 MELEK' }], 'me'), null);
  // a transfer to yourself is not the lesson
  assert.equal(detectSendFirstTransfer([{ to: 'me', amount: '5.000 MELEK' }], 'me'), null);
  assert.equal(detectSendFirstTransfer([{ to: 'ME', amount: '5.000 MELEK' }], 'me'), null);
  const hit = detectSendFirstTransfer([{ to: 'a', amount: '0.001 MELEK' }], 'me');
  assert.equal(hit?.to, 'a');
});

test('detectDelegateSomeMp: reads the MP field, excludes self, honours the minimum', () => {
  assert.equal(detectDelegateSomeMp([], 'me'), null);
  assert.equal(detectDelegateSomeMp([{ delegatee: 'a', amount_mp: '0.500' }], 'me'), null);
  assert.equal(detectDelegateSomeMp([{ delegatee: 'me', amount_mp: '9.000' }], 'me'), null);
  const hit = detectDelegateSomeMp([{ delegatee: 'a', amount_mp: '1.000' }], 'me');
  assert.equal(hit?.delegatee, 'a');
  // a node that returns `to` instead of `delegatee` still gets the self-check
  assert.equal(detectDelegateSomeMp([{ to: 'me', amount_mp: '9.000' }], 'me'), null);
});

test('the four new detectors never throw on junk', () => {
  for (const junk of [undefined, null, 0, '', [], [null], [undefined], [{}]]) {
    assert.doesNotThrow(() => detectSetProfile(junk));
    assert.doesNotThrow(() => detectFollowThreeAuthors(junk === null || junk === undefined || !Array.isArray(junk) ? [] : junk, 'me'));
    assert.doesNotThrow(() => detectSendFirstTransfer(Array.isArray(junk) ? junk : [], 'me'));
    assert.doesNotThrow(() => detectDelegateSomeMp(Array.isArray(junk) ? junk : [], 'me'));
  }
});
