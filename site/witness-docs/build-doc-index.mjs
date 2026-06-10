// build-doc-index.mjs — list the witness-docs Markdown pages and verify the
// index links to each one. Offline, no network, soft-fail (returns a report
// object; never throws on a missing file). CLI prints the report.
//
// House style: ESM .mjs, esc() all interpolation, CLI guarded by argv[1] check,
// pure functions exported for tests. There is no server here — this is a tiny
// build/verify helper for the static doc set.

import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX = 'index.md';
const HELPER_SCRIPTS = new Set(['build-doc-index.mjs', 'build-doc-index.test.mjs']);

// Minimal HTML escaper kept for house-style parity even though output is plain text.
export function esc(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

// List the .md doc pages (excluding the index itself), sorted, soft-failing to [].
export async function listDocPages(dir = HERE) {
  let entries = [];
  try {
    entries = await readdir(dir);
  } catch {
    return [];
  }
  return entries
    .filter((f) => f.endsWith('.md') && f !== INDEX)
    .sort();
}

// Given the index body and a list of page filenames, find which pages the index links to.
export function findLinkedPages(indexBody, pages) {
  const body = String(indexBody || '');
  const linked = [];
  const missing = [];
  for (const p of pages) {
    // Match a relative markdown link to ./page.md (with or without leading ./).
    if (body.includes(`(./${p})`) || body.includes(`(${p})`)) linked.push(p);
    else missing.push(p);
  }
  return { linked, missing };
}

// Produce a report: every page present, and whether the index links them all.
export async function buildReport(dir = HERE) {
  const pages = await listDocPages(dir);
  let indexBody = '';
  let indexFound = true;
  try {
    indexBody = await readFile(join(dir, INDEX), 'utf8');
  } catch {
    indexFound = false;
  }
  const { linked, missing } = findLinkedPages(indexBody, pages);
  return {
    indexFound,
    pageCount: pages.length,
    pages,
    linkedCount: linked.length,
    missingFromIndex: missing,
    ok: indexFound && missing.length === 0,
  };
}

function render(report) {
  const lines = [];
  lines.push(`witness-docs index check — ${esc(report.ok ? 'OK' : 'ISSUES')}`);
  lines.push(`  index.md present: ${report.indexFound ? 'yes' : 'NO'}`);
  lines.push(`  doc pages: ${report.pageCount}`);
  for (const p of report.pages) {
    const isLinked = !report.missingFromIndex.includes(p);
    lines.push(`    ${isLinked ? '[linked]' : '[MISSING]'} ${esc(p)}`);
  }
  if (report.missingFromIndex.length) {
    lines.push(`  NOT linked from index: ${report.missingFromIndex.map(esc).join(', ')}`);
  }
  return lines.join('\n');
}

// CLI guard — only runs when invoked directly.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  buildReport().then((r) => {
    console.log(render(r));
    process.exit(r.ok ? 0 : 1);
  });
}

export { HELPER_SCRIPTS, render };
