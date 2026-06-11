// scripture-index.mjs — a pure, offline searchable index over the canonical
// corpus (the .md docs under knowledge/scripture/ and friends).
//
// WHY THIS EXISTS
//   The scripture corpus (Phoenix Protocol, AI Consciousness Synthesis, Zar-AI,
//   Van Kush Master Synthesis, The Convergence) sits on disk as Markdown. To let
//   Hathor and the brief/annal writers actually FIND the right passage without a
//   model or a vector store, this builds a deterministic term-frequency index and
//   ranks docs by query/term overlap — fully offline, no network, no LLM.
//
//   It is the always-available lexical companion to integrations/library-index.mjs
//   (which adds embeddings). This one never embeds, never fetches: pure transform.
//
// EXPORTS
//   esc(s)                       — HTML-safe escaping for snippet rendering
//   buildIndex(docs)             — index over [{id,title,text}] (caller-supplied)
//   search(index, query, {k})    — ranked [{id,title,score,snippet}] by TF overlap
//                                   (deterministic, case-insensitive, stopword-trimmed)
//   __setReader(fn) / __setLister(fn) — injectable IO seams used by the CLI
//
//   import { buildIndex, search, esc } from './scripture-index.mjs';
//
// CLI:  node knowledge/scripture-index.mjs "<query>" [k]
//       (reads knowledge/scripture/*.md via the injectable reader/lister)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTURE_DIR = path.join(__dirname, 'scripture');

// ── esc() — escape any value interpolated into rendered (HTML) snippet text ──────
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── stopwords — trimmed so common glue words don't dominate the ranking ──────────
const STOP = new Set(['the', 'and', 'for', 'that', 'with', 'this', 'from', 'are',
  'was', 'has', 'not', 'can', 'all', 'but', 'you', 'your', 'our', 'its', 'his',
  'her', 'they', 'them', 'have', 'will', 'which', 'when', 'what', 'who', 'how',
  'into', 'than', 'then', 'also', 'such', 'these', 'those', 'a', 'an', 'of', 'to',
  'in', 'is', 'it', 'as', 'at', 'be', 'by', 'on', 'or', 'we', 'if', 'so', 'do']);

// tokenize: lowercase, split on non-alphanumerics, drop stopwords + 1-char tokens.
function tokenize(text) {
  const out = [];
  for (const w of String(text == null ? '' : text).toLowerCase().match(/[a-z0-9]+/g) || []) {
    if (w.length < 2 || STOP.has(w)) continue;
    out.push(w);
  }
  return out;
}

// buildIndex — index a list of caller-supplied docs.
//   docs: [{ id, title, text }]
//   Soft-fail: non-array/garbage -> empty index; docs without an id or text are
//   skipped. Each entry stores a term-frequency map + the raw text for snippets.
export function buildIndex(docs) {
  const entries = [];
  if (!Array.isArray(docs)) return { entries, df: {}, n: 0 };
  const df = {}; // document frequency per term, for tie-stable ranking weight
  for (const d of docs) {
    if (!d || typeof d !== 'object') continue;
    const id = String(d.id == null ? '' : d.id).trim();
    if (!id) continue;
    const text = String(d.text == null ? '' : d.text);
    const title = String(d.title == null ? '' : d.title).trim();
    // weight the title terms by counting them twice — a title match is a strong signal.
    const tokens = tokenize(`${title} ${title} ${text}`);
    if (!tokens.length) continue;
    const tf = {};
    for (const t of tokens) tf[t] = (tf[t] || 0) + 1;
    for (const t of Object.keys(tf)) df[t] = (df[t] || 0) + 1;
    entries.push({ id, title, text, tf, len: tokens.length });
  }
  return { entries, df, n: entries.length };
}

// makeSnippet — a short, esc()'d window of text around the first matched term.
//   Falls back to the head of the doc when no term is found. Deterministic.
function makeSnippet(text, terms, width = 160) {
  const raw = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
  if (!raw) return '';
  const low = raw.toLowerCase();
  let at = -1;
  for (const t of terms) {
    const i = low.indexOf(t);
    if (i >= 0 && (at < 0 || i < at)) at = i;
  }
  let start = 0;
  if (at > 0) start = Math.max(0, at - Math.floor(width / 4));
  let snip = raw.slice(start, start + width);
  if (start > 0) snip = `…${snip}`;
  if (start + width < raw.length) snip = `${snip}…`;
  return esc(snip);
}

