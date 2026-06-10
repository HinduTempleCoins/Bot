/**
 * policing-scenarios.test.mjs — the consolidated, repeatable OFFLINE harness
 * that drives Cheetah's REAL detection/compose/scan functions through the
 * realistic policing scenarios we proved live on the testnet today.
 *
 * This is the offline twin of the live policing loop (a thief posts a copy;
 * @cheetahbot replies on-chain). NOTHING here touches a chain or the network:
 *   - text/discovery run on an injected in-memory corpus (no chain RPC).
 *   - the image path runs through perceptual-hash with an injected decoder +
 *     fetch (no jimp decode of real bytes, no HTTP) and a temp hash store.
 *   - the store (whitelist/blacklist/findings) is rooted in a per-test tmpdir
 *     so state never leaks between cases or other suites.
 *   - scanPost is always called with dryRun:true, so the broadcast branch is
 *     never reached (it would require Hathor chain config + posting auth, which
 *     this repo deliberately does not hold — the live variant runs on the host).
 *
 * It reuses the SAME functions the bot runs — scanPost / detectText / discover /
 * relatedInCorpus / scanPostImages / composeImageCreditNote / the perceptual-hash
 * primitives — so a regression in detection or in the credit-first tone fails
 * here before it ever reaches the chain. No detection logic is reimplemented.
 *
 * Scenarios (mirror the live proof + the must-not-flag guards):
 *   (a) verbatim plagiarism      -> MATCH + a credit note composed
 *   (b) original text            -> ORIGINAL / no note
 *   (c) related prior work       -> SEE-ALSO (discovery) note
 *   (d) duplicate image          -> image-credit note (small Hamming)
 *   (e) distinct image           -> no note (large Hamming)
 *   (f) whitelisted own re-post  -> skipped (author-whitelisted)
 *   (g) frequency cap            -> second post on the same author is skipped
 *
 * Plus a tone gate: every composed note is credit-first (contains a crediting
 * phrase, never an accusatory word). This is the load-bearing POLICY.md /
 * CHEETAH_ADVANCED.md invariant — Cheetah states facts, never accuses.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { scanPost, __recordComment, __resetCap } from './index.js';
import { detectText } from './text-detection.js';
import { discover, relatedInCorpus } from './discovery.js';
import { addWhitelist } from './store.js';
import { scanPostImages } from './image-scan.js';
import { composeImageCreditNote, composeCreditingNote, composeDiscoveryNote } from './compose.js';
import {
  dHashFromGray, hammingDistance, indexImage, findOriginal,
  __setDecoder, __setFetch, HAMMING_MATCH_MAX,
} from './perceptual-hash.js';

// ---- helpers ---------------------------------------------------------------

// A fresh isolated shared-store root per test that touches the store, so
// whitelist/blacklist/findings state never leaks between cases or suites.
function tmpStore() {
  return mkdtempSync(join(tmpdir(), 'cheetah-pol-'));
}
function tmpHashStore(tag) {
  return join(mkdtempSync(join(tmpdir(), 'cheetah-img-')), `${tag}.json`);
}

// esc() — house rule: escape any value that lands in user-facing text. Here we
// only use it to sanity-check that composed notes never carry raw HTML; the
// notes themselves are markdown built by compose.js.
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

// Credit-first tone gate. A Cheetah note is acceptable iff it leads with credit
// ("credit" / "also appears" / "connection, not a claim" / "source") and never
// uses the accusatory vocabulary the old punitive Cheetah used.
const CREDIT_PHRASES = [
  /credit/i,
  /also appears/i,
  /also appear/i,
  /connection, not a claim/i,
  /a connection, not a claim/i,
  /source/i,
  /cross-reference/i,
  /related/i,
  /connects to/i,
];
const ACCUSATORY = /\b(stole|stolen|thief|theft|plagiari[sz]|banned|ban\b|cheater|fraud|guilty)\b/i;

function assertCreditFirst(note, label) {
  assert.ok(note && note.length > 0, `${label}: a note must be composed`);
  assert.ok(
    CREDIT_PHRASES.some((re) => re.test(note)),
    `${label}: note must contain a credit-first phrase — got: ${note.slice(0, 120)}`
  );
  assert.ok(
    !ACCUSATORY.test(note),
    `${label}: note must not contain accusatory language — got: ${note.slice(0, 160)}`
  );
  // self-ID footer must be present (Reddit-bot norm — every comment identifies itself)
  assert.match(note, /Cheetah/, `${label}: note must self-identify as Cheetah`);
}

// A 9x8 gray gradient -> all dHash bits 0. Used to mint deterministic image
// "bytes" without jimp/network. Flipping the top-left nibble gives a near twin
// (small Hamming) or a wildly different image (large Hamming) on demand.
function gradient(w = 9, h = 8) {
  const g = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = x * 20;
  return g;
}
// A descending gradient -> all bits 1 -> Hamming 64 from the ascending one.
function inverseGradient(w = 9, h = 8) {
  const g = new Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) g[y * w + x] = (w - 1 - x) * 20;
  return g;
}

// A small shared corpus standing in for prior on-chain posts.
const SOURCE_BODY =
  'Graphene-family chains rely on delegated proof-of-stake. The witness slot is ' +
  'elected by stake-weighted voting and produces blocks in a round-robin schedule, ' +
  'one producer per slot in a fixed rotation each round.';

const ORIGINAL_AUTHOR = { author: 'punicwax', permlink: 'dpos-explainer',
  url: 'https://steemit.com/@punicwax/dpos-explainer', body: SOURCE_BODY };

// ===========================================================================
// (a) verbatim plagiarism -> MATCH + credit note composed
// ===========================================================================

test('(a) verbatim plagiarism: MATCH + a credit-first note is composed', async () => {
  const storeRoot = tmpStore();
  const corpus = [ORIGINAL_AUTHOR];
  __resetCap();

  // detection sees the copy...
  const det = await detectText(SOURCE_BODY, { corpus });
  assert.equal(det.match, true, 'a verbatim copy must match');
  assert.ok(det.confidence >= 0.5, 'confidence at/above the similarity threshold');

  // ...and scanPost (dry-run) composes the crediting comment, intent = crediting-comment.
  const res = await scanPost(
    { author: 'thief', permlink: 'copied-it', body: SOURCE_BODY },
    { dryRun: true, corpus, storeRoot }
  );
  assert.equal(res.intent, 'crediting-comment', 'the copy path produces a crediting comment');
  assert.equal(res.source.author, 'punicwax', 'the credited source author is plumbed through');
  assert.match(res.comment, /steemit\.com/, 'the source URL is in the note');
  assertCreditFirst(res.comment, '(a) crediting note');

  await rm(storeRoot, { recursive: true, force: true });
});

// ===========================================================================
// (b) original text -> ORIGINAL / no note
// ===========================================================================

test('(b) original text: no match, no note (scanPost skips no-match)', async () => {
  const storeRoot = tmpStore();
  const corpus = [ORIGINAL_AUTHOR];
  const post = {
    author: 'gardener',
    permlink: 'balcony-bees',
    body: 'I planted tomatoes and basil on my balcony this weekend and the bees showed up by afternoon. ' +
      'Next year I want to add lavender and a small water dish for them, and maybe track which days they visit most.',
  };

  const det = await detectText(post.body, { corpus });
  assert.equal(det.match, false, 'unrelated original text must not match');

  const res = await scanPost(post, { dryRun: true, corpus, storeRoot });
  assert.equal(res.intent, undefined, 'no comment intent for original content');
  assert.equal(res.skipped, 'no-match', 'scanPost reports no-match for original, unrelated text');

  await rm(storeRoot, { recursive: true, force: true });
});

// ===========================================================================
// (c) related prior work -> SEE-ALSO (discovery) note
// ===========================================================================

test('(c) related prior work: a discovery "see also" note, not a copy flag', async () => {
  const storeRoot = tmpStore();
  // Two posts on the SAME topic in DIFFERENT words: shares vocabulary (related
  // band) but is well below the copy threshold.
  const prior = {
    author: 'scholar',
    permlink: 'why-stake',
    body: 'Delegated proof of stake elects block producers who take turns signing blocks. ' +
      'Reward curves shape participation. Token price relative to issuance drives network security. ' +
      'Plutocracy and voter apathy are the main failure modes of the system.',
  };
  const post = {
    author: 'student',
    permlink: 'my-stake-notes',
    body: 'Delegated proof of stake elects block producers, and reward curves shape participation ' +
      'in the system. Token price relative to issuance drives network security over time. The failure ' +
      'modes I worry about most are plutocracy and voter apathy among the long tail of small holders ' +
      'who never vote at all.',
  };
  const corpus = [prior];

  // not a copy
  const det = await detectText(post.body, { corpus });
  assert.equal(det.match, false, 'paraphrase on the same topic is not a copy');

  // but it IS related -> discover() returns it
  const { related } = discover(post, { corpus });
  assert.ok(related.length >= 1, 'related prior work is found in the relatedness band');
  assert.equal(related[0].author, 'scholar');

  // scanPost (dry-run) takes the discovery branch
  const res = await scanPost(post, { dryRun: true, corpus, storeRoot });
  assert.equal(res.intent, 'discovery-comment', 'related-but-not-copy yields a discovery comment');
  assertCreditFirst(res.comment, '(c) discovery note');

  await rm(storeRoot, { recursive: true, force: true });
});

// ===========================================================================
// (d) duplicate image (small Hamming) -> image-credit note
// ===========================================================================

test('(d) duplicate image: earliest poster credited, image-credit note is credit-first', async () => {
  const hashStorePath = tmpHashStore('dup');

  // Inject a decoder so the same URL always yields the same gray matrix, and a
  // fetch that returns dummy bytes (decoder ignores them). No jimp, no network.
  __setDecoder((/* buf, size */) => ({ gray: gradient(), w: 9, h: 8 }));
  __setFetch(async () => ({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer }));

  try {
    // alice posted the image FIRST (earlier timestamp).
    const firstHash = dHashFromGray(gradient());
    await indexImage({ hash: firstHash, author: 'alice', permlink: 'orig-art', seenAt: '2026-01-01T00:00:00Z' }, hashStorePath);

    // bob re-posts the SAME image later -> scanPostImages finds alice as the credit.
    const bobPost = {
      author: 'bob',
      permlink: 'repost',
      created: '2026-03-01T00:00:00Z',
      body: 'Check out this great picture ![art](https://img.example/art.png)',
    };
    const scan = await scanPostImages(bobPost, { hashStorePath, noIndex: true });
    assert.equal(scan.imageCount, 1, 'one image extracted from the post');
    assert.equal(scan.findings.length, 1, 'a prior appearance (credit) is found');
    assert.equal(scan.findings[0].source.author, 'alice', 'earliest poster (alice) is who credit is due');

    // The composed image-credit note must be credit-first.
    const f = scan.findings[0];
    const note = composeImageCreditNote(
      { match: true, source: f.source, confidence: f.confidence },
      `${bobPost.author}-${bobPost.permlink}-img`
    );
    assertCreditFirst(note, '(d) image-credit note');
    assert.match(note, /@alice\/orig-art/, 'the original author/permlink is credited in the note');
  } finally {
    __setDecoder(null); __setFetch(null);
    await rm(hashStorePath, { force: true });
  }
});

