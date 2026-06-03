// scripture-validate.test.mjs — OFFLINE unit tests for the scripture corpus validator (queue #151).
// Covers parseFrontmatter (block + inline list + quotes + absent), validateDoc (flags missing fields),
// and validateScripture (catches a doc missing from the index, an index entry with a missing file, and
// a clean corpus). Uses temp files in the OS tmp dir; no network, no real-corpus access.
//
//   node --test tools/scripture-validate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseFrontmatter,
  validateDoc,
  validateScripture,
  DEFAULT_REQUIRED,
} from './scripture-validate.mjs';

const fm = (obj) => {
  const lines = ['---'];
  for (const [k, v] of Object.entries(obj)) {
    if (Array.isArray(v)) lines.push(`${k}: [${v.map((x) => JSON.stringify(x)).join(', ')}]`);
    else lines.push(`${k}: ${v}`);
  }
  lines.push('---', '', 'body text here');
  return lines.join('\n');
};

// --- parseFrontmatter ---

test('parseFrontmatter parses key: value pairs', () => {
  const out = parseFrontmatter('---\ntitle: Hello\nid: foo\n---\nbody');
  assert.equal(out.title, 'Hello');
  assert.equal(out.id, 'foo');
});

test('parseFrontmatter parses inline lists', () => {
  const out = parseFrontmatter('---\nkey_themes: [a, "b c", d]\n---\nbody');
  assert.deepEqual(out.key_themes, ['a', 'b c', 'd']);
});

test('parseFrontmatter strips quotes from scalar values', () => {
  const out = parseFrontmatter('---\ntitle: "Quoted Title"\n---\nx');
  assert.equal(out.title, 'Quoted Title');
});

test('parseFrontmatter returns {} when no frontmatter block', () => {
  assert.deepEqual(parseFrontmatter('# just markdown\n\nno frontmatter'), {});
  assert.deepEqual(parseFrontmatter(''), {});
  assert.deepEqual(parseFrontmatter(undefined), {});
});

test('parseFrontmatter ignores comments and blank lines in block', () => {
  const out = parseFrontmatter('---\n# a comment\n\ntitle: T\n---\nx');
  assert.deepEqual(out, { title: 'T' });
});

// --- validateDoc ---

test('validateDoc passes when all required fields present', () => {
  const md = fm({ title: 'T', key_themes: ['x', 'y'] });
  const r = validateDoc(md);
  assert.deepEqual(r, { ok: true, missing: [] });
});

test('validateDoc flags missing fields', () => {
  const md = fm({ title: 'T' }); // key_themes missing
  const r = validateDoc(md);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['key_themes']);
});

test('validateDoc treats empty string / empty list as missing', () => {
  const md = '---\ntitle: \nkey_themes: []\n---\nbody';
  const r = validateDoc(md);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing.sort(), ['key_themes', 'title']);
});

test('validateDoc honors custom required list', () => {
  const md = fm({ title: 'T', key_themes: ['x'] });
  const r = validateDoc(md, { required: ['title', 'key_themes', 'received_at'] });
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['received_at']);
});

test('DEFAULT_REQUIRED is exported and includes title + key_themes', () => {
  assert.ok(DEFAULT_REQUIRED.includes('title'));
  assert.ok(DEFAULT_REQUIRED.includes('key_themes'));
});

// --- validateScripture (temp dir) ---

function makeCorpus(files) {
  const dir = mkdtempSync(join(tmpdir(), 'scripture-validate-'));
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(dir, name), content, 'utf8');
  }
  return dir;
}

test('validateScripture passes on a clean corpus', () => {
  const dir = makeCorpus({
    'a.md': fm({ title: 'A', key_themes: ['t1'] }),
    'b.md': fm({ title: 'B', key_themes: ['t2'] }),
    '_index.json': JSON.stringify({
      documents: [
        { id: 'a', file_md: 'a.md' },
        { id: 'b', file_md: 'b.md' },
      ],
    }),
  });
  try {
    const r = validateScripture({ dir });
    assert.deepEqual(r, { ok: true, problems: [] });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateScripture catches a doc missing from the index', () => {
  const dir = makeCorpus({
    'a.md': fm({ title: 'A', key_themes: ['t1'] }),
    'orphan.md': fm({ title: 'Orphan', key_themes: ['t9'] }),
    '_index.json': JSON.stringify({ documents: [{ id: 'a', file_md: 'a.md' }] }),
  });
  try {
    const r = validateScripture({ dir });
    assert.equal(r.ok, false);
    const orphan = r.problems.find((p) => p.file === 'orphan.md');
    assert.ok(orphan, 'expected a problem for orphan.md');
    assert.match(orphan.issue, /not referenced/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateScripture catches an index entry whose file is missing', () => {
  const dir = makeCorpus({
    'a.md': fm({ title: 'A', key_themes: ['t1'] }),
    '_index.json': JSON.stringify({
      documents: [
        { id: 'a', file_md: 'a.md' },
        { id: 'ghost', file_md: 'ghost.md' },
      ],
    }),
  });
  try {
    const r = validateScripture({ dir });
    assert.equal(r.ok, false);
    const ghost = r.problems.find((p) => p.file === 'ghost.md');
    assert.ok(ghost, 'expected a problem for ghost.md');
    assert.match(ghost.issue, /missing from dir/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateScripture flags a doc missing required frontmatter', () => {
  const dir = makeCorpus({
    'a.md': '# no frontmatter at all\n\nbody',
    '_index.json': JSON.stringify({ documents: [{ id: 'a', file_md: 'a.md' }] }),
  });
  try {
    const r = validateScripture({ dir });
    assert.equal(r.ok, false);
    const a = r.problems.find((p) => p.file === 'a.md');
    assert.ok(a);
    assert.match(a.issue, /missing required frontmatter/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateScripture flags an index entry with no file_md', () => {
  const dir = makeCorpus({
    'a.md': fm({ title: 'A', key_themes: ['t1'] }),
    '_index.json': JSON.stringify({ documents: [{ id: 'a', file_md: 'a.md' }, { id: 'bad' }] }),
  });
  try {
    const r = validateScripture({ dir });
    assert.equal(r.ok, false);
    assert.ok(r.problems.some((p) => /has no file_md/.test(p.issue)));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateScripture reports an unparseable index', () => {
  const dir = makeCorpus({ '_index.json': '{ not valid json' });
  try {
    const r = validateScripture({ dir });
    assert.equal(r.ok, false);
    assert.match(r.problems[0].issue, /cannot read\/parse index/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('validateScripture throws when dir is omitted', () => {
  assert.throws(() => validateScripture({}), TypeError);
});