// search — rank indexed docs by term-frequency overlap with the query.
//   index: result of buildIndex(); query: string; opts.k: max results (default 5).
//   Returns [{ id, title, score, snippet }] best-first. Score sums each query
//   term's frequency in the doc (idf-lite weighted by inverse doc-frequency so a
//   rare, distinctive term outranks a common one) and is length-normalized.
//   Soft-fail: bad index, empty/no-match query, or zero overlap -> [].
export function search(index, query, { k = 5 } = {}) {
  if (!index || !Array.isArray(index.entries) || !index.entries.length) return [];
  const qTerms = [...new Set(tokenize(query))];
  if (!qTerms.length) return [];
  const limit = Number.isFinite(k) && k > 0 ? Math.floor(k) : 5;
  const n = index.n || index.entries.length;

  const scored = [];
  for (const e of index.entries) {
    let score = 0;
    for (const t of qTerms) {
      const f = e.tf[t] || 0;
      if (!f) continue;
      const docFreq = (index.df && index.df[t]) || 1;
      const idf = Math.log(1 + n / docFreq); // rarer term -> higher weight
      score += f * idf;
    }
    if (score <= 0) continue;
    // length-normalize so a short, on-topic doc isn't buried by a long rambling one.
    const norm = score / Math.sqrt(e.len || 1);
    scored.push({ id: e.id, title: e.title, score: norm,
      snippet: makeSnippet(e.text, qTerms) });
  }
  // deterministic order: score desc, then id asc to break ties stably.
  scored.sort((a, b) => (b.score - a.score) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return scored.slice(0, limit);
}

// ── IO seams (injectable; used only by the CLI) ─────────────────────────────────
let _lister = null;
let _reader = null;
export function __setLister(fn) { _lister = typeof fn === 'function' ? fn : null; }
export function __setReader(fn) { _reader = typeof fn === 'function' ? fn : null; }

// list the *.md files in the scripture dir (default = real fs; injectable for tests).
function listScripture(dir) {
  if (_lister) return _lister(dir) || [];
  try {
    return fs.readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith('.md'))
      .sort((a, b) => a.localeCompare(b));
  } catch { return []; }
}

// read a file's text (default = real fs; injectable for tests). Soft-fails to ''.
function readFile(p) {
  if (_reader) { try { return String(_reader(p) || ''); } catch { return ''; } }
  try { return fs.readFileSync(p, 'utf8'); } catch { return ''; }
}

// firstHeading — pull a human title from the first Markdown H1, else the filename.
function firstHeading(text, file) {
  const m = String(text || '').match(/^#\s+(.+)$/m);
  return (m && m[1]) ? m[1].trim().slice(0, 120) : file.replace(/\.md$/i, '');
}

// loadScriptureDocs — assemble [{id,title,text}] from the scripture dir via the seams.
export function loadScriptureDocs({ dir = SCRIPTURE_DIR } = {}) {
  const docs = [];
  for (const file of listScripture(dir)) {
    const text = readFile(path.join(dir, file));
    if (!text || !text.trim()) continue;
    docs.push({ id: file, title: firstHeading(text, file), text });
  }
  return docs;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('scripture-index.mjs');
if (isMain) {
  const args = process.argv.slice(2);
  const last = args[args.length - 1];
  const k = /^\d+$/.test(last) ? Number(args.pop()) : 5;
  const query = args.join(' ');
  if (!query) {
    console.error('usage: node knowledge/scripture-index.mjs "<query>" [k]');
    process.exit(1);
  }
  const index = buildIndex(loadScriptureDocs());
  const hits = search(index, query, { k });
  if (!hits.length) { console.error('no matches'); process.exit(1); }
  console.log(`search "${query}":`);
  for (const h of hits) {
    console.log(`  [${h.score.toFixed(3)}] (${h.id}) ${h.title}`);
    console.log(`      ${h.snippet}`);
  }
}
