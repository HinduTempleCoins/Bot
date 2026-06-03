// scripture-validate.mjs — scripture corpus integrity validator (queue #151). FAILS when a doc in
// knowledge/scripture/ lacks required frontmatter OR has no matching _index.json entry, and when an
// _index.json entry points at a file that does not exist. Pure validation + read-only node:fs.
//
//   import { parseFrontmatter, validateDoc, validateScripture } from './tools/scripture-validate.mjs'
//   node tools/scripture-validate.mjs            # validate the real dir, read-only, exit!=0 on problems
//
// CI usage — add a step to a GitHub Action (do NOT need a dedicated workflow; e.g. fold into an
// existing .github/workflows/ci.yml):
//
//   - name: Validate scripture corpus
//     run: node tools/scripture-validate.mjs
//
// The non-zero exit on problems lets the Action gate merges. This tool never writes — it only reads
// the scripture .md files and _index.json and reports.

import { readFileSync, readdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

// Default required frontmatter fields for a scripture doc. Callers can override via opts.required.
export const DEFAULT_REQUIRED = ['title', 'key_themes'];

// parseFrontmatter(md) -> object
// Extracts a leading YAML-ish frontmatter block delimited by '---' lines and parses it into a flat
// object. Supports `key: value`, quoted strings, and inline `[a, b, c]` lists. Returns {} when there
// is no frontmatter block. Intentionally minimal — no external YAML dependency.
export function parseFrontmatter(md) {
  const text = String(md ?? '');
  const match = text.match(/^﻿?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!match) return {};
  const body = match[1];
  const out = {};
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const colon = line.indexOf(':');
    if (colon === -1) continue;
    const key = line.slice(0, colon).trim();
    if (!key) continue;
    const value = line.slice(colon + 1).trim();
    out[key] = parseValue(value);
  }
  return out;
}

// parseValue(raw) -> string | array | '' — interpret a scalar frontmatter value.
function parseValue(raw) {
  if (raw === '') return '';
  // inline list: [a, "b", c]
  if (raw.startsWith('[') && raw.endsWith(']')) {
    const inner = raw.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((item) => unquote(item.trim())).filter((s) => s.length > 0);
  }
  return unquote(raw);
}

function unquote(s) {
  if (s.length >= 2 && ((s[0] === '"' && s[s.length - 1] === '"') || (s[0] === "'" && s[s.length - 1] === "'"))) {
    return s.slice(1, -1);
  }
  return s;
}

// isPresent(value) -> bool — a required field counts as present only when it has real content.
function isPresent(value) {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

// validateDoc(md, { required }) -> { ok, missing[] }
// Parses frontmatter from md and reports which required fields are absent/empty. Pure.
export function validateDoc(md, opts = {}) {
  const required = opts.required || DEFAULT_REQUIRED;
  const fm = parseFrontmatter(md);
  const missing = [];
  for (const field of required) {
    if (!isPresent(fm[field])) missing.push(field);
  }
  return { ok: missing.length === 0, missing };
}

// validateScripture({ dir, indexPath, required, readFn, listFn }) -> { ok, problems:[{file, issue}] }
// Checks, read-only:
//   1. every .md in dir (except the index's own json) has all required frontmatter fields
//   2. every .md in dir is referenced by some _index.json document entry (file_md)
//   3. every _index.json document entry's file_md points at a file that exists in dir
// readFn/listFn are injectable for testing; default to node:fs (read-only).
export function validateScripture(opts = {}) {
  const { dir, indexPath, required = DEFAULT_REQUIRED } = opts;
  const readFn = opts.readFn || ((p) => readFileSync(p, 'utf8'));
  const listFn = opts.listFn || ((d) => readdirSync(d));
  const problems = [];

  if (!dir) throw new TypeError('validateScripture: dir is required');
  const resolvedIndexPath = indexPath || join(dir, '_index.json');

  // Parse the index.
  let index;
  try {
    index = JSON.parse(readFn(resolvedIndexPath));
  } catch (err) {
    problems.push({ file: basename(resolvedIndexPath), issue: `cannot read/parse index: ${err.message}` });
    return { ok: false, problems };
  }

  const entries = Array.isArray(index?.documents) ? index.documents : [];
  const indexedFiles = new Set();
  for (const entry of entries) {
    const fileMd = entry?.file_md;
    if (!fileMd) {
      problems.push({ file: '_index.json', issue: `entry "${entry?.id || entry?.title || 'unknown'}" has no file_md` });
      continue;
    }
    indexedFiles.add(fileMd);
  }

  // List the .md files actually present (exclude any non-md and the index itself).
  const mdFiles = listFn(dir).filter((name) => name.endsWith('.md'));

  // 1 + 2: each present .md has frontmatter and is indexed.
  for (const name of mdFiles) {
    let content;
    try {
      content = readFn(join(dir, name));
    } catch (err) {
      problems.push({ file: name, issue: `cannot read: ${err.message}` });
      continue;
    }
    const { ok, missing } = validateDoc(content, { required });
    if (!ok) {
      problems.push({ file: name, issue: `missing required frontmatter: ${missing.join(', ')}` });
    }
    if (!indexedFiles.has(name)) {
      problems.push({ file: name, issue: 'not referenced by any _index.json entry' });
    }
  }

  // 3: each indexed file exists on disk.
  const presentSet = new Set(mdFiles);
  for (const fileMd of indexedFiles) {
    if (!presentSet.has(fileMd)) {
      problems.push({ file: fileMd, issue: 'referenced by _index.json but file is missing from dir' });
    }
  }

  return { ok: problems.length === 0, problems };
}

// CLI: validate the real scripture dir, read-only, non-zero exit on problems (for CI gating).
if (process.argv[1] && process.argv[1].endsWith('scripture-validate.mjs')) {
  const here = fileURLToPath(new URL('.', import.meta.url));
  const dir = process.argv[2] || join(here, '..', 'knowledge', 'scripture');
  const { ok, problems } = validateScripture({ dir });
  if (ok) {
    console.log(`scripture-validate: OK (${dir})`);
    process.exit(0);
  }
  console.error(`scripture-validate: ${problems.length} problem(s) in ${dir}`);
  for (const p of problems) {
    console.error(`  - ${p.file}: ${p.issue}`);
  }
  process.exit(1);
}
