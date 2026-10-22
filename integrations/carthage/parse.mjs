// parse.mjs — read THE CARTHAGE BIBLE (Biblia El Kartago) and its reading guides, and turn the
// expansion backlog into data.
//
// THE SOURCE
//   `brujeria/The_Book_of_Tanit19.txt` in the growth corpus — *The Carthage Bible (Biblia El
//   Kartago) / The Temple Culture Remonstrance from the Church / Diaspora Brujeria / Alexandriaca
//   et Delphiaca Bibliotheca Religio*, by Rev. Ryan Sasha-Shai Van Kush, The Shaivite Temple.
//   ~198,900 words, 17,423 lines, 19 books, each with an "or, the Book of …" second name.
//
// THE METHOD IS NOT OURS TO INVENT. It is specified in the operator's own reading guides
// (`Book_201_20Analysis_20Part_201.pdf.txt`, `…Part_202…`, `Book_202_20Analysis.pdf.txt`), and
// Part 1 opens with the operator correcting a previous attempt that built an outline from the
// emails instead of reading the book:
//
//     "You left out all the stuff about the Sun and Moon from the First Chapter. That should
//      have given it away right off the bat."
//     "I was wrong. I created an outline based on emails rather than reading this. Now I'm
//      reading it."
//     Purpose: "Document actual content before applying email expansions."
//
//   ORDER OF OPERATIONS IS LOAD-BEARING: source text first, email expansions second, everything
//   else last. This module only ever reads the SOURCE. research.mjs does the second and third
//   passes, and it cannot run until this one has.
//
// TYPE E BULLETPOINTS (the guides' own words):
//   "Brainstorm placeholders - Author's notes of what should go there. Not section headers - even
//    when they look like headers. Require major expansion - usually 3-12 paragraphs each. Source
//    material in emails - search email archive using keywords."
//
//   Identification rules, verbatim from Part 1 § HOW TO IDENTIFY TYPE E:
//     1. Single line or short phrase (often just 2-5 words)
//     2. NOT a section header for what follows below it
//     3. References a concept/source but doesn't develop it
//     4. "Placeholder" quality - clearly unfinished
//     5. Often references specific texts (e.g. "Book of Tobit Jesus Fish")
//     6. Breaks the prose flow of surrounding paragraphs
//     7. May appear italicized, indented, or set apart visually
//
//   Part 2 § TYPE E BULLETPOINTS: THE EXPANSION SYSTEM already inventories and NUMBERS 63 of them
//   for Book 1. We PARSE that inventory rather than re-deriving it (parseInventory), then extend
//   it by scanning all 19 books for the same shape (extractTypeE). An extracted bulletpoint that
//   matches an inventory entry is `kind:'inventoried'` and carries the operator's own note where
//   he left one — e.g. #23 Sacred Tales: "looks like Header, but I need my own Words between the
//   Quotes."
//
// Exports: CORPUS_ROOT, sourcePath, analysisPaths, readText, loadSource, loadAnalyses,
//   parseBooks, parseInventory, extractTypeE, bookAt, normalizeLabel, matchInventory, parseAll.
//
// Soft-fail house style: nothing here throws. A missing corpus yields empty structures with an
// `ok:false` and a reason, never an exception.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// ── where the corpus lives ───────────────────────────────────────────────────
// The seven growth corpora: brujeria, emails, mail, marsresident, teaching, threadlist,
// warchristmas. They are operator material and live OUTSIDE this public repo — set
// CARTHAGE_CORPUS to wherever the durable copy sits (the corpus host's path is recorded in
// .local/, not here). The default is a local .local/growth mount; tests point it at ./fixtures.
export const CORPUS_ROOT = () =>
  String(process.env.CARTHAGE_CORPUS || path.join(process.cwd(), '.local', 'growth'))
    .replace(/\/+$/, '');

