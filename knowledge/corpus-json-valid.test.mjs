// knowledge/corpus-json-valid.test.mjs — offline guard: every *.json under knowledge/ must parse.
// Walks the corpus tree recursively and asserts JSON.parse() succeeds for each file,
// failing loudly with the offending path. Guards against the cyp450 'Extra data'
// regression class (trailing bytes / concatenated objects) going forward.
// Fully offline: local fs only, no network, no fetch.
// Run:  node --test knowledge/corpus-json-valid.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const KNOWLEDGE_DIR = path.dirname(fileURLToPath(import.meta.url));

// Recursively collect every *.json path under dir.
async function collectJson(dir) {
  const out = [];
  const entries = await readdir(dir, { withFileTypes: true });
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      out.push(...(await collectJson(full)));
    } else if (ent.isFile() && ent.name.endsWith('.json')) {
      out.push(full);
    }
  }
  return out;
}

test('every knowledge/*.json parses with JSON.parse', async () => {
  const files = await collectJson(KNOWLEDGE_DIR);

  // Sanity: the corpus should not be empty — a zero-file walk would silently pass.
  assert.ok(files.length > 0, 'expected at least one *.json under knowledge/');

  const failures = [];
  for (const file of files) {
    const rel = path.relative(KNOWLEDGE_DIR, file);
    let raw;
    try {
      raw = await readFile(file, 'utf8');
    } catch (err) {
      failures.push(`${rel}: unreadable — ${err.message}`);
      continue;
    }
    try {
      JSON.parse(raw);
    } catch (err) {
      // err.message from V8 carries position/extra-data detail (e.g. "Unexpected
      // non-whitespace character after JSON at position N" — the cyp450 class).
      failures.push(`${rel}: ${err.message}`);
    }
  }

  assert.deepEqual(
    failures,
    [],
    `${failures.length} invalid JSON file(s) under knowledge/:\n  ${failures.join('\n  ')}`,
  );
});
