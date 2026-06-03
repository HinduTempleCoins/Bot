// lib-search.mjs — full-text search for the SoapBox Library (queue #87). Two layers:
//
//   1. a PURE in-memory inverted index (no external service, no network) — tokenize → term-frequency
//      ranking (TF + a light IDF-ish rarity weight) → multi-term AND filtering → snippet highlighting.
//      This is the default and ALWAYS works, so the Library is searchable with zero infra.
//   2. OPTIONAL engine adapters to a hosted Meilisearch / Typesense instance (URL + key from env),
//      both SOFT-FAIL: on any misconfig / network / non-OK response they return null so the caller
//      falls back to the in-memory index instead of throwing.
//
// A "doc" is { id, title?, body?, text?, url?, tags? } — any string fields are indexed; `id` is
// required (we key results by it). search() returns ranked [{ id, score, snippet }].
//
//   import { indexDocs, search, meiliSearch, typesenseSearch } from './lib-search.mjs'
//   const store = indexDocs(docs);
//   search('alexander shulgin', store, { limit: 5 });
//   node integrations/soapbox/lib-search.mjs <query>     # demo with a tiny fixture
//
// Engine adapters use a __setFetch hook so the (network) paths are testable; the offline test suite
// only exercises the PURE in-memory index.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const env = (k) => (typeof process !== 'undefined' && process.env && process.env[k]) || '';

// ── tokenization ─────────────────────────────────────────────────────────────────────────────────
// Unicode-aware: split on anything that isn't a letter/number, lowercase, drop very short tokens and
// a small stop-word set. Pure + deterministic so ranking is reproducible.
const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'is', 'are', 'was',
  'be', 'by', 'at', 'as', 'it', 'this', 'that', 'with', 'from', 'de', 'la', 'el', 'le']);

export function tokenize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1 && !STOP.has(t));
}

// the searchable text of a doc = its string fields concatenated (title weighted by repetition).
function docText(doc) {
  if (!doc || typeof doc !== 'object') return '';
  const parts = [];
  if (doc.title) parts.push(String(doc.title), String(doc.title)); // title counts double
  if (doc.body) parts.push(String(doc.body));
  if (doc.text) parts.push(String(doc.text));
  if (doc.url) parts.push(String(doc.url));
  if (Array.isArray(doc.tags)) parts.push(doc.tags.join(' '));
  else if (doc.tags) parts.push(String(doc.tags));
  return parts.join('\n');
}

// snippet source = the human-readable body (no title-doubling, no url), for highlighting.
function snippetSource(doc) {
  if (!doc || typeof doc !== 'object') return '';
  return [doc.title, doc.body, doc.text].filter(Boolean).map(String).join(' — ');
}

// ── in-memory inverted index ───────────────────────────────────────────────────────────────────────
/**
 * Build an inverted index from docs. Returns an opaque store:
 *   { N, docs: Map<id, {doc, len}>, df: Map<term, docCount>, postings: Map<term, Map<id, tf>> }
 * Pure: no network. Re-callable; later calls REBUILD (the store isn't mutated incrementally).
 */
export function indexDocs(docs = [], store = null) {
  const s = store && store.postings ? store : { N: 0, docs: new Map(), df: new Map(), postings: new Map() };
  for (const doc of (docs || [])) {
    if (!doc || doc.id == null) continue;
    const id = doc.id;
    if (s.docs.has(id)) continue; // first write wins; rebuild from scratch to replace
    const toks = tokenize(docText(doc));
    s.docs.set(id, { doc, len: toks.length });
    s.N = s.docs.size;
    const tf = new Map();
    for (const t of toks) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, c] of tf) {
      let p = s.postings.get(t);
      if (!p) { p = new Map(); s.postings.set(t, p); }
      p.set(id, c);
      s.df.set(t, (s.df.get(t) || 0) + 1);
    }
  }
  return s;
}

// ── snippet highlighting ─────────────────────────────────────────────────────────────────────────
// Find the densest window of source text around the query terms and wrap matches in [[…]] markers.
export function snippet(text, terms, { width = 180, mark = ['[[', ']]'] } = {}) {
  const src = String(text || '').replace(/\s+/g, ' ').trim();
  if (!src) return '';
  const lc = src.toLowerCase();
  const set = new Set(terms.map((t) => t.toLowerCase()).filter(Boolean));
  // locate first match position to center the window.
  let best = -1;
  for (const t of set) {
    const i = lc.indexOf(t);
    if (i >= 0 && (best < 0 || i < best)) best = i;
  }
  let start = 0;
  if (best >= 0) start = Math.max(0, best - Math.floor(width / 4));
  let win = src.slice(start, start + width);
  if (start > 0) win = '…' + win;
  if (start + width < src.length) win = win + '…';
  // highlight whole-word-ish matches (case-insensitive), longest terms first to avoid nesting.
  const sorted = [...set].sort((a, b) => b.length - a.length);
  for (const t of sorted) {
    if (!t) continue;
    const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
    win = win.replace(re, `${mark[0]}$1${mark[1]}`);
  }
  return win;
}

// ── search ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Rank docs in `store` against `query`. Pure: no network.
 *   - multi-term: AND by default (a doc must contain ALL query terms); opts.match='or' relaxes to OR.
 *   - ranking: sum over query terms of tf(term,doc) * idf(term), length-normalized, with a title-hit
 *     bonus folded in via the title-doubling at index time. Rarer terms (higher idf) weigh more.
 * Returns [{ id, score, snippet }] sorted best-first, capped to opts.limit (default 10).
 */
