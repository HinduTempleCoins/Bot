/**
 * Tests for tutorial/composer.js. Uses node's built-in test runner.
 *
 *   node --test tutorial/composer.test.js
 *
 * Or via the npm script:
 *
 *   npm test
 *
 * Fully offline: composeResponse is a pure deterministic function. It reads
 * the checked-in tutorial/stages.json via loadStages() (a static file in this
 * dir — no network, no keys, no clock). Nothing here touches a chain, an LLM,
 * or any private key; the same evidence + account always yields the same body.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { composeResponse } from './composer.js';

// A user post / comment shaped like detector.js evidence.
const post = (account, over = {}) => ({
  author: account,
  permlink: 'my-intro-post',
  title: 'Hello MELEK',
  body: 'x'.repeat(300),
  ...over,
});

// ---- happy path: every stage with witness_response produces a payload ------

test('intro_post: comment_and_upvote with quoted title and upvote on the post', () => {
  const out = composeResponse({
    stageKey: 'intro_post',
    account: 'alice',
    evidence: post('alice'),
  });
  assert.equal(out.action, 'comment_and_upvote');
  assert.equal(out.comment.parentAuthor, 'alice');
  assert.equal(out.comment.parentPermlink, 'my-intro-post');
  // body addresses the user and weaves the title in
  assert.match(out.comment.body, /@alice/);
  assert.match(out.comment.body, /Hello MELEK/);
  // reply permlink is sanitized to [a-z0-9-]
  assert.match(out.comment.permlink, /^[a-z0-9-]+$/);
  assert.ok(out.comment.permlink.length <= 255);
  // upvote targets the same post at the stage weight
  assert.deepEqual(out.upvote, {
    author: 'alice',
    permlink: 'my-intro-post',
    weight: 10000,
  });
  assert.equal(out.transfer, undefined);
  assert.equal(out.stage.key, 'intro_post');
});

test('engage_three_posts: comment array evidence replies on the last comment', () => {
  const comments = [
    { author: 'bob', parent_author: 'carol', parent_permlink: 'p1', permlink: 'c1', body: 'real reply one' },
    { author: 'bob', parent_author: 'dave', parent_permlink: 'p2', permlink: 'c2', body: 'real reply two' },
    { author: 'bob', parent_author: 'erin', parent_permlink: 'p3', permlink: 'c3', body: 'real reply three' },
  ];
  const out = composeResponse({
    stageKey: 'engage_three_posts',
    account: 'bob',
    evidence: comments,
  });
  assert.equal(out.action, 'comment_and_upvote');
  // replies on the most-recent comment authored by the user
  assert.equal(out.comment.parentAuthor, 'bob');
  assert.equal(out.comment.parentPermlink, 'c3');
  // author list is woven from the distinct parent authors
  assert.match(out.comment.body, /@carol/);
  assert.match(out.comment.body, /@erin/);
  assert.deepEqual(out.upvote, { author: 'bob', permlink: 'c3', weight: 10000 });
});

test('share_what_you_know: comment_and_upvote on the shared post', () => {
  const out = composeResponse({
    stageKey: 'share_what_you_know',
    account: 'fred',
    evidence: post('fred', { permlink: 'how-to-thing', title: 'How To Thing' }),
  });
  assert.equal(out.action, 'comment_and_upvote');
  assert.equal(out.comment.parentPermlink, 'how-to-thing');
  assert.match(out.comment.body, /How To Thing/);
  assert.deepEqual(out.upvote, { author: 'fred', permlink: 'how-to-thing', weight: 10000 });
});

test('first_organic_upvote: comment_and_transfer carries the configured amount/memo', () => {
  const out = composeResponse({
    stageKey: 'first_organic_upvote',
    account: 'gail',
    evidence: { voter: 'helen', weight: 5000, time: '2026-06-01T00:00:00' },
    permlinkHint: { author: 'gail', permlink: 'gails-work' },
  });
  assert.equal(out.action, 'comment_and_transfer');
  assert.equal(out.upvote, undefined);
  assert.deepEqual(out.transfer, {
    to: 'gail',
    amount: '1.000 MELEK',
    memo: 'First organic upvote — welcome to the readership.',
  });
  // the voter who lifted the work is named in the body
  assert.match(out.comment.body, /@helen/);
  // reply target came from the hint (vote evidence is not a post)
  assert.equal(out.comment.parentAuthor, 'gail');
  assert.equal(out.comment.parentPermlink, 'gails-work');
});

test('power_up: comment_and_upvote, amount woven in, no transfer', () => {
  const out = composeResponse({
    stageKey: 'power_up',
    account: 'ivan',
    evidence: { amount: '5.000 MELEK' },
    permlinkHint: { author: 'ivan', permlink: 'recent' },
  });
  assert.equal(out.action, 'comment_and_upvote');
  assert.match(out.comment.body, /5\.000 MELEK/);
  assert.equal(out.transfer, undefined);
});

test('vote_for_a_witness: comment_and_upvote, witness named, no upvote target', () => {
  // evidence is a witness-vote object (not a post) and no hint → fallback
  // reply target (empty author, stage key as permlink) and no upvote.
  const out = composeResponse({
    stageKey: 'vote_for_a_witness',
    account: 'jane',
    evidence: { witness: 'hathor' },
  });
  assert.equal(out.action, 'comment_and_upvote');
  assert.match(out.comment.body, /@hathor/);
  // no post-shaped evidence and no hint → no upvote target
  assert.equal(out.upvote, undefined);
  // fallback reply target
  assert.equal(out.comment.parentAuthor, '');
  assert.equal(out.comment.parentPermlink, 'vote_for_a_witness');
});

// ---- determinism ------------------------------------------------------------

test('same account + stage yields identical body (deterministic variant pick)', () => {
  const args = { stageKey: 'intro_post', account: 'kate', evidence: post('kate') };
  const a = composeResponse(args);
  const b = composeResponse(args);
  assert.equal(a.comment.body, b.comment.body);
  assert.equal(a.comment.permlink, b.comment.permlink);
});

test('different accounts can select different variants over the pool', () => {
  // Across many accounts the picker should produce more than one distinct body
  // (it indexes into a 3-variant pool by a sha256 of account::stageKey).
  const bodies = new Set();
  for (const account of ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j']) {
    const out = composeResponse({ stageKey: 'intro_post', account, evidence: post(account) });
    bodies.add(out.comment.body);
  }
  assert.ok(bodies.size > 1, 'expected variant spread across accounts');
});

// ---- edge cases: missing/empty evidence details degrade, do not throw ------

test('missing title: no quoted-title snippet, still composes', () => {
  const out = composeResponse({
    stageKey: 'intro_post',
    account: 'liam',
    evidence: post('liam', { title: undefined }),
  });
  assert.match(out.comment.body, /@liam/);
  assert.doesNotMatch(out.comment.body, / — "/); // quoteTitle yields nothing
});

test('empty evidence object: still composes via fallback reply target', () => {
  const out = composeResponse({
    stageKey: 'intro_post',
    account: 'mia',
    evidence: {},
  });
  assert.equal(out.action, 'comment_and_upvote');
  assert.match(out.comment.body, /@mia/);
  // no usable post evidence → fallback reply target, no upvote target
  assert.equal(out.comment.parentAuthor, '');
  assert.equal(out.comment.parentPermlink, 'intro_post');
  assert.equal(out.upvote, undefined);
});

test('null evidence: helpers default cleanly, no throw', () => {
  const out = composeResponse({
    stageKey: 'first_organic_upvote',
    account: 'nora',
    evidence: null,
  });
  assert.equal(out.action, 'comment_and_transfer');
  // voter unknown → "someone"/"a reader" default phrasing
  assert.match(out.comment.body, /@someone|@a reader|@nora/);
  assert.equal(out.transfer.to, 'nora');
});

test('empty comment array: composes, no author list, fallback target', () => {
  const out = composeResponse({
    stageKey: 'engage_three_posts',
    account: 'omar',
    evidence: [],
  });
  assert.equal(out.action, 'comment_and_upvote');
  assert.match(out.comment.body, /@omar/);
  assert.equal(out.comment.parentPermlink, 'engage_three_posts');
});

test('evidence author mismatch: not treated as the user post (fallback target)', () => {
  // A post authored by someone else must not become the reply/upvote target.
  const out = composeResponse({
    stageKey: 'intro_post',
    account: 'pat',
    evidence: post('someone-else'),
  });
  assert.equal(out.comment.parentAuthor, '');
  assert.equal(out.comment.parentPermlink, 'intro_post');
  assert.equal(out.upvote, undefined);
});

test('permlinkHint is used only when evidence is not a usable post', () => {
  // evidence IS the user's post → that wins over the hint.
  const out = composeResponse({
    stageKey: 'intro_post',
    account: 'quinn',
    evidence: post('quinn', { permlink: 'real-post' }),
    permlinkHint: { author: 'quinn', permlink: 'hint-post' },
  });
  assert.equal(out.comment.parentPermlink, 'real-post');
});

// ---- error paths: invalid args throw with a clear message ------------------

test('missing account throws', () => {
  assert.throws(
    () => composeResponse({ stageKey: 'intro_post', account: '', evidence: post('x') }),
    /account required/,
  );
});

test('unknown stage key throws', () => {
  assert.throws(
    () => composeResponse({ stageKey: 'no_such_stage', account: 'rita', evidence: {} }),
    /unknown stage/,
  );
});

test('known stage with no template pool throws (set_profile has no TEMPLATES entry)', () => {
  assert.throws(
    () => composeResponse({ stageKey: 'set_profile', account: 'sam', evidence: {} }),
    /no template pool/,
  );
});

// ---- permlink sanitization --------------------------------------------------

test('reply permlink sanitizes uppercase and odd chars and is bounded', () => {
  const out = composeResponse({
    stageKey: 'intro_post',
    account: 'Tina_With_Caps',
    evidence: post('Tina_With_Caps', { permlink: 'Weird/Permlink!!' }),
  });
  assert.match(out.comment.permlink, /^[a-z0-9-]+$/);
  assert.ok(out.comment.permlink.length <= 255);
});