// ===========================================================================
// (e) distinct image (large Hamming) -> no note
// ===========================================================================

test('(e) distinct image: large Hamming distance -> no credit, no note', async () => {
  const hashStorePath = tmpHashStore('distinct');
  try {
    // alice's image is the ascending gradient (all bits 0).
    const aliceHash = dHashFromGray(gradient());
    await indexImage({ hash: aliceHash, author: 'alice', permlink: 'orig', seenAt: '2026-01-01T00:00:00Z' }, hashStorePath);

    // carol's image is the inverse gradient (all bits 1) -> Hamming 64, way beyond max.
    const carolHash = dHashFromGray(inverseGradient());
    assert.equal(hammingDistance(aliceHash, carolHash), 64, 'the two images are maximally different');
    assert.ok(64 > HAMMING_MATCH_MAX, 'distance is beyond the match threshold');

    const credit = await findOriginal(carolHash, { maxDistance: HAMMING_MATCH_MAX }, hashStorePath);
    assert.equal(credit, null, 'a distinct image gets no prior-match -> it may itself be original');
  } finally {
    await rm(hashStorePath, { force: true });
  }
});

// ===========================================================================
// (f) whitelisted / own re-post -> skipped
// ===========================================================================

test('(f) whitelisted own re-post: a true text match is suppressed (author-whitelisted)', async () => {
  const storeRoot = tmpStore();
  const body =
    'This is my own DevTome chapter on temple acoustics, originally written by me and cross-posted ' +
    'here verbatim with the same words throughout the whole chapter from start to finish, unchanged.';

  // The author proved authorship -> Hathor's resolution added a whitelist entry.
  await addWhitelist({
    account: 'author-vankush',
    material: null,
    reason: 'proved authorship — same text on their verified blog, predates this post',
    evidence: 'https://example.org/original-by-author',
    addedBy: 'hathor-resolution',
  }, storeRoot);

  // The text genuinely matches (it IS their own words mirrored in the corpus)...
  const corpus = [{ author: 'mirror', permlink: 'p1', url: 'https://example.org/original-by-author', body }];
  const det = await detectText(body, { corpus });
  assert.equal(det.match, true, 'the match is real — the guard is the whitelist, not the matcher');

  // ...but scanPost suppresses the crediting comment.
  const res = await scanPost(
    { author: 'author-vankush', permlink: 'cross-post', body },
    { dryRun: true, corpus, storeRoot }
  );
  assert.equal(res.skipped, 'author-whitelisted', 'whitelist suppresses the note');
  assert.equal(res.intent, undefined, 'no comment is composed for a whitelisted author');

  await rm(storeRoot, { recursive: true, force: true });
});

