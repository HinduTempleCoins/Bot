// septuagint-chain.mjs — the m-l-k root in Greek letters.
//
// Operator, 2026-10-20: "Maybe make a New Digram for this" — the Greek material was a cramped column
// on the m-l-k wheel. Then: "Don't say 'Not the same' just Show how Similar they are, Show the
// Similarities that the 'Hebrew is Greek' Author actually would have."
//
// So this figure is affirmative. No hedging column, no "notice, not identity". Joseph Yahuda argued in
// *Hebrew Is Greek* (1982) that the two languages are one; what is drawn below is the evidence he would
// have led with, and every line of it is an artefact rather than an argument — a Septuagint spelling, a
// translator's substitution, a bilingual stone. The reader can check each one.
//
// THE THREE CROSSINGS, which are the three bands of the diagram:
//   I.   The letters carried. mem/lamed/kaph come through as mu/lambda/chi and the root is still legible
//        in Greek dress: Μολόχ, Μελχισέδεκ, Μαλαχίας. And because Greek cannot write an aleph at all,
//        מלאכי and מלכי fall together into the same μ-λ-χ the moment they are written in Greek — the
//        distinction the wheel keeps in Hebrew does not survive the crossing.
//   II.  The word carried, the letters did not. ἄγγελος for מלאך, νόμος for תורה, and so on. Worth
//        knowing that Greek's own word for messenger has no agreed Indo-European parentage: Watkins'
//        comparison with Sanskrit ajira- has been abandoned, Beekes sets ἄγγελος beside ἄγγαρος, a
//        courier word out of the East, and the 17th-c. Hebraist Gussetius derived ἀγγέλλω straight from
//        הִגִּיד, "he announced".
//   III. The same four letters, read two ways, in antiquity. In Leviticus the Greek renders למלך as
//        ἄρχοντι, a ruler — and at 20:5 as τοὺς ἄρχοντας, plural, which no proper name can be. At
//        2 Kings 23:10 the same four letters come over as τῷ Μόλοχ, a name. One word, two decisions,
//        taken centuries before the first vowel point. The Hebrew side has its own case: 2 Samuel 11:1
//        writes "the messengers" where it means "when kings go out to battle".
//   IV.  The same god on one stone. The Cippi of Melqart — Punic to Melqart, Greek to Ἡρακλῆς, one
//        dedication, two scripts. Barthélemy read Phoenician off the Greek side in 1758 and recovered
//        18 of the 22 letters, so m-l-k is on the object that unlocked the script.
//
// Pure: data in, SVG out. No network, no randomness.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const f = (n) => Math.round(n * 100) / 100;

const SCRIPT = "'Noto Sans Hebrew','Noto Serif Hebrew','SBL Hebrew','Times New Roman','DejaVu Sans','FreeSerif',serif";
const SANS = "system-ui,-apple-system,'Segoe UI',sans-serif";
const INK = '#141210', BONE = '#f0e9db', GOLD = '#c8a24a', DIM = '#968d7c';
const HEB = '#c8a24a', GRK = '#8a7fc0', ENG = '#6fa8a0';

/** The three letters themselves, which is where the argument starts. */
export const LETTER_MAP = [
  { he: 'מ', heName: 'mēm', gk: 'Μ μ', gkName: 'mu' },
  { he: 'ל', heName: 'lāmed', gk: 'Λ λ', gkName: 'lambda' },
  { he: 'כ', heName: 'kap', gk: 'Χ χ', gkName: 'chi', note: 'and Κ κ, kappa' },
];

/**
 * Band I — the root written in Greek letters. `en` is what English finally received.
 */
