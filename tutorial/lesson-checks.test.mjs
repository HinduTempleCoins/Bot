// lesson-checks.test.mjs — OFFLINE. Every lesson check kind in detector.js runLessonCheck(): pass with
// votable evidence, fail naming exactly what is missing, and not_checkable (never a fail).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runLessonCheck, LESSON_CHECK_KINDS, urlsIn } from './detector.js';
import { KIND_COVERAGE } from './chain-reader.mjs';

const post = (o) => ({ author: 'alice', permlink: 'p1', title: 'Hi', body: 'x'.repeat(250), tags: ['introduceyourself'], ...o });

test('every lesson kind the series needs exists, and the reader documents its coverage', () => {
  for (const k of ['account_exists', 'post_authored', 'post_with_tag', 'post_contains_link', 'comment_on', 'transfer_to_vesting',
    'witness_vote_cast', 'profile_set', 'follows_created', 'manual_review']) {
    assert.ok(LESSON_CHECK_KINDS.includes(k), k);
    assert.ok(KIND_COVERAGE[k], `coverage for ${k}`);
  }
});

test('account_exists: passes for a commenter, fails only when the chain says the account is absent', () => {
  assert.equal(runLessonCheck({ kind: 'account_exists' }, { account_exists: true }, { account: 'alice' }).status, 'pass');
  assert.equal(runLessonCheck({ kind: 'account_exists' }, { account_exists: null }, { account: 'alice' }).status, 'pass');
  assert.equal(runLessonCheck({ kind: 'account_exists' }, { account_exists: false }, { account: 'alice' }).status, 'fail');
});

