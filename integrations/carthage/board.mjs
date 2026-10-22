// board.mjs — the Carthage expansion backlog as cards on the HATHOR METATRON SCENE BOARD.
//
// This is deliberately NOT a new board model. pentecaust/metatron.mjs already defines the one the
// operator writes against, and we match its vocabulary exactly:
//
//   var COLS=['Backlog','Writing','Review','Done'];                     ← metatron.mjs
//   cards.push({text:…, pts:…, col:0})                                   ← metatron.mjs
//   <input id=pts type=number min=1 max=13 …>                            ← metatron.mjs
//   "1 story point ≈ 500 words (or ⅛ of a script page)."                 ← metatron.mjs
//
// So: four columns, integer `pts` of 1..13 on each card, `col` as the column INDEX, and 500 words
// to the point. A card here is a Type E bulletpoint waiting to be written; the board is the queue
// the drafting bot will later pull from, one card at a time, Backlog → Writing → Review → Done.
//
// SIZING comes from the operator's reading guides, not from a guess:
//   Part 2 § EXPANSION ESTIMATES — "Average: 5-7 paragraphs each"; "Some need: 10-12 paragraphs
//     (Job, Sacred Tales, Lord of Animals, Suit of Diamonds/Grail, Sasha Shulgin spice cabinet
//     analysis, Splendor Solis images)"; "Conservative estimate: 400-500 paragraphs total".
//   Book 2 guide § TYPE E … PROTOCOL — "usually 3-10, sometimes 15-25 for lists", and names the
//     list case: "'Berber, Libyan, Moroccan, Punic Gods' followed by deity list = Each deity needs
//     profile, 15-25 paragraphs total".
//   WORDS_PER_PARAGRAPH is MEASURED off the source rather than assumed: the median prose paragraph
//     in The_Book_of_Tanit19.txt is 143 words (743 paragraphs of >= 40 words; mean 252, so the
//     distribution is long-tailed and the median is the honest centre). Rounded to 150.
//
// Soft-fail: every export tolerates garbage input and returns a safe shape. Nothing throws.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { esc } from './parse.mjs';

// ── metatron vocabulary (must stay identical to pentecaust/metatron.mjs) ─────
export const COLUMNS = Object.freeze(['Backlog', 'Writing', 'Review', 'Done']);
export const WORDS_PER_POINT = 500;   // metatron.mjs: "1 story point ≈ 500 words"
export const MAX_POINTS = 13;         // metatron.mjs: <input id=pts … max=13>
export const MIN_POINTS = 1;          // metatron.mjs: <input id=pts … min=1>

// ── sizing constants (from the reading guides + a measurement of the source) ─
export const WORDS_PER_PARAGRAPH = 150;
export const SIZES = Object.freeze({
  // the guides' default band
  normal: { min: 5, max: 7, basis: 'guides: "Average: 5-7 paragraphs each"' },
  // the items Part 2 names as needing more
  heavy: { min: 10, max: 12, basis: 'guides: "Some need: 10-12 paragraphs"' },
  // a bulletpoint that is itself a list of things, each of which needs a profile
  list: { min: 15, max: 25, basis: 'Book 2 guide: deity/list bulletpoints "15-25 paragraphs total"' },
});

// The six Part 2 names the guide singles out as 10-12 paragraph items.
const HEAVY = [
  /\bjob\b/i,
  /sacred tales/i,
  /lord of (the )?animals/i,
  /(suit of diamonds|holy grail|chalices)/i,
  /shulgin/i,
  /splendor solis/i,
];

function isHeavy(text) { return HEAVY.some((re) => re.test(String(text || ''))); }

// A bulletpoint that enumerates ("Berber, Libyan, Moroccan, Punic Gods", "…, etc.", "various …")
// is the 15-25 paragraph case: each member of the list needs its own profile.
function isList(text) {
  const t = String(text || '');
  if (/\betc\b/i.test(t)) return true;
  if (/\bvarious\b/i.test(t)) return true;
  return (t.match(/,/g) || []).length >= 2;
}

