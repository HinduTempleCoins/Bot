// run-tests.mjs — DISCOVERS the offline test suite instead of listing it.
//
// WHY THIS EXISTS. `package.json`'s `test` script used to be a hand-maintained literal of ~55 glob
// patterns. Every time a module landed in a directory nobody remembered to add, its tests silently
// stopped running — and because the suite still went green, nothing surfaced it. That regression was
// closed on 2026-06-08 and again on 2026-08-27, and had re-opened both times; by 2026-09-04 the list
// was missing 105 tracked test files carrying ~1,331 `test()` calls. A list that must be edited by
// hand to stay correct will drift again, so the list is gone: this walks the tree instead.
//
// A file is a test if its basename ends `.test.mjs` or `.test.js`. Nothing else opts it in.
//
// House rules this keeps: the suite is `node --test`, fully offline, and never needs the network.
// Anything that cannot honour that does not belong under a `*.test.*` name.

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Directory names never descended into, at any depth.
//   node_modules  — third-party tests are not ours to run
//   .local        — gitignored operator-only material (recovered copies of other repos, superseded
//                   duplicates); its ~27 test files are not part of this repo's suite
//   .git, coverage, dist, build — not source
export const SKIP_DIRS = new Set(['node_modules', '.git', '.local', 'coverage', 'dist', 'build']);

export function isTestFile(name) {
  return name.endsWith('.test.mjs') || name.endsWith('.test.js');
}

/** Every test file under `root`, repo-relative, sorted. Never throws on an unreadable directory. */
export function findTestFiles(root = REPO_ROOT) {
  const out = [];
  const walk = (dir) => {
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name)) continue;
        walk(full);
      } else if (e.isFile() && isTestFile(e.name)) {
        out.push(path.relative(root, full));
      }
    }
  };
  walk(root);
  return out.sort();
}

const isMain = process.argv[1] && process.argv[1].endsWith('run-tests.mjs');
if (isMain) {
  const passthrough = process.argv.slice(2);
  const files = findTestFiles();
  if (!files.length) {
    console.error('[test] no test files found — that is certainly wrong; check SKIP_DIRS');
    process.exit(1);
  }
  console.log(`[test] discovered ${files.length} test files`);
  const child = spawn(process.execPath, ['--test', ...passthrough, ...files],
    { cwd: REPO_ROOT, stdio: 'inherit' });
  child.on('exit', (code, signal) => process.exit(signal ? 1 : (code ?? 1)));
}
