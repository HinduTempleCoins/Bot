// cheetah-embeddings.mjs — semantic source-matching for Cheetah's content-attribution job (queue #150).
//
// Cheetah is the credit-first / discovery-first librarian sibling to Hathor: when a post's TEXT looks
// like it came from somewhere, Cheetah's job is to STATE the probable original source with a link — not
// to punish. cheetah-search.mjs already finds candidate sources and ranks them by LEXICAL overlap
// (shingled Jaccard) — that catches verbatim / near-verbatim copies. This module is the complementary
// SEMANTIC layer: it embeds text into vectors and ranks by MEANING (cosine similarity), so Cheetah can
// say "this passage most resembles source X" even when the words were paraphrased rather than copied.
//
// It is meant to back findSimilarOnWeb / cheetahFindSources in cheetah/text-detection.js (wiring is a
// later step — this file only provides the engine):
//
//   import { createStore, rankSources, bestMatch, embed, cosineSimilarity } from './cheetah-embeddings.mjs'
//   const store = createStore();
//   store.add('doc1', 'the moon orbits the earth once a month', { url: '…' });
//   const hits = store.query('how long does the lunar orbit take', { topK: 3 });   // [{id, score, meta}]
//   const ranked = rankSources('suspect passage', candidates, { topK: 5 });        // semantic ranking
//   const top = bestMatch('suspect passage', candidates);                          // single top or null
//
// Pattern (per integrations/soapbox/macro.mjs + cheetah-search.mjs): ESM, soft-fail (never throws),
// injectable embedder + injectable fetch so tests run fully offline with ZERO deps and ZERO network,
// CLI guarded by the argv check. NO secrets / keys / required external API.
//
// Offline by default: when no embedder is injected via __setEmbedder, embed() falls back to a
// deterministic local lexical vectorizer (a hashed token-bag / TF vector). That gives the module a
// working semantic-ish ranking with no model and no network — good enough to rank by shared meaning of
// vocabulary, and a drop-in slot for a real embedding API (OpenAI / nomic / Granite) when one is wired.

// ── injectable embedder + fetch (offline by default) ─────────────────────────────────────────────
// _embed: optional async (text) → number[]. When null, the deterministic local vectorizer is used.
let _embed = null;
/** Inject a real embedder: async (text) => number[]. Pass null/undefined to revert to the local one. */
export function __setEmbedder(fn) { _embed = typeof fn === 'function' ? fn : null; }

/**
 * Wire the local MiniLM embedder (integrations/minilm-embedder.mjs) as the PREFERRED embedder, with the
 * deterministic word-bag staying as the automatic fallback (embed() already soft-falls when the injected
 * embedder returns null / throws — which is exactly what MiniLM does if the model can't load). Production
 * opt-in only; tests inject their own fakes via __setEmbedder and never call this, so they stay offline.
 * Importing minilm-embedder.mjs does NO work — the model loads lazily on the first real embed.
 */
export async function enableMiniLM() {
  const { makeEmbedder } = await import('./minilm-embedder.mjs');
  __setEmbedder(makeEmbedder());
}

// _fetch is exposed for parity with the sibling modules (a real embedder may want it); unused by the
// local fallback, kept so a wired embedder can be built without re-plumbing.
let _fetch = (...a) => globalThis.fetch(...a);
/** Inject a fetch implementation (for an embedder that calls an API). Tests stay offline regardless. */
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
/** Expose the current fetch to a custom embedder. */
export function _getFetch() { return _fetch; }

// ── deterministic local lexical vectorizer (no deps, no network) ─────────────────────────────────
// Maps text → a fixed-dimension TF vector. Each token is hashed into one of DIM buckets and its count
// accumulated; the vector is then a bag-of-hashed-words. Two texts that share vocabulary land weight in
// the same buckets, so cosine similarity between their vectors tracks shared meaning-of-words. This is
// the "feature hashing" trick — deterministic, dependency-free, and stable across runs/processes.

const DIM = 256;

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'is', 'are', 'was',
  'were', 'be', 'as', 'at', 'by', 'it', 'this', 'that', 'with', 'from', 'but', 'not', 'has', 'have',
  'how', 'does', 'do', 'did', 'i', 'you', 'we', 'they', 'he', 'she', 'its', 'their', 'our']);

/** Lowercase → unicode word tokens, drop stopwords + ≤2-char noise. PURE. */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

// Deterministic 32-bit string hash (FNV-1a). PURE, no crypto dep needed for a feature-hash bucket.
function hash32(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * Deterministic local embedding: a length-DIM L2-normalized hashed-TF vector. PURE, offline, no deps.
 * Empty / token-free text → a zero vector (cosineSimilarity with it is 0).
 */
export function localEmbed(text) {
  const vec = new Array(DIM).fill(0);
  const tokens = tokenize(text);
  for (const t of tokens) vec[hash32(t) % DIM] += 1;
  // L2-normalize so vector length doesn't bias cosine (it cancels anyway, but keeps vectors comparable
  // and gives a clean unit-length representation a real embedder would also return).
  let norm = 0;
  for (const x of vec) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm === 0) return vec;
  for (let i = 0; i < DIM; i++) vec[i] /= norm;
  return vec;
}

// ── public: embed + cosine ───────────────────────────────────────────────────────────────────────

