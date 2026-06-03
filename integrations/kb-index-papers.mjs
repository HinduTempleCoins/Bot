// kb-index-papers.mjs — Task #50: index the operator's own peer-reviewed research papers (the
// Heterosis-mechanism paper and Mythology-as-Genealogy) — already verbatim in the scripture corpus
// at knowledge/scripture/ — into the knowledge base as searchable, CHUNKED, CITABLE records.
//
// One job: take a corpus document (markdown with a metadata header), split its body into overlapping
// chunks on sentence/paragraph boundaries, and emit per-chunk records each carrying enough provenance
// (docId, source, title, ord, charStart) that a retrieval layer can cite the exact passage it used.
//
//   import { indexPapers, toRecords } from './integrations/kb-index-papers.mjs';
//   const indexed = await indexPapers(SCRIPTURE_PAPERS);   // reads the real .md files
//   const records = toRecords(indexed);                    // flat citable chunks for a vector store
//
// The default reader pulls the real files via node:fs/promises and SOFT-FAILS to [] (never throws),
// so an unreadable/missing doc is skipped rather than crashing the batch. Tests inject canned doc
// strings via __setReader() so they run fully offline with no filesystem dependency.
//
// CLI:  node integrations/kb-index-papers.mjs            → indexes the two scripture papers, prints a summary
//       node integrations/kb-index-papers.mjs --json     → prints the flat citable records as JSON
//
// SECURITY: read-only over local files. No keys, no network, no secrets. Never writes to disk, never
// touches knowledge/** (those files are read-only source of truth). Best-effort, no-throw throughout.

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCRIPTURE_DIR = resolve(__dirname, '../knowledge/scripture');

// The operator's own peer-reviewed papers, already in the scripture corpus (see scripture/_index.json).
// These are what task #50 names explicitly; the indexer is generic and works on any corpus doc.
export const SCRIPTURE_PAPERS = [
  { id: 'heterosis_mechanism', path: resolve(SCRIPTURE_DIR, 'heterosis_mechanism.md'), source: 'knowledge/scripture/heterosis_mechanism.md' },
  { id: 'mythology_as_genealogy', path: resolve(SCRIPTURE_DIR, 'mythology_as_genealogy.md'), source: 'knowledge/scripture/mythology_as_genealogy.md' },
];