export const SOURCE_REL = 'brujeria/The_Book_of_Tanit19.txt';
export const ANALYSIS_REL = Object.freeze([
  'brujeria/Book_201_20Analysis_20Part_201.pdf.txt',
  'brujeria/Book_201_20Analysis_20Part_202.pdf.txt',
  'brujeria/Book_202_20Analysis.pdf.txt',
]);

export const sourcePath = (root = CORPUS_ROOT()) => path.join(root, SOURCE_REL);
export const analysisPaths = (root = CORPUS_ROOT()) => ANALYSIS_REL.map((r) => path.join(root, r));

/** Read a text file. Returns '' on any failure — never throws. */
export function readText(file) {
  try {
    const s = fs.statSync(file);
    if (!s.isFile()) return '';
    return fs.readFileSync(file, 'utf8');
  } catch { return ''; }
}

/** Load the Carthage Bible source. { ok, path, text, lines, words }. */
export function loadSource(root = CORPUS_ROOT()) {
  const file = sourcePath(root);
  const text = readText(file);
  if (!text) return { ok: false, path: file, text: '', lines: 0, words: 0, reason: 'source not readable' };
  return { ok: true, path: file, text, lines: text.split('\n').length, words: countWords(text) };
}

/** Load the three reading guides. [{ ok, path, text }]. */
export function loadAnalyses(root = CORPUS_ROOT()) {
  return analysisPaths(root).map((file) => {
    const text = readText(file);
    return { ok: !!text, path: file, text };
  });
}

