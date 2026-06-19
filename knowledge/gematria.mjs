// gematria.mjs — Hebrew gematria + Greek isopsephy calculator (backlog 85b5ad36fb).
//
// A PURE, deterministic data+transform module: fixed, frozen letter-value tables for the
// Hebrew alphabet (mispar hechrachi / standard absolute value) and the Greek alphabet
// (isopsephy), plus the standard arithmetic over them. This fits the knowledge/ corpus of
// esoteric / ancient-mystery reference material.
//
// This is reference/educational arithmetic ONLY. The module sums fixed integer letter values
// and groups words by equal value. It makes NO interpretive, divinatory, or fortune-telling
// claims — equal numeric value is a property of the spellings, not a statement about meaning.
//
// PURE / deterministic. No network, no LLM, no secrets, no file IO, no remote reader. Every
// function soft-fails (returns 0 / [] / {}) on empty or garbage input and NEVER throws. CLI
// guarded by process.argv[1].
//
//   import { HEBREW_VALUES, GREEK_VALUES, gematria, ordinal, reduce, matches } from './gematria.mjs'
//   node knowledge/gematria.mjs            # compute a fixture word

// --- HTML escape (single local copy; identical behavior to the engine's esc) ----------------
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// --- Hebrew: mispar hechrachi (standard / absolute value) -----------------------------------
//
// 22 base letters; the 5 final (sofit) forms take the SAME value as their base letter under
// the standard (mispar hechrachi) reckoning (the alternative high-value finals scheme,
// mispar gadol, is intentionally NOT used here). Letters are keyed by their Unicode code
// points so both regular and final forms resolve to the correct value.
export const HEBREW_VALUES = Object.freeze({
  'א': 1,    // alef
  'ב': 2,    // bet
  'ג': 3,    // gimel
  'ד': 4,    // dalet
  'ה': 5,    // he
  'ו': 6,    // vav
  'ז': 7,    // zayin
  'ח': 8,    // het
  'ט': 9,    // tet
  'י': 10,   // yod
  'ך': 20,   // final kaf
  'כ': 20,   // kaf
  'ל': 30,   // lamed
  'ם': 40,   // final mem
  'מ': 40,   // mem
  'ן': 50,   // final nun
  'נ': 50,   // nun
  'ס': 60,   // samekh
  'ע': 70,   // ayin
  'ף': 80,   // final pe
  'פ': 80,   // pe
  'ץ': 90,   // final tsadi
  'צ': 90,   // tsadi
  'ק': 100,  // qof
  'ר': 200,  // resh
  'ש': 300,  // shin
  'ת': 400,  // tav
});

// --- Greek: isopsephy ------------------------------------------------------------------------
//
// 24 classical letters plus the three numeral-only archaic letters (digamma/stigma=6, koppa=90,
// sampi=900) that complete the Milesian numbering. Both lowercase and uppercase forms are keyed.
// Final sigma (ς) takes the same value as sigma (200).
export const GREEK_VALUES = Object.freeze({
  'α': 1,    'A': 1,       'Α': 1,    // alpha
  'β': 2,    'Β': 2,                  // beta
  'γ': 3,    'Γ': 3,                  // gamma
  'δ': 4,    'Δ': 4,                  // delta
  'ε': 5,    'Ε': 5,                  // epsilon
  'ϝ': 6,    'Ϝ': 6,    'ϛ': 6,  // digamma / stigma (6)
  'ζ': 7,    'Ζ': 7,                  // zeta
  'η': 8,    'Η': 8,                  // eta
  'θ': 9,    'Θ': 9,                  // theta
  'ι': 10,   'Ι': 10,                 // iota
  'κ': 20,   'Κ': 20,                 // kappa
  'λ': 30,   'Λ': 30,                 // lambda
  'μ': 40,   'Μ': 40,                 // mu
  'ν': 50,   'Ν': 50,                 // nu
  'ξ': 60,   'Ξ': 60,                 // xi
  'ο': 70,   'Ο': 70,                 // omicron
  'π': 80,   'Π': 80,                 // pi
  'ϟ': 90,   'Ϟ': 90,                 // koppa (90)
  'ρ': 100,  'Ρ': 100,                // rho
  'σ': 200,  'ς': 200,  'Σ': 200, // sigma + final sigma
  'τ': 300,  'Τ': 300,                // tau
  'υ': 400,  'Υ': 400,                // upsilon
  'φ': 500,  'Φ': 500,                // phi
  'χ': 600,  'Χ': 600,                // chi
  'ψ': 700,  'Ψ': 700,                // psi
  'ω': 800,  'Ω': 800,                // omega
  'ϡ': 900,  'Ϡ': 900,                // sampi (900)
});