export const CARRIED = [
  { he: 'מֹלֶךְ', heTr: 'mōlek', gk: 'Μολόχ', gkTr: 'Molokh', en: 'Moloch',
    note: 'The form the world knows is the Greek one. English never met the Hebrew.' },
  { he: 'מַלְכִּי־צֶדֶק', heTr: 'Malkî-ṣedeq', gk: 'Μελχισέδεκ', gkTr: 'Melchisedek', en: 'Melchizedek',
    note: 'Carried into Hebrews in its Greek dress and never changed back.' },
  { he: 'מַלְאָכִי', heTr: "Mal'ākî", gk: 'Μαλαχίας', gkTr: 'Malachias', en: 'Malachi',
    note: 'The aleph is simply gone — Greek has no letter for it, so in Greek this is μ-λ-χ, the same three signs as Μελχισέδεκ. Nor is the convergence only Greek: the Punic corpus writes MLKT where MLʾKT is meant, Palmyrene has mlkbl, “Messenger of Baal”, and Arabic keeps malik the king beside malak the angel in one set of letters.' },
  { he: 'מלקרת', heTr: 'Melqart', gk: 'Μελκάρθος', gkTr: 'Melkarthos', en: '(Melqart)',
    note: 'Read as mlk-qrt, King of the City — a reconstruction, and the usual one. Greek writers kept the consonants whole: Μελ-καρθ-ος.' },
];

/**
 * Band II — where a Greek word was put in place of the Hebrew one, and English took the Greek.
 */
export const TRANSLATED = [
  { he: 'מַלְאָךְ', heTr: "mal'āk", heSense: 'one who is sent', gk: 'ἄγγελος', gkTr: 'angelos', en: 'angel',
    note: 'Both words mean exactly the same thing, and the Greek one has no settled parentage of its own: the Indo-European comparison is abandoned, Beekes sets it beside ἄγγαρος out of the East, and Gussetius derived it from הִגִּיד, "he announced".' },
  { he: 'תּוֹרָה', heTr: 'tôrâ', heSense: 'teaching, instruction', gk: 'νόμος', gkTr: 'nomos', en: 'law',
    note: 'The heaviest substitution in the book. Teaching became statute, and most of what has been argued about since follows from it.' },
  { he: 'נֶפֶשׁ', heTr: 'nepeš', heSense: 'throat, breath, a living creature entire', gk: 'ψυχή', gkTr: 'psychē', en: 'soul',
    note: 'A whole living thing became a part of one — the part that could then be separated from the body.' },
  { he: 'שְׁאוֹל', heTr: "šᵊ'ôl", heSense: 'the grave, where everyone goes', gk: 'ᾅδης', gkTr: 'hādēs', en: 'hell',
    note: 'A common destination took a Greek god’s name, and later a moral temperature it never had.' },
  { he: 'רוּחַ', heTr: 'rûaḥ', heSense: 'wind, breath, moving air', gk: 'πνεῦμα', gkTr: 'pneuma', en: 'spirit',
    note: 'Weather became metaphysics.' },
  { he: 'מָשִׁיחַ', heTr: 'māšîaḥ', heSense: 'anointed — smeared with oil', gk: 'Χριστός', gkTr: 'Christos', en: 'Christ',
    note: 'A description of an office became a name.' },
];

/** Band III — the bilingual stone. */
export const CIPPUS = {
  punic: 'לאדנן למלקרת בעל צר',
  punicTr: "l'dnn lmlqrt b'l ṣr — “to our lord Melqart, Baal of Tyre”",
  greek: 'ΗΡΑΚΛΕΙ ΑΡΧΗΓΕΤΕΙ',
  greekTr: 'Ἡρακλεῖ ἀρχηγέτει — “to Herakles the Founder”',
  lines: [
    'Two marble cippi from Tas-Silġ in Malta, 2nd century BC. One dedication, cut twice: Punic on the base, Greek above it.',
    'The same two brothers, the same god, and on the Greek face the god of the m-l-k root is simply called Herakles.',
    'In 1758 Jean-Jacques Barthélemy read the Punic off the Greek and recovered 18 of the 22 Phoenician letters from it.',
    'So the root is not merely comparable to Greek. It is on the object by which Europe learned to read Phoenician at all.',
    'One cippus is in the Louvre; its twin is in Valletta.',
  ],
};

