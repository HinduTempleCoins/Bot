// cheetah-search.mjs — the source-finding backend for Cheetah's content-attribution job (queue #72).
//
// Cheetah is the credit-first / discovery-first librarian sibling to Hathor: when a post's TEXT (or an
// image's caption/description) looks like it came from somewhere, Cheetah's job is to STATE the probable
// original source with a link — not to punish. This module is the pluggable "given this text, find where
// it probably came from" layer underneath that. It does NOT decide; it surfaces ranked candidates and
// hands Cheetah the links so Cheetah can say "this matches X (source: …)".
//
// It aggregates three existing search backends (imported, never edited; each soft-fails independently):
//   integrations/scraper.mjs               — general WEB search (searchAll) for prior web content
//   integrations/soapbox/library-catalog.mjs — scholarly / book matches (catalogSearch)
//   integrations/soapbox/nft-search.mjs    — on-chain / NFT content (searchNfts)
//
// The ranking is LLM-FREE: a pure token-overlap / shingled-Jaccard similarityScore() lets Cheetah rank
// candidate matches against the suspect text deterministically and offline. That's the load-bearing part
// the tests exercise; findSources() is the thin fusion-and-rank shell on top.
//
//   import { findSources, similarityScore, bestMatch } from './cheetah-search.mjs'
//   const matches = await findSources('the text of the post', { max: 10 })
//   node integrations/cheetah-search.mjs "some suspect text"
//
// Pattern (per integrations/soapbox/macro.mjs): ESM, soft-fail (never throws), `sources` is an injectable
// param so tests run fully offline with fakes, CLI guarded by the argv check.

import { searchAll } from './scraper.mjs';
import { catalogSearch } from './soapbox/library-catalog.mjs';
import { searchNfts } from './soapbox/nft-search.mjs';

// ── PURE similarity (no network, no LLM) ─────────────────────────────────────────────────────────
// Token-overlap + shingled Jaccard. Cheetah uses this to rank candidate matches against the suspect
// text deterministically. Identical text → 1; disjoint → 0; partial overlap → in between.

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'to', 'in', 'on', 'for', 'is', 'are', 'was',
  'were', 'be', 'as', 'at', 'by', 'it', 'this', 'that', 'with', 'from', 'but', 'not', 'has', 'have']);

/** Lowercase → unicode word tokens, drop stopwords + ≤2-char noise. PURE. */
export function tokenize(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2 && !STOP.has(t));
}

// w-gram shingles over a token list (default bigrams). Captures local word ORDER, so two texts that
// share the same words in the same phrasing score higher than two that merely share a vocabulary.
function shingles(tokens, w = 2) {
  if (tokens.length < w) return tokens.length ? [tokens.join(' ')] : [];
  const out = [];
  for (let i = 0; i + w <= tokens.length; i++) out.push(tokens.slice(i, i + w).join(' '));
  return out;
}

function jaccard(aSet, bSet) {
  if (!aSet.size && !bSet.size) return 0;
  let inter = 0;
  for (const x of aSet) if (bSet.has(x)) inter++;
  const union = aSet.size + bSet.size - inter;
  return union ? inter / union : 0;
}

/**
 * Similarity of two texts in [0,1]. PURE — no network, no LLM. A blend of unigram Jaccard (shared
 * vocabulary) and bigram-shingle Jaccard (shared phrasing/word-order), so verbatim or near-verbatim
 * copies score high while texts that merely share topic words score in the middle. Identical → 1,
 * fully disjoint → 0. Empty input on either side → 0.
 */
export function similarityScore(a, b) {
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (!ta.length || !tb.length) return 0;
  const uni = jaccard(new Set(ta), new Set(tb));
  const bi = jaccard(new Set(shingles(ta, 2)), new Set(shingles(tb, 2)));
  // weight phrasing a bit higher than bare vocabulary — order-preserving copies are the strong signal.
  const score = uni * 0.45 + bi * 0.55;
  return Math.round(score * 10000) / 10000;
}

/**
 * Pick the candidate most similar to `text`. PURE. `candidates` is an array of strings OR objects with
 * a comparable text field (title/snippet/text/name/description, joined). Returns
 *   { index, similarity, candidate } | null   (null for empty/no-candidate input).
 */
export function bestMatch(text, candidates) {
  if (!text || !Array.isArray(candidates) || !candidates.length) return null;
  let best = null;
  candidates.forEach((c, index) => {
    const sim = similarityScore(text, candidateText(c));
    if (!best || sim > best.similarity) best = { index, similarity: sim, candidate: c };
  });
  return best;
}

// Extract comparable text from a candidate (string or object). PURE.
function candidateText(c) {
  if (typeof c === 'string') return c;
  if (!c || typeof c !== 'object') return '';
  return [c.title, c.name, c.snippet, c.description, c.text]
    .filter((x) => typeof x === 'string' && x).join(' ');
}

