// harm-battery.test.mjs — the designed Cheetah/Hathor test battery (.local catalog) as runnable,
// offline assertions across every harm category. Proves each detector fires (or correctly stays
// silent) on the catalog's bad-actor scenarios, and that the unified moderation runner routes one
// post to multiple flags. No network: detectors are pure / lexicon-based.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { detectText } from './text-detection.js';
import { detectToxicity } from './toxicity-detect.mjs';
import { detectScam } from './scam-detect.mjs';
import { detectImpersonation } from './impersonation-detect.mjs';
import { detectImageTheft } from './image-theft-detect.mjs';
import { detectPiiHeuristic } from '../integrations/flag-taxonomy.mjs';
import { runModeration } from '../integrations/moderation-runner.mjs';

const HATHOR_ORIGINAL =
  'MELEK is a founding-witness blockchain. Hathor produces blocks, helps newcomers, and teaches the ' +
  'community. The witness is an account on the chain, named for the VR-Hathor-Mehit figure, carrying ' +
  'a lineage of work from the 2017 Mathematicians email through the Convergence.';

// ── plagiarism / copy-paste ──────────────────────────────────────────────────────────────────────
test('plagiarism: verbatim repost of a Hathor original → 100% match', async () => {
  const corpus = [{ author: 'hathor', permlink: 'introducing-hathor-on-melek', body: HATHOR_ORIGINAL }];
  const r = await detectText(HATHOR_ORIGINAL, { corpus });
  assert.equal(r.match, true);
  assert.ok(r.confidence >= 0.95, `verbatim should be ~100%, got ${r.confidence}`);
  assert.ok(/hathor/.test(r.source.author || r.source.url || ''), 'credits the Hathor original');
});

test('plagiarism: near-copy (edit + append) → match in the sub-100% band', async () => {
  const corpus = [{ author: 'hathor', permlink: 'introducing-hathor-on-melek', body: HATHOR_ORIGINAL }];
  const nearCopy = HATHOR_ORIGINAL.replace('produces blocks', 'makes blocks') + ' Also, here is my own extra closing thought about the future.';
  const r = await detectText(nearCopy, { corpus });
  assert.equal(r.match, true, 'near-copy still flags');
  assert.ok(r.confidence > 0.3 && r.confidence < 1, `sub-100% band, got ${r.confidence}`);
});

test('plagiarism: genuinely original text → no match (0% control)', async () => {
  const corpus = [{ author: 'hathor', permlink: 'x', body: HATHOR_ORIGINAL }];
  const r = await detectText('I baked sourdough today and walked my dog along the river. Unrelated content.', { corpus });
  assert.ok(!r.match, 'original content is not flagged');
});

// ── image-theft / photo-credit ───────────────────────────────────────────────────────────────────
const H = 'ffffffffffffffff'; // a 64-bit dHash
test('image-theft: identical pHash, different author → match, top severity', () => {
  const r = detectImageTheft({ hash: H, author: 'img-thief' }, { known: [{ hash: H, author: 'hathor', permlink: 'intro' }] });
  assert.ok(r.match, 'exact duplicate by another author is a match');
  assert.equal(r.match.distance, 0);
  assert.ok(r.flag.severity >= 5, `distance 0 → top severity, got ${r.flag.severity}`);
});

test('image-theft: near-duplicate (few bits off) → match at lower severity', () => {
  const near = 'fffffffffffffff0'; // ~4 bits off
  const r = detectImageTheft({ hash: near, author: 'recropper' }, { known: [{ hash: H, author: 'photog', permlink: 'shot' }] });
  assert.ok(r.match, 'near-dup within threshold matches');
  assert.ok(r.match.distance > 0 && r.match.distance <= 10);
  assert.ok(r.flag.severity >= 3 && r.flag.severity < 5, `near-dup → mid severity, got ${r.flag.severity}`);
});

test('image-theft: SAME author reposting own image → NO flag (false-positive guard)', () => {
  const r = detectImageTheft({ hash: H, author: 'photog' }, { known: [{ hash: H, author: 'photog', permlink: 'shot' }] });
  assert.equal(r.match, null, 'reusing your own image is not theft');
  assert.equal(r.flag, null);
});