function clampPoints(n) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v)) return MIN_POINTS;
  return Math.max(MIN_POINTS, Math.min(MAX_POINTS, v));
}

/**
 * How big is this bulletpoint?
 * @param {{text?:string,note?:string}} bp
 * @returns {{size,minParagraphs,maxParagraphs,paragraphs,minWords,maxWords,words,points,basis}}
 */
export function estimateExpansion(bp = {}) {
  const text = `${bp.text || ''} ${bp.note || ''}`;
  const size = isHeavy(text) ? 'heavy' : isList(text) ? 'list' : 'normal';
  const band = SIZES[size];
  const paragraphs = Math.round((band.min + band.max) / 2);
  const words = paragraphs * WORDS_PER_PARAGRAPH;
  return {
    size,
    minParagraphs: band.min,
    maxParagraphs: band.max,
    paragraphs,
    minWords: band.min * WORDS_PER_PARAGRAPH,
    maxWords: band.max * WORDS_PER_PARAGRAPH,
    words,
    points: clampPoints(words / WORDS_PER_POINT),
    basis: band.basis,
  };
}

/**
 * Turn a parsed Type E bulletpoint into a metatron scene card.
 * Metatron's own fields (text, pts, col) come first and keep their exact meaning; everything the
 * Carthage pipeline needs rides alongside, so the card is still a valid metatron card.
 */
export function makeCard(bp = {}, { col = 0 } = {}) {
  const est = estimateExpansion(bp);
  return {
    // --- metatron card fields ---
    text: String(bp.text || '').slice(0, 200),
    pts: est.points,
    col: COLUMNS[col] ? col : 0,
    // --- carthage fields ---
    id: String(bp.id || ''),
    column: COLUMNS[COLUMNS[col] ? col : 0],
    book: bp.bookNumber ?? bp.book ?? null,
    bookTitle: bp.bookTitle || null,
    line: bp.line ?? null,
    note: bp.note || null,
    kind: bp.kind || 'candidate',
    confidence: bp.confidence || 'strong',
    inventoryN: bp.inventoryN ?? null,
    estimate: est,
    dossier: null,     // set by the runner once research.mjs has written one
    researchedAt: null,
    updatedAt: null,
  };
}

/** A fresh, empty board. */
export function newBoard() {
  return { version: 1, columns: [...COLUMNS], wordsPerPoint: WORDS_PER_POINT, cards: [], updatedAt: null };
}

function normalizeBoard(board) {
  if (!board || typeof board !== 'object' || !Array.isArray(board.cards)) return newBoard();
  return { ...newBoard(), ...board, cards: board.cards.filter((c) => c && typeof c === 'object') };
}

/**
 * Add a card, or refresh an existing one IN PLACE without losing human progress.
 * Idempotent and resumable: a card already moved to Writing/Review/Done keeps its column, and an
 * existing dossier link survives a re-parse. Re-running the whole pipeline must never reset work.
 */
export function upsertCard(board, card, { now = () => new Date().toISOString() } = {}) {
  const b = normalizeBoard(board);
  if (!card || !card.id) return b;
  const i = b.cards.findIndex((c) => c.id === card.id);
  if (i < 0) {
    b.cards.push({ ...card, updatedAt: now() });
  } else {
    const prev = b.cards[i];
    b.cards[i] = {
      ...prev,
      ...card,
      col: prev.col,                                   // human progress wins
      column: COLUMNS[prev.col] || COLUMNS[0],
      dossier: card.dossier || prev.dossier,
      researchedAt: card.researchedAt || prev.researchedAt,
      updatedAt: now(),
    };
  }
  b.updatedAt = now();
  return b;
}

/** Move a card to a column, by name or index. No-op on an unknown card or column. */
export function moveCard(board, id, column, { now = () => new Date().toISOString() } = {}) {
  const b = normalizeBoard(board);
  const idx = typeof column === 'number' ? column : COLUMNS.indexOf(String(column));
  if (idx < 0 || idx >= COLUMNS.length) return b;
  const c = b.cards.find((x) => x.id === id);
  if (!c) return b;
  c.col = idx;
  c.column = COLUMNS[idx];
  c.updatedAt = now();
  b.updatedAt = now();
  return b;
}

