// bm25.mjs — pure, zero-dependency lexical retrieval primitives (OSS-benchmark ADOPT items A1+A2,
// task #222). Three well-known, published algorithms re-implemented from scratch (no vendored source):
//
//   buildIndex(docs, { fields })  → an Okapi BM25 inverted index (IDF + per-doc length norms).
//   score(index, query)           → ranked [{ id, score }] for a query against that index.
//   rrf(rankings, { k })          → Reciprocal Rank Fusion of N ranked lists (rank-based, scale-free).
//   typoMatch(term, vocab, {...}) → bounded edit-distance term correction (small, no dep).
//
// Why these: our search-quality scorer matches query terms with exact `includes()` (no IDF, no length
// normalization, no typo tolerance) and ranks each engine's rows with one signal. BM25 is the lexical
// gold standard (IDF-weighted TF with length normalization); RRF is the ~10-line industry-standard way
// to fuse a lexical ranking with a semantic one without a score-scale mismatch (RAGFlow/txtai/Elastic/
// OpenSearch all ship it as their hybrid default); typoMatch adds Meilisearch-style fuzzy term matching.
//
// Pattern (per the soapbox readers): ESM, PURE (no network, no state, deterministic), soft-fail (never
// throws — bad input → empty/identity result), CLI guarded behind the argv check.
//
//   import { buildIndex, score, rrf, typoMatch } from './bm25.mjs'
//   node integrations/bm25.mjs   # tiny offline demo

// ── tokenization ──────────────────────────────────────────────────────────────────────────────────
// Lowercase → unicode word tokens, drop ≤1-char noise. Stopwords are intentionally NOT removed here:
// BM25's IDF already down-weights common terms, so dropping stopwords would be redundant and would also
// hurt typo/proximity callers that want the raw token stream. PURE.
export function tokenize(text) {
  return String(text == null ? '' : text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 1);
}

// ── Okapi BM25 ──────────────────────────────────────────────────────────────────────────────────
// Defaults are the standard Okapi BM25 constants:
//   k1 = 1.2 — term-frequency saturation (how fast extra occurrences of a term stop helping).
//   b  = 0.75 — length-normalization strength (0 = none, 1 = full doc-length penalty).
// IDF uses the BM25 "plus-0.5" smoothed form: idf = ln(1 + (N - n + 0.5) / (n + 0.5)), which is always
// >= 0 (rarer terms across the corpus score higher; a term in every doc contributes ~0).
const DEFAULT_K1 = 1.2;
const DEFAULT_B = 0.75;

/**
 * Build an in-memory BM25 inverted index over `docs`.
 *
 * @param docs  Array of { id, ...fields } OR plain strings. A string doc is indexed as its whole text
 *              and given an array-index id. Object docs without an `id` fall back to their array index.
 * @param opts.fields  Which string fields of each doc to index (default ['text']). Joined per doc.
 * @param opts.k1, opts.b  Okapi parameters (defaults 1.2 / 0.75).
 *
 * @returns { N, avgdl, k1, b, df:Map, postings:Map<term, Map<id, tf>>, docLen:Map<id,len>,
 *            ids:[], score(query) }  — soft-fail: empty/invalid docs → an empty index whose score() → [].
 */
export function buildIndex(docs = [], { fields = ['text'], k1 = DEFAULT_K1, b = DEFAULT_B } = {}) {
  const postings = new Map();   // term -> Map(id -> tf)
  const df = new Map();         // term -> document frequency
  const docLen = new Map();     // id -> token count
  const ids = [];
  let totalLen = 0;

  const list = Array.isArray(docs) ? docs : [];
  for (let i = 0; i < list.length; i++) {
    const d = list[i];
    let id;
    let text;
    if (typeof d === 'string') {
      id = i;
      text = d;
    } else if (d && typeof d === 'object') {
      id = d.id != null ? d.id : i;
      text = fields.map((f) => (typeof d[f] === 'string' ? d[f] : '')).join(' ');
    } else {
      continue;
    }
    const tokens = tokenize(text);
    ids.push(id);
    docLen.set(id, tokens.length);
    totalLen += tokens.length;

    // term frequencies within this doc
    const tf = new Map();
    for (const t of tokens) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [term, count] of tf) {
      let p = postings.get(term);
      if (!p) { p = new Map(); postings.set(term, p); }
      p.set(id, count);
      df.set(term, (df.get(term) || 0) + 1);
    }
  }

  const N = ids.length;
  const avgdl = N ? totalLen / N : 0;

  const index = { N, avgdl, k1, b, df, postings, docLen, ids };
  index.score = (query) => score(index, query);
  return index;
}

/** BM25 IDF (smoothed, non-negative) for a term given corpus size N and document frequency n. PURE. */
function idf(N, n) {
  return Math.log(1 + (N - n + 0.5) / (n + 0.5));
}

/**
 * Score every doc that contains at least one query term against a BM25 index.
 * @returns ranked [{ id, score }] desc by score (ties broken deterministically by id string order).
 *          Empty index / empty query / no matches → []. Soft-fail (never throws).
 */
export function score(index, query) {
  if (!index || !index.postings || !index.N) return [];
  const terms = tokenize(query);
  if (!terms.length) return [];
  const { N, avgdl, k1, b, df, postings, docLen } = index;

  const acc = new Map(); // id -> accumulated score
  // de-dup query terms but keep them (a repeated query term shouldn't double-count IDF*saturation)
  for (const term of new Set(terms)) {
    const p = postings.get(term);
    if (!p) continue;
    const n = df.get(term) || 0;
    const w = idf(N, n);
    if (w <= 0) continue;
    for (const [id, tf] of p) {
      const dl = docLen.get(id) || 0;
      const denom = tf + k1 * (1 - b + (b * dl) / (avgdl || 1));
      const contribution = w * ((tf * (k1 + 1)) / (denom || 1));
      acc.set(id, (acc.get(id) || 0) + contribution);
    }
  }

  return [...acc.entries()]
    .map(([id, s]) => ({ id, score: s }))
    .sort((a, b2) => b2.score - a.score || String(a.id).localeCompare(String(b2.id)));
}

