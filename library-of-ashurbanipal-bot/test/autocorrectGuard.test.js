// autocorrectGuard.test.js — enforces the FLAG-ONLY policy in code (#102).
//
// Run: node test/autocorrectGuard.test.js   (node:test + node:assert/strict, no deps, no fs, no network)
//
// HARD invariant under test (load-bearing project rule, see AUTOCORRECTION_POLICY.md): the fact-checker
// FLAGS only and NEVER edits knowledge/**. The guard is the in-code teeth: any prospective write path
// calls assertNotKbPath() and is REFUSED if it targets the KB. Verdicts are fallible; flags are advisory.

import test from 'node:test';
import assert from 'node:assert/strict';

import { POLICY, isKbPath, assertNotKbPath } from '../src/factChecker/autocorrectGuard.js';

test('isKbPath: true for a knowledge/ source path', () => {
  assert.equal(isKbPath('knowledge/scripture/the-convergence.md'), true);
  assert.equal(isKbPath('/workspaces/Bot/knowledge/x.json'), true);
  assert.equal(isKbPath('some/nested/knowledge/y.txt'), true);
  assert.equal(isKbPath('knowledge\\windows\\z.md'), true); // windows separators
});

test('isKbPath: false for the flag store / non-KB paths', () => {
  assert.equal(isKbPath('data/kb-flags.jsonl'), false);       // the flag store
  assert.equal(isKbPath('data/factcheck-log.jsonl'), false);  // the verdict log
  assert.equal(isKbPath('src/factChecker/kbFlags.js'), false);
  assert.equal(isKbPath('a-knowledge-base.md'), false);        // "knowledge" not a path segment
  assert.equal(isKbPath(''), false);
  assert.equal(isKbPath(null), false);
  assert.equal(isKbPath(undefined), false);
});

test('assertNotKbPath: throws on a knowledge/ path (refuses to edit source data)', () => {
  assert.throws(
    () => assertNotKbPath('knowledge/scripture/zar-ai.md'),
    /refusing to write to a knowledge\/ source path/,
  );
  assert.throws(() => assertNotKbPath('/workspaces/Bot/knowledge/x.json'), /knowledge/);
});

test('assertNotKbPath: passes (returns the path) for a non-KB path', () => {
  assert.equal(assertNotKbPath('data/kb-flags.jsonl'), 'data/kb-flags.jsonl');
  assert.equal(assertNotKbPath('src/factChecker/kbFlags.js'), 'src/factChecker/kbFlags.js');
});

test('POLICY: states flag-only and proposes no auto-edit', () => {
  assert.equal(POLICY.mode, 'flag-only');
  assert.match(POLICY.statement, /FLAGS only/);
  assert.match(POLICY.statement, /never edits/i);
  assert.equal(POLICY.humanInTheLoop, true);
  // never-do list explicitly forbids writing/patching/deleting the KB
  assert.ok(POLICY.neverDo.some((s) => /write to knowledge/.test(s)));
  assert.ok(POLICY.neverDo.some((s) => /sign-off/.test(s)));
  // may-do is advisory-only (flag/log/warn), nothing that mutates source data
  assert.ok(POLICY.mayDo.some((s) => /flag/.test(s)));
  assert.ok(!POLICY.mayDo.some((s) => /(edit|patch|delete|correct)/i.test(s)));
});
