// kula-ring.test.mjs — offline tests for the Kula Ring analogy mapper (backlog 99078c0bdf).
//
// node:test + node:assert/strict, fully offline. Covers: static-data shape, lookup happy path,
// case/whitespace insensitivity, soft-fail on unknown/empty/non-string input, deterministic
// (byte-stable) Markdown render, and esc() of interpolated fields.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { KULA_RING, explainAnalogy, renderMarkdown, esc } from './kula-ring.mjs';

test('KULA_RING static data has the expected shape', () => {
  assert.equal(KULA_RING.name, 'The Kula Ring');
  assert.ok(KULA_RING.terms.soulava, 'soulava term present');
  assert.ok(KULA_RING.terms.mwali, 'mwali term present');
  assert.equal(KULA_RING.directions.length, 2);
  const dirs = KULA_RING.directions.map((d) => d.circulation).sort();
  assert.deepEqual(dirs, ['clockwise', 'counter-clockwise']);
  // each term entry carries both halves of the analogy
  for (const k of Object.keys(KULA_RING.terms)) {
    assert.ok(KULA_RING.terms[k].anthropology.length > 0, `${k} has anthropology`);
    assert.ok(KULA_RING.terms[k].cryptoMapping.length > 0, `${k} has cryptoMapping`);
  }
});

test('KULA_RING is frozen (read-only corpus)', () => {
  assert.ok(Object.isFrozen(KULA_RING));
  assert.ok(Object.isFrozen(KULA_RING.terms));
  assert.throws(() => {
    'use strict';
    KULA_RING.name = 'mutated';
  });
});

test('explainAnalogy returns anthropology + cryptoMapping for a known term', () => {
  const r = explainAnalogy('soulava');
  assert.equal(r.found, true);
  assert.equal(r.term, 'soulava');
  assert.match(r.anthropology, /necklace/i);
  assert.match(r.cryptoMapping, /upvote/i);
});

test('explainAnalogy is case- and whitespace-insensitive', () => {
  const a = explainAnalogy('  MWALI ');
  assert.equal(a.found, true);
  assert.equal(a.term, 'mwali');
  assert.equal(a.cryptoMapping, KULA_RING.terms.mwali.cryptoMapping);
});

test('explainAnalogy soft-fails on unknown term', () => {
  const r = explainAnalogy('dogecoin');
  assert.equal(r.found, false);
  assert.equal(r.anthropology, '');
  assert.equal(r.cryptoMapping, '');
});

test('explainAnalogy soft-fails (never throws) on empty / non-string input', () => {
  for (const bad of ['', '   ', null, undefined, 42, {}, [], NaN]) {
    const r = explainAnalogy(bad);
    assert.equal(r.found, false);
    assert.equal(typeof r.anthropology, 'string');
    assert.equal(typeof r.cryptoMapping, 'string');
  }
});

test('renderMarkdown is deterministic / byte-stable', () => {
  const a = renderMarkdown();
  const b = renderMarkdown();
  assert.equal(a, b);
  assert.equal(typeof a, 'string');
  assert.ok(a.endsWith('\n'));
  assert.match(a, /^# The Kula Ring/);
  // every term heading appears, in sorted order
  const keys = Object.keys(KULA_RING.terms).sort();
  let idx = -1;
  for (const k of keys) {
    const at = a.indexOf(`### ${k}`);
    assert.ok(at > idx, `term ${k} present and in sorted order`);
    idx = at;
  }
});

test('renderMarkdown escapes interpolated fields (no raw HTML metacharacters leak)', () => {
  // The corpus uses a typographic apostrophe (’) not a raw quote, so the rendered doc should
  // carry no unescaped < > or & that did not come from esc() itself. Sanity-check esc() directly.
  assert.equal(esc('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
  const md = renderMarkdown();
  // No bare '<' from our data (Markdown headings use '#', not tags).
  assert.ok(!/<[a-zA-Z]/.test(md), 'no raw HTML tags in the rendered Markdown');
});
