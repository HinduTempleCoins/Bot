// toxicity-detect.test.mjs — OFFLINE tests for the heuristic toxicity detector.
// node --test cheetah/toxicity-detect.test.mjs   (no network, no keys)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  detectToxicity,
  esc,
  FLAG_THRESHOLD,
  DEFAULT_LEXICON,
  __setLexicon,
  __resetLexicon,
  __getLexicon,
  __setFetch,
} from './toxicity-detect.mjs';

test('esc escapes HTML-significant characters', () => {
  assert.equal(esc('<b>"x"&\'</b>'), '&lt;b&gt;&quot;x&quot;&amp;&#39;&lt;/b&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

test('clean text scores 0 and emits no flag', () => {
  const r = detectToxicity('thank you for the thoughtful post, I learned a lot');
  assert.equal(r.score, 0);
  assert.deepEqual(r.labels, []);
  assert.equal(r.flag, null);
});

test('empty / null / undefined input is neutral and never throws', () => {
  for (const v of ['', '   ', null, undefined, 0, {}, []]) {
    const r = detectToxicity(v);
    assert.equal(r.score, 0);
    assert.deepEqual(r.labels, []);
    assert.equal(r.flag, null);
  }
});

test('a direct threat fires the threats label and emits a harassment flag', () => {
  const r = detectToxicity('I will kill you and your family');
  assert.ok(r.labels.includes('threats'));
  assert.ok(r.score >= FLAG_THRESHOLD);
  assert.ok(r.flag);
  assert.equal(r.flag.kind, 'harassment');
  assert.ok(r.flag.severity >= 4, 'threats floor severity to >= 4');
  assert.equal(typeof r.flag.reason, 'string');
});

test('severe insults accumulate and cross the flag threshold', () => {
  const r = detectToxicity('you are a worthless pathetic loser and everyone hates you');
  assert.ok(r.labels.includes('severe-insult'));
  assert.ok(r.score >= FLAG_THRESHOLD);
  assert.ok(r.flag);
  assert.equal(r.flag.kind, 'harassment');
});

test('a single mild insult is scored but below threshold → no flag', () => {
  const r = detectToxicity('that is a stupid idea');
  assert.ok(r.labels.includes('severe-insult'));
  assert.ok(r.score > 0);
  assert.ok(r.score < FLAG_THRESHOLD);
  assert.equal(r.flag, null);
});

test('separator obfuscation (k i l l   y o u) is normalized and caught', () => {
  const r = detectToxicity('k.i.l.l you, you freak');
  assert.ok(r.labels.includes('threats'));
  assert.ok(r.flag);
});

test('flag shape exactly matches flag-pipe fileFlag expectation', () => {
  const r = detectToxicity('kill yourself you garbage');
  assert.ok(r.flag);
  const keys = Object.keys(r.flag).sort();
  assert.deepEqual(keys, ['kind', 'reason', 'severity']);
  assert.equal(r.flag.kind, 'harassment');
  assert.ok(Number.isInteger(r.flag.severity));
  assert.ok(r.flag.severity >= 1 && r.flag.severity <= 5);
});

test('deterministic: same input yields identical output', () => {
  const a = detectToxicity('you worthless trash, go away');
  const b = detectToxicity('you worthless trash, go away');
  assert.deepEqual(a, b);
});

test('reason is HTML-escaped (no raw angle brackets leak through)', () => {
  // category names + counts only go into reason, but ensure esc() is applied at the boundary.
  const r = detectToxicity('worthless worthless worthless worthless');
  assert.ok(r.flag);
  assert.ok(!/[<>]/.test(r.flag.reason));
});

test('__setLexicon injects a custom lexicon; __resetLexicon restores default', () => {
  __setLexicon({ custom: { weight: 0.9, terms: ['zorp'] } });
  assert.equal(__getLexicon().custom.weight, 0.9);
  const r = detectToxicity('what a zorp you are');
  assert.ok(r.labels.includes('custom'));
  assert.ok(r.flag);
  assert.equal(r.flag.kind, 'harassment');

  __resetLexicon();
  assert.equal(__getLexicon(), DEFAULT_LEXICON);
  const r2 = detectToxicity('what a zorp you are');
  assert.deepEqual(r2.labels, []);
  assert.equal(r2.flag, null);
});

test('injected slur lexicon (private list at runtime) fires the slurs label at high severity', () => {
  __setLexicon({ slurs: { weight: 0.6, terms: ['xxbadwordxx'] } });
  try {
    const r = detectToxicity('you are a xxbadwordxx');
    assert.ok(r.labels.includes('slurs'));
    assert.ok(r.flag);
    assert.ok(r.flag.severity >= 4);
  } finally {
    __resetLexicon();
  }
});

test('score is clamped to 0..1 even with many hits', () => {
  const r = detectToxicity('kill you kill you kill you kill you kill you kill you');
  assert.ok(r.score <= 1);
  assert.ok(r.score >= 0);
});

test('__setFetch accepts a function (production seam, unused offline) and does not throw', () => {
  assert.doesNotThrow(() => __setFetch(async () => ({ ok: true })));
  // detection still works purely offline regardless of the injected fetch.
  const r = detectToxicity('hello friend');
  assert.equal(r.flag, null);
  __setFetch(undefined); // ignored (not a function) — must not throw
});

test('default lexicon slur placeholders are public-safe (no real slurs committed)', () => {
  for (const term of DEFAULT_LEXICON.slurs.terms) {
    assert.ok(term.startsWith('__') && term.endsWith('__'), 'slur terms are placeholders');
  }
});