function countWords(s) {
  const t = String(s || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

// Strip the invisible junk a PDF/Docs export leaves behind (zero-width space, soft hyphen, BOM,
// non-breaking space) so a label compares and matches like the plain string it looks like.
function clean(s) {
  return String(s == null ? '' : s)
    .replace(/[​‌‍­﻿]/g, '')
    .replace(/ /g, ' ');
}

/** esc() all interpolation (house style) — used by the text renderers in board.mjs/run.mjs too. */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ── books ────────────────────────────────────────────────────────────────────
// A book heading is a line "The Book of X" IMMEDIATELY followed (blank lines allowed) by its
// second name, "or, the Book of Y". Both halves are required: the source also contains flush-left
// lines like "The Book of Mary Magdeline" that are a section inside a book, not a book heading.
//
// NOTE for anyone handed `^\s*The Book of [A-Z]` as the rule: that regex finds only 17 of the 19.
// Three headings read "The Book of **the** Tree of Life", "…**the** Sphynx" and "…**the** Djed;" —
// lowercase "the" after "of". The second-name line is what actually makes a heading a heading.
const BOOK_HEAD = /^\s*The Book of\s+\S/;
const BOOK_SECOND = /^\s*or,?\s+the\s+\S/i;

/**
 * Split the source into its 19 books.
 * @returns {Array<{number,title,secondName,secondNames,headLine,secondLine,startLine,endLine,lineCount,wordCount,placeholder}>}
 *   Line numbers are 1-based and inclusive. `placeholder:true` marks a book that exists as a
 *   heading with almost nothing under it (Saturn and Titans in the current draft).
 */
export function parseBooks(text, { placeholderWords = 500 } = {}) {
  const lines = String(text || '').split('\n');
  if (lines.length < 2) return [];

  const heads = [];
  for (let i = 0; i < lines.length; i++) {
    if (!BOOK_HEAD.test(clean(lines[i]))) continue;
    // the next non-empty line must be the "or, the Book of …" second name
    let j = i + 1;
    while (j < lines.length && !clean(lines[j]).trim()) j++;
    if (j >= lines.length || !BOOK_SECOND.test(clean(lines[j]))) continue;
    heads.push({ headLine: i + 1, secondLine: j + 1, i, j });
  }

  return heads.map((h, idx) => {
    const title = clean(lines[h.i]).trim().replace(/[;,]\s*$/, '');
    const secondRaw = clean(lines[h.j]).trim().replace(/^or,?\s+/i, '').replace(/[;,]\s*$/, '');
    const startLine = h.headLine;
    const endLine = idx + 1 < heads.length ? heads[idx + 1].headLine - 1 : lines.length;
    const body = lines.slice(startLine - 1, endLine).join('\n');
    const wordCount = countWords(body);
    return {
      number: idx + 1,
      title,
      secondName: secondRaw,
      // a few books carry two second names, e.g. "the Book of the Phoenix; the Book of Wax"
      secondNames: secondRaw.split(/\s*;\s*/).filter(Boolean),
      headLine: h.headLine,
      secondLine: h.secondLine,
      startLine,
      endLine,
      lineCount: endLine - startLine + 1,
      wordCount,
      placeholder: wordCount < placeholderWords,
    };
  });
}

/** Which book contains a 1-based line number? Returns the book or null. */
export function bookAt(books, line) {
  for (const b of books || []) if (line >= b.startLine && line <= b.endLine) return b;
  return null;
}

// ── the operator's own numbered inventory (Part 2) ───────────────────────────
/**
 * Parse § "Complete Inventory (60+ Identified)" out of the Part 2 reading guide. The list is
 * written two ways in the same section — a real numbered list for 1-29, then run-on prose
 * ("30. Pythia 31. Soma is …") for 30-63 — so we normalise the whole block and walk strictly
 * ascending "N." markers.
 * @returns {Array<{n:number,text:string,note:string|null}>}
 */
export function parseInventory(text) {
  const t = clean(text);
  if (!t) return [];
  const start = t.search(/Complete Inventory/i);
  if (start < 0) return [];
  const after = t.slice(start);
  const stop = after.search(/Expansion Protocol/i);
  const region = (stop > 0 ? after.slice(0, stop) : after).replace(/\s+/g, ' ');

  const re = /(?:^|[\s(])(\d{1,3})\.\s*/g;
  const marks = [];
  let m;
  let want = 1;
  while ((m = re.exec(region))) {
    const n = Number(m[1]);
    if (n !== want) continue;            // only an unbroken 1,2,3,… sequence counts as the list
    marks.push({ n, from: m.index + m[0].length });
    want++;
  }
  if (!marks.length) return [];

  const out = [];
  for (let i = 0; i < marks.length; i++) {
    const end = i + 1 < marks.length ? region.lastIndexOf(`${marks[i + 1].n}.`, marks[i + 1].from) : region.length;
    let body = region.slice(marks[i].from, Math.max(marks[i].from, end)).trim();
    // the guide interleaves "From middle sections (Pythia onward):" style headings into the run-on
    // prose; they belong to the NEXT item's preamble, not this item's label.
    body = body
      .replace(/\bFrom [^:]{0,80}:\s*$/i, '')
      .replace(/\s+Plus many embedded\b.*$/i, '')   // the guide's closing aside, not part of #63
      .replace(/[\s.;,]+$/, '').trim();
    if (!body) continue;

    // Trailing parenthetical = the operator's note on that item, e.g. #23 Sacred Tales
    // ("author specifically said: 'looks like Header, but I need my own Words between the Quotes'")
    // and #57 Splendor Solis images ("Describe each image"). Keep it; the drafting bot needs it.
    let note = null;
    const paren = body.match(/^(.*?)\s*\(([^()]*)\)\s*$/);
    if (paren && paren[1].trim()) {
      body = paren[1].trim();
      note = paren[2].replace(/^author specifically said:\s*/i, '').replace(/^["“”']|["“”']$/g, '').trim() || null;
    }
    out.push({ n: marks[i].n, text: body, note });
  }
  return out;
}

// ── Type E extraction from the source ────────────────────────────────────────
// Shape rules, straight from the guides. A Type E line is SHORT, flush-left-ish, isolated by blank
// lines (or sitting in a run of other bulletpoints), and does not end like a sentence.
// The author's own bulletpoint lists carry trailing commas and "etc." — "Ashera Tree Goddess," /
// "Wand, Club, Mace Culture," / "Scotland and Ireland Tribal Constitutions, etc." are three
// consecutive Type E lines in the source. A trailing comma is therefore NOT a prose ending here.
const ENDS_LIKE_PROSE = /(?<!\betc)[.;:!?—–]$/;
const STARTS_LIKE_LABEL = /^["“”'‘(\[A-Z0-9]/;
// A bulletpoint on the line BELOW another one that reads as an instruction is the author's note on
// it, not a separate card — the source's "Splendor Solis images" / "Describe each image" pair, which
// the Part 2 inventory confirms is one item (#57) with a note.
const NOTE_LINE = /^(describe|explain|expand|add|include|quote|cite|compare|insert|finish|fill|research|draft|write|need|needs)\b/i;
const PAGE_ARTEFACT = /^(page|chapter|p|pg)?\s*\d{1,4}$/i;
// Things that LOOK isolated and short but are not brainstorm placeholders: footnote apparatus
// ("1. [14] Traditionally peace offering"), numbered list entries inside a quoted list, and the
// first wrapped line of a block quotation (opens a quote and never closes it on that line).
const FOOTNOTE = /^\d+\s*\.?\s*\[/;
const NUMBERED = /^\d+\s*[.)]/;
const OPENS_QUOTE = /^["“”'‘]/;
// Data rather than brainstorm: correspondence-table rows ("Mars = Tuesday", "Leo, the Lion=August=
// Ruby"), Gardiner hieroglyph sign codes ("O20 & O20A", "U35") and recipe quantities ("10 grams
// Beeswax"). Short, isolated and capitalised, but nothing to expand into paragraphs.
const TABLE_ROW = /=/;
const SIGN_CODE = /^[A-Z]{1,2}\d{1,3}[A-Z]?(\s*(&|and)\s*[A-Z]{1,2}\d{1,3}[A-Z]?)*$/;
const MEASURE = /^\d+(\.\d+)?\s*(g|gram|grams|mg|ml|l|oz|kg|lb|lbs|cup|cups|tsp|tbsp|part|parts|drop|drops)\b/i;
// A Type E bulletpoint is a NOUN PHRASE — a thing the author means to write about. A line carrying
// a finite verb or a pronoun is a sentence (usually a wrapped verse or prose line that happened to
// fall short and blank-separated), so it is downgraded to `weak` rather than queued for drafting.
const SENTENCE_WORDS = new Set(('is are was were be been being am do does did have has had will ' +
  'would can could should must that which who whom when while if because i we you they he she it ' +
  'me my our their his her them us not but so there this these those').split(' '));

function isBlank(line) { return !clean(line).trim(); }

function isCandidate(line, { maxWords = 14, maxChars = 95, maxIndent = 8 } = {}) {
  const raw = clean(line);
  const t = raw.trim();
  if (!t) return false;
  if (t.length > maxChars) return false;
  const indent = raw.length - raw.replace(/^\s+/, '').length;
  if (indent > maxIndent) return false;
  const words = t.split(/\s+/).length;
  if (words > maxWords) return false;
  if (ENDS_LIKE_PROSE.test(t)) return false;
  if (!STARTS_LIKE_LABEL.test(t)) return false;
  if (PAGE_ARTEFACT.test(t)) return false;
  if (FOOTNOTE.test(t) || NUMBERED.test(t)) return false;
  if (OPENS_QUOTE.test(t)) return false;
  if (TABLE_ROW.test(t) || SIGN_CODE.test(t) || MEASURE.test(t)) return false;
  return true;
}

/**
 * How much we trust a shape-match, before a human verifies it.
 *   'inventoried' — the operator already numbered it in the Part 2 inventory. Settled.
 *   'strong'      — reads as a bare noun-phrase placeholder, within the guides' "2-10 words".
 *   'weak'        — right shape, but long or sentence-like. Flagged, NOT queued for drafting.
 * Per the guides this last call ("Is this a header or a placeholder?") is a human STEP 1, so weak
 * candidates are surfaced for review rather than silently dropped or silently drafted.
 */
export function confidenceOf(label, { inventoried = false } = {}) {
  if (inventoried) return 'inventoried';
  const t = clean(label).trim();
  const words = t.split(/\s+/);
  if (words.length > 10) return 'weak';
  const lower = words.map((w) => w.toLowerCase().replace(/[^a-z]/g, ''));
  if (lower.some((w) => w && SENTENCE_WORDS.has(w))) return 'weak';
  if (/["“”]$/.test(t)) return 'weak';
  return 'strong';
}

function nonEmptyNeighbours(lines, idx, dir, n) {
  const out = [];
  for (let i = idx + dir; i >= 0 && i < lines.length && out.length < n; i += dir) {
    const t = clean(lines[i]).trim();
    if (!t) { if (out.length) break; else continue; }
    out.push(t);
  }
  return dir < 0 ? out.reverse() : out;
}

/** Normalised comparison key for a bulletpoint label. */
export function normalizeLabel(s) {
  return clean(s).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

/** Match an extracted label against the operator's numbered inventory. Returns the item or null. */
export function matchInventory(label, inventory) {
  const a = normalizeLabel(label);
  if (!a) return null;
  const items = inventory || [];
  for (const it of items) if (normalizeLabel(it.text) === a) return it;
  // fall back to strong token overlap so "Pharaoh's Epithets" still matches "Pharaohs Epithets"
  // and "Suit of Diamonds and Chalices, as well as the Holy Grail" matches a shorter in-book form.
  const at = new Set(a.split(' ').filter((w) => w.length > 2));
  if (at.size < 2) return null;
  let best = null, bestScore = 0;
  for (const it of items) {
    const bt = new Set(normalizeLabel(it.text).split(' ').filter((w) => w.length > 2));
    if (bt.size < 2) continue;
    let shared = 0;
    for (const w of at) if (bt.has(w)) shared++;
    const score = shared / Math.min(at.size, bt.size);
    if (score > bestScore) { bestScore = score; best = it; }
  }
  return bestScore >= 0.65 ? best : null;
}

/**
 * Scan the whole source for Type E bulletpoints.
 * @param {string} text  the Carthage Bible source
 * @param {{books?:Array, inventory?:Array, context?:number}} opts
 * @returns {Array<{id,text,note,line,book,bookNumber,bookTitle,words,kind,inventoryN,
 *                  contextBefore,contextAfter}>}
 */
export function extractTypeE(text, { books, inventory = [], context = 2 } = {}) {
  const src = String(text || '');
  if (!src.trim()) return [];
  const lines = src.split('\n');
  const bks = books && books.length ? books : parseBooks(src);

  // never treat a book heading or its second name as a bulletpoint
  const headingLines = new Set();
  for (const b of bks) { headingLines.add(b.headLine); headingLines.add(b.secondLine); }

  const cand = lines.map((l, i) => isCandidate(l) && !headingLines.has(i + 1));

  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!cand[i]) continue;
    const prevOk = i === 0 || isBlank(lines[i - 1]) || cand[i - 1];
    // A bulletpoint may sit directly on top of the block quotation it is about — #23 Sacred Tales
    // is exactly that case ("looks like Header, but I need my own Words between the Quotes") — or on
    // top of a second brainstorm fragment, as "King Scorpion" / "eventually to Hercules, and then
    // Merlin and Witches" does. What it never sits on top of is a full wrapped prose line.
    const nextRaw = i === lines.length - 1 ? '' : clean(lines[i + 1]).trim();
    const nextOk = i === lines.length - 1 || isBlank(lines[i + 1]) || cand[i + 1] ||
      OPENS_QUOTE.test(nextRaw) || (nextRaw.length < 70 && !ENDS_LIKE_PROSE.test(nextRaw));
    if (!prevOk || !nextOk) continue;

    const label = clean(lines[i]).trim();

    // instruction line directly under a bulletpoint → it is that bulletpoint's note
    if (NOTE_LINE.test(label) && out.length && out[out.length - 1].line === i) {
      out[out.length - 1].note = label;
      continue;
    }

    const book = bookAt(bks, i + 1);
    const inv = matchInventory(label, inventory);
    out.push({
      id: `B${book ? book.number : 0}-L${i + 1}`,
      text: label,
      note: inv && inv.note ? inv.note : null,
      line: i + 1,
      book: book ? book.number : null,
      bookNumber: book ? book.number : null,
      bookTitle: book ? book.title : null,
      bookSecondName: book ? book.secondName : null,
      words: label.split(/\s+/).length,
      kind: inv ? 'inventoried' : 'candidate',
      confidence: confidenceOf(label, { inventoried: !!inv }),
      inventoryN: inv ? inv.n : null,
      contextBefore: nonEmptyNeighbours(lines, i, -1, context),
      contextAfter: nonEmptyNeighbours(lines, i, +1, context),
    });
  }
  return out;
}

/**
 * One call that does the whole read-the-source-first pass.
 * @returns {{ok,root,source,books,inventory,bulletpoints,coverage,reasons}}
 *   `coverage` reports which of the operator's numbered inventory items we located in the text —
 *   an inventory item we cannot find is a real finding, not a bug to paper over.
 */
export function parseAll({ root = CORPUS_ROOT() } = {}) {
  const reasons = [];
  const source = loadSource(root);
  if (!source.ok) reasons.push(`source unreadable at ${source.path}`);
  const analyses = loadAnalyses(root);
  const inventory = analyses.flatMap((a) => (a.ok ? parseInventory(a.text) : []));
  // the three guides overlap; keep the first (longest) inventory found
  const inv = (() => {
    let best = [];
    for (const a of analyses) {
      if (!a.ok) continue;
      const got = parseInventory(a.text);
      if (got.length > best.length) best = got;
    }
    return best;
  })();
  if (!inv.length) reasons.push('no numbered Type E inventory parsed from the reading guides');

  const books = source.ok ? parseBooks(source.text) : [];
  const bulletpoints = source.ok ? extractTypeE(source.text, { books, inventory: inv }) : [];

  const found = new Set(bulletpoints.map((b) => b.inventoryN).filter((n) => n != null));
  const coverage = {
    inventory: inv.length,
    located: found.size,
    missing: inv.filter((i) => !found.has(i.n)).map((i) => ({ n: i.n, text: i.text })),
  };

  return {
    ok: source.ok,
    root,
    source: { path: source.path, lines: source.lines, words: source.words },
    books,
    inventory: inv,
    inventoryAll: inventory.length,
    bulletpoints,
    coverage,
    reasons,
  };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = parseAll();
  if (!r.ok) { console.error(`carthage/parse: ${r.reasons.join('; ')}`); process.exit(1); }
  console.log(`source: ${r.source.path}`);
  console.log(`${r.source.lines} lines · ${r.source.words} words · ${r.books.length} books\n`);
  for (const b of r.books) {
    console.log(
      `${String(b.number).padStart(2)}. ${b.title}\n    or, ${b.secondName}` +
      `\n    lines ${b.startLine}-${b.endLine} · ${b.wordCount} words${b.placeholder ? '  ← PLACEHOLDER' : ''}`);
  }
  const by = (c) => r.bulletpoints.filter((b) => b.confidence === c).length;
  console.log(`\ninventory parsed: ${r.inventory.length} numbered items`);
  console.log(`Type E bulletpoints extracted: ${r.bulletpoints.length}` +
    `  (inventoried ${by('inventoried')} · strong ${by('strong')} · weak ${by('weak')})`);
  console.log(`inventory items located in the text: ${r.coverage.located}/${r.coverage.inventory}`);
  if (process.argv.includes('--list')) {
    const only = process.argv.includes('--weak') ? ['weak'] : ['inventoried', 'strong'];
    for (const b of r.bulletpoints) {
      if (!only.includes(b.confidence)) continue;
      console.log(`  [${b.kind === 'inventoried' ? `#${String(b.inventoryN).padStart(2)}` : '   '}] ${b.id.padEnd(11)} ${b.text}${b.note ? `  — note: ${b.note}` : ''}`);
    }
  }
}
