// ingest-manifest.mjs — corpus ingest-delta tracking (queue #152). Maintains a manifest
// (path -> sha256 + size) so re-ingestion processes ONLY new/changed/deleted files instead of
// re-chewing the whole corpus every run. Pure hash/diff logic + a thin node:fs persistence layer.
//
//   import { buildManifest, diffManifest, loadManifest, saveManifest } from './ingest-manifest.mjs'
//   node tools/ingest-manifest.mjs <dir> [manifest.json]   # read-only delta demo
//
// No network, no mutation of the corpus — buildManifest takes an injected readFn so it stays pure
// and testable; only loadManifest/saveManifest touch the filesystem (JSON).

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// sha256 of a buffer/string -> hex
export function sha256(data) {
  return createHash('sha256').update(data).digest('hex');
}

// buildManifest(fileList, readFn) -> { path: { hash, size } }
// readFn(path) returns the file contents (Buffer or string). Pure: no fs access of its own.
export function buildManifest(fileList, readFn) {
  if (typeof readFn !== 'function') throw new TypeError('buildManifest: readFn must be a function');
  const manifest = {};
  for (const path of fileList || []) {
    const data = readFn(path);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data ?? ''));
    manifest[path] = { hash: sha256(buf), size: buf.length };
  }
  return manifest;
}

// diffManifest(old, current) -> { added:[], changed:[], removed:[] }
// added   = paths in current but not old
// changed = paths in both whose hash differs
// removed = paths in old but not current
export function diffManifest(old, current) {
  const prev = old || {};
  const cur = current || {};
  const added = [];
  const changed = [];
  const removed = [];
  for (const path of Object.keys(cur)) {
    if (!(path in prev)) added.push(path);
    else if (prev[path]?.hash !== cur[path]?.hash) changed.push(path);
  }
  for (const path of Object.keys(prev)) {
    if (!(path in cur)) removed.push(path);
  }
  return { added, changed, removed };
}

// loadManifest(path) -> manifest object. Missing file -> {} (first run is not an error).
export function loadManifest(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    if (err && err.code === 'ENOENT') return {};
    throw err;
  }
}

// saveManifest(path, manifest) -> writes pretty JSON. Returns the path written.
export function saveManifest(path, manifest) {
  writeFileSync(path, JSON.stringify(manifest || {}, null, 2) + '\n', 'utf8');
  return path;
}

// --- helpers for the CLI demo (recursive file walk; not exported as the pure core) ---
function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.isFile()) out.push(full);
  }
  return out;
}

// CLI: diff a directory against a saved manifest, read-only (prints the delta, writes nothing).
if (process.argv[1] && process.argv[1].endsWith('ingest-manifest.mjs')) {
  const dir = process.argv[2];
  const manifestPath = process.argv[3] || 'ingest-manifest.json';
  if (!dir) {
    console.error('usage: node tools/ingest-manifest.mjs <dir> [manifest.json]');
    process.exit(1);
  }
  const files = walk(dir).filter((p) => statSync(p).isFile());
  const current = buildManifest(files, (p) => readFileSync(p));
  const old = loadManifest(manifestPath);
  const { added, changed, removed } = diffManifest(old, current);
  console.log(`manifest: ${manifestPath} (${Object.keys(old).length} known)`);
  console.log(`scanned:  ${dir} (${files.length} files)`);
  console.log(`+ added   (${added.length}): ${added.join(', ') || '—'}`);
  console.log(`~ changed (${changed.length}): ${changed.join(', ') || '—'}`);
  console.log(`- removed (${removed.length}): ${removed.join(', ') || '—'}`);
  console.log('(read-only demo — no manifest written, no corpus touched)');
}
