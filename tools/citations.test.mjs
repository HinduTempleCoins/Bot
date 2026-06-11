// citations.test.mjs — OFFLINE unit tests for citableSet (tmpdir walk + skips), citationCoverage
// (claim-line detection, backtick / [[wikilink]] / bare-file ref resolution, unresolved tracking,
// coveragePct, extraRefs) and the CITATION_RULE export. citationCoverage is driven with inline
// string fixtures; the citable set is built from an in-test tmpdir so the whole suite is hermetic.
// No network, no real repo access.
//
//   node --test tools/citations.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CITATION_RULE, citableSet, citationCoverage } from './citations.mjs';

// Build a small repo tree in a tmpdir and return { dir, cleanup }. The tree intentionally includes
// node_modules / .git / .local so we can assert they are skipped, plus a nested dir.
function makeRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'citations-'));
  const file = (rel, body = 'x') => {
    const full = join(dir, rel);
    mkdirSync(join(full, '..'), { recursive: true });
    writeFileSync(full, body);
  };
  file('README.md');
  file('tools/citations.mjs');
  file('src/chain/graphene.js');
  file('node_modules/leftpad/index.js'); // must be skipped
  file('.git/config'); // must be skipped
  file('.local/SECRET_BRIEF.md'); // must be skipped
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('CITATION_RULE is a non-empty string', () => {
  assert.equal(typeof CITATION_RULE, 'string');
  assert.ok(CITATION_RULE.length > 0);
  assert.match(CITATION_RULE, /CITATION RULE/);
});

test('citableSet walks the tree and adds both relative paths and basenames', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const set = citableSet(dir);
    // relative paths
    assert.ok(set.has(join('tools', 'citations.mjs')));
    assert.ok(set.has(join('src', 'chain', 'graphene.js')));
    assert.ok(set.has('README.md'));
    // basenames
    assert.ok(set.has('citations.mjs'));
    assert.ok(set.has('graphene.js'));
  } finally {
    cleanup();
  }
});

test('citableSet skips node_modules, .git and .local', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const set = citableSet(dir);
    assert.ok(!set.has(join('node_modules', 'leftpad', 'index.js')));
    assert.ok(!set.has(join('.git', 'config')));
    assert.ok(!set.has(join('.local', 'SECRET_BRIEF.md')));
    // and their basenames must not leak in either
    assert.ok(!set.has('SECRET_BRIEF.md'));
    assert.ok(!set.has('config'));
  } finally {
    cleanup();
  }
});

test('citableSet returns empty set for a missing dir (soft-fail, never throws)', () => {
  const set = citableSet(join(tmpdir(), 'citations-does-not-exist-zzz'));
  assert.ok(set instanceof Set);
  assert.equal(set.size, 0);
});

test('citationCoverage resolves a backtick path ref against the citable set', () => {
  const citable = new Set(['tools/citations.mjs', 'citations.mjs']);
  const text = '- the score comes from `tools/citations.mjs` per the rule';
  const cov = citationCoverage(text, citable);
  assert.equal(cov.claims, 1);
  assert.equal(cov.cited, 1);
  assert.equal(cov.resolved, 1);
  assert.equal(cov.coveragePct, 100);
  assert.deepEqual(cov.unresolved, []);
});

test('citationCoverage resolves a [[wikilink]] ref', () => {
  const citable = new Set(['annal-2026-06-01.md', 'annal-2026-06-01']);
  const text = '- this decision follows [[annal-2026-06-01]] directly';
  const cov = citationCoverage(text, citable);
  assert.equal(cov.cited, 1);
  assert.equal(cov.resolved, 1);
});

test('citationCoverage resolves a bare file-name ref by basename', () => {
  const citable = new Set(['src/chain/graphene.js', 'graphene.js']);
  const text = '- block production lives in graphene.js on the witness host';
  const cov = citationCoverage(text, citable);
  assert.equal(cov.cited, 1);
  assert.equal(cov.resolved, 1);
});

test('citationCoverage resolves a ./-prefixed ref by suffix match', () => {
  const citable = new Set(['tools/citations.mjs', 'citations.mjs']);
  const text = '- see `./tools/citations.mjs` for the scoring code';
  const cov = citationCoverage(text, citable);
  assert.equal(cov.resolved, 1);
});

