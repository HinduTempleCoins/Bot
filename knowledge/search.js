// knowledge/search.js — deterministic topic lookup over the WHOLE knowledge corpus. No LLM, no network.
//
// One job: take a free-text query and rank the knowledge corpus by token overlap — key-theme /
// keyword / title hits — so the command menu, the Phase-3 corpus-index, the Witness, and Cheetah
// can route a topic to the right document(s) and cite them. Pure + deterministic: the same query
// over the same indices always returns the same ranking. Simple TF-style scoring, no embeddings.
//
//   import { search, topicsFor, searchScripture } from './knowledge/search.js';
//   search('phoenician haplogroup', { limit: 5 });
//     -> [{ id, title, score, why, path, source }]
//   topicsFor('wax headcone');   // -> ['phoenician', 'consciousness', ...] (matched keyword folders)
//
// Three corpus sources are folded into one entry list (all read-only source-of-truth files):
//   - knowledge/scripture/_index.json   → the 7 canonical docs (title + key_themes, highest weight)
//   - knowledge/_keyword_index.json     → folder keyword map (primary/secondary topic folders)
//   - knowledge/_library_catalog.json   → ~1500 catalogued files (title + extracted keywords)
//
// CLI:  node knowledge/search.js "phoenician haplogroup"
//       node knowledge/search.js --scripture "egregore"   (restrict to scripture docs)
//
// House style: injectable reader seam (__setReader) so the shape tests run fully OFFLINE with canned
// indices and no filesystem touch; soft-fail-never-throw (a bad/missing index → empty results, never
// an exception); esc() on every interpolated string in the CLI output. Read-only: never writes, never
// mutates knowledge/**. No keys, no network, no secrets.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPTURE_INDEX = path.join(HERE, 'scripture', '_index.json');
const KEYWORD_INDEX = path.join(HERE, '_keyword_index.json');
const LIBRARY_CATALOG = path.join(HERE, '_library_catalog.json');

// ── esc ─────────────────────────────────────────────────────────────────────
// Escape any interpolated string (CLI prints corpus titles/keywords verbatim).
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// ── Injectable reader seam (offline-testable) ────────────────────────────────
// Default: read the named index file as utf-8 and JSON.parse it; soft-fail to null on any error
// (missing file, bad JSON, permission). __setReader(fn) lets tests feed canned objects keyed by
// path so the shape tests never touch the real filesystem.
function defaultReader(p) {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

let _reader = defaultReader;

/** Override the index reader. Pass fn(path) => object|null, or null to restore the fs default. */
export function __setReader(fn) {
  _reader = typeof fn === 'function' ? fn : defaultReader;
}

function readIndex(p) {
  try {
    const v = _reader(p);
    return v && typeof v === 'object' ? v : null;
  } catch {
    return null; // a throwing injected reader must not crash the search
  }
}

// ── tokenization ─────────────────────────────────────────────────────────────
const norm = (s) => String(s == null ? '' : s).toLowerCase();

// Split into word tokens (alnum runs of length >= 2). Drops punctuation and 1-char noise so
// "J2a-M410" → ["j2a", "m410"] and "150,000-year" → ["150", "000", "year"].
function tokenize(s) {
  return norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 2);
}

// ── corpus assembly ──────────────────────────────────────────────────────────
// Fold the three indices into one flat entry list. Each entry carries the text fields we score
// against (title, themes, keywords) plus where it came from for citation. Every step soft-fails:
// a missing/garbage index simply contributes no entries.