// ===========================================================================
// (g) frequency cap -> second post on the same author is skipped
// ===========================================================================

test('(g) frequency cap: once Cheetah has commented on an author, a second copy is skipped', async () => {
  const storeRoot = tmpStore();
  const corpus = [ORIGINAL_AUTHOR];
  __resetCap();

  // First copy by 'serialcopier' crosses threshold -> a crediting comment intent.
  const first = await scanPost(
    { author: 'serialcopier', permlink: 'copy-1', body: SOURCE_BODY },
    { dryRun: true, corpus, storeRoot }
  );
  assert.equal(first.intent, 'crediting-comment', 'the first copy is flagged');

  // Simulate that Cheetah commented on this author (what the live broadcast/
  // discovery branch does via recordComment after a successful on-chain reply).
  __recordComment('serialcopier');

  // A SECOND copy by the same author the same day must now be suppressed by the
  // frequency cap (default 1/author/day) — checked at the very top of scanPost.
  const second = await scanPost(
    { author: 'serialcopier', permlink: 'copy-2', body: SOURCE_BODY },
    { dryRun: true, corpus, storeRoot }
  );
  assert.equal(second.skipped, 'frequency-cap', 'the cap suppresses a second comment on the same author');
  assert.equal(second.intent, undefined, 'no second comment is composed');

  __resetCap();
  await rm(storeRoot, { recursive: true, force: true });
});

