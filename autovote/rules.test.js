import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  clampWeight,
  fanbaseMatches,
  fanbaseVoteWeight,
  trailMatches,
  trailVoteWeight,
  scheduleDue,
  underDailyCap,
  nextAllowedVoteTime,
  plannedVote,
} from './rules.js';

test('clampWeight bounds and rounds', () => {
  assert.equal(clampWeight(99999), 10000);
  assert.equal(clampWeight(-99999), -10000);
  assert.equal(clampWeight(50.6), 51);
  assert.equal(clampWeight('abc'), 0);
});

test('fanbaseMatches: top-level post by tracked author only', () => {
  const rule = { authors: ['alice', 'bob'], paused: false };
  assert.equal(fanbaseMatches(rule, { author: 'alice', parent_author: '' }), true);
  assert.equal(fanbaseMatches(rule, { author: 'ALICE', parent_author: '' }), true, 'case-insensitive');
  assert.equal(fanbaseMatches(rule, { author: 'carol', parent_author: '' }), false, 'untracked author');
  assert.equal(fanbaseMatches(rule, { author: 'alice', parent_author: 'bob' }), false, 'comment not post');
});

test('fanbaseMatches: paused never matches', () => {
  const rule = { authors: ['alice'], paused: true };
  assert.equal(fanbaseMatches(rule, { author: 'alice', parent_author: '' }), false);
});

test('fanbaseVoteWeight maps percent to 10000 scale', () => {
  assert.equal(fanbaseVoteWeight({ weight: 100 }), 10000);
  assert.equal(fanbaseVoteWeight({ weight: 50 }), 5000);
  assert.equal(fanbaseVoteWeight({ weight: 0 }), 0);
});

test('trailMatches: follow leader upvotes, not own posts, not downvotes', () => {
  const rule = { target: 'leader', owner: 'me', paused: false };
  assert.equal(trailMatches(rule, { voter: 'leader', author: 'x', weight: 8000 }), true);
  assert.equal(trailMatches(rule, { voter: 'LEADER', author: 'x', weight: 8000 }), true);
  assert.equal(trailMatches(rule, { voter: 'other', author: 'x', weight: 8000 }), false, 'wrong leader');
  assert.equal(trailMatches(rule, { voter: 'leader', author: 'x', weight: -5000 }), false, 'downvote');
  assert.equal(trailMatches(rule, { voter: 'leader', author: 'me', weight: 8000 }), false, 'own post');
});

test('trailVoteWeight: percent base + optional scale to leader', () => {
  assert.equal(trailVoteWeight({ weight: 100 }, 10000), 10000);
  assert.equal(trailVoteWeight({ weight: 50 }, 10000), 5000);
  // scaleToLeader: leader voted 50% (5000), our rule is 100% -> 5000
  assert.equal(trailVoteWeight({ weight: 100, scaleToLeader: true }, 5000), 5000);
  assert.equal(trailVoteWeight({ weight: 50, scaleToLeader: true }, 5000), 2500);
});

test('scheduleDue: respects time, done, paused', () => {
  assert.equal(scheduleDue({ voteAt: 1000, done: false, paused: false }, 1500), true);
  assert.equal(scheduleDue({ voteAt: 2000, done: false, paused: false }, 1500), false, 'future');
  assert.equal(scheduleDue({ voteAt: 1000, done: true, paused: false }, 1500), false, 'done');
  assert.equal(scheduleDue({ voteAt: 1000, done: false, paused: true }, 1500), false, 'paused');
});

test('underDailyCap', () => {
  assert.equal(underDailyCap(0, 999), true, '0 = unlimited');
  assert.equal(underDailyCap(5, 4), true);
  assert.equal(underDailyCap(5, 5), false);
  assert.equal(underDailyCap(5, 6), false);
});

test('nextAllowedVoteTime: rate limit gap', () => {
  assert.equal(nextAllowedVoteTime(0, 3300), 0, 'never voted = allowed now');
  assert.equal(nextAllowedVoteTime(1000, 3300), 4300);
});

test('plannedVote applies delay and clamps weight', () => {
  assert.deepEqual(plannedVote({ eventTimeMs: 1000, delayMs: 5000, weight: 12000 }), {
    fireAt: 6000,
    weight: 10000,
  });
});
