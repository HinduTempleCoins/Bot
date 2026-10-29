// pentecaust/word-filter.mjs — mask curse words in PMs.
//
// Operator, 2026-10-28: "filter out the use of Curse words for now altogether, but not where People
// can't get around it with a Mispelling." So this is a LITERAL, WHOLE-WORD filter and nothing more:
//
//   • the plain spelling is masked — "shit" -> "****"
//   • a misspelling, a star, a stretched vowel or leetspeak is LEFT ALONE ON PURPOSE —
//     "sh*t", "shiit", "sh1t" all pass. There is no normalisation, no character folding, no
//     homoglyph mapping. Do NOT add any: being escapable is the requirement, not a gap.
//   • whole words only, so Scunthorpe, assassin, classic, cocktail, bass and friends are untouched
//
// Scope is PMs (1:1 DMs). Team / game group chat is NOT filtered — the operator asked for PMs.
//
// It masks rather than refuses: the message still sends, so nobody loses what they wrote and no one
// has to guess why a send failed.
//
// House style: ESM, pure, soft-fail-never-throw, offline-testable, no deps.

/**
 * The plain spellings. Lowercase, no variants — variants are deliberately out of scope.
 * Env-overridable so the list is operator-tunable without a deploy: PENTECAUST_CURSES="a,b,c".
 */
const DEFAULT_CURSES = [
  'fuck', 'fucks', 'fucked', 'fucking', 'fucker', 'fuckers', 'motherfucker', 'motherfuckers',
  'shit', 'shits', 'shitted', 'shitting', 'shitty', 'bullshit', 'shithead',
  'bitch', 'bitches', 'bitching', 'bitchy',
  'cunt', 'cunts',
  'asshole', 'assholes', 'dickhead', 'dickheads',
  'bastard', 'bastards',
  'piss', 'pissed', 'pissing',
  'slut', 'sluts', 'whore', 'whores',
  'retard', 'retarded', 'retards',
  'faggot', 'faggots', 'nigger', 'niggers',
  'twat', 'twats', 'wanker', 'wankers', 'prick', 'pricks',
  'goddamn', 'godamn',
];

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

/** The active list, lowercased and de-duplicated. */
export function curseList() {
  const raw = env('PENTECAUST_CURSES', '');
  const list = raw
    ? String(raw).split(',').map((s) => s.trim().toLowerCase()).filter(Boolean)
    : DEFAULT_CURSES;
  return Array.from(new Set(list));
}

const escapeRe = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Whole-word matcher. `\b` on both sides is what keeps "assassin" and "Scunthorpe" safe, and it is
 * also what lets a misspelling through — which is intended.
 */
function matcher(list) {
  if (!list.length) return null;
  // longest first so "motherfucker" masks whole rather than leaving "mother" + mask
  const alts = [...list].sort((a, b) => b.length - a.length).map(escapeRe).join('|');
  try { return new RegExp(`\\b(?:${alts})\\b`, 'gi'); } catch { return null; }
}

/** Mask with the same number of asterisks, so the shape of the sentence survives. */
const stars = (w) => '*'.repeat(String(w).length);

/**
 * Mask the plain curse words in `text`.
 * @param {string} text
 * @param {{list?:string[]}} [opts]
 * @returns {{text:string, masked:number}} the filtered text and how many words were masked
 */
export function maskCurses(text, opts = {}) {
  const s = String(text == null ? '' : text);
  if (!s) return { text: s, masked: 0 };
  const re = matcher(Array.isArray(opts.list) ? opts.list.map((x) => String(x).toLowerCase()) : curseList());
  if (!re) return { text: s, masked: 0 };
  let masked = 0;
  const out = s.replace(re, (w) => { masked += 1; return stars(w); });
  return { text: out, masked };
}

/** True when `text` contains at least one plain curse word. */
export function hasCurse(text, opts = {}) {
  return maskCurses(text, opts).masked > 0;
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && /pentecaust\/word-filter\.mjs$/.test(process.argv[1])) {
  const line = process.argv.slice(2).join(' ');
  if (!line) {
    console.log('usage: node pentecaust/word-filter.mjs "<text>"');
    console.log(`\n${curseList().length} words in the list. Whole-word, exact spelling only —`);
    console.log('misspellings are deliberately NOT caught (operator, 2026-10-28).');
    process.exit(0);
  }
  const r = maskCurses(line);
  console.log(`in  : ${line}`);
  console.log(`out : ${r.text}`);
  console.log(`masked: ${r.masked}`);
}