// ── source adapters: normalize each backend → [{ url, title, snippet, source }] ──────────────────
// Each adapter is its own try/catch so one dead backend never sinks the others (soft-fail floor).

async function fromWeb(text, max, fn) {
  try {
    const rows = await fn(text, { limit: max });
    return (rows || []).map((r) => ({
      url: r.url || null,
      title: (r.title || '').trim(),
      snippet: r.snippet || r.digest || '',
      source: 'web',
    })).filter((r) => r.url || r.title);
  } catch { return []; }
}

async function fromLibrary(text, max, fn) {
  try {
    const out = await fn(text, { limit: max });
    const rows = out?.results || (Array.isArray(out) ? out : []);
    return rows.map((r) => ({
      url: r.url || (r.doi ? `https://doi.org/${r.doi}` : null),
      title: (r.title || '').trim(),
      snippet: [(r.authors || []).slice(0, 3).join(', '), r.year].filter(Boolean).join(' · '),
      source: r.type === 'book' ? 'library:book' : 'library:scholarly',
    })).filter((r) => r.url || r.title);
  } catch { return []; }
}

async function fromOnChain(text, max, fn) {
  try {
    // nft-search is key-gated and chain-scoped; with no keys it returns []. We probe ethereum (its
    // default) — callers wiring more chains can inject a custom adapter via the `sources` param.
    const rows = await fn({ chain: 'ethereum', q: text });
    return (rows || []).slice(0, max).map((t) => ({
      url: (typeof t.tokenUri === 'string' && t.tokenUri) || t.image || null,
      title: (t.name || t.contractAddress || '').toString().trim(),
      snippet: t.description || '',
      source: 'onchain:nft',
    })).filter((r) => r.url || r.title);
  } catch { return []; }
}

// Default source-finders. Each: async (text, max) → [{url, title, snippet, source}]. Injectable so the
// tests pass fakes (no network). Keys mirror the three backends Cheetah aggregates.
function defaultSources() {
  return {
    web: (text, max) => fromWeb(text, max, searchAll),
    library: (text, max) => fromLibrary(text, max, catalogSearch),
    onchain: (text, max) => fromOnChain(text, max, searchNfts),
  };
}

/**
 * Given suspect text, find probable original sources across web + library + on-chain. NEVER throws —
 * any dead/empty source contributes nothing. Returns a ranked, deduped (by url, else title) array of
 *   { url, title, snippet, source, similarity }
 * where `similarity` is the PURE token-overlap score of the candidate's text against the suspect text,
 * so Cheetah can state the strongest matches first WITHOUT an LLM. Credit-first: these are candidate
 * matches with links, not verdicts.
 *
 * `sources` is injectable: a map of name → async (text, max) → rows[]. Defaults to the three real
 * backends; tests pass fakes for fully-offline runs.
 */
export async function findSources(text, { max = 10, sources } = {}) {
  const q = String(text || '').trim();
  if (!q) return [];
  const finders = sources || defaultSources();
  const perSource = Math.max(max, 5);

  const settled = await Promise.allSettled(
    Object.values(finders).map((fn) => Promise.resolve(fn(q, perSource)).catch(() => [])),
  );
  const raw = settled.flatMap((s) => (s.status === 'fulfilled' && Array.isArray(s.value) ? s.value : []));

  // dedup by normalized url, else by normalized title; keep the first, prefer a richer snippet.
  const seen = new Map();
  for (const r of raw) {
    if (!r) continue;
    const url = r.url || null;
    const title = (r.title || '').trim();
    const key = (url ? `u:${url.replace(/\/+$/, '').toLowerCase()}` : title ? `t:${title.toLowerCase()}` : '');
    if (!key) continue;
    const cand = {
      url,
      title,
      snippet: r.snippet || '',
      source: r.source || 'unknown',
      similarity: similarityScore(q, [title, r.snippet].filter(Boolean).join(' ')),
    };
    const prev = seen.get(key);
    if (!prev) seen.set(key, cand);
    else if (cand.snippet.length > prev.snippet.length) {
      // keep the better snippet + the higher similarity that snippet implies.
      seen.set(key, cand.similarity >= prev.similarity ? cand : { ...prev, snippet: cand.snippet });
    }
  }

  return [...seen.values()]
    .sort((a, b) => b.similarity - a.similarity || (b.snippet.length - a.snippet.length))
    .slice(0, max);
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('cheetah-search.mjs')) {
  const text = process.argv.slice(2).join(' ') || 'the phoenix protocol describes a method of recovery';
  const matches = await findSources(text, { max: 10 });
  console.log(`\nCheetah — probable sources for: "${text.slice(0, 70)}"\n`);
  if (!matches.length) console.log('  (no candidate sources — backends may be keyless/offline)');
  for (const m of matches) {
    console.log(`  [${(m.similarity).toFixed(3)}] ${(m.title || '?').slice(0, 64)}  (${m.source})`);
    if (m.url) console.log(`          ${m.url}`);
  }
}
