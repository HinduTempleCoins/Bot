// run-tests.test.mjs — guards the discovery that replaced the hand-maintained glob list.
// The regression this suite keeps re-living is "a directory of tests silently stopped running",
// so the load-bearing assertion is the last one: nothing the walker can reach is left out.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { findTestFiles, isTestFile, SKIP_DIRS, REPO_ROOT } from './run-tests.mjs';

test('isTestFile accepts .test.mjs / .test.js and nothing else', () => {
  assert.equal(isTestFile('karma.test.mjs'), true);
  assert.equal(isTestFile('server.test.js'), true);
  assert.equal(isTestFile('karma.mjs'), false);
  assert.equal(isTestFile('test.mjs'), false);          // not a `.test.` file
  assert.equal(isTestFile('fixtures/a.test.json'), false);
});

test('findTestFiles skips node_modules and .local at any depth', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'runtests-'));
  try {
    for (const rel of ['a.test.mjs', 'pkg/b.test.js',
                       'node_modules/dep/c.test.mjs', 'pkg/node_modules/d.test.mjs',
                       '.local/e.test.mjs', '.local/deep/f.test.mjs']) {
      fs.mkdirSync(path.join(dir, path.dirname(rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), '');
    }
    assert.deepEqual(findTestFiles(dir), ['a.test.mjs', path.join('pkg', 'b.test.js')]);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('findTestFiles never throws on an unreadable directory', () => {
  assert.deepEqual(findTestFiles(path.join(os.tmpdir(), 'definitely-not-here-' + Date.now())), []);
});

test('SKIP_DIRS covers node_modules and .local — the two that must never be walked', () => {
  assert.ok(SKIP_DIRS.has('node_modules'));
  assert.ok(SKIP_DIRS.has('.local'));
});

test('THE GUARD: every test file in the repo is discovered — none silently dropped', () => {
  const discovered = new Set(findTestFiles());
  // Re-walk independently, with only the two exclusions that are non-negotiable, and demand that
  // discovery reached everything. If this fails, a directory of tests has gone dark again.
  const missed = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === '.git' || e.name === '.local') continue;
        walk(full);
      } else if (e.isFile() && isTestFile(e.name)) {
        const rel = path.relative(REPO_ROOT, full);
        if (!discovered.has(rel)) missed.push(rel);
      }
    }
  };
  walk(REPO_ROOT);
  assert.deepEqual(missed, [], `test files not reached by discovery:\n  ${missed.join('\n  ')}`);
  assert.ok(discovered.size > 1000, `expected >1000 test files, found ${discovered.size}`);
});