// ── Reciprocal Rank Fusion ──────────────────────────────────────────────────────────────────────
/**
 * Reciprocal Rank Fusion: merge N ranked lists into one, using RANKS not raw scores so two rankers on
 * different score scales (e.g. BM25 vs cosine) fuse cleanly. fused(id) = Σ 1/(k + rank), rank 0-based.
 * k=60 is the published default (Cormack et al.); larger k flattens the rank weighting.
 *
 * @param rankings  Array of ranked lists. Each list is an array of ids OR of objects with an `id`.
 * @returns ranked [{ id, score }] desc (ties broken deterministically by id string order).
 *          No lists / empty lists → []. Soft-fail (never throws).
 */
export function rrf(rankings = [], { k = 60 } = {}) {
  const scores = new Map();
  for (const list of (Array.isArray(rankings) ? rankings : [])) {
    if (!Array.isArray(list)) continue;
    for (let i = 0; i < list.length; i++) {
      const item = list[i];
      const id = (item && typeof item === 'object') ? item.id : item;
      if (id == null) continue;
      scores.set(id, (scores.get(id) || 0) + 1 / (k + i + 1));
    }
  }
  return [...scores.entries()]
    .map(([id, s]) => ({ id, score: s }))
    .sort((a, b) => b.score - a.score || String(a.id).localeCompare(String(b.id)));
}

// ── bounded edit distance + typo correction ───────────────────────────────────────────────────────
/**
 * Levenshtein edit distance between two strings, capped at `max`: returns max+1 as soon as the distance
 * is provably > max (early exit keeps it cheap for the small `max` we use). PURE.
 */
export function editDistance(a, b, max = Infinity) {
  a = String(a == null ? '' : a);
  b = String(b == null ? '' : b);
  if (a === b) return 0;
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  let prev = new Array(lb + 1);
  let cur = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= lb; j++) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > max) return max + 1; // whole row already exceeds the cap → distance > max
    [prev, cur] = [cur, prev];
  }
  return prev[lb];
}

/**
 * Default max-edits band by term length (Meilisearch-style): short terms tolerate fewer typos.
 *   len <= 3 → 0 (no fuzz; too easy to collide), 4–7 → 1, >= 8 → 2.
 */
export function defaultMaxEdits(len) {
  if (len <= 3) return 0;
  if (len <= 7) return 1;
  return 2;
}

/**
 * Correct a possibly-misspelled `term` to the closest vocabulary entry within a bounded edit distance.
 * Exact match wins immediately (distance 0). Otherwise returns the nearest vocab term whose distance is
 * <= maxEdits; ties broken by the SHORTER, then lexicographically smaller, candidate (deterministic).
 * Returns null when nothing is within the band (refuses far terms) — never "corrects" to a distant word.
 *
 * @param term   the query term to correct.
 * @param vocab  iterable (array / Set) of known terms (e.g. an index's `postings.keys()`).
 * @param opts.maxEdits  override the length-based band.
 * @returns { term, distance } | null. Soft-fail (never throws).
 */
export function typoMatch(term, vocab, { maxEdits } = {}) {
  const q = String(term == null ? '' : term).toLowerCase();
  if (!q) return null;
  const cap = Number.isFinite(maxEdits) ? maxEdits : defaultMaxEdits(q.length);
  let best = null;
  for (const raw of (vocab || [])) {
    const v = String(raw == null ? '' : raw).toLowerCase();
    if (!v) continue;
    if (v === q) return { term: v, distance: 0 };
    if (cap <= 0) continue; // band forbids any fuzz for this term length
    const d = editDistance(q, v, cap);
    if (d > cap) continue;
    if (
      !best ||
      d < best.distance ||
      (d === best.distance && v.length < best.term.length) ||
      (d === best.distance && v.length === best.term.length && v < best.term)
    ) {
      best = { term: v, distance: d };
    }
  }
  return best;
}

// ── CLI demo (offline, no deps) ─────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('bm25.mjs')) {
  const docs = [
    { id: 'a', text: 'the moon orbits the earth once a month' },
    { id: 'b', text: 'lunar eclipse astronomy the the the moon shadow earth sun corpus filler text here' },
    { id: 'c', text: 'simmer onions in butter until they caramelize for the soup' },
  ];
  const idx = buildIndex(docs);
  const q = process.argv.slice(2).join(' ') || 'moon earth';
  console.log(`BM25 for "${q}":`);
  for (const r of score(idx, q)) console.log(`  [${r.score.toFixed(4)}] ${r.id}`);

  const lex = score(idx, 'moon').map((r) => r.id);
  const sem = ['c', 'a', 'b'];
  console.log(`\nRRF(lexical=${JSON.stringify(lex)}, semantic=${JSON.stringify(sem)}):`);
  for (const r of rrf([lex, sem])) console.log(`  [${r.score.toFixed(4)}] ${r.id}`);

  console.log(`\ntypoMatch("astronmy" → vocab):`, typoMatch('astronmy', idx.postings.keys()));
  console.log(`typoMatch("zzzzz" → vocab):`, typoMatch('zzzzz', idx.postings.keys()));
}