// ── Injectable file reader (offline-testable) ───────────────────────────────────────────────────
// Default: read the real file as utf-8 via node:fs/promises, soft-fail to null on any error.
// __setReader(fn) lets tests feed canned doc strings keyed by path (or ignore the path entirely).
let _reader = async (path) => {
  try {
    const { readFile } = await import('node:fs/promises');
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
};

/** Override the file reader. Pass a fn (path) => string|null|Promise<...>, or null to restore default. */
export function __setReader(fn) {
  _reader = fn || (async (path) => {
    try {
      const { readFile } = await import('node:fs/promises');
      return await readFile(path, 'utf8');
    } catch {
      return null;
    }
  });
}

// ── chunkText ───────────────────────────────────────────────────────────────────────────────────
/**
 * Split text into overlapping chunks on sentence/paragraph boundaries. Pure + deterministic.
 *
 * Each chunk is at most `maxChars` long; consecutive chunks overlap by ~`overlap` chars so a passage
 * that straddles a boundary is still wholly contained in one chunk. The chunks together cover the
 * whole text with no gaps (chunk[n].charStart <= previous chunk's end), which the tests assert.
 *
 * @param {string} text
 * @param {{ maxChars?: number, overlap?: number }} [opts]
 * @returns {Array<{ text: string, charStart: number }>}
 */
export function chunkText(text, { maxChars = 1200, overlap = 150 } = {}) {
  const src = typeof text === 'string' ? text.trim() : '';
  if (!src) return [];
  const max = Math.max(1, Math.floor(maxChars));
  // Overlap must be smaller than maxChars or the window can't advance — clamp it.
  const ov = Math.min(Math.max(0, Math.floor(overlap)), max - 1);

  if (src.length <= max) return [{ text: src, charStart: 0 }];

  const chunks = [];
  let start = 0;
  while (start < src.length) {
    let end = Math.min(start + max, src.length);

    // If we're not at the very end, back `end` up to the nearest natural boundary inside the window
    // (paragraph break > sentence end > whitespace) so chunks split on prose, not mid-word.
    if (end < src.length) {
      const window = src.slice(start, end);
      const boundary = lastBoundary(window);
      // Only honor the boundary if it leaves a non-trivial chunk (avoid pathological tiny chunks).
      if (boundary > Math.floor(max * 0.5)) {
        end = start + boundary;
      }
    }

    const piece = src.slice(start, end).trim();
    if (piece) chunks.push({ text: piece, charStart: start });

    if (end >= src.length) break;
    // Advance the window, stepping back by `overlap` so chunks overlap. Guard against no-progress.
    const next = end - ov;
    start = next > start ? next : end;
  }
  return chunks;
}

// Find the index just past the best split boundary within a window: prefer a paragraph break,
// then a sentence terminator, then any whitespace. Returns the window length if none found.
function lastBoundary(window) {
  const para = window.lastIndexOf('\n\n');
  if (para > 0) return para + 2;
  const sentence = Math.max(
    window.lastIndexOf('. '),
    window.lastIndexOf('! '),
    window.lastIndexOf('? '),
    window.lastIndexOf('.\n'),
    window.lastIndexOf('!\n'),
    window.lastIndexOf('?\n'),
  );
  if (sentence > 0) return sentence + 2;
  const space = window.lastIndexOf(' ');
  if (space > 0) return space + 1;
  return window.length;
}

// ── parseFrontmatter ────────────────────────────────────────────────────────────────────────────
/**
 * Split a corpus doc into { meta, body }. Two shapes are supported, both used in this repo:
 *
 *  1. YAML-ish frontmatter fenced by --- at the very top:
 *       ---
 *       title: ...
 *       author: ...
 *       ---
 *       <body>
 *
 *  2. The scripture markdown shape: a leading "# Title" line followed by a "**Key:** value" block,
 *     terminated by a "---" rule, then the body. The header keys are folded into meta and the
 *     H1 title is captured as meta.title.
 *
 * No-frontmatter input returns { meta: {}, body: <whole input trimmed> }. Never throws.
 *
 * @param {string} raw
 * @returns {{ meta: Record<string,string>, body: string }}
 */
export function parseFrontmatter(raw) {
  const text = typeof raw === 'string' ? raw.replace(/\r\n/g, '\n') : '';
  if (!text.trim()) return { meta: {}, body: '' };

  // Shape 1: leading --- fenced YAML-ish block.
  if (/^---\s*\n/.test(text)) {
    const end = text.indexOf('\n---', 4);
    if (end !== -1) {
      const block = text.slice(text.indexOf('\n') + 1, end);
      const body = text.slice(end + 4).replace(/^\s*\n/, '').trim();
      return { meta: parseKeyVals(block), body };
    }
  }

  // Shape 2: "# Title" + "**Key:** value" header, ended by a --- horizontal rule.
  const meta = {};
  const lines = text.split('\n');
  const h1 = lines.find((l) => /^#\s+/.test(l));
  if (h1) meta.title = h1.replace(/^#\s+/, '').trim();

  // Pull **Key:** value pairs from the region above the first --- rule (or whole doc if no rule).
  const ruleIdx = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l.trim()));
  const headerRegion = (ruleIdx > 0 ? lines.slice(0, ruleIdx) : lines).join('\n');
  for (const m of headerRegion.matchAll(/^\*\*([^*:]+):\*\*\s*(.+?)\s*$/gm)) {
    const key = m[1].trim().toLowerCase().replace(/\s+/g, '_');
    if (!(key in meta)) meta[key] = stripMd(m[2]);
  }

  const body = (ruleIdx > 0 ? lines.slice(ruleIdx + 1).join('\n') : text).trim();
  return { meta, body };
}

// Parse a simple "key: value" block (one pair per line). Tolerant: ignores blank/comment/list lines.
function parseKeyVals(block) {
  const meta = {};
  for (const line of block.split('\n')) {
    const m = line.match(/^\s*([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (m) {
      const key = m[1].trim().toLowerCase();
      let val = m[2].trim().replace(/^["']|["']$/g, '');
      meta[key] = val;
    }
  }
  return meta;
}

// Strip light markdown emphasis/links from a header value so meta holds plain text.
function stripMd(s) {
  return String(s)
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`/g, '')
    .trim();
}

// ── indexDocument ───────────────────────────────────────────────────────────────────────────────
/**
 * Index a single document: parse its header, chunk the body, and tag each chunk for citation.
 *
 * @param {string} raw                       the full document text (frontmatter + body)
 * @param {{ id: string, source?: string, maxChars?: number, overlap?: number }} opts
 * @returns {{ id, source, title, author?, chunks:Array<{id,ord,text,charStart}>, indexedAt }}
 */
export function indexDocument(raw, { id, source, maxChars, overlap } = {}) {
  const docId = id || 'doc';
  const { meta, body } = parseFrontmatter(raw);
  const pieces = chunkText(body, { maxChars, overlap });
  const chunks = pieces.map((p, ord) => ({
    id: `${docId}#${ord}`,
    ord,
    text: p.text,
    charStart: p.charStart,
  }));
  return {
    id: docId,
    source: source || meta.source || docId,
    title: meta.title || docId,
    author: meta.author || undefined,
    chunks,
    indexedAt: new Date().toISOString(),
  };
}

// ── indexPapers ─────────────────────────────────────────────────────────────────────────────────
/**
 * Run indexDocument over a list of entries, reading each via the injectable reader. Entries that
 * carry `raw` are used directly; otherwise `path` is read. Unreadable/empty entries are soft-skipped
 * (logged to stderr, omitted from the result) rather than throwing. Never throws.
 *
 * @param {Array<{ id:string, path?:string, raw?:string, source?:string }>} [entries]
 * @param {{ maxChars?: number, overlap?: number }} [opts]
 * @returns {Promise<Array<ReturnType<typeof indexDocument>>>}
 */
export async function indexPapers(entries = SCRIPTURE_PAPERS, opts = {}) {
  const list = Array.isArray(entries) ? entries : [];
  const out = [];
  for (const entry of list) {
    if (!entry || !entry.id) continue;
    let raw = typeof entry.raw === 'string' ? entry.raw : null;
    if (raw == null && entry.path) {
      try {
        raw = await _reader(entry.path);
      } catch {
        raw = null;
      }
    }
    if (typeof raw !== 'string' || !raw.trim()) {
      // Soft-skip: the doc couldn't be read or was empty.
      try { console.error(`[kb-index-papers] skipped unreadable entry: ${entry.id}`); } catch {}
      continue;
    }
    const indexed = indexDocument(raw, {
      id: entry.id,
      source: entry.source || entry.path,
      maxChars: opts.maxChars,
      overlap: opts.overlap,
    });
    if (indexed.chunks.length) out.push(indexed);
  }
  return out;
}

// ── toRecords ───────────────────────────────────────────────────────────────────────────────────
/**
 * Flatten indexed documents into a flat list of citable chunk records, ready to push into a vector
 * store / search index. Each record stands alone and carries its provenance.
 *
 * @param {Array<ReturnType<typeof indexDocument>>} indexed
 * @returns {Array<{ docId, chunkId, ord, text, source, title }>}
 */
export function toRecords(indexed) {
  const docs = Array.isArray(indexed) ? indexed : [];
  const records = [];
  for (const doc of docs) {
    if (!doc || !Array.isArray(doc.chunks)) continue;
    for (const c of doc.chunks) {
      records.push({
        docId: doc.id,
        chunkId: c.id,
        ord: c.ord,
        text: c.text,
        source: doc.source,
        title: doc.title,
      });
    }
  }
  return records;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
const isMain =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('kb-index-papers.mjs');

if (isMain) {
  const asJson = process.argv.includes('--json');
  const indexed = await indexPapers();
  const records = toRecords(indexed);
  if (asJson) {
    console.log(JSON.stringify(records, null, 2));
  } else {
    console.error(`[kb-index-papers] scripture dir: ${SCRIPTURE_DIR}`);
    for (const doc of indexed) {
      console.log(`\n${doc.title}`);
      console.log(`  id=${doc.id}  source=${doc.source}`);
      console.log(`  chunks=${doc.chunks.length}${doc.author ? `  author=${doc.author}` : ''}`);
    }
    console.log(`\n[kb-index-papers] ${indexed.length} doc(s) → ${records.length} citable chunk record(s).`);
  }
}
