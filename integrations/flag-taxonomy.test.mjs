// flag-taxonomy.test.mjs — offline tests for the unified harm taxonomy.
// node --test. No network, no real fs (an in-memory fs is injected into the moderation store).

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  TAXONOMY, ACTIONS, categoryFor, classify, route, wireDefaultDetectors,
  detectScamHeuristic, detectPiiHeuristic, detectImpersonationHeuristic,
} from './flag-taxonomy.mjs';
import { createModerationStore } from './moderation-flags.mjs';

// ── in-memory fs so the store never touches disk (offline) ──────────────────────────────────────
function memFs() {
  const files = new Map();
  return {
    files,
    mkdirSync() {},
    appendFileSync(p, data) { files.set(p, (files.get(p) || '') + data); },
    readFileSync(p) { if (!files.has(p)) { const e = new Error('ENOENT'); e.code = 'ENOENT'; throw e; } return files.get(p); },
  };
}
function memStore() {
  let n = 0;
  return createModerationStore({ fs: memFs(), storePath: '/mem/flags.jsonl', idGen: () => `t_${n++}` });
}

// ── TAXONOMY shape ───────────────────────────────────────────────────────────────────────────────
test('taxonomy covers the required harm categories', () => {
  const keys = TAXONOMY.map((c) => c.key);
  for (const k of [
    'plagiarism', 'image-theft', 'spam', 'scam-fraud', 'harassment-toxicity', 'hate',
    'impersonation', 'misinformation', 'doxxing-pii', 'csam', 'bot-sybil', 'copyright-dmca',
  ]) assert.ok(keys.includes(k), `missing category ${k}`);
});

test('every category has severity 1-5, a detector mapping, and a valid action', () => {
  const valid = new Set(Object.values(ACTIONS));
  for (const c of TAXONOMY) {
    assert.ok(c.severity >= 1 && c.severity <= 5, `${c.key} severity out of range`);
    assert.ok(c.detector && c.detector.module && c.detector.fn, `${c.key} missing detector`);
    assert.ok(valid.has(c.action), `${c.key} invalid action ${c.action}`);
    assert.equal(typeof c.gated, 'boolean');
  }
});

test('CSAM is gated, max severity, and escalates to human+counsel (never auto-actioned)', () => {
  const csam = categoryFor('csam');
  assert.equal(csam.gated, true);
  assert.equal(csam.severity, 5);
  assert.equal(csam.action, ACTIONS.HUMAN_COUNSEL);
  // copyright-DMCA is also gated (legal process).
  assert.equal(categoryFor('copyright-dmca').gated, true);
});

test('attribution categories default to credit-first, not punitive', () => {
  assert.equal(categoryFor('plagiarism').action, ACTIONS.CREDIT_NOTE);
  assert.equal(categoryFor('image-theft').action, ACTIONS.CREDIT_NOTE);
});

// ── classify(): plagiarism on a near-copy ────────────────────────────────────────────────────────
test('classify finds plagiarism on a near-copy via the real Cheetah detector', async () => {
  const original = 'The quick brown fox jumps over the lazy dog while the witness watches the chain produce blocks every four seconds.';
  // a near-copy: same sentence with a couple words changed.
  const copy = 'The quick brown fox jumps over the lazy dog while the witness observes the chain produce blocks every four seconds.';
  const findings = await classify({
    author: '@plagiarist', permlink: 'p1', body: copy,
    corpus: [{ author: 'original', permlink: 'o1', body: original }],
  });
  const plag = findings.find((f) => f.category === 'plagiarism');
  assert.ok(plag, 'expected a plagiarism finding');
  assert.equal(plag.action, ACTIONS.CREDIT_NOTE);
  assert.ok(plag.confidence > 0.5, `expected high similarity, got ${plag.confidence}`);
});

