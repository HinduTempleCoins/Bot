// status.test.js — tests for the plain-English status generator (Task #95).
//
// Runs fully offline: statusSummary() takes injected module-list + test-results, so no disk, no
// network, no LLM. Asserts: capabilities() returns the feature list with valid states; statusSummary
// builds a plain sentence + correct counts from injected data; renderStatus emits operator-friendly
// markdown with NO file paths / module names / jargon in the human-facing text.
//
// Run: node --test test/status.test.js   (node:test + node:assert/strict, no new deps)

import test from 'node:test';
import assert from 'node:assert/strict';

import { capabilities, statusSummary, renderStatus } from '../src/status.js';

const VALID_STATES = new Set(['live', 'built', 'pending']);

// Words that betray code-speak to a non-coder. The operator-facing TEXT must contain none of these.
const JARGON = [
  '.js', '.mjs', 'src/', 'function', 'module', 'await', 'import', 'export',
  'JSONL', 'API key', 'env var', 'wikiGenerator', 'factChecker', 'reviewQueue',
];

function assertNoJargon(text, label) {
  for (const j of JARGON) {
    assert.ok(!text.includes(j), `${label} should not contain jargon "${j}" — got: ${text}`);
  }
}

// ── capabilities() ────────────────────────────────────────────────────────────────────────────
test('capabilities() returns a non-empty list of {name, state, plain}', () => {
  const caps = capabilities();
  assert.ok(Array.isArray(caps));
  assert.ok(caps.length >= 5, 'should describe at least a handful of features');
  for (const c of caps) {
    assert.equal(typeof c.name, 'string');
    assert.ok(c.name.length > 0);
    assert.ok(VALID_STATES.has(c.state), `bad state: ${c.state}`);
    assert.equal(typeof c.plain, 'string');
    assert.ok(c.plain.length > 0);
    assertNoJargon(c.plain, `capability "${c.name}" plain text`);
  }
});

test('capabilities() covers the real "waiting on you" items (publish, live data, chat surfaces)', () => {
  const caps = capabilities();
  const pending = caps.filter((c) => c.state === 'pending').map((c) => c.name.toLowerCase()).join(' | ');
  assert.match(pending, /wiki/);          // publishing into a real wiki
  assert.match(pending, /data/);          // live market/chain data
  assert.match(pending, /discord|telegram/); // chat surfaces
});

test('capabilities() returns frozen copies (callers cannot mutate the canonical list)', () => {
  const a = capabilities();
  assert.throws(() => { a[0].state = 'live'; });
  // a fresh call is unaffected
  const b = capabilities();
  assert.notEqual(b[0].state, 'live'); // unchanged unless it genuinely was 'live'
});

// ── statusSummary() ───────────────────────────────────────────────────────────────────────────
test('statusSummary() produces counts + a plain human sentence from injected data', () => {
  const s = statusSummary({
    modules: [{ name: 'a', present: true }, { name: 'b', present: true }, { name: 'c', present: false }],
    tests: { passed: 90, failed: 0 },
  });
  assert.equal(s.counts.modules, 2); // 'c' is absent
  assert.equal(s.counts.testsPassed, 90);
  assert.equal(s.counts.testsFailed, 0);
  assert.equal(s.counts.capabilities, capabilities().length);
  assert.equal(s.counts.live + s.counts.built + s.counts.pending, s.counts.capabilities);

  assert.equal(typeof s.sentence, 'string');
  assert.ok(s.sentence.length > 0);
  assert.match(s.sentence, /passing/);
  assertNoJargon(s.sentence, 'summary sentence');
});

test('statusSummary() sentence reflects FAILING checks when injected', () => {
  const s = statusSummary({ modules: [], tests: { passed: 10, failed: 3 } });
  assert.match(s.sentence, /failing|attention/);
  assert.equal(s.counts.testsFailed, 3);
  assertNoJargon(s.sentence, 'failing summary sentence');
});

test('statusSummary() soft-fails on empty / missing input', () => {
  const s = statusSummary();
  assert.equal(s.counts.modules, 0);
  assert.equal(s.counts.testsPassed, 0);
  assert.ok(s.sentence.length > 0);
  assert.match(s.sentence, /not been run|have not/);
});

test('statusSummary() accepts plain-string module lists', () => {
  const s = statusSummary({ modules: ['one', 'two', 'three'], tests: {} });
  assert.equal(s.counts.modules, 3);
});

// ── renderStatus() ────────────────────────────────────────────────────────────────────────────
test('renderStatus() emits operator-friendly markdown with no jargon in the human text', () => {
  const s = statusSummary({ modules: [{ name: 'x', present: true }], tests: { passed: 50, failed: 0 } });
  const md = renderStatus(s);
  assert.match(md, /^# Library of Ashurbanipal/m);
  // At least one "ready/working" section renders (live and/or built features exist).
  assert.match(md, /Working now|Ready, waiting on outside setup/);
  assert.match(md, /Waiting on you/);
  assert.match(md, /The numbers/);
  // The leading human sentence is present.
  assert.ok(md.includes(s.sentence));
  assertNoJargon(md, 'rendered status markdown');
});

test('renderStatus() works with no argument (renders live capabilities)', () => {
  const md = renderStatus();
  assert.match(md, /^# Library of Ashurbanipal/m);
  assertNoJargon(md, 'default rendered status');
});

test('renderStatus() lists each pending item by name under "Waiting on you"', () => {
  const md = renderStatus(statusSummary({ modules: [], tests: {} }));
  const pendingNames = capabilities().filter((c) => c.state === 'pending').map((c) => c.name);
  for (const n of pendingNames) {
    assert.ok(md.includes(n), `expected pending item "${n}" in rendered output`);
  }
});