/**
 * Band IV — the split the Greek translators themselves made, centuries before the vowel points existed.
 * Verified verse by verse from the printed Greek: in Leviticus the four letters are rendered as a common
 * noun, in Kings transliterated as a god's name. The plural at Lev 20:5 is the load-bearing one, because
 * a proper name has no plural. Μολοχ appears nowhere in LXX Leviticus 18 or 20.
 */
export const SPLIT = {
  bare: 'למלך',
  bareNote: 'Leviticus 18:21, unpointed: four letters, and no mater lectionis to help. The same four cut into the Judahite LMLK jar seals around 700 BC — 2,000-odd handles reading “belonging to the king”.',
  readings: [
    { ref: 'Leviticus 18:21', gk: 'ἄρχοντι', en: '“to serve a RULER” — a common noun' },
    { ref: 'Leviticus 20:2, 3, 4', gk: 'ἄρχοντι', en: 'a ruler again, three more times' },
    { ref: 'Leviticus 20:5', gk: 'τοὺς ἄρχοντας', en: 'THE RULERS — plural. A proper name has no plural.' },
    { ref: '2 Kings 23:10', gk: 'τῷ Μόλοχ', en: '“to MOLOCH, in the fire” — carried over as a name' },
  ],
  closers: [
    'One written word, two decisions, taken by the same tradition in different books and five to eight centuries before anyone wrote a vowel.',
    'And the field was open in Hebrew too. At 2 Samuel 11:1 the text writes הַמַּלְאָכִים, “the MESSENGERS”, at the moment it means “when KINGS go out to battle”.',
    'Rendsburg calls that visual word play — it exists, he writes, “solely from the written form of the text”. The reader saw both and knew which was meant.',
  ],
};