/** Story-point and word totals, overall and per column / per book. */
export function totals(board) {
  const b = normalizeBoard(board);
  const out = {
    cards: b.cards.length,
    points: 0,
    words: 0,
    paragraphs: 0,
    byColumn: Object.fromEntries(COLUMNS.map((c) => [c, { cards: 0, points: 0, words: 0 }])),
    byBook: {},
    remainingPoints: 0,   // everything not yet in Done
  };
  for (const c of b.cards) {
    const pts = Number(c.pts) || 0;
    const words = Number(c.estimate?.words) || 0;
    const paras = Number(c.estimate?.paragraphs) || 0;
    out.points += pts; out.words += words; out.paragraphs += paras;
    const colName = COLUMNS[c.col] || COLUMNS[0];
    out.byColumn[colName].cards += 1;
    out.byColumn[colName].points += pts;
    out.byColumn[colName].words += words;
    if (colName !== 'Done') out.remainingPoints += pts;
    const bk = c.book == null ? 'front-matter' : `Book ${c.book}`;
    out.byBook[bk] = out.byBook[bk] || { cards: 0, points: 0, words: 0 };
    out.byBook[bk].cards += 1;
    out.byBook[bk].points += pts;
    out.byBook[bk].words += words;
  }
  return out;
}

/** The next card the drafting bot should pull: highest-trust, lowest book/line, still in Backlog. */
export function nextCard(board, { requireDossier = true } = {}) {
  const b = normalizeBoard(board);
  const rank = { inventoried: 0, strong: 1, weak: 2 };
  return b.cards
    .filter((c) => (COLUMNS[c.col] || COLUMNS[0]) === 'Backlog')
    .filter((c) => (requireDossier ? !!c.dossier : true))
    .sort((x, y) =>
      (rank[x.confidence] ?? 3) - (rank[y.confidence] ?? 3) ||
      (x.book ?? 999) - (y.book ?? 999) ||
      (x.line ?? 0) - (y.line ?? 0))[0] || null;
}

// ── persistence (soft-fail both ways) ────────────────────────────────────────
export const BOARD_FILE = () =>
  process.env.CARTHAGE_BOARD || path.join(process.cwd(), 'data', 'carthage', 'board.json');

export function loadBoard(file = BOARD_FILE()) {
  try { return normalizeBoard(JSON.parse(fs.readFileSync(file, 'utf8'))); }
  catch { return newBoard(); }
}

export function saveBoard(board, file = BOARD_FILE()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(normalizeBoard(board), null, 2)}\n`);
    return { ok: true, file };
  } catch (e) { return { ok: false, file, error: e && e.message ? e.message : String(e) }; }
}

/** Plain-text board for a terminal or a brief. Everything interpolated is esc()'d. */
export function renderBoard(board, { limit = 10 } = {}) {
  const b = normalizeBoard(board);
  const t = totals(b);
  const lines = [
    `Carthage expansion — ${t.cards} cards · ${t.points} story points · ~${t.words.toLocaleString('en-US')} words · ~${t.paragraphs} paragraphs`,
    `(1 point ≈ ${WORDS_PER_POINT} words · 1 paragraph ≈ ${WORDS_PER_PARAGRAPH} words)`,
    '',
  ];
  for (const col of COLUMNS) {
    const cards = b.cards.filter((c) => (COLUMNS[c.col] || COLUMNS[0]) === col);
    const s = t.byColumn[col];
    lines.push(`${esc(col)} — ${s.cards} cards, ${s.points} pts`);
    for (const c of cards.slice(0, limit)) {
      lines.push(`  · [${esc(c.id)}] ${esc(c.text)} (${esc(String(c.pts))} pt${c.note ? ` — note: ${esc(c.note)}` : ''})`);
    }
    if (cards.length > limit) lines.push(`  … and ${cards.length - limit} more`);
    lines.push('');
  }
  return lines.join('\n');
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  console.log(renderBoard(loadBoard()));
}
