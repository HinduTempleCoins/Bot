// build-doc-index.test.mjs — offline tests for the witness-docs index checker.
// node --test, no network, no fixtures beyond the real doc dir alongside this file.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  esc,
  listDocPages,
  findLinkedPages,
  buildReport,
  render,
} from './build-doc-index.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

test('esc escapes HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
});

test('listDocPages returns sorted .md pages excluding index.md', async () => {
  const pages = await listDocPages(HERE);
  assert.ok(pages.length >= 7, `expected the 7 doc pages, got ${pages.length}`);
  assert.ok(!pages.includes('index.md'), 'index.md must be excluded');
  assert.ok(pages.includes('keys-explained.md'));
  assert.ok(pages.includes('running-a-node.md'));
  const sorted = [...pages].sort();
  assert.deepEqual(pages, sorted, 'pages should come back sorted');
});

test('listDocPages soft-fails to [] on a missing directory', async () => {
  const pages = await listDocPages('/no/such/dir/anywhere');
  assert.deepEqual(pages, []);
});

test('findLinkedPages splits linked vs missing', () => {
  const body = 'see [a](./a.md) and [b](b.md) but not c';
  const { linked, missing } = findLinkedPages(body, ['a.md', 'b.md', 'c.md']);
  assert.deepEqual(linked.sort(), ['a.md', 'b.md']);
  assert.deepEqual(missing, ['c.md']);
});

test('findLinkedPages tolerates empty/nullish body', () => {
  const { linked, missing } = findLinkedPages(null, ['a.md']);
  assert.deepEqual(linked, []);
  assert.deepEqual(missing, ['a.md']);
});

test('buildReport: real index links every doc page (no broken internal links)', async () => {
  const report = await buildReport(HERE);
  assert.equal(report.indexFound, true, 'index.md should exist');
  assert.deepEqual(report.missingFromIndex, [], 'every page must be linked from index.md');
  assert.equal(report.ok, true);
  assert.equal(report.linkedCount, report.pageCount);
});

test('render produces a human-readable report string', async () => {
  const report = await buildReport(HERE);
  const out = render(report);
  assert.match(out, /witness-docs index check/);
  assert.match(out, /\[linked\] keys-explained\.md/);
});