const text = (x, y, s, { size = 14, weight = 400, anchor = 'start', fill = BONE, font = SANS, ls = 0, rtl = false } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${esc(font)}" font-size="${size}"`
  + ` font-weight="${weight}" fill="${fill}"${ls ? ` letter-spacing="${ls}"` : ''}`
  + `${rtl ? ' direction="rtl" unicode-bidi="bidi-override"' : ''}>${esc(s)}</text>`;

export function wrap(s, n) {
  const w = String(s).split(/\s+/); const out = []; let cur = '';
  for (const x of w) { if (cur && (cur + ' ' + x).length > n) { out.push(cur); cur = x; } else cur = cur ? cur + ' ' + x : x; }
  if (cur) out.push(cur);
  return out;
}

const W = 1520, PAD = 56;
const C_HE = 330, C_GK = 760, C_EN = 1085;
const NOTE_X = 170, NOTE_COLS = 86;

function bandHead(y, roman, title, sub) {
  let s = text(PAD + 14, y, roman, { size: 26, fill: GOLD, weight: 700, font: SCRIPT });
  s += text(PAD + 58, y, title, { size: 15, fill: GOLD, ls: 3, weight: 700 });
  s += text(PAD + 58, y + 21, sub, { size: 12.5, fill: DIM });
  return s;
}

/** One Hebrew→Greek→English row. Returns [svg, height]. */
function row(r, y, { sense = false } = {}) {
  let s = '';
  s += text(C_HE, y + 28, r.he, { size: 30, font: SCRIPT, fill: HEB, weight: 700, anchor: 'end', rtl: true });
  s += text(C_HE, y + 48, r.heTr, { size: 12.5, fill: BONE, anchor: 'end' });
  if (sense && r.heSense) s += text(C_HE, y + 65, r.heSense, { size: 11, fill: DIM, anchor: 'end' });

  const ax1 = C_HE + 26, ax2 = C_GK - 142;
  s += `<line x1="${f(ax1)}" y1="${f(y + 23)}" x2="${f(ax2)}" y2="${f(y + 23)}" stroke="${GRK}" stroke-width="1.4" opacity="0.65"/>`;
  s += `<path d="M ${f(ax2 + 9)},${f(y + 23)} L ${f(ax2 - 2)},${f(y + 18.5)} L ${f(ax2 - 2)},${f(y + 27.5)} Z" fill="${GRK}" opacity="0.85"/>`;

  s += text(C_GK, y + 28, r.gk, { size: 27, font: SCRIPT, fill: GRK, weight: 700, anchor: 'middle' });
  s += text(C_GK, y + 48, r.gkTr, { size: 12.5, fill: BONE, anchor: 'middle' });

  const bx1 = C_GK + 118, bx2 = C_EN - 26;
  s += `<line x1="${f(bx1)}" y1="${f(y + 23)}" x2="${f(bx2)}" y2="${f(y + 23)}" stroke="${ENG}" stroke-width="1.4" opacity="0.65"/>`;
  s += `<path d="M ${f(bx2 + 9)},${f(y + 23)} L ${f(bx2 - 2)},${f(y + 18.5)} L ${f(bx2 - 2)},${f(y + 27.5)} Z" fill="${ENG}" opacity="0.85"/>`;
  s += text(C_EN, y + 30, r.en, { size: 25, fill: ENG, weight: 700 });

  const lines = wrap(r.note, NOTE_COLS);
  lines.forEach((l, i) => { s += text(NOTE_X, y + 86 + i * 17, l, { size: 13, fill: BONE }); });
  const h = Math.max(84, (sense && r.heSense ? 72 : 56) + lines.length * 17 + 24);
  s += `<line x1="${PAD}" y1="${f(y + h - 7)}" x2="${f(W - PAD)}" y2="${f(y + h - 7)}" stroke="${GOLD}" stroke-width="0.6" opacity="0.16"/>`;
  return [s, h];
}

export function septuagintChainSvg() {
  let body = '';
  let y = 236;

  // the three letters, across the top
  body += text(PAD + 60, y, 'מלך', { size: 30, font: SCRIPT, fill: BONE, weight: 700, rtl: true });
  body += text(PAD + 60, y + 22, 'three letters', { size: 11.5, fill: DIM });
  LETTER_MAP.forEach((m, i) => {
    const x = 300 + i * 290;
    body += text(x, y, m.he, { size: 36, font: SCRIPT, fill: HEB, weight: 700, rtl: true });
    body += text(x + 34, y, '→', { size: 20, fill: DIM });
    body += text(x + 70, y, m.gk, { size: 30, font: SCRIPT, fill: GRK, weight: 700 });
    body += text(x, y + 22, `${m.heName} · ${m.gkName}${m.note ? ' · ' + m.note : ''}`, { size: 11.5, fill: DIM });
  });
  y += 58;
  body += `<line x1="${PAD}" y1="${f(y)}" x2="${f(W - PAD)}" y2="${f(y)}" stroke="${GOLD}" stroke-width="1" opacity="0.3"/>`;
  y += 48;

  body += bandHead(y, 'א', 'THE LETTERS CARRIED', 'The root is still legible in Greek. And Greek has no aleph, so the aleph words and the king words fall together the moment they cross.');
  y += 56;
  body += text(C_HE, y, 'HEBREW', { size: 12, fill: HEB, ls: 3.5, weight: 700, anchor: 'end' });
  body += text(C_GK, y, 'GREEK', { size: 12, fill: GRK, ls: 3.5, weight: 700, anchor: 'middle' });
  body += text(C_EN, y, 'ENGLISH', { size: 12, fill: ENG, ls: 3.5, weight: 700 });
  y += 20;
  for (const r of CARRIED) { const [s, h] = row(r, y); body += s; y += h; }
  y += 40;

  body += bandHead(y, 'ב', 'THE WORD CARRIED, THE LETTERS DID NOT', 'A Greek word was put in the place of the Hebrew one, and English took the Greek.');
  y += 76;
  for (const r of TRANSLATED) { const [s, h] = row(r, y, { sense: true }); body += s; y += h; }
  y += 40;

  body += bandHead(y, 'ג', 'THE SAME FOUR LETTERS, READ TWO WAYS — BY PEOPLE WHO HAD NO VOWEL POINTS',
    'Not our reconstruction. The Greek translators\u2019 own split, book against book.');
  y += 62;
  body += text(C_HE, y + 16, SPLIT.bare, { size: 52, font: SCRIPT, fill: HEB, weight: 700, anchor: 'end', rtl: true });
  wrap(SPLIT.bareNote, 92).forEach((l, i) => { body += text(C_HE + 150, y + i * 19, l, { size: 13, fill: DIM }); });
  y += 62;
  for (const r of SPLIT.readings) {
    body += text(C_HE, y, r.ref, { size: 13.5, fill: BONE, weight: 600, anchor: 'end' });
    body += text(C_HE + 46, y, r.gk, { size: 21, font: SCRIPT, fill: GRK, weight: 700 });
    body += text(C_HE + 290, y, r.en, { size: 13.5, fill: BONE });
    y += 32;
  }
  y += 8;
  for (const l of SPLIT.closers) { wrap(l, 150).forEach((t) => { body += text(NOTE_X, y, t, { size: 13, fill: BONE }); y += 18; }); y += 6; }
  y += 34;

  body += bandHead(y, 'ד', 'THE SAME GOD, ON ONE STONE', 'The Cippi of Melqart — the bilingual that let Europe read Phoenician.');
  y += 66;
  body += text(410, y + 6, CIPPUS.punic, { size: 26, font: SCRIPT, fill: HEB, weight: 700, anchor: 'middle', rtl: true });
  body += text(410, y + 28, CIPPUS.punicTr, { size: 12, fill: DIM, anchor: 'middle' });
  body += text(1080, y + 6, CIPPUS.greek, { size: 24, font: SCRIPT, fill: GRK, weight: 700, anchor: 'middle' });
  body += text(1080, y + 28, CIPPUS.greekTr, { size: 12, fill: DIM, anchor: 'middle' });
  y += 58;
  for (const l of CIPPUS.lines) { wrap(l, 150).forEach((t) => { body += text(NOTE_X, y, t, { size: 13, fill: BONE }); y += 18; }); }

  const h = y + 92;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${f(h)}" width="${W}" height="${f(h)}" role="img" aria-label="The m-l-k root carried into Greek letters, translated into Greek words, and identified with a Greek god">`
    + `<rect width="${W}" height="${f(h)}" fill="${INK}"/>`
    + `<rect x="22" y="22" width="${W - 44}" height="${f(h - 44)}" fill="none" stroke="${GOLD}" stroke-width="1" opacity="0.4"/>`
    + text(W / 2, 78, 'THE ROOT IN GREEK LETTERS', { size: 19, fill: GOLD, ls: 5, weight: 700, anchor: 'middle' })
    + text(W / 2, 114, 'מלך crossed into Greek three times: carried letter for letter, swapped for a Greek word, and set beside a Greek god on the same stone.', { size: 14.5, fill: BONE, anchor: 'middle' })
    + text(W / 2, 140, 'Joseph Yahuda argued in Hebrew Is Greek (1982) that the two languages are one. These are the artefacts he would have put first.', { size: 13, fill: DIM, anchor: 'middle' })
    + text(W / 2, 166, 'Every line below is a Septuagint spelling, a translator’s substitution, or a bilingual inscription — each one checkable.', { size: 13, fill: DIM, anchor: 'middle' })
    + body
    + text(W / 2, h - 44, 'The vowels were a choice made in Hebrew. This was the choice made in Greek — and it is the Greek choice that most of the world received.', { size: 13.5, fill: DIM, anchor: 'middle' })
    + '</svg>';
}