function scriptureEntries() {
  const idx = readIndex(SCRIPTURE_INDEX);
  const docs = Array.isArray(idx?.documents) ? idx.documents
    : Array.isArray(idx?.scriptures) ? idx.scriptures
    : [];
  const out = [];
  for (const d of docs) {
    if (!d || typeof d !== 'object') continue;
    const file = d.file_md || d.file || '';
    out.push({
      id: d.id || norm(d.title).replace(/[^a-z0-9]+/g, '_'),
      title: d.title || d.id || '(untitled scripture)',
      source: 'scripture',
      path: file ? `knowledge/scripture/${file}` : 'knowledge/scripture/_index.json',
      title_terms: tokenize(d.title),
      theme_terms: (Array.isArray(d.key_themes) ? d.key_themes : []).map((t) => tokenize(t)),
      keyword_terms: [],
      weight: 3, // canonical docs rank above catalogued files on equal overlap
    });
  }
  return out;
}

function keywordFolderEntries() {
  const idx = readIndex(KEYWORD_INDEX);
  const fk = idx?.folder_keywords;
  if (!fk || typeof fk !== 'object') return [];
  const out = [];
  for (const [folder, spec] of Object.entries(fk)) {
    if (!spec || typeof spec !== 'object') continue;
    const primary = Array.isArray(spec.primary) ? spec.primary : [];
    const secondary = Array.isArray(spec.secondary) ? spec.secondary : [];
    out.push({
      id: `folder:${folder}`,
      title: `Topic folder: ${folder}`,
      source: 'keyword',
      folder,
      path: `knowledge/${folder}/`,
      title_terms: tokenize(folder),
      theme_terms: primary.map((t) => tokenize(t)),     // primary keywords ≈ themes (weight 2)
      keyword_terms: secondary.map((t) => tokenize(t)), // secondary keywords (weight 1)
      weight: 2,
    });
  }
  return out;
}

function catalogEntries() {
  const idx = readIndex(LIBRARY_CATALOG);
  const byDomain = idx?.byDomain;
  if (!byDomain || typeof byDomain !== 'object') return [];
  const out = [];
  for (const [domain, files] of Object.entries(byDomain)) {
    if (!Array.isArray(files)) continue;
    for (const f of files) {
      if (!f || typeof f !== 'object' || !f.path) continue;
      out.push({
        id: f.path,
        title: f.title || f.path,
        source: 'catalog',
        domain,
        path: f.path,
        title_terms: tokenize(f.title),
        theme_terms: [],
        keyword_terms: (Array.isArray(f.keywords) ? f.keywords : []).map((t) => tokenize(t)),
        weight: 1,
      });
    }
  }
  return out;
}

// Build the unified corpus. Not cached: the reader seam may change between calls in tests, and the
// indices are small enough (scripture + keyword fixed-size, catalog ~1500) that a per-call build is
// fine for the deterministic-lookup use. Soft-fails to [] if every index is unreadable.
export function buildCorpus() {
  try {
    return [...scriptureEntries(), ...keywordFolderEntries(), ...catalogEntries()];
  } catch {
    return [];
  }
}

// ── scoring ──────────────────────────────────────────────────────────────────
// TF-style overlap: for each query term, the points it earns against an entry are the field weight
// of the BEST field it hits (title 3 / theme 2 / keyword 1), multiplied by the entry's source weight
// so a canonical scripture doc edges out a catalogued file on otherwise-equal overlap. A term matches
// a field if it equals any token of that field (exact token match — deterministic, no fuzz). `why`
// records the (term, field) hits for explainability; the count of distinct query terms that matched
// is tracked so coverage breaks ties.

const FIELD_WEIGHT = { title: 3, theme: 2, keyword: 1 };

function hasTermInGroups(term, groups) {
  // groups is an array of token-arrays (e.g. each theme/keyword tokenized separately)
  for (const g of groups) {
    if (g.includes(term)) return true;
  }
  return false;
}

function scoreEntry(entry, terms) {
  let score = 0;
  let matched = 0;
  const why = [];
  for (const t of terms) {
    let best = 0;
    let field = null;
    if (entry.title_terms.includes(t)) { best = FIELD_WEIGHT.title; field = 'title'; }
    if (FIELD_WEIGHT.theme > best && hasTermInGroups(t, entry.theme_terms)) { best = FIELD_WEIGHT.theme; field = 'theme'; }
    if (FIELD_WEIGHT.keyword > best && hasTermInGroups(t, entry.keyword_terms)) { best = FIELD_WEIGHT.keyword; field = 'keyword'; }
    if (best > 0) {
      score += best * (entry.weight || 1);
      matched += 1;
      why.push(`${field}:${t}`);
    }
  }
  return { score, matched, why };
}