test('classify finds NO plagiarism for unrelated text', async () => {
  const findings = await classify({
    author: '@a', permlink: 'p', body: 'A completely different sentence about mining pools and resource credits.',
    corpus: [{ author: 'b', permlink: 'o', body: 'Hathor delegates power to brand new accounts so they can post.' }],
  });
  assert.ok(!findings.find((f) => f.category === 'plagiarism'));
});

// ── classify(): spam on a flood ──────────────────────────────────────────────────────────────────
test('classify finds spam on an instant flood of comments', async () => {
  const findings = await classify({
    author: '@spammer', permlink: 's1', body: 'buy buy buy',
    opsInWindow: 20, intervalMs: 0, rcBudget: 0, opKind: 'comment',
  });
  const spam = findings.find((f) => f.category === 'spam');
  assert.ok(spam, 'expected a spam finding from the flood');
  assert.equal(spam.action, ACTIONS.QUEUE_REVIEW);
  assert.ok(spam.confidence > 0);
});

test('classify finds NO spam for a single post', async () => {
  const findings = await classify({ author: '@a', permlink: 'p', body: 'just one post', opsInWindow: 1 });
  assert.ok(!findings.find((f) => f.category === 'spam'));
});

// ── classify(): toxicity / scam / PII / impersonation via deterministic detectors ────────────────
test('classify flags harassment via the lexicon toxicity floor', async () => {
  const findings = await classify({ author: '@x', permlink: 'p', body: 'you are an idiot and I will find you' });
  assert.ok(findings.find((f) => f.category === 'harassment-toxicity'), 'expected toxicity finding');
});

test('classify flags scam, PII and impersonation deterministically', async () => {
  const scam = await classify({ author: '@x', permlink: 'p', body: 'send me your seed phrase to claim your free airdrop https://evil.example' });
  assert.ok(scam.find((f) => f.category === 'scam-fraud'));

  const pii = await classify({ author: '@x', permlink: 'p', body: 'his SSN is 123-45-6789 and phone 555-123-4567' });
  assert.ok(pii.find((f) => f.category === 'doxxing-pii'));

  const imp = await classify({ author: '@scammer', permlink: 'p', body: 'I am the official Hathor, send funds here' });
  assert.ok(imp.find((f) => f.category === 'impersonation'));
});

test('the real Hathor account is NOT flagged for impersonation', () => {
  assert.equal(detectImpersonationHeuristic({ author: 'hathor', body: 'this is hathor, the witness' }).hit, false);
});

// ── gated categories never auto-action ───────────────────────────────────────────────────────────
test('gated categories (CSAM) never auto-action: default detector is a no-op', async () => {
  // Even with everything present, the default csam detector returns nothing — no model classifier.
  const findings = await classify({ author: '@x', permlink: 'p', body: 'anything at all', images: [{ url: 'x' }] });
  assert.ok(!findings.find((f) => f.category === 'csam'), 'csam must never be auto-detected by default');
});

test('an injected gated match routes as OPEN/human+counsel, never actioned', async () => {
  const store = memStore();
  // Simulate a verified out-of-band PhotoDNA hit being handed in (the only way a gated finding appears).
  const detectors = wireDefaultDetectors({
    csam: async () => ({ category: 'csam', severity: 5, confidence: 0.99, evidence: 'verified hash match', action: ACTIONS.HUMAN_COUNSEL, gated: true }),
  });
  const findings = await classify({ author: '@x', permlink: 'p', body: 'x' }, { detectors });
  const csam = findings.find((f) => f.category === 'csam');
  assert.ok(csam && csam.gated);

  const routed = await route(findings, { store, content: { author: 'x', permlink: 'p' } });
  const csamEntry = routed.find((r) => r.category === 'csam');
  assert.ok(csamEntry.gated);
  assert.equal(csamEntry.status, 'open');       // opened for a human, NOT 'actioned'
  // and in the store it is OPEN, in the queue, never auto-resolved.
  const open = store.queueForModeration();
  assert.ok(open.find((r) => r.kind === 'illegal'), 'gated finding must land OPEN in the queue');
  assert.equal(store.stats().actioned, 0, 'nothing is ever auto-actioned');
});

