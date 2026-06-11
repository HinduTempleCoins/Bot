// knowledge/cryptocurrency/kb-query.mjs
//
// Read-only query helper over the existing knowledge/synthesis/knowledge-base.json.
// This is the public-safe "query the knowledge base" surface: it loads the JSON,
// lists top-level topics, fetches one topic, and substring-searches across all
// nested string values. It NEVER edits, writes, or mutates the data file — the
// actual content additions are left to the data file itself.
//
// No network, no chain calls, no key material. Disk IO is behind an injectable
// reader seam (__setReader) so tests run fully offline without touching the file.
//
// House style: ESM .mjs, esc() all HTML interpolation, CLI guarded by
// process.argv[1], soft-fail never throw (missing/malformed -> {} or []).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Default location of the knowledge base, relative to this module.
// Overridable via arg to loadKb() or the KB_PATH env var.
export const DEFAULT_KB_PATH = resolve(__dirname, '../synthesis/knowledge-base.json');

/** HTML-escape any interpolated value. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

// Injectable reader seam: (path) => string. Defaults to a soft-failing
// synchronous file read. Tests swap this out so no disk/network is touched.
let _read = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/** Override the reader for tests. reader: (path) => string|null. */
export function __setReader(fn) {
  _read = typeof fn === 'function' ? fn : _read;
}

/** Restore the default disk reader. */
export function __resetReader() {
  _read = (path) => {
    try {
      return readFileSync(path, 'utf8');
    } catch {
      return null;
    }
  };
}

/**
 * Load the knowledge base as a plain object.
 * Path resolution: explicit arg -> KB_PATH env -> DEFAULT_KB_PATH.
 * Soft-fail to {} if the file is missing, unreadable, or malformed JSON.
 * Never throws; never mutates anything on disk.
 */
export function loadKb(path) {
  const p = path || process.env.KB_PATH || DEFAULT_KB_PATH;
  let raw;
  try {
    raw = _read(p);
  } catch {
    return {};
  }
  if (raw == null || raw === '') return {};
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch {
    return {};
  }
  // Only object-shaped roots are usable as a topic map.
  if (obj == null || typeof obj !== 'object' || Array.isArray(obj)) return {};
  return obj;
}

/** Top-level topic keys, in declared order. Non-object -> []. */
export function topics(kb) {
  if (kb == null || typeof kb !== 'object' || Array.isArray(kb)) return [];
  return Object.keys(kb);
}

/**
 * Fetch one top-level topic by key (case-insensitive, trimmed).
 * Unknown / null / non-object kb -> null (soft-fail). Read-only: returns the
 * stored value as-is (no copy, no mutation).
 */
export function getTopic(kb, key) {
  if (kb == null || typeof kb !== 'object' || Array.isArray(kb)) return null;
  if (key == null) return null;
  const want = String(key).trim();
  if (!want) return null;
  if (Object.prototype.hasOwnProperty.call(kb, want)) return kb[want];
  const lower = want.toLowerCase();
  for (const k of Object.keys(kb)) {
    if (k.toLowerCase() === lower) return kb[k];
  }
  return null;
}

/**
 * Case-insensitive substring search across every nested string value.
 * Returns [{ path, snippet }] where path is the dotted/indexed key path to the
 * matching string and snippet is a trimmed window around the match.
 * Empty / null term or non-object kb -> [].
 */
export function search(kb, term) {
  if (kb == null || typeof kb !== 'object') return [];
  if (term == null) return [];
  const q = String(term).trim().toLowerCase();
  if (!q) return [];

  const out = [];
  const walk = (node, path) => {
    if (typeof node === 'string') {
      const idx = node.toLowerCase().indexOf(q);
      if (idx !== -1) out.push({ path, snippet: snippetOf(node, idx, q.length) });
      return;
    }
    if (Array.isArray(node)) {
      node.forEach((v, i) => walk(v, `${path}[${i}]`));
      return;
    }
    if (node && typeof node === 'object') {
      for (const k of Object.keys(node)) {
        walk(node[k], path ? `${path}.${k}` : k);
      }
    }
  };
  walk(kb, '');
  return out;
}

/** Build a trimmed window of context around a match. */
function snippetOf(str, idx, len, pad = 60) {
  const start = Math.max(0, idx - pad);
  const end = Math.min(str.length, idx + len + pad);
  let s = str.slice(start, end).replace(/\s+/g, ' ').trim();
  if (start > 0) s = `…${s}`;
  if (end < str.length) s = `${s}…`;
  return s;
}

/**
 * Deterministic render of search results.
 * { html:false } (default) -> plain text, one line per result.
 * { html:true }            -> an esc()'d HTML list.
 */
export function render(results, { html = false } = {}) {
  const list = Array.isArray(results) ? results : [];
  if (html) {
    if (!list.length) return '<ul class="kb-results"></ul>';
    const body = list
      .map(
        (r) =>
          '<li>' +
          `<code>${esc(r.path)}</code>: ` +
          `<span>${esc(r.snippet)}</span>` +
          '</li>',
      )
      .join('');
    return `<ul class="kb-results">${body}</ul>`;
  }
  return list.map((r) => `${r.path}: ${r.snippet}`).join('\n');
}

// CLI: `node kb-query.mjs [term]`. No arg -> print top-level topics.
// With a term -> print substring search results.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const arg = process.argv[2];
  const kb = loadKb();
  if (!arg) {
    const t = topics(kb);
    if (!t.length) {
      process.stdout.write('Knowledge base empty or unreadable.\n');
    } else {
      process.stdout.write(`Topics (${t.length}):\n  ${t.join('\n  ')}\n`);
    }
  } else {
    const results = search(kb, arg);
    if (!results.length) {
      process.stdout.write(`No matches for "${arg}".\n`);
    } else {
      process.stdout.write(`${render(results)}\n`);
    }
  }
}