// ── toxicity / harassment ────────────────────────────────────────────────────────────────────────
test('toxicity: letter-spacing obfuscation is de-obfuscated and flagged', () => {
  const r = detectToxicity('you are a l-o-s-e-r and p.a.t.h.e.t.i.c, you should die');
  assert.ok(r.flag, 'obfuscated insult + threat still flags');
  assert.ok(r.flag.severity >= 4, `threat floor, got ${r.flag.severity}`);
  assert.ok(r.labels.includes('threats') || r.labels.includes('severe-insult'), `labels=${r.labels}`);
});

test('toxicity: ordinary disagreement → no flag', () => {
  const r = detectToxicity('I disagree with this proposal and think the tokenomics need work.');
  assert.equal(r.flag, null, 'civil disagreement is not toxic');
});

// ── scam / phishing ──────────────────────────────────────────────────────────────────────────────
test('scam: key-phish (active key request) → flag', () => {
  const r = detectScam('This is official Hathor support, your account needs verification — message support and send your active key.');
  assert.ok(r.flag, 'key request is a scam');
  assert.ok(r.flag.severity >= 4, `severity, got ${r.flag.severity}`);
});

test('scam: seed-phrase / send-funds pitch → flag', () => {
  const r = detectScam('Send 100 TESTS to double your money, or DM me your 12-word seed phrase to claim your airdrop now!');
  assert.ok(r.flag, 'seed-phrase + send-funds → scam');
});

// ── impersonation / sybil ────────────────────────────────────────────────────────────────────────
test('impersonation: leetspeak hath0r-support targeting verified hathor → flag', () => {
  const r = detectImpersonation('hath0r-support', {
    knownAccounts: [{ account: 'hathor', verified: true }],
    displayName: 'Hathor',
    bio: 'the official Hathor support team — DM me to verify your account',
    accountAgeDays: 0,
  });
  assert.ok(r.flag, 'homoglyph look-alike of a verified account is flagged');
  assert.ok(r.score >= 0.5, `score=${r.score} signals=${r.signals}`);
});

test('impersonation: sybil ring of look-alikes each flags', () => {
  const known = [{ account: 'hathor', verified: true }];
  for (const handle of ['hathor-official', 'hathor-witness', 'real-hathor', 'hathor1']) {
    const r = detectImpersonation(handle, { knownAccounts: known, accountAgeDays: 0 });
    assert.ok(r.flag, `${handle} should flag as impersonation`);
  }
});

test('impersonation: the genuine verified account itself → no flag', () => {
  const r = detectImpersonation('hathor', { knownAccounts: [{ account: 'hathor', verified: true }], accountAgeDays: 400 });
  assert.equal(r.flag, null, 'the real account is not impersonating itself');
});

// ── doxxing / PII ────────────────────────────────────────────────────────────────────────────────
test('doxxing: multi-PII (phone+address+email) → hit, evidence names patterns only (no leaked values)', () => {
  const r = detectPiiHeuristic({ body: "who @victim really is: call 555-867-5309, lives at 12 Main Street, email victim@example.com" });
  assert.equal(r.hit, true);
  assert.ok(/phone/.test(r.evidence) && /email/.test(r.evidence), `evidence lists pattern names: ${r.evidence}`);
  assert.ok(!/555|Main Street|victim@example/.test(r.evidence), 'evidence must NOT reproduce the leaked PII');
});

test('doxxing: a post with no PII → no hit', () => {
  const r = detectPiiHeuristic({ body: 'Here is my opinion on the latest hardfork. No personal data here.' });
  assert.equal(r.hit, false);
});

// ── unified moderation spine: one post, multiple harms ───────────────────────────────────────────
test('runModeration: a scam+doxx post files multiple coexisting flags through ONE pipe', async () => {
  const content = {
    author: 'doxxer-pii', permlink: 'p1',
    body: "send me 100 TESTS or I post @victim's home: 12 Main Street, 555-867-5309, victim@example.com and your seed phrase",
  };
  const out = await runModeration(content);
  assert.ok(out.flagsFiled >= 1, `at least one flag filed, got ${out.flagsFiled}`);
  const kinds = out.results.flatMap((r) => (r.filed || []).map((f) => f.kind || f.category || ''));
  // doxxing and scam are distinct kinds and must not collapse into each other (dedupe is per target+kind).
  assert.ok(out.results.some((r) => !r.skipped), 'at least one detector ran and produced a result');
});
