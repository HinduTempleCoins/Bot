// septuagint-chain.mjs — Hebrew word, Greek choice, English result.
//
// Operator, 2026-10-20, on the Greek material: "Maybe make a New Digram for this." It was a cramped
// column on the m-l-k wheel and it is a bigger argument than that, so it gets its own figure.
//
// THE ARGUMENT, and it is the same one the vowels make. Hebrew was written consonantally and the
// Masoretes chose a reading from a live field and passed it on. Centuries earlier the Septuagint
// translators faced the same kind of choice in a different dimension: a Hebrew word with its own
// range of sense, and no Greek word that covers it. What they picked is what the rest of the world
// inherited — in many cases without ever learning that a choice had been made.
//
// NOT a claim that Hebrew and Greek are related. Joseph Yahuda's *Hebrew Is Greek* (1982) argues for
// kinship between the languages and is not accepted; nothing here rests on it. Every row below is a
// documented act of translation, transliteration or identification. The heading is "notice", not
// "same", and that distinction is the honest one.
//
// Pure: data in, SVG out. No network, no randomness.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const f = (n) => Math.round(n * 100) / 100;

const SCRIPT = '"Noto Sans Hebrew","Noto Serif Hebrew","SBL Hebrew","Times New Roman",serif';
const SANS = 'system-ui,-apple-system,"Segoe UI",sans-serif';
const INK = '#141210', BONE = '#f0e9db', GOLD = '#c8a24a', DIM = '#968d7c';
const HEB = '#c8a24a', GRK = '#8a7fc0', ENG = '#6fa8a0';

/**
 * Each row: the Hebrew, what the Septuagint (or the New Testament, or a Greek historian) made of it,
 * what English received, and what the choice actually did. `kind` marks what sort of act it was.
 */
export const CHAIN = [
  { he: 'מַלְאָךְ', heTr: "mal'āk", heSense: 'messenger — anyone sent, human or not',
    gk: 'ἄγγελος', gkTr: 'angelos', en: 'angel',
    did: 'A job became a species. In Hebrew the word says what someone is doing; in English it says what someone is.',
    kind: 'translated' },
  { he: 'תּוֹרָה', heTr: 'tôrâ', heSense: 'teaching, instruction, what a parent gives a child',
    gk: 'νόμος', gkTr: 'nomos', en: 'law',
    did: 'The heaviest choice in the book. Teaching became statute, and most of what has been argued about since follows from it.',
    kind: 'translated' },
  { he: 'נֶפֶשׁ', heTr: 'nepeš', heSense: 'throat, breath, appetite, a living creature entire',
    gk: 'ψυχή', gkTr: 'psychē', en: 'soul',
    did: 'A whole living thing became a part of one — the part that could then be separated from the body.',
    kind: 'translated' },
  { he: 'שְׁאוֹל', heTr: "šᵊ'ôl", heSense: 'the grave, where everyone goes',
    gk: 'ᾅδης', gkTr: 'hādēs', en: 'hell',
    did: 'A common destination acquired a Greek god\'s name, and later a moral temperature it never had.',
    kind: 'translated' },
  { he: 'רוּחַ', heTr: 'rûaḥ', heSense: 'wind, breath, the moving air',
    gk: 'πνεῦμα', gkTr: 'pneuma', en: 'spirit',
    did: 'Weather became metaphysics.',
    kind: 'translated' },
  { he: 'מָשִׁיחַ', heTr: 'māšîaḥ', heSense: 'anointed — a king, a priest, smeared with oil',
    gk: 'Χριστός', gkTr: 'Christos', en: 'Christ',
    did: 'A description of an office became a name.',
    kind: 'translated' },
  { he: 'מֹלֶךְ', heTr: 'mōlek', heSense: 'read by some as an offering, by others as a god',
    gk: 'Μολόχ', gkTr: 'Molokh', en: 'Moloch',
    did: 'The form the world knows is the Greek one. English never met the Hebrew.',
    kind: 'transliterated' },
  { he: 'מַלְכִּי־צֶדֶק', heTr: 'Malkî-ṣedeq', heSense: '"my king is righteousness"',
    gk: 'Μελχισέδεκ', gkTr: 'Melchisedek', en: 'Melchizedek',
    did: 'Carried into Hebrews in its Greek dress, and kept it.',
    kind: 'transliterated' },
  { he: 'מלקרת', heTr: 'Melqart', heSense: 'mlk-qrt, King of the City — the god of Tyre',
    gk: 'Ἡρακλῆς', gkTr: 'Hēraklēs', en: 'Hercules',
    did: 'Not translation at all. The Greeks met a god and decided he was one of theirs. Herodotus names the Tyrian Herakles.',
    kind: 'identified' },
];

const KIND = {
  translated: 'a word was chosen',
  transliterated: 'the sound was carried over',
  identified: 'a god was declared to be another god',
};

