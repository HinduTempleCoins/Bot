// from-tracker.mjs — wire the deterministic Brief floor (rules-floor.mjs) to REAL tracker data.
//
// rules-floor.mjs is the policy (score → rank → bucket → render a stable skeleton). It takes an
// array of items. The tracker, though, lives on disk as JSONL (.local/queue-items.jsonl): one
// JSON object per line, item shape { id, file, section, text, status, dependsHint, links }. This
// module is the thin, pure adapter between the two:
//
//   import { loadItems, renderBriefFromJsonl } from './from-tracker.mjs'
//   loadItems(jsonlString)                   -> Item[]   (parse, soft-fail per line)
//   renderBriefFromJsonl(jsonlString, opts)  -> markdown (loadItems → buildFloor → renderMarkdown)
//
// The only IO is reading the JSONL, and it is injectable via __setReader. The CLI reads
// .local/queue-items.jsonl (if present) through that same seam. Pure, offline,
// soft-fail-never-throw. No network, no Date.now().

import { buildFloor, renderMarkdown } from './rules-floor.mjs';

// --- injectable reader seam (the only IO) ----------------------------------------------------
// A reader is `() => string` returning the raw JSONL text. Tests/callers swap it with __setReader;
// the CLI installs a default that reads the tracker file from disk. The module stays pure on
// import — fs is only loaded at the CLI boundary, and only if no reader was injected.
let _reader = null;

/** Override the JSONL reader (`() => string`). Pass nothing/falsy to clear it. */
export function __setReader(reader) {
  _reader = typeof reader === 'function' ? reader : null;
}

/** Read raw JSONL via the injected reader, else ''. Soft-fail: any throw → ''. */
function readRaw() {
  if (!_reader) return '';
  try {
    return String(_reader() || '');
  } catch {
    return '';
  }
}

/**
 * Parse a JSONL string into tracker items. One JSON object per line; blank lines and lines that
 * fail to parse (or that aren't plain objects) are skipped. Soft-fail: bad input → []. Never throws.
 *
 * @param {string} jsonlText  raw JSONL (the tracker file contents)
 * @returns {Array<object>}   items in file order
 */
export function loadItems(jsonlText) {
  if (typeof jsonlText !== 'string' || !jsonlText.trim()) return [];
  const items = [];
  for (const raw of jsonlText.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue; // skip a malformed line, keep going
    }
    if (obj && typeof obj === 'object' && !Array.isArray(obj)) items.push(obj);
  }
  return items;
}

/**
 * Render a deterministic Brief skeleton from raw JSONL tracker text. Composes
 * loadItems → buildFloor → renderMarkdown. Byte-identical for identical input. Never throws.
 *
 * @param {string} jsonlText  raw JSONL (the tracker file contents)
 * @param {object} [opts]     forwarded to buildFloor (e.g. { doNextCap, weights })
 * @returns {string}          stable markdown skeleton (esc-safe, ends in a newline)
 */
export function renderBriefFromJsonl(jsonlText, opts = {}) {
  try {
    const items = loadItems(jsonlText);
    return renderMarkdown(buildFloor(items, opts || {}));
  } catch {
    return renderMarkdown(buildFloor([])); // soft-fail to an empty (but valid) skeleton
  }
}

// --- CLI (guarded; reads .local/queue-items.jsonl via the reader seam) -----------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  if (!_reader) {
    const fs = await import('node:fs');
    const QUEUE_PATH = '.local/queue-items.jsonl';
    __setReader(() => (fs.existsSync(QUEUE_PATH) ? fs.readFileSync(QUEUE_PATH, 'utf8') : ''));
  }
  process.stdout.write(renderBriefFromJsonl(readRaw()));
}
