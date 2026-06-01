/**
 * discovery.js — Cheetah Step 5: discovery-first librarian mode.
 *
 * Per CHEETAH_ADVANCED.md: the inversion of the old punitive Cheetah. Before
 * (and more often than) it ever surfaces a copy, Cheetah's primary face is a
 * LIBRARIAN — "this post connects to prior work X / by author Y" — stating a
 * factual relatedness with a source link, never an accusation. Hathor handles
 * any resolution; Cheetah only points.
 *
 * The key distinction from text-detection (Step 1-3) is the SIMILARITY BAND:
 *   - >= SIMILARITY_THRESHOLD (default 0.5)  → a *match* (text-detection's job:
 *     possible copy, route to the crediting note + finding).
 *   - [RELATEDNESS_FLOOR, SIMILARITY_THRESHOLD) → *related* (this module: shares
 *     substantial material/topic but isn't a copy — a librarian "see also").
 *   - < RELATEDNESS_FLOOR → unrelated, say nothing.
 *
 * Deterministic: shingle + Jaccard, same engine as detection. No LLM decides
 * relatedness. Gated by relevance (the band) and frequency (don't spam links).
 *
 *   discover(post, { corpus }) -> { related: [{author, permlink, score, why}], note }
 */

import { shingles, jaccard } from './text-detection.js';

// Relatedness is TOPIC overlap, not near-copy. Copy detection uses 5-word
// shingles (rare exact phrases); relatedness uses SHORTER shingles (2 words)
// so two posts that cover the same ground in different words still register.
export const DISCOVERY_SHINGLE_SIZE = parseInt(process.env.CHEETAH_DISCOVERY_SHINGLE || '2', 10);

// floor for "related enough to mention". Below this it's just incidental shared
// vocabulary — not worth a librarian note. Tunable via env.
export const RELATEDNESS_FLOOR = parseFloat(process.env.CHEETAH_RELATEDNESS_FLOOR || '0.08');

// ceiling: at/above this (on the discovery shingle) it's effectively a copy —
// that's text-detection's territory, not a "see also". Distinct from detection's
// own threshold because it's measured on the shorter discovery shingle.
export const RELATEDNESS_CEIL = parseFloat(process.env.CHEETAH_RELATEDNESS_CEIL || '0.45');

// cap on how many "see also" links one note carries — a librarian points at the
// best few, not a wall of references.
export const MAX_RELATED = parseInt(process.env.CHEETAH_MAX_RELATED || '3', 10);

/**
 * Score one post against a corpus, returning prior posts in the relatedness
 * band (related but NOT a copy), ranked best-first.
 */
export function relatedInCorpus(body, corpus = [], opts = {}) {
  const floor = opts.floor ?? RELATEDNESS_FLOOR;
  const ceil = opts.ceil ?? RELATEDNESS_CEIL;
  const n = opts.shingleSize ?? DISCOVERY_SHINGLE_SIZE;
  const target = shingles(body, n);
  const scored = [];
  for (const c of corpus) {
    const score = jaccard(target, shingles(c.body, n));
    // strictly inside the band: at/above floor, strictly below the match ceiling.
    // (>= ceiling is text-detection's territory — a likely copy, not a "see also".)
    if (score >= floor && score < ceil) {
      scored.push({ author: c.author, permlink: c.permlink, score: +score.toFixed(3), why: 'shared-material' });
    }
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, opts.max ?? MAX_RELATED);
}

/**
 * Compose a deterministic librarian "see also" note. No LLM, no accusation —
 * states the connection as fact, links the prior work, lets the reader judge.
 * Returns '' when nothing is related (Cheetah stays silent).
 */
export function composeLibrarianNote(related, opts = {}) {
  if (!related.length) return '';
  const linkFor = opts.linkFor || ((r) => `@${r.author}/${r.permlink}`);
  const lines = related.map((r) => `- ${linkFor(r)} (${Math.round(r.score * 100)}% shared material)`);
  const head = related.length === 1
    ? 'This connects to earlier work on the chain:'
    : 'This connects to earlier work on the chain:';
  return `${head}\n${lines.join('\n')}\n\n_Pointed out by Cheetah — a connection, not a claim. The authors above hold their own context._`;
}

/** Top-level: find related prior work + compose the note. */
export function discover(post, { corpus = [], ...opts } = {}) {
  const related = relatedInCorpus(post.body, corpus, opts);
  return { related, note: composeLibrarianNote(related, opts) };
}