// A deterministic, dry-run-independent assertion of the frequency-cap value, so a
// config change that would let Cheetah spam an author fails here.
test('(g2) frequency cap default is 1 comment/author/day', async () => {
  const { FREQUENCY_CAP_PER_AUTHOR_DAY } = await import('./config.js');
  assert.equal(FREQUENCY_CAP_PER_AUTHOR_DAY, 1, 'default cap is one comment per author per day');
});

// ===========================================================================
// tone gate over every composer (belt-and-suspenders on the credit-first rule)
// ===========================================================================

test('tone: all three composers produce credit-first, non-accusatory notes', () => {
  const credit = composeCreditingNote(
    { match: true, source: { kind: 'on-chain', url: 'https://x/y', title: 'Y', author: 'orig', permlink: 'p' }, confidence: 0.9 },
    'seed-a'
  );
  assertCreditFirst(credit, 'crediting');

  const image = composeImageCreditNote(
    { match: true, source: { author: 'alice', permlink: 'orig' }, confidence: 0.95 },
    'seed-b'
  );
  assertCreditFirst(image, 'image-credit');

  const disc = composeDiscoveryNote(
    { related: [{ author: 'scholar', permlink: 'why-stake', url: '@scholar/why-stake' }] },
    'seed-c'
  );
  assertCreditFirst(disc, 'discovery');

  // esc() sanity: no raw angle-bracket HTML leaks into a note.
  for (const [n, note] of [['credit', credit], ['image', image], ['disc', disc]]) {
    assert.equal(note.includes('<script'), false, `${n}: no raw HTML`);
    assert.equal(esc('<b>') , '&lt;b&gt;'); // esc itself behaves
  }
});