// ── public search ────────────────────────────────────────────────────────────
/**
 * Rank the knowledge corpus against a free-text query.
 * @param {string} query
 * @param {{ limit?: number, source?: 'scripture'|'keyword'|'catalog' }} [opts]
 * @returns {Array<{ id, title, score, why, path, source }>} ranked best-first, score > 0 only.
 */
export function search(query, opts = {}) {
  try {
    const limit = Number.isFinite(opts.limit) && opts.limit > 0 ? Math.floor(opts.limit) : 5;
    const terms = [...new Set(tokenize(query))]; // dedupe terms so "wax wax" doesn't double-count
    if (!terms.length) return [];

    let corpus = buildCorpus();
    if (opts.source) corpus = corpus.filter((e) => e.source === opts.source);

    const scored = [];
    for (const entry of corpus) {
      const { score, matched, why } = scoreEntry(entry, terms);
      if (score > 0) {
        scored.push({
          id: entry.id,
          title: entry.title,
          score,
          why,
          path: entry.path,
          source: entry.source,
          _matched: matched,
        });
      }
    }

    // Rank: score desc, then coverage (distinct terms matched) desc, then a stable tiebreak by id
    // so the ordering is fully deterministic regardless of corpus iteration order.
    scored.sort((a, b) =>
      b.score - a.score ||
      b._matched - a._matched ||
      String(a.id).localeCompare(String(b.id)));

    return scored.slice(0, limit).map(({ _matched, ...r }) => r);
  } catch {
    return []; // never throw
  }
}

/**
 * topicsFor(query) — the keyword folders whose primary/secondary keywords the query hits, best-first.
 * A lightweight router: "which sections of the corpus is this query about?". Returns folder names.
 * @param {string} query
 * @returns {string[]}
 */
export function topicsFor(query) {
  try {
    const hits = search(query, { source: 'keyword', limit: 50 });
    return hits.map((h) => h.folder || (h.id.startsWith('folder:') ? h.id.slice('folder:'.length) : h.id));
  } catch {
    return [];
  }
}

/**
 * Back-compat: restrict the search to the canonical scripture docs. Mirrors the original
 * searchScripture() shape this module shipped with (callers in the command menu / corpus-index).
 * @param {string} query
 * @param {{ limit?: number }} [opts]
 */
export function searchScripture(query, { limit = 5 } = {}) {
  return search(query, { limit, source: 'scripture' });
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('search.js')) {
  const args = process.argv.slice(2);
  const scriptureOnly = args[0] === '--scripture';
  const q = (scriptureOnly ? args.slice(1) : args).join(' ');
  if (!q) {
    console.error('usage: node knowledge/search.js [--scripture] "<topic>"');
    process.exit(1);
  }
  const hits = search(q, scriptureOnly ? { source: 'scripture' } : {});
  if (!hits.length) {
    console.log(`No knowledge matches for "${esc(q)}".`);
    const topics = topicsFor(q);
    if (topics.length) console.log(`Related topic folders: ${topics.map(esc).join(', ')}`);
    process.exit(0);
  }
  console.log(`Knowledge matches for "${esc(q)}":`);
  for (const h of hits) {
    console.log(`\n  [${h.score}] ${esc(h.title)}  (${esc(h.source)})`);
    console.log(`      cite: ${esc(h.path)}`);
    if (h.why.length) console.log(`      matched: ${[...new Set(h.why)].map(esc).join(', ')}`);
  }
  const topics = topicsFor(q);
  if (topics.length) console.log(`\nTopic folders: ${topics.map(esc).join(', ')}`);
}