/**
 * Embed text into a numeric vector. Uses the injected embedder if one is set (via __setEmbedder),
 * otherwise the deterministic local lexical vectorizer. NEVER throws — if an injected embedder fails or
 * returns a non-array, falls back to the local embedding. Async because real embedders are async.
 */
export async function embed(text) {
  if (_embed) {
    try {
      const v = await _embed(text);
      if (Array.isArray(v) && v.length) return v;
    } catch { /* fall through to local */ }
  }
  return localEmbed(text);
}

/**
 * Cosine similarity of two equal-length numeric vectors, in [-1, 1] (in [0,1] for the non-negative TF
 * vectors this module produces). PURE. Identical direction → 1, orthogonal → 0. A zero vector, a length
 * mismatch, or non-array input → 0 (soft, never throws).
 */
export function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// ── in-memory vector store ───────────────────────────────────────────────────────────────────────

/**
 * Create an in-memory vector store. Docs are embedded on add() and queried by cosine similarity.
 * Returns { add, query, size }:
 *   add(id, text, meta?) → embeds text, stores { id, vector, meta }. Re-adding an id replaces it.
 *   query(text, {topK=5}) → [{ id, score, meta }] sorted by score desc (top K). Empty store → [].
 *   size() → number of stored docs.
 * NEVER throws — embedding failures soft-fall to the local embedder via embed().
 */
export function createStore() {
  const docs = new Map(); // id → { id, vector, meta }

  return {
    async add(id, text, meta = {}) {
      if (id == null) return;
      const vector = await embed(text);
      docs.set(String(id), { id: String(id), vector, meta });
    },

    async query(text, { topK = 5 } = {}) {
      if (docs.size === 0) return [];
      const qv = await embed(text);
      const scored = [];
      for (const d of docs.values()) {
        scored.push({ id: d.id, score: cosineSimilarity(qv, d.vector), meta: d.meta });
      }
      scored.sort((a, b) => b.score - a.score);
      return scored.slice(0, Math.max(0, topK));
    },

    size() { return docs.size; },
  };
}

// ── source ranking (what Cheetah calls) ──────────────────────────────────────────────────────────

// Extract comparable text from a candidate (string or object). PURE. Mirrors cheetah-search.mjs so the
// two modules accept the same candidate shapes.
function candidateText(c) {
  if (typeof c === 'string') return c;
  if (!c || typeof c !== 'object') return '';
  return [c.text, c.title, c.name, c.snippet, c.description]
    .filter((x) => typeof x === 'string' && x).join(' ');
}

/**
 * Semantically rank which candidate sources best match the query text. This is what Cheetah uses to
 * say "this passage most resembles source X". Candidates is an array of strings OR objects with a
 * comparable text field ({ id?, text|title|snippet|…, meta? }). Returns, sorted by score desc:
 *   [{ id, score, meta, candidate, index }]
 * where score is the cosine similarity of the candidate's embedding to the query's. NEVER throws;
 * empty / invalid candidates → []. Pure given a fixed embedder.
 */
export async function rankSources(queryText, candidates, { topK } = {}) {
  if (!queryText || !Array.isArray(candidates) || candidates.length === 0) return [];
  const qv = await embed(queryText);
  const ranked = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    const cv = await embed(candidateText(c));
    const id = (c && typeof c === 'object' && c.id != null) ? c.id : i;
    const meta = (c && typeof c === 'object' && c.meta) ? c.meta : (typeof c === 'object' ? c : {});
    ranked.push({ id, score: cosineSimilarity(qv, cv), meta, candidate: c, index: i });
  }
  ranked.sort((a, b) => b.score - a.score);
  return typeof topK === 'number' ? ranked.slice(0, Math.max(0, topK)) : ranked;
}

/**
 * The single best-matching candidate for the query text, or null for empty/no-candidate input.
 * Returns the top entry from rankSources (same shape: { id, score, meta, candidate, index }).
 */
export async function bestMatch(queryText, candidates) {
  const ranked = await rankSources(queryText, candidates, { topK: 1 });
  return ranked.length ? ranked[0] : null;
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('cheetah-embeddings.mjs')) {
  // NB: the offline fallback matches by SHARED VOCABULARY (hashed-TF), not synonymy — a query using
  // "lunar" won't match a doc that says "moon". A real injected embedder closes that gap; the default
  // query below deliberately shares words with the astronomy doc so the demo ranks as expected.
  const query = process.argv.slice(2).join(' ') || 'how far does the moon orbit from the earth';
  const store = createStore();
  await store.add('astronomy', 'the moon orbits the earth and reflects sunlight at night', { topic: 'space' });
  await store.add('cooking', 'simmer the onions in butter until they caramelize for the soup', { topic: 'food' });
  await store.add('finance', 'the central bank raised interest rates to cool inflation', { topic: 'money' });
  const hits = await store.query(query, { topK: 3 });
  console.log(`\nCheetah embeddings — semantic matches for: "${query.slice(0, 70)}"`);
  console.log(`  (embedder: ${_embed ? 'injected' : 'local lexical fallback'}, store size: ${store.size()})\n`);
  for (const h of hits) console.log(`  [${h.score.toFixed(4)}] ${h.id}  ${JSON.stringify(h.meta)}`);
}
