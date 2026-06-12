/**
 * text-detection.js — Cheetah's similarity-matching engine.
 *
 * Per CHEETAH_ADVANCED.md §3: detection is NOT primarily an LLM. Generative
 * models hallucinate sources, which is the opposite of crediting. So this
 * uses shingle-hash + Jaccard similarity over word n-grams. The detection
 * either finds a match in available corpora or it doesn't; an LLM may write
 * the friendly comment AFTER a match is found, but never decides "guilt."
 *
 * Two backends, called separately:
 *   - findSimilarOnChain — queries prior on-chain posts; returns matches
 *     ranked by Jaccard. Stub currently — wires to the Hathor GrapheneAdapter
 *     when MELEK chain RPC values exist.
 *   - findSimilarOnWeb — queries an external search API (Google CSE / Serper
 *     / DDG). Pluggable per CHEETAH_WEB_SEARCH env. Returns matches with URL +
 *     snippet + similarity score.
 *
 * The top-level detectText() composes both backends and returns the
 * highest-scoring match above SIMILARITY_THRESHOLD, or null.
 *
 * Output schema:
 *   { match: bool, source: { kind, url, title?, author?, snippet? },
 *     confidence: 0..1, all_matches: [...] }
 */

import { createHash } from 'node:crypto';
import { SIMILARITY_THRESHOLD, SHINGLE_SIZE, WEB_SEARCH_BACKEND } from './config.js';
// #180 — back web detection with cheetah-search (scraper + library + on-chain), defensive import.
let cheetahFindSources = null;
try { ({ findSources: cheetahFindSources } = await import('../integrations/cheetah-search.mjs')); } catch { /* optional */ }

// ---- text → shingle set ----------------------------------------------------

/** Normalize text: lowercase, strip punctuation, split into words. */
function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^\w\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

/**
 * Build shingles (overlapping n-word sequences) and hash each to a short
 * fingerprint. Returns a Set for O(1) intersection.
 *
 * Why hash: comparing string n-grams directly is slow + memory-hungry for
 * large corpora. 16 hex chars (64 bits) gives effectively zero collision risk
 * within the corpora we care about.
 */
export function shingles(text, n = SHINGLE_SIZE) {
  const words = tokenize(text);
  const out = new Set();
  if (words.length < n) {
    // Text too short to shingle — return whole-text hash as single shingle
    // (still allows exact-match detection for very short content).
    if (words.length === 0) return out;
    out.add(createHash('sha1').update(words.join(' ')).digest('hex').slice(0, 16));
    return out;
  }
  for (let i = 0; i + n <= words.length; i++) {
    const window = words.slice(i, i + n).join(' ');
    out.add(createHash('sha1').update(window).digest('hex').slice(0, 16));
  }
  return out;
}

/**
 * Jaccard similarity: |A ∩ B| / |A ∪ B|. 0 = disjoint, 1 = identical.
 * For text plagiarism detection, 0.5+ is suspicious, 0.8+ is clearly derived.
 */
export function jaccard(setA, setB) {
  if (!setA.size || !setB.size) return 0;
  let intersection = 0;
  for (const x of setA) if (setB.has(x)) intersection++;
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

// ---- on-chain search backend (stub until chain RPC is live) ----------------

/**
 * Query prior on-chain posts for similar text. Returns matches ranked by
 * Jaccard.
 *
 * @param {string} body — the post body to check
 * @param {object} opts
 *   - hathorAdapter: optional GrapheneAdapter instance for live chain queries
 *   - corpus: optional array of { author, permlink, body } for offline tests
 *   - limit: max matches to return (default 5)
 *
 * When hathorAdapter is provided and the chain is live, this will query
 * recent posts; the strategy can evolve (search by tags, by author cohort,
 * full-history scan via tantivy/etc). Stub for now: corpus-based only.
 */
export async function findSimilarOnChain(body, opts = {}) {
  const { corpus = [], limit = 5 } = opts;
  if (corpus.length === 0) {
    return {
      matches: [],
      note: opts.hathorAdapter
        ? 'on-chain live query not yet implemented — stubbed'
        : 'no corpus provided (offline mode)',
    };
  }
  const target = shingles(body);
  if (!target.size) return { matches: [], note: 'target text empty after normalization' };

  const scored = corpus.map((entry) => {
    const sim = jaccard(target, shingles(entry.body));
    return {
      kind: 'on-chain',
      author: entry.author,
      permlink: entry.permlink,
      // Default to a condenser-resolvable internal link (`/@author/permlink`) rather than a
      // `chain://` pseudo-scheme — the front end does not linkify `chain://` (it prepends
      // `https://` and the link renders dead). Browser-verified on alpha.melek.salon 2026-06-12.
      url: entry.url || `/@${entry.author}/${entry.permlink}`,
      snippet: (entry.body || '').slice(0, 200),
      confidence: sim,
    };
  });
  scored.sort((a, b) => b.confidence - a.confidence);
  return { matches: scored.slice(0, limit), note: 'corpus-mode' };
}

// ---- web search backend (pluggable per WEB_SEARCH_BACKEND env) -------------

/**
 * Query an external search API for related content. Backend depends on
 * CHEETAH_WEB_SEARCH env: 'none' (default), 'google', 'serper', 'duckduckgo'.
 * Returns matches with URL + snippet + similarity.
 *
 * Currently stubbed — operator picks the backend; implementation lands
 * when that decision is made (see CHEETAH_ADVANCED.md "Decisions pending
 * operator" + TODO.md).
 */
export async function findSimilarOnWeb(body, opts = {}) {
  if (WEB_SEARCH_BACKEND === 'none' || !WEB_SEARCH_BACKEND) {
    return { matches: [], note: 'web search disabled (CHEETAH_WEB_SEARCH=none)' };
  }
  // #180 — cheetah-search finds probable sources (web/scholarly/on-chain) + scores similarity;
  // credit-first: we surface matches with links, never decide "guilt." Soft-fail to empty.
  if (!cheetahFindSources) return { matches: [], note: 'cheetah-search unavailable' };
  try {
    const found = await cheetahFindSources(body, { max: opts.limit || 8 });
    const matches = (found || []).map((m) => ({
      kind: 'web', url: m.url, title: m.title, author: m.author, snippet: m.snippet,
      similarity: typeof m.similarity === 'number' ? m.similarity : 0,
    }));
    return { matches };
  } catch (e) {
    return { matches: [], note: `web search error: ${e.message}` };
  }
}

// ---- top-level detector ----------------------------------------------------

/**
 * Run both backends and return the highest-scoring match above threshold,
 * or null. Threshold comes from SIMILARITY_THRESHOLD.
 *
 * @param {string} body
 * @param {object} opts — passed through to backends
 * @returns {Promise<{match: boolean, source: object|null, confidence: number, all_matches: array}>}
 */
export async function detectText(body, opts = {}) {
  const [onChain, onWeb] = await Promise.all([
    findSimilarOnChain(body, opts),
    findSimilarOnWeb(body, opts),
  ]);
  const all = [...onChain.matches, ...onWeb.matches]
    .sort((a, b) => b.confidence - a.confidence);

  const top = all[0];
  if (!top || top.confidence < SIMILARITY_THRESHOLD) {
    return { match: false, source: null, confidence: top?.confidence ?? 0, all_matches: all };
  }
  return {
    match: true,
    source: {
      kind: top.kind,
      url: top.url,
      title: top.title,
      author: top.author,
      permlink: top.permlink,
      snippet: top.snippet,
    },
    confidence: top.confidence,
    all_matches: all,
  };
}
