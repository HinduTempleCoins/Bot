/**
 * false-positive.test.js — Cheetah's must-NOT-flag guards (task #10c).
 *
 * The Ashurbanipal lesson (MEMORY): verdicts are fallible; expect false
 * positives; flag, never edit. Cheetah is flag-conservative by design — it
 * would rather miss a thief than credit-comment on an innocent post. These
 * tests lock the cases that must NOT produce a crediting "this also appears
 * here" comment, so a future threshold/guard change can't silently turn
 * Cheetah back into the old punitive tripwire.
 *
 * Offline only: every case is corpus/fixture-based, no network, so this file
 * is safe in the `npm test` glob. (The live cross-platform theft check is the
 * separate runnable script cheetah/xplatform-theft.mjs, which hits the chain.)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { detectText } from './text-detection.js';
import { scanPost } from './index.js';
import { addWhitelist } from './store.js';

// A fresh isolated shared-store root per test that touches the store, so
// whitelist/blacklist state never leaks between cases or other suites.
function tmpStore() {
  return mkdtempSync(join(tmpdir(), 'cheetah-fp-'));
}

// "crediting-comment" is the only intent that publicly names another source
// as overlapping the author's post — the thing we must not do to an innocent.
function isFlag(res) {
  return res.intent === 'crediting-comment';
}

// --- 1. genuinely original content, no corpus match -------------------------

test('NO FLAG: original content sharing no n-grams with the corpus', async () => {
  const corpus = [
    { author: 'a', permlink: 'p1', body: 'Graphene-family chains rely on delegated proof-of-stake witness scheduling.' },
  ];
  const post = {
    author: 'newbie',
    permlink: 'my-first-post',
    body: 'I planted tomatoes and basil on my balcony this weekend and the bees showed up by afternoon.',
  };
  const det = await detectText(post.body, { corpus });
  assert.equal(det.match, false, 'original text must not match');
  const res = await scanPost(post, { dryRun: true, corpus, storeRoot: tmpStore() });
  assert.equal(isFlag(res), false);
});

// --- 2. short, generic phrasing that coincidentally overlaps ----------------
// A common opener ("Thanks for reading, and please follow for more!") will
// appear on many posts. It must stay BELOW threshold so Cheetah doesn't flag
// every post that ends with a boilerplate sign-off.

test('NO FLAG: short generic boilerplate sign-off shared with another post', async () => {
  const corpus = [
    { author: 'a', permlink: 'p1', body: 'Here is my deep analysis of the harvest cycle and crop rotation over five seasons of careful record keeping. ' + 'Thanks for reading and please follow for more.' },
  ];
  const post = {
    author: 'b',
    permlink: 'p2',
    body: 'A totally different essay about the migration patterns of arctic terns across two hemispheres each year. ' + 'Thanks for reading and please follow for more.',
  };
  const det = await detectText(post.body, { corpus });
  assert.equal(det.match, false, 'only the boilerplate overlaps — must stay below 0.5 Jaccard');
});

// --- 3. quoting a short snippet of another post -----------------------------
// Fair-use-sized quotation embedded in otherwise-original writing must not
// trip the copy threshold (the whole point of credit-first vs. accusation).

test('NO FLAG: a one-sentence quote inside otherwise-original writing', async () => {
  const source = 'The witness slot is elected by stake-weighted voting and produces blocks in a round-robin schedule.';
  const corpus = [{ author: 'orig', permlink: 'p1', body: source }];
  const post = {
    author: 'commentator',
    permlink: 'my-analysis',
    body: 'I have been studying how new chains bootstrap their validator sets. As one explainer put it, "' + source + '" ' +
      'But what fascinates me is the economics underneath: why anyone stakes at all, how reward curves shape participation, ' +
      'and what happens to security when token price falls faster than issuance. None of the standard write-ups address that gap, ' +
      'so here is my own attempt at a model, built from first principles and a few weekends of spreadsheet wrangling.',
  };
  const det = await detectText(post.body, { corpus });
  assert.equal(det.match, false, 'a short embedded quote must not cross the copy threshold');
});

// --- 4. empty / whitespace-only post ----------------------------------------

test('NO FLAG: empty post body', async () => {
  const corpus = [{ author: 'a', permlink: 'p1', body: 'some real content here about gardening and bees and tomatoes' }];
  const det = await detectText('', { corpus });
  assert.equal(det.match, false);
  const res = await scanPost({ author: 'x', permlink: 'empty', body: '   ' }, { dryRun: true, corpus, storeRoot: tmpStore() });
  assert.equal(isFlag(res), false);
});

// --- 5. self-quotation: author proved authorship → whitelist suppresses -----
// Even on a true 100% text match, an author who has proven they wrote the
// material (cross-posting their own work) must not be flagged.

test('NO FLAG: whitelisted author re-posting their own proven material', async () => {
  const storeRoot = tmpStore();
  const body = 'This is my own DevTome chapter on temple acoustics, originally written by me and cross-posted here verbatim with the same words throughout the whole thing.';
  await addWhitelist({
    account: 'author-vankush',
    material: null,
    reason: 'proved authorship — same text on their verified blog, predates this post',
    evidence: 'https://example.org/original-by-author',
    addedBy: 'hathor-resolution',
  }, storeRoot);

  // The text genuinely matches (it IS their own words appearing in the corpus)...
  const corpus = [{ author: 'mirror', permlink: 'p1', url: 'https://example.org/original-by-author', body }];
  const det = await detectText(body, { corpus });
  assert.equal(det.match, true, 'text match is real — the guard is the whitelist, not the matcher');

  // ...but the whitelist must suppress the crediting comment.
  const res = await scanPost({ author: 'author-vankush', permlink: 'p2', body }, { dryRun: true, corpus, storeRoot });
  assert.equal(isFlag(res), false);
  assert.equal(res.skipped, 'author-whitelisted');
});

// --- 6. flag-conservative threshold sanity ----------------------------------
// Borderline overlap (some shared phrasing, lots of original) must land below
// threshold. Prefer missing a thief over flagging an innocent.

test('NO FLAG: partial overlap below the copy threshold stays unflagged', async () => {
  const original = 'Delegated proof of stake elects a fixed set of block producers who take turns signing blocks in a deterministic round-robin order each round.';
  const post = {
    author: 'student',
    permlink: 'notes',
    body: 'Delegated proof of stake elects block producers. ' +
      'In my own words: it is a popularity contest weighted by money, which has obvious failure modes around plutocracy, ' +
      'voter apathy, and the long-tail of small holders who never delegate. I want to explore each of those with real numbers ' +
      'from three different chains and a back-of-envelope simulation of a stake-concentration attack over a six month horizon.',
  };
  const det = await detectText(post.body, { corpus: [{ author: 'orig', permlink: 'p1', body: original }] });
  assert.equal(det.match, false, 'a paraphrase that reuses a few words must not be flagged as a copy');
});

// --- 7. the positive control: a real verbatim copy STILL flags --------------
// Guards must not be so loose that Cheetah goes blind. A full verbatim copy of
// a non-whitelisted author's work must still produce the crediting comment.

test('CONTROL: a verbatim copy of a non-whitelisted source still flags', async () => {
  const body = 'Graphene-family chains rely on delegated proof-of-stake. The witness slot is elected by stake-weighted voting and produces blocks in a round-robin schedule, one producer per slot in a fixed rotation.';
  const corpus = [{ author: 'steem:punicwax', permlink: 'p1', url: 'https://steemit.com/@punicwax/p1', body }];
  const det = await detectText(body, { corpus });
  assert.equal(det.match, true);
  const res = await scanPost({ author: 'thief', permlink: 'copy', body }, { dryRun: true, corpus, storeRoot: tmpStore() });
  assert.equal(isFlag(res), true, 'the engine must still catch a genuine verbatim copy');
  assert.match(res.comment, /steemit\.com/, 'the credited source URL must be plumbed into the note');
});
