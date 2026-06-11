// book-chunker.mjs — smart paragraph chunker for book/corpus ingestion.
//
// Pure text-transform: no fetch, no embeddings, no storage — just string math. Where
// integrations/library-rag.mjs + integrations/minilm-embedder.mjs EMBED and RETRIEVE, this
// module only SEGMENTS: it slices a long document into ~target-word chunks ready to hand to
// those embedders one chunk at a time.
//
// Spec — "Smart Chunking: by paragraph, ~500 words, with overlap":
//   - Split the text into paragraphs on `splitOn` (default the blank-line "\n\n").
//   - Pack WHOLE paragraphs into a chunk until adding the next one would exceed `targetWords`.
//   - A single paragraph longer than `targetWords` is split at WORD boundaries into target-sized
//     pieces (no paragraph is ever silently dropped or split mid-word).
//   - Carry an `overlapWords`-word TAIL of each emitted chunk forward as the HEAD of the next, so
//     a sentence straddling a boundary still appears whole in at least one chunk (retrieval recall).
//
// Each chunk: { index, text, wordCount, startWord, endWord } where startWord/endWord are absolute
// word offsets into the original stream of words (endWord exclusive). Overlap means consecutive
// chunks' [startWord,endWord) ranges intentionally OVERLAP by ~overlapWords.
//
// Exports:
//   chunkText(text, opts) -> Array<{index,text,wordCount,startWord,endWord}>
//   estimateChunks(text, opts) -> number   (count only; same packing, no string building)
//
// Soft-fail (house style): never throw. Empty / non-string / whitespace-only input -> []. Bad
// numeric opts are clamped to sane values rather than thrown on.

const DEFAULTS = { targetWords: 500, overlapWords: 50, splitOn: '\n\n' };

// Coerce one option to a non-negative integer, falling back to `dflt` on garbage.
function intOpt(v, dflt) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 0 ? n : dflt;
}

function resolveOpts(opts) {
  const o = opts && typeof opts === 'object' ? opts : {};
  let targetWords = intOpt(o.targetWords, DEFAULTS.targetWords);
  if (targetWords < 1) targetWords = DEFAULTS.targetWords; // a target of 0 is meaningless
  let overlapWords = intOpt(o.overlapWords, DEFAULTS.overlapWords);
  // Overlap must be strictly smaller than the target or we'd never make forward progress.
  if (overlapWords >= targetWords) overlapWords = Math.max(0, targetWords - 1);
  const splitOn =
    typeof o.splitOn === 'string' && o.splitOn.length > 0 ? o.splitOn : DEFAULTS.splitOn;
  return { targetWords, overlapWords, splitOn };
}

// Split a string into words on any run of whitespace. Empty/whitespace -> [].
function words(s) {
  const t = String(s).trim();
  return t.length === 0 ? [] : t.split(/\s+/);
}

// Break the text into paragraph word-arrays. A paragraph longer than targetWords is pre-split into
// target-sized word slices so the packer only ever deals with paragraphs that fit. Returns an array
// of word-arrays (each non-empty).
function paragraphs(text, splitOn, targetWords) {
  const out = [];
  for (const raw of String(text).split(splitOn)) {
    const w = words(raw);
    if (w.length === 0) continue;
    if (w.length <= targetWords) {
      out.push(w);
    } else {
      for (let i = 0; i < w.length; i += targetWords) {
        out.push(w.slice(i, i + targetWords));
      }
    }
  }
  return out;
}

/**
 * Segment `text` into overlapping, paragraph-aligned, ~targetWords chunks.
 * @returns Array<{index,text,wordCount,startWord,endWord}> — [] on empty/non-string input.
 */
export function chunkText(text, opts = {}) {
  if (typeof text !== 'string') return [];
  const { targetWords, overlapWords, splitOn } = resolveOpts(opts);
  const paras = paragraphs(text, splitOn, targetWords);
  if (paras.length === 0) return [];

  const chunks = [];
  let cur = []; // word array for the chunk being built
  let curStart = 0; // absolute word offset where `cur` begins

  const flush = () => {
    if (cur.length === 0) return;
    const startWord = curStart;
    const endWord = curStart + cur.length;
    chunks.push({
      index: chunks.length,
      text: cur.join(' '),
      wordCount: cur.length,
      startWord,
      endWord,
    });
    // Carry an overlap tail forward as the head of the next chunk.
    if (overlapWords > 0) {
      const tail = cur.slice(Math.max(0, cur.length - overlapWords));
      cur = tail;
      curStart = endWord - tail.length;
    } else {
      cur = [];
      curStart = endWord;
    }
  };

  for (const para of paras) {
    // If appending this whole paragraph would overflow the target and we already have content,
    // close the current chunk first (whole-paragraph integrity).
    if (cur.length > 0 && cur.length + para.length > targetWords) {
      flush();
    }
    cur = cur.concat(para);
    // After packing, if we're at/over target, emit.
    if (cur.length >= targetWords) {
      flush();
    }
  }
  flush();

  // The overlap carry can leave a trailing chunk that is a pure duplicate of the previous chunk's
  // tail (no new words past the previous endWord). Drop any such tail-only remnant.
  if (chunks.length >= 2) {
    const last = chunks[chunks.length - 1];
    const prev = chunks[chunks.length - 2];
    if (last.endWord <= prev.endWord) chunks.pop();
  }
  // Re-index in case we popped.
  for (let i = 0; i < chunks.length; i++) chunks[i].index = i;
  return chunks;
}

/**
 * Count chunks chunkText would produce, without building chunk strings.
 * @returns number — 0 on empty/non-string input.
 */
export function estimateChunks(text, opts = {}) {
  if (typeof text !== 'string') return 0;
  // Cheapest correct implementation: run the packer and count. The work is string-free except for
  // the final join, which dominates nothing for a count; reuse keeps the two paths in lockstep.
  return chunkText(text, opts).length;
}

export default { chunkText, estimateChunks };