// ── route() writes to the ONE store + is idempotent ──────────────────────────────────────────────
test('route writes findings to the injected store and is idempotent', async () => {
  const store = memStore();
  const content = { author: 'spammer', permlink: 's1', body: 'send me your private key for a guaranteed profit airdrop', opsInWindow: 20 };
  const findings = await classify(content);
  assert.ok(findings.length > 0);

  const first = await route(findings, { store, content });
  const openAfterFirst = store.queueForModeration().length;
  assert.equal(openAfterFirst, first.length, 'each finding opened one report');
  assert.ok(first.every((r) => r.report && r.report.status === 'open'));
  assert.ok(first.every((r) => !r.deduped), 'first route should not dedupe');

  // routing the SAME findings again must NOT stack duplicates (idempotent via store dedup).
  const second = await route(findings, { store, content });
  assert.ok(second.every((r) => r.deduped), 'second route should dedupe every entry');
  assert.equal(store.queueForModeration().length, openAfterFirst, 'queue size unchanged on re-route');
});

test('route stores the category/severity/action in report context for the queue UI', async () => {
  const store = memStore();
  const content = { author: 'x', permlink: 'p', body: 'send me your seed phrase' };
  const findings = await classify(content);
  await route(findings, { store, content });
  const entry = store.listReports({ kind: 'scam' })[0];
  assert.ok(entry);
  const ctx = JSON.parse(entry.context);
  assert.equal(ctx.category, 'scam-fraud');
  assert.equal(ctx.action, ACTIONS.QUEUE_REVIEW);
  assert.equal(typeof ctx.confidence, 'number');
});

// ── soft-fail when a detector is absent or throws ────────────────────────────────────────────────
test('classify soft-fails when a detector is absent (yields no finding, no throw)', async () => {
  // Only one detector present; everything else absent.
  const detectors = { 'scam-fraud': async (c) => (detectScamHeuristic(c).hit ? { category: 'scam-fraud', severity: 4, confidence: 0.6, evidence: 'x', action: ACTIONS.QUEUE_REVIEW, gated: false } : null) };
  const findings = await classify({ author: 'x', permlink: 'p', body: 'connect your wallet to claim your prize' }, { detectors });
  assert.equal(findings.length, 1);
  assert.equal(findings[0].category, 'scam-fraud');
});

test('classify soft-fails when a detector throws', async () => {
  const detectors = wireDefaultDetectors({
    'scam-fraud': async () => { throw new Error('boom'); },
  });
  // The thrown detector is swallowed; the rest still run. PII present here:
  const findings = await classify({ author: 'x', permlink: 'p', body: 'his email is bob@evil.example and SSN 123-45-6789' }, { detectors });
  assert.ok(findings.find((f) => f.category === 'doxxing-pii'));
  assert.ok(!findings.find((f) => f.category === 'scam-fraud'), 'thrown detector yields no finding');
});

test('route soft-fails on a broken store without throwing', async () => {
  const brokenStore = { raiseReport() { throw new Error('store down'); } };
  const findings = await classify({ author: 'x', permlink: 'p', body: 'send me your private key' });
  const routed = await route(findings, { store: brokenStore, content: { author: 'x', permlink: 'p' } });
  assert.ok(Array.isArray(routed), 'route returns an array even when the store throws');
  assert.ok(routed.every((r) => r.report === null), 'no report object on a failed write');
});

// ── findings ordering: most-serious first ────────────────────────────────────────────────────────
test('findings are ordered most-serious first', async () => {
  const content = {
    author: 'x', permlink: 'p',
    body: 'you are an idiot, send me your seed phrase for a free airdrop, SSN 123-45-6789',
  };
  const findings = await classify(content);
  for (let i = 1; i < findings.length; i++) {
    assert.ok(findings[i - 1].severity >= findings[i].severity, 'severity must be non-increasing');
  }
});
