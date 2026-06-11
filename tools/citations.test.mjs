// citations.test.mjs — OFFLINE unit tests for citationCoverage() + citableSet() + CITATION_RULE.
// The module is filesystem-only (citableSet walks a real dir) and pure for citationCoverage
// (text + a Set of known refs). We point citableSet at a per-test tmp fixture so nothing
// touches the network, the live repo, or any keys. Both functions soft-fail — citableSet
// returns an empty Set on a missing dir, citationCoverage returns a typed zero result on
// empty/garbage text — which we assert below.
//
//   node --test tools/citations.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CITATION_RULE, citableSet, citationCoverage } from './citations.mjs';

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'citations-'));
}

// ── CITATION_RULE ──────────────────────────────────────────────────────────
test('CITATION_RULE is a non-empty single-line string covering the three provenance angles', () => {
  assert.equal(typeof CITATION_RULE, 'string');
  assert.ok(CITATION_RULE.length > 50);
  assert.ok(!CITATION_RULE.includes('\n'), 'joined to a single line');
  assert.match(CITATION_RULE, /CITATION RULE/);
  assert.match(CITATION_RULE, /recency/i);
  assert.match(CITATION_RULE, /corroboration/i);
});

// ── citableSet (happy path) ──────────────────────────────────────────────────
test('citableSet returns a Set with both relative paths and basenames', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'BRIEF.md'), 'x', 'utf8');
  fs.mkdirSync(path.join(dir, 'sub'));
  fs.writeFileSync(path.join(dir, 'sub', 'note.md'), 'y', 'utf8');

  const set = citableSet(dir);
  assert.ok(set instanceof Set);
  assert.ok(set.has('BRIEF.md'));           // relative == basename at top level
  assert.ok(set.has(path.join('sub', 'note.md'))); // relative path
  assert.ok(set.has('note.md'));            // basename
});

test('citableSet skips node_modules, .git, and .local', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'real.md'), 'x', 'utf8');
  for (const skip of ['node_modules', '.git', '.local']) {
    fs.mkdirSync(path.join(dir, skip));
    fs.writeFileSync(path.join(dir, skip, 'hidden.md'), 'x', 'utf8');
  }
  const set = citableSet(dir);
  assert.ok(set.has('real.md'));
  assert.ok(!set.has('hidden.md'), 'ignored-dir contents are excluded');
});

// ── citableSet (soft-fail) ───────────────────────────────────────────────────
test('citableSet returns an empty Set on a missing dir (never throws)', () => {
  let set;
  assert.doesNotThrow(() => { set = citableSet('/no/such/dir/anywhere-xyz'); });
  assert.ok(set instanceof Set);
  assert.equal(set.size, 0);
});

// ── citationCoverage (happy path) ────────────────────────────────────────────
test('citationCoverage resolves backtick, [[wiki]], and bare-path citations', () => {
  const known = new Set(['BRIEF.md', 'tools/citations.mjs', 'citations.mjs']);
  const text = [
    '- the rule lives in `BRIEF.md` per the operator',           // backtick -> resolves
    '- coverage logic is in tools/citations.mjs and is pure',    // bare path -> resolves
    '- see [[BRIEF.md]] for the founding brief and lineage',     // wiki -> resolves
  ].join('\n');

  const r = citationCoverage(text, known);
  assert.equal(r.claims, 3);
  assert.equal(r.cited, 3);
  assert.equal(r.resolved, 3);
  assert.equal(r.coveragePct, 100);
  assert.deepEqual(r.unresolved, []);
});

test('citationCoverage flags an unresolved citation to a non-existent file', () => {
  const known = new Set(['real.md']);
  const text = '- this claim cites `ghost.md` which does not exist anywhere';
  const r = citationCoverage(text, known);
  assert.equal(r.claims, 1);
  assert.equal(r.cited, 1);
  assert.equal(r.resolved, 0);
  assert.equal(r.coveragePct, 0);
  assert.equal(r.unresolved.length, 1);
  assert.deepEqual(r.unresolved[0].refs, ['ghost.md']);
  assert.ok(r.unresolved[0].line.length <= 80);
});

test('citationCoverage counts only claim-ish lines (>12 chars, list/number lead)', () => {
  const known = new Set(['a.md']);
  const text = [
    '# Heading line that is long but not a claim bullet',  // not claim-ish (no -/*/digit lead)
    '- short',                                             // <=12 chars trimmed -> excluded
    '- a real claim line that references `a.md` clearly',  // claim, cited, resolves
    'plain prose with no leading bullet ref to `a.md`',    // not claim-ish lead char
  ].join('\n');
  const r = citationCoverage(text, known);
  assert.equal(r.claims, 1);
  assert.equal(r.cited, 1);
  assert.equal(r.resolved, 1);
});

test('citationCoverage: a claim-ish line with no citation is counted but not cited', () => {
  const known = new Set(['a.md']);
  const text = '- a claim line with no source reference at all here';
  const r = citationCoverage(text, known);
  assert.equal(r.claims, 1);
  assert.equal(r.cited, 0);
  assert.equal(r.resolved, 0);
  assert.equal(r.coveragePct, 0);
});

test('citationCoverage accepts an array for citable and merges extraRefs', () => {
  const text = '- ties back to `extra-note.md` which is supplied via extraRefs';
  const r = citationCoverage(text, ['unrelated.md'], { extraRefs: ['extra-note.md'] });
  assert.equal(r.resolved, 1);
  assert.equal(r.coveragePct, 100);
});

test('citationCoverage resolves via suffix (endsWith) when a path is partial', () => {
  // known holds a full relative path; the citation gives only a trailing segment.
  const known = new Set(['tools/sub/citations.mjs']);
  const text = '- references `sub/citations.mjs` as a partial path tail';
  const r = citationCoverage(text, known);
  assert.equal(r.resolved, 1);
});

test('citationCoverage caps unresolved samples at 10', () => {
  const known = new Set();
  const lines = [];
  for (let i = 0; i < 15; i++) lines.push(`- claim number ${i} cites \`missing-${i}.md\` here`);
  const r = citationCoverage(lines.join('\n'), known);
  assert.equal(r.claims, 15);
  assert.equal(r.cited, 15);
  assert.equal(r.resolved, 0);
  assert.equal(r.unresolved.length, 10);
});

// ── citationCoverage (soft-fail / edge) ──────────────────────────────────────
test('citationCoverage on empty text returns a typed zero result (never throws)', () => {
  let r;
  assert.doesNotThrow(() => { r = citationCoverage('', new Set()); });
  assert.deepEqual(r, { claims: 0, cited: 0, resolved: 0, coveragePct: 0, unresolved: [] });
});

test('citationCoverage on whitespace-only / no claim-ish lines yields zero coverage', () => {
  const r = citationCoverage('\n\n   \n# title only\n', new Set(['x.md']));
  assert.equal(r.claims, 0);
  assert.equal(r.coveragePct, 0);
  assert.deepEqual(r.unresolved, []);
});

test('citationCoverage works against a real citableSet fixture end-to-end', () => {
  const dir = mkTmp();
  fs.writeFileSync(path.join(dir, 'DECISION.md'), 'x', 'utf8');
  const set = citableSet(dir);
  const text = '- the decision is recorded in `DECISION.md` for any AI to reopen';
  const r = citationCoverage(text, set);
  assert.equal(r.resolved, 1);
  assert.equal(r.coveragePct, 100);
});