export function search(query, store, { limit = 10, match = 'and' } = {}) {
  if (!store || !store.postings) return [];
  const terms = [...new Set(tokenize(query))];
  if (!terms.length) return [];
  const N = Math.max(1, store.N);

  // candidate doc ids: union of postings; AND mode keeps only docs hit by every term.
  const hitCount = new Map(); // id -> #distinct query terms matched
  const scores = new Map();   // id -> accumulated score
  for (const t of terms) {
    const p = store.postings.get(t);
    if (!p) continue;
    const df = store.df.get(t) || p.size;
    const idf = Math.log(1 + N / df); // rarer term → higher idf
    for (const [id, tf] of p) {
      hitCount.set(id, (hitCount.get(id) || 0) + 1);
      scores.set(id, (scores.get(id) || 0) + tf * idf);
    }
  }

  const out = [];
  for (const [id, raw] of scores) {
    if (match === 'and' && hitCount.get(id) < terms.length) continue;
    const entry = store.docs.get(id);
    const len = entry ? entry.len : 0;
    // length normalization: divide by sqrt(len) so long docs don't dominate, +1 to avoid /0.
    const score = raw / Math.sqrt(len + 1);
    const snip = entry ? snippet(snippetSource(entry.doc), terms) : '';
    out.push({ id, score: Math.round(score * 1000) / 1000, snippet: snip });
  }
  out.sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
  return out.slice(0, limit);
}

// ── engine adapters (OPTIONAL, soft-fail) ──────────────────────────────────────────────────────────
// Both return a normalized [{ id, score, snippet }] on success, or null on ANY problem (missing
// config, network error, non-OK status, unparseable body) so the caller can fall back to in-memory.

/**
 * Meilisearch /indexes/{index}/search. Config from args or env:
 *   MEILI_URL, MEILI_KEY (optional), MEILI_INDEX (default 'library').
 * Soft-fails to null.
 */
export async function meiliSearch(query, {
  url = env('MEILI_URL'),
  key = env('MEILI_KEY'),
  index = env('MEILI_INDEX') || 'library',
  limit = 10,
} = {}) {
  if (!url || !query) return null;
  try {
    const headers = { 'Content-Type': 'application/json' };
    if (key) headers.Authorization = `Bearer ${key}`;
    const r = await _fetch(`${url.replace(/\/+$/, '')}/indexes/${encodeURIComponent(index)}/search`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ q: String(query), limit, attributesToHighlight: ['title', 'body', 'text'] }),
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    const hits = j && j.hits;
    if (!Array.isArray(hits)) return null;
    return hits.map((h, i) => {
      const fmt = h._formatted || {};
      const snip = (fmt.body || fmt.text || fmt.title || h.body || h.text || h.title || '')
        .toString().replace(/<em>/g, '[[').replace(/<\/em>/g, ']]');
      return { id: h.id, score: typeof h._rankingScore === 'number' ? h._rankingScore : (hits.length - i), snippet: snip.slice(0, 200) };
    });
  } catch { return null; }
}

/**
 * Typesense /collections/{collection}/documents/search. Config from args or env:
 *   TYPESENSE_URL, TYPESENSE_KEY, TYPESENSE_COLLECTION (default 'library'),
 *   TYPESENSE_QUERY_BY (default 'title,body,text').
 * Soft-fails to null.
 */
export async function typesenseSearch(query, {
  url = env('TYPESENSE_URL'),
  key = env('TYPESENSE_KEY'),
  collection = env('TYPESENSE_COLLECTION') || 'library',
  queryBy = env('TYPESENSE_QUERY_BY') || 'title,body,text',
  limit = 10,
} = {}) {
  if (!url || !key || !query) return null;
  try {
    const qs = new URLSearchParams({ q: String(query), query_by: queryBy, per_page: String(limit) });
    const r = await _fetch(
      `${url.replace(/\/+$/, '')}/collections/${encodeURIComponent(collection)}/documents/search?${qs}`,
      { headers: { 'X-TYPESENSE-API-KEY': key } },
    );
    if (!r || !r.ok) return null;
    const j = await r.json();
    const hits = j && j.hits;
    if (!Array.isArray(hits)) return null;
    return hits.map((h) => {
      const d = h.document || {};
      const hl = (h.highlights || [])[0] || {};
      const snip = (hl.snippet || d.body || d.text || d.title || '')
        .toString().replace(/<mark>/g, '[[').replace(/<\/mark>/g, ']]');
      return { id: d.id, score: typeof h.text_match === 'number' ? h.text_match : 0, snippet: snip.slice(0, 200) };
    });
  } catch { return null; }
}

// ── CLI demo (offline, tiny fixture) ────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('lib-search.mjs')) {
  const q = process.argv.slice(2).join(' ') || 'shulgin chemist';
  const fixture = [
    { id: 'shulgin', title: 'Alexander Shulgin', body: 'American chemist and author of PiHKAL, pioneer of psychedelic phenethylamine synthesis.' },
    { id: 'pihkal', title: 'PiHKAL', body: 'Phenethylamines I Have Known And Loved, a chemistry book by Alexander Shulgin and Ann Shulgin.' },
    { id: 'hathor', title: 'Hathor the Witness', body: 'A founding witness account on the MELEK blockchain, the Angelic AI resident.' },
  ];
  const store = indexDocs(fixture);
  const results = search(q, store, { limit: 5 });
  console.log(`query: ${q}\n`);
  if (!results.length) console.log('(no matches)');
  for (const r of results) console.log(`  (${r.score}) ${r.id}\n     ${r.snippet}`);
}