test('post_with_tag: tag, length and image requirements; missing names the exact gap', () => {
  const check = { kind: 'post_with_tag', params: { tag_any_of: ['introduceyourself', 'introduction'], min_body_chars: 200 } };
  const ok = runLessonCheck(check, { posts: [post()] });
  assert.equal(ok.status, 'pass');
  assert.equal(ok.evidence.permlink, 'p1');

  const none = runLessonCheck(check, { posts: [] });
  assert.match(none.missing[0], /post of your own/);
  const untagged = runLessonCheck(check, { posts: [post({ tags: ['life'] })] });
  assert.match(untagged.missing[0], /#introduceyourself or #introduction/);
  const short = runLessonCheck(check, { posts: [post({ body: 'short' })] });
  assert.match(short.missing[0], /at least 200 characters .*longest I found has 5/);

  const img = { kind: 'post_with_tag', params: { tag_any_of: ['hathor-edit'], require_image: true } };
  assert.equal(runLessonCheck(img, { posts: [post({ tags: ['hathor-edit'], body: 'no pic here' })] }).status, 'fail');
  assert.equal(runLessonCheck(img, { posts: [post({ tags: ['hathor-edit'], body: 'see ![x](https://a.b/c.png)' })] }).status, 'pass');
  assert.equal(runLessonCheck(img, { posts: [post({ tags: ['hathor-edit'], body: 'meta only', json_metadata: '{"image":["https://a/b.jpg"]}' })] }).status, 'pass');
});

test('post_authored reuses the tag/length logic', () => {
  assert.equal(runLessonCheck({ kind: 'post_authored', params: { tag_any_of: ['introduceyourself'], min_body_chars: 200 } }, { posts: [post()] }).status, 'pass');
});

test('post_contains_link: domain + path prefix + optional tag; subdomains count; other hosts do not', () => {
  const check = { kind: 'post_contains_link', params: { domain: 'hathor.soapbox.community', path_prefix_any_of: ['/img/', '/p/'], min_count: 1 } };
  const withImg = post({ body: 'Look ![me](https://hathor.soapbox.community/img/17903-abc.png) nice' });
  assert.equal(runLessonCheck(check, { posts: [withImg] }).status, 'pass');
  const wrongPath = post({ body: 'https://hathor.soapbox.community/templates' });
  const r = runLessonCheck(check, { posts: [wrongPath] });
  assert.equal(r.status, 'fail');
  assert.match(r.missing[0], /hathor\.soapbox\.community.*\/img\/ or \/p\//);
  assert.equal(runLessonCheck(check, { posts: [post({ body: 'https://evil.example/img/hathor.soapbox.community.png' })] }).status, 'fail');

  const tagged = { kind: 'post_contains_link', params: { ...check.params, tag_any_of: ['reference-studio'] } };
  const noTag = runLessonCheck(tagged, { posts: [withImg] });
  assert.equal(noTag.status, 'fail');
  assert.match(noTag.missing[0], /#reference-studio/);
  assert.equal(runLessonCheck(tagged, { posts: [{ ...withImg, tags: ['reference-studio'] }] }).status, 'pass');

  const inComments = { kind: 'post_contains_link', params: { domain: 'melek.salon', in: 'comments' } };
  assert.equal(runLessonCheck(inComments, { comments: [{ author: 'alice', permlink: 'c', parent_author: 'bob', body: 'see https://melek.salon/@bob' }] }).status, 'pass');
});

test('urlsIn strips trailing punctuation and markdown', () => {
  const u = urlsIn('see (https://a.example/x/y). and [z](https://b.example/p/1)');
  assert.deepEqual(u.map((x) => x.href), ['https://a.example/x/y', 'https://b.example/p/1']);
});

test('comment_on: author (+ optional permlink, min length)', () => {
  const check = { kind: 'comment_on', params: { author: 'melek', min_body_chars: 20 } };
  const c = { author: 'alice', permlink: 're-1', parent_author: 'melek', parent_permlink: 'post', body: 'a thoughtful reply here, yes' };
  assert.equal(runLessonCheck(check, { comments: [c] }).status, 'pass');
  assert.equal(runLessonCheck(check, { comments: [{ ...c, body: 'short' }] }).status, 'fail');
  const exact = { kind: 'comment_on', params: { author: '@Melek', permlink: 'other' } };
  const r = runLessonCheck(exact, { comments: [c] });
  assert.equal(r.status, 'fail');
  assert.match(r.missing[0], /@melek's post "other"/);
});

test('chain-state kinds: power-up, witness vote, profile, follows', () => {
  assert.equal(runLessonCheck({ kind: 'transfer_to_vesting', params: { min_amount_melek: '0.001' } }, { transfers_to_vesting: [{ amount: '1.000 MELEK' }] }).status, 'pass');
  assert.match(runLessonCheck({ kind: 'transfer_to_vesting', params: {} }, {}).missing[0], /power-up/);
  assert.equal(runLessonCheck({ kind: 'witness_vote_cast', params: { min_count: 1 } }, { witness_votes: [{ witness: 'hathor', approve: true }] }).status, 'pass');
  assert.match(runLessonCheck({ kind: 'witness_vote_cast', params: {} }, { witness_votes: [{ witness: 'x', approve: false }] }).missing[0], /you have 0/);
  assert.equal(runLessonCheck({ kind: 'profile_set', params: { require_fields_any_of: ['name'] } }, { profile: { name: 'Al' } }).status, 'pass');
  assert.equal(runLessonCheck({ kind: 'profile_set', params: {} }, { profile: null }).status, 'fail');
  const follow = { kind: 'follows_created', params: { min_distinct_followed: 1, must_include: ['hathor'], exclude_self: true } };
  assert.equal(runLessonCheck(follow, { follows: [{ following: 'hathor' }] }, { account: 'alice' }).status, 'pass');
  const r = runLessonCheck(follow, { follows: [{ following: 'bob' }, { following: 'alice' }] }, { account: 'alice' });
  assert.equal(r.status, 'fail');
  assert.match(r.missing[0], /@hathor/);
});

test('manual_review and unknown kinds are not_checkable — never a fail', () => {
  const m = runLessonCheck({ kind: 'manual_review', params: { what: 'which app' } }, {});
  assert.equal(m.status, 'not_checkable');
  assert.match(m.reason, /which app/);
  assert.equal(runLessonCheck({ kind: 'prana_tx_seen' }, {}).status, 'not_checkable');
  assert.equal(runLessonCheck(null, null).status, 'not_checkable');
});