// --- Arabic: ḥisāb al-jummal (the abjad order) ----------------------------------------------
//
// The 28 Arabic letters in their ancient ABJAD (not alphabetical) order, each with its numeral —
// the same 1-9, 10-90, 100-900 ladder as Hebrew/Greek. This is the system the ZAIRJA divination
// device and Arabic gematria run on. Eastern (Mashriqi) values.
export const ARABIC_ABJAD = Object.freeze({
  'ا': 1, 'أ': 1, 'إ': 1, 'آ': 1,   // alif
  'ب': 2,    // ba
  'ج': 3,    // jim
  'د': 4,    // dal
  'ه': 5, 'ة': 5,   // ha / ta marbuta
  'و': 6, 'ؤ': 6,   // waw
  'ز': 7,    // zay
  'ح': 8,    // ha
  'ط': 9,    // ta
  'ي': 10, 'ى': 10, 'ئ': 10,  // ya
  'ك': 20,   // kaf
  'ل': 30,   // lam
  'م': 40,   // mim
  'ن': 50,   // nun
  'س': 60,   // sin
  'ع': 70,   // ayn
  'ف': 80,   // fa
  'ص': 90,   // sad
  'ق': 100,  // qaf
  'ر': 200,  // ra
  'ش': 300,  // shin
  'ت': 400,  // ta
  'ث': 500,  // tha
  'خ': 600,  // kha
  'ذ': 700,  // dhal
  'ض': 800,  // dad
  'ظ': 900,  // za
  'غ': 1000, // ghayn
});

// --- table resolution -----------------------------------------------------------------------
//
// 'hebrew' -> HEBREW_VALUES; 'greek'/'standard' -> GREEK_VALUES; 'arabic'/'abjad' -> ARABIC_ABJAD.
function tableFor(system) {
  const s = String(system ?? '').toLowerCase();
  if (s === 'hebrew') return HEBREW_VALUES;
  if (s === 'greek' || s === 'standard') return GREEK_VALUES;
  if (s === 'arabic' || s === 'abjad') return ARABIC_ABJAD;
  return null;
}

// The fixed numeric value ladder of a system, ascending and de-duplicated, used to compute the
// ordinal (positional) value of a letter.
function valueLadder(table) {
  const seen = new Set();
  for (const v of Object.values(table)) seen.add(v);
  return Array.from(seen).sort((a, b) => a - b);
}

// --- gematria: absolute value sum -----------------------------------------------------------
//
// Sums the table value of every recognized letter in `word`; non-letters and unrecognized
// characters contribute 0 (i.e. are ignored). Soft-fails to 0 on empty/garbage/unknown system.
export function gematria(word, opts = {}) {
  const table = tableFor(opts && opts.system);
  if (!table) return 0;
  const str = String(word ?? '');
  let sum = 0;
  for (const ch of str) {
    const v = table[ch];
    if (typeof v === 'number') sum += v;
  }
  return sum;
}

// --- ordinal: mispar siduri (positional value) ----------------------------------------------
//
// Each recognized letter contributes its 1-based position in the system's ascending value
// ladder (alef/alpha = 1, bet/beta = 2, ...). Non-letters contribute 0. Soft-fails to 0.
export function ordinal(word, system) {
  const table = tableFor(system);
  if (!table) return 0;
  const ladder = valueLadder(table);
  const pos = new Map();
  ladder.forEach((v, i) => pos.set(v, i + 1));
  const str = String(word ?? '');
  let sum = 0;
  for (const ch of str) {
    const v = table[ch];
    if (typeof v === 'number') sum += (pos.get(v) || 0);
  }
  return sum;
}

// --- reduce: digital root 1-9 ----------------------------------------------------------------
//
// Repeatedly sums the decimal digits of |n| until a single digit remains. reduce(0) -> 0;
// negatives use their magnitude. Non-finite / garbage soft-fails to 0.
export function reduce(n) {
  let x = Number(n);
  if (!Number.isFinite(x)) return 0;
  x = Math.abs(Math.trunc(x));
  if (x === 0) return 0;
  // digital root closed form: 1 + (x - 1) mod 9, but compute by summation for clarity/safety.
  while (x >= 10) {
    let s = 0;
    while (x > 0) { s += x % 10; x = Math.floor(x / 10); }
    x = s;
  }
  return x;
}

// --- matches: group words sharing the same gematria value -----------------------------------
//
// Returns a frozen array of groups: [{ value, words: [...] }], sorted by ascending value, where
// each group holds the (de-duplicated, input-order-preserved) words that compute to that value.
// Words computing to 0 are included under value 0. Soft-fails to [] on bad input/system.
export function matches(words, system) {
  if (!tableFor(system)) return Object.freeze([]);
  if (!Array.isArray(words)) return Object.freeze([]);
  const byValue = new Map();
  for (const w of words) {
    const word = String(w ?? '');
    const value = gematria(word, { system });
    if (!byValue.has(value)) byValue.set(value, []);
    const arr = byValue.get(value);
    if (!arr.includes(word)) arr.push(word);
  }
  const groups = Array.from(byValue.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([value, ws]) => Object.freeze({ value, words: Object.freeze(ws.slice()) }));
  return Object.freeze(groups);
}

// --- CLI ------------------------------------------------------------------------------------
//
// Deterministic fixture: the Hebrew word חי ("chai", het+yod) = 8 + 10 = 18 — the canonical
// textbook gematria example, used here purely as a reproducible self-check.
function renderFixture() {
  const word = 'חי'; // het + yod
  const v = gematria(word, { system: 'hebrew' });
  const o = ordinal(word, 'hebrew');
  const r = reduce(v);
  return [
    'gematria.mjs — fixture self-check',
    `  word (Hebrew het+yod): ${word}`,
    `  gematria (mispar hechrachi): ${v}`,
    `  ordinal  (mispar siduri):    ${o}`,
    `  reduce   (digital root):     ${r}`,
  ].join('\n');
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  console.log(renderFixture());
}