test('citationCoverage tracks unresolved refs and lowers coveragePct', () => {
  const citable = new Set(['tools/citations.mjs', 'citations.mjs']);
  const text = [
    '- resolved via `tools/citations.mjs`',
    '- unresolved via `tools/ghost.mjs` which does not exist',
  ].join('\n');
  const cov = citationCoverage(text, citable);
  assert.equal(cov.claims, 2);
  assert.equal(cov.cited, 2);
  assert.equal(cov.resolved, 1);
  assert.equal(cov.coveragePct, 50);
  assert.equal(cov.unresolved.length, 1);
  assert.ok(cov.unresolved[0].refs.includes('tools/ghost.mjs'));
});

test('citationCoverage counts claim-ish lines only (list/number markers, length > 12)', () => {
  const text = [
    '# A heading that is long but not a claim line',
    '- a long-enough bullet claim `README.md`',
    '* another long-enough claim `README.md`',
    '1. numbered long-enough claim `README.md`',
    '- short', // under 12 chars after trim -> excluded
    'plain prose with `README.md` but no list marker', // no leading -/*/digit -> excluded
  ].join('\n');
  const cov = citationCoverage(text, new Set(['README.md']));
  assert.equal(cov.claims, 3);
  assert.equal(cov.resolved, 3);
});

test('citationCoverage: cited counts only lines that carry a ref; uncited claims are not cited', () => {
  const text = [
    '- this long claim line carries no citation at all',
    '- this long claim cites `README.md`',
  ].join('\n');
  const cov = citationCoverage(text, new Set(['README.md']));
  assert.equal(cov.claims, 2);
  assert.equal(cov.cited, 1); // only the second line has a ref
  assert.equal(cov.resolved, 1);
  assert.equal(cov.coveragePct, 50); // resolved / claims
});

test('citationCoverage honors extraRefs (extends the known set)', () => {
  const text = '- decision based on `dynamic-source.md` provided at runtime';
  const without = citationCoverage(text, new Set());
  assert.equal(without.resolved, 0);
  const withExtra = citationCoverage(text, new Set(), { extraRefs: ['dynamic-source.md'] });
  assert.equal(withExtra.resolved, 1);
  assert.equal(withExtra.coveragePct, 100);
});

test('citationCoverage accepts an array (non-Set) as the citable arg', () => {
  const text = '- cites `README.md` from an array-backed citable set';
  const cov = citationCoverage(text, ['README.md']);
  assert.equal(cov.resolved, 1);
});

test('citationCoverage on empty text yields zeroed result, coveragePct 0', () => {
  const cov = citationCoverage('', new Set(['README.md']));
  assert.deepEqual(cov, { claims: 0, cited: 0, resolved: 0, coveragePct: 0, unresolved: [] });
});

test('citationCoverage caps the unresolved sample at 10', () => {
  const lines = [];
  for (let i = 0; i < 15; i++) lines.push(`- claim number ${i} cites \`missing-${i}.md\` here`);
  const cov = citationCoverage(lines.join('\n'), new Set());
  assert.equal(cov.claims, 15);
  assert.equal(cov.cited, 15);
  assert.equal(cov.resolved, 0);
  assert.equal(cov.unresolved.length, 10);
});

test('citationCoverage integrates with a citableSet built from a tmpdir (hermetic end-to-end)', () => {
  const { dir, cleanup } = makeRepo();
  try {
    const citable = citableSet(dir);
    const text = [
      '- scoring code is `tools/citations.mjs`',
      '- chain client is graphene.js on the host',
      '- this one cites `does/not/exist.md` and stays unresolved',
    ].join('\n');
    const cov = citationCoverage(text, citable);
    assert.equal(cov.claims, 3);
    assert.equal(cov.cited, 3);
    assert.equal(cov.resolved, 2);
    assert.equal(cov.coveragePct, 67); // round(2/3*100)
    assert.equal(cov.unresolved.length, 1);
  } finally {
    cleanup();
  }
});