const text = (x, y, s, { size = 14, weight = 400, anchor = 'start', fill = BONE, font = SANS, ls = 0, rtl = false } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${font}" font-size="${size}"`
  + ` font-weight="${weight}" fill="${fill}"${ls ? ` letter-spacing="${ls}"` : ''}`
  + `${rtl ? ' direction="rtl" unicode-bidi="bidi-override"' : ''}>${esc(s)}</text>`;

function wrap(s, n) {
  const w = String(s).split(/\s+/); const out = []; let cur = '';
  for (const x of w) { if (cur && (cur + ' ' + x).length > n) { out.push(cur); cur = x; } else cur = cur ? cur + ' ' + x : x; }
  if (cur) out.push(cur);
  return out;
}

export function septuagintChainSvg() {
  const w = 1480, pad = 56;
  const cHe = 300, cGk = 700, cEn = 1030;   // column anchors
  const top = 206;
  // measure
  let h = top;
  const rows = CHAIN.map((r) => {
    const sense = wrap(r.heSense, 42).length;
    const did = wrap(r.did, 74).length;
    const rh = Math.max(76, 34 + sense * 14 + did * 17 + 18);
    const y = h; h += rh;
    return { r, y, rh };
  });
  h += 96;

  let body = '';
  // column headings
  body += text(cHe, top - 34, 'HEBREW', { size: 12.5, fill: HEB, ls: 3.5, weight: 700, anchor: 'end' });
  body += text(cGk, top - 34, 'WHAT GREEK MADE OF IT', { size: 12.5, fill: GRK, ls: 3.5, weight: 700, anchor: 'middle' });
  body += text(cEn, top - 34, 'WHAT ENGLISH GOT', { size: 12.5, fill: ENG, ls: 3.5, weight: 700, anchor: 'start' });

  for (const { r, y, rh } of rows) {
    // Hebrew, right-aligned so the script runs into the arrow
    body += text(cHe, y + 26, r.he, { size: 30, font: SCRIPT, fill: HEB, weight: 700, anchor: 'end', rtl: true });
    body += text(cHe, y + 46, r.heTr, { size: 12.5, fill: BONE, anchor: 'end' });
    wrap(r.heSense, 42).forEach((l, i) => { body += text(cHe, y + 63 + i * 14, l, { size: 11, fill: DIM, anchor: 'end' }); });

    // the arrow, labelled with what kind of act it was
    const ax1 = cHe + 26, ax2 = cGk - 128;
    body += `<line x1="${f(ax1)}" y1="${f(y + 22)}" x2="${f(ax2)}" y2="${f(y + 22)}" stroke="${GRK}" stroke-width="1.4" opacity="0.6"/>`;
    body += `<path d="M ${f(ax2 + 8)},${f(y + 22)} L ${f(ax2 - 2)},${f(y + 18)} L ${f(ax2 - 2)},${f(y + 26)} Z" fill="${GRK}" opacity="0.8"/>`;
    body += text((ax1 + ax2) / 2, y + 14, KIND[r.kind], { size: 10, fill: DIM, anchor: 'middle' });

    // Greek
    body += text(cGk, y + 26, r.gk, { size: 27, font: SCRIPT, fill: GRK, weight: 700, anchor: 'middle' });
    body += text(cGk, y + 46, r.gkTr, { size: 12.5, fill: BONE, anchor: 'middle' });

    // second arrow
    const bx1 = cGk + 112, bx2 = cEn - 26;
    body += `<line x1="${f(bx1)}" y1="${f(y + 22)}" x2="${f(bx2)}" y2="${f(y + 22)}" stroke="${ENG}" stroke-width="1.4" opacity="0.6"/>`;
    body += `<path d="M ${f(bx2 + 8)},${f(y + 22)} L ${f(bx2 - 2)},${f(y + 18)} L ${f(bx2 - 2)},${f(y + 26)} Z" fill="${ENG}" opacity="0.8"/>`;

    // English
    body += text(cEn, y + 28, r.en, { size: 25, fill: ENG, weight: 700, anchor: 'start' });

    // what the choice did — runs the full width under the row
    wrap(r.did, 74).forEach((l, i) => { body += text(cHe - 160, y + 84 + i * 17, l, { size: 13, fill: BONE, anchor: 'start' }); });
    body += `<line x1="${pad}" y1="${f(y + rh - 6)}" x2="${f(w - pad)}" y2="${f(y + rh - 6)}" stroke="${GOLD}" stroke-width="0.6" opacity="0.18"/>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${f(h)}" width="${w}" height="${f(h)}" role="img" aria-label="Hebrew words, the Greek chosen for them, and what English received">`
    + `<rect width="${w}" height="${f(h)}" fill="${INK}"/>`
    + `<rect x="22" y="22" width="${w - 44}" height="${f(h - 44)}" fill="none" stroke="${GOLD}" stroke-width="1" opacity="0.4"/>`
    + text(w / 2, 74, 'A WORD WAS CHOSEN, AND WE KEPT IT', { size: 17, fill: GOLD, ls: 4, weight: 700, anchor: 'middle' })
    + text(w / 2, 108, 'The translators met Hebrew words with no Greek equivalent and had to decide. What they decided is what the rest of us inherited.', { size: 14, fill: DIM, anchor: 'middle' })
    + text(w / 2, 132, 'These are acts of translation, transliteration and identification — not evidence that the languages are related.', { size: 13, fill: DIM, anchor: 'middle' })
    + text(w / 2, 158, 'Notice, not identity.', { size: 13.5, fill: GRK, anchor: 'middle', weight: 600 })
    + body
    + text(w / 2, h - 44, 'The same thing the vowels did, in a different dimension: a live field, a real choice, and everyone after inheriting the result.', { size: 13, fill: DIM, anchor: 'middle' })
    + '</svg>';
}
