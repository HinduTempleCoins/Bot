// chunk-text.mjs — smart, paragraph-aware text chunker. Pure transform: the public-safe,
// infra-free core of the "Smart Chunking" book-memory item. NO ChromaDB, NO embeddings,
// NO network — just deterministic word-packing with a configurable overlap, so a downstream
// (private) ingestion step can do the vector/embedding work this layer never touches.
//
//   import { chunkText, countWords } from './chunk-text.mjs'
//   node tools/chunk-text.mjs <file>            # or: cat file | node tools/chunk-text.mjs
//   node tools/chunk-text.mjs <file> --words 400 --overlap 40 --no-paragraph
//
// chunkText(text, { wordsPerChunk=500, overlap=50, byParagraph=true })
//   -> [{ index, text, wordCount, startWord, endWord }]
//
// Packing: paragraphs (split on blank lines) are accumulated until adding the next would
// exceed wordsPerChunk; then a chunk is emitted. A single paragraph longer than
// wordsPerChunk is split on word boundaries. Adjacent chunks carry `overlap` trailing words
// of the previous chunk re-prefixed, so context isn't lost at a boundary. startWord/endWord
// are zero-based offsets into the flat whitespace-tokenized word stream (overlap-inclusive).
// Soft-fail: empty / whitespace-only input -> []. Never throws.

import fs from 'node:fs';

// injectable reader seam so the CLI's only IO is testable / mockable offline.
let _read = (p) => fs.readFileSync(p, 'utf8');
export function __setReader(fn) { _read = fn || ((p) => fs.readFileSync(p, 'utf8')); }

// whitespace-tokenized word count. Soft-fails to 0 on non-strings / empty.
export function countWords(text) {
  if (typeof text !== 'string') return 0;
  const t = text.trim();
  if (!t) return 0;
  return t.split(/\s+/).length;
}

function toWords(s) {
  const t = String(s == null ? '' : s).trim();
  return t ? t.split(/\s+/) : [];
}

// split a paragraph that is itself larger than the cap into word-bounded pieces.
function splitLongParagraph(words, cap) {
  const out = [];
  for (let i = 0; i < words.length; i += cap) out.push(words.slice(i, i + cap));
  return out;
}

export function chunkText(text, opts = {}) {
  if (typeof text !== 'string') return [];
  const wordsPerChunk = Number.isFinite(opts.wordsPerChunk) && opts.wordsPerChunk > 0
    ? Math.floor(opts.wordsPerChunk) : 500;
  let overlap = Number.isFinite(opts.overlap) && opts.overlap >= 0
    ? Math.floor(opts.overlap) : 50;
  // overlap must be strictly smaller than the chunk size or packing can't advance.
  if (overlap >= wordsPerChunk) overlap = Math.max(0, wordsPerChunk - 1);
  const byParagraph = opts.byParagraph !== false;

  if (!text.trim()) return [];

  // build a list of word-arrays ("units") to pack. By paragraph, each unit is a paragraph
  // (long ones pre-split to the cap). Otherwise the whole text is one flat word stream that
  // splitLongParagraph slices into cap-sized units.
  let units;
  if (byParagraph) {
    const paras = text.split(/\n\s*\n+/).map(toWords).filter(w => w.length);
    units = [];
    for (const p of paras) {
      if (p.length > wordsPerChunk) units.push(...splitLongParagraph(p, wordsPerChunk));
      else units.push(p);
    }
  } else {
    units = splitLongParagraph(toWords(text), wordsPerChunk);
  }
  if (!units.length) return [];

  // pack units into chunks of up to wordsPerChunk words (without overlap).
  const packs = [];
  let cur = [];
  for (const u of units) {
    if (cur.length && cur.length + u.length > wordsPerChunk) { packs.push(cur); cur = []; }
    cur = cur.concat(u);
  }
  if (cur.length) packs.push(cur);

  // emit chunks, prefixing each (after the first) with `overlap` trailing words of the prior
  // pack. startWord/endWord index into the flat overlap-inclusive word stream.
  const chunks = [];
  let cursor = 0; // running index into the emitted (overlap-inclusive) word stream
  for (let i = 0; i < packs.length; i++) {
    const prev = i > 0 && overlap > 0 ? packs[i - 1].slice(-overlap) : [];
    const words = prev.concat(packs[i]);
    const startWord = cursor;
    const endWord = cursor + words.length - 1;
    chunks.push({
      index: i,
      text: words.join(' '),
      wordCount: words.length,
      startWord,
      endWord,
    });
    cursor = endWord + 1;
  }
  return chunks;
}

// --- CLI (guarded) ---------------------------------------------------------
function parseArgs(argv) {
  const o = { file: null, wordsPerChunk: 500, overlap: 50, byParagraph: true };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--words') o.wordsPerChunk = +argv[++i];
    else if (a === '--overlap') o.overlap = +argv[++i];
    else if (a === '--no-paragraph') o.byParagraph = false;
    else if (!a.startsWith('--') && o.file == null) o.file = a;
  }
  return o;
}

function readStdin() {
  try { return fs.readFileSync(0, 'utf8'); } catch { return ''; }
}

export function runCli(argv, read = _read, stdin = readStdin) {
  const o = parseArgs(argv);
  let text = '';
  if (o.file) { try { text = read(o.file); } catch { text = ''; } }
  else { text = stdin(); }
  const chunks = chunkText(text, o);
  return {
    file: o.file || '(stdin)',
    wordsPerChunk: o.wordsPerChunk,
    overlap: o.overlap,
    byParagraph: o.byParagraph,
    totalWords: countWords(text),
    chunkCount: chunks.length,
    chunks: chunks.map(c => ({ index: c.index, wordCount: c.wordCount, startWord: c.startWord, endWord: c.endWord })),
  };
}

if (process.argv[1] && process.argv[1].endsWith('chunk-text.mjs')) {
  const stats = runCli(process.argv.slice(2));
  console.log(JSON.stringify(stats, null, 2));
}
