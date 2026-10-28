// mlk-wheel.mjs — the M-L-K diagram: one consonantal root, every reading it carries.
//
// Operator, 2026-10-20: "Make a Graphic that Depicts all the MLK kind of like Chaos as a Diagram all
// in Hebrew." So: the bare three letters at the centre and the readings radiating out of them, in the
// eight-armed shape of a chaos star — which is also the sign the Cult of Kek borrowed, and the point of
// the diagram is that this root was a field long before anyone made a flag out of chaos.
//
// WHAT THE DIAGRAM ARGUES, and the honesty rules it keeps:
//   • Hebrew was written consonantally. The Tiberian points are a later overlay, so מלך on the page is
//     the same three letters whichever word is meant. The centre shows them bare.
//   • The Masoretes chose, genuinely, from a field that was really open, and passed that choice on.
//     The unchosen readings were live, not wrong. Nothing here calls their work a mistake.
//   • מלאך carries an ALEPH and is from l-'-k, "to send" — a different root. It is drawn on the outer
//     ring in its own colour and labelled as such, because the argument is stronger when the letters
//     are reported honestly than when they are made to agree.
//
// Pure: data in, SVG out. No network, no randomness.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const f = (n) => Math.round(n * 100) / 100;

// A stack with Hebrew coverage; the renderer picks the first it has.
const HEB = '"Noto Sans Hebrew","Noto Serif Hebrew","SBL Hebrew","Times New Roman",serif';
const SANS = 'system-ui,-apple-system,"Segoe UI",sans-serif';

const INK = '#141210', BONE = '#f0e9db', GOLD = '#c8a24a', DIM = '#968d7c';
const SAME = '#c8a24a';   // the same consonantal root, m-l-k
const OTHER = '#5b8fd4';  // a different root — aleph words
const PUNIC = '#c0553f';  // the attested Punic sacrificial term

/**
 * The readings. `heb` is pointed where a pointing exists; `bare` is the consonantal skeleton.
 * `kind`: 'same' = written מלך · 'punic' = the Punic/tophet sacrificial term · 'other' = different root.
 */
export const READINGS = [
  { heb: 'מֶלֶךְ', bare: 'מלך', tr: 'melek', gloss: 'king', kind: 'same' },
  { heb: 'מָלַךְ', bare: 'מלך', tr: 'mālak', gloss: 'to reign, to be king', kind: 'same' },
  { heb: 'מַלְכָּה', bare: 'מלכה', tr: 'malkâ', gloss: 'queen', kind: 'same' },
  { heb: 'מַלְכוּת', bare: 'מלכות', tr: 'malkût', gloss: 'kingdom, kingship', kind: 'same' },
  { heb: 'מֹלֶךְ', bare: 'מלך', tr: 'mōlek', gloss: 'Molech — read by some as an offering, not a name', kind: 'same' },
  { heb: 'מִלְכֹּם', bare: 'מלכם', tr: 'Milkōm', gloss: 'Milcom, the Ammonite god', kind: 'same' },
  { heb: 'מַלְכִּי־צֶדֶק', bare: 'מלכיצדק', tr: 'Malkî-ṣedeq', gloss: 'Melchizedek — "my king is righteousness"', kind: 'same' },
  // Punic was written in its own script and without pointing. These two are shown as bare consonants
  // rather than given invented Hebrew vowels, which would be a reconstruction presented as a reading.
  { heb: 'מלקרת', bare: 'מלקרת', tr: 'Melqart', gloss: 'Melqart — mlk-qrt, "King of the City" · Punic, unpointed', kind: 'punic' },
  { heb: 'מלך', bare: 'מלך', tr: 'molk', gloss: 'the offering named on the Punic tophet stones · unpointed', kind: 'punic' },
  { heb: 'מַלְאָךְ', bare: 'מלאך', tr: "mal'āk", gloss: 'messenger, angel — from l-ʾ-k, "to send"', kind: 'other' },
  { heb: 'מַלְאָכִי', bare: 'מלאכי', tr: "Mal'ākî", gloss: 'Malachi — "my messenger"', kind: 'other' },
  { heb: 'מְלָאכָה', bare: 'מלאכה', tr: "mᵊlā'kâ", gloss: 'work, craft — also from l-ʾ-k', kind: 'other' },
];

const COLOUR = { same: SAME, punic: PUNIC, other: OTHER };
const GREEK = '#8a7fc0';

/**
 * Where Greek actually met these words. NOT a claim of shared root — every entry here is an attested
 * contact point: a Septuagint transliteration, a translator's choice, or an ancient identification of
 * one god with another. Joseph Yahuda's *Hebrew Is Greek* (1982) argued for deep kinship between the
 * two languages and is not accepted; nothing below depends on it. The label on the diagram is
 * "notice", not "same", and the distinction is the honest one.
 */
export const GREEK_NOTICES = [
  { gk: 'ἄγγελος', tr: 'angelos', note: 'what the Septuagint translators chose for מלאך — our word "angel"' },
  { gk: 'Μολόχ', tr: 'Molokh', note: 'the Septuagint spelling that gave English "Moloch"' },
  { gk: 'Μελχισέδεκ', tr: 'Melchisedek', note: 'Greek form of מלכי־צדק, carried into Hebrews' },
  { gk: 'Ἡρακλῆς', tr: 'Hēraklēs', note: 'who the Greeks said Melqart was — Herodotus names the Tyrian Herakles' },
];

const text = (x, y, s, { size = 14, weight = 400, anchor = 'middle', fill = BONE, font = SANS, ls = 0, rtl = false } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${font}" font-size="${size}"`
  + ` font-weight="${weight}" fill="${fill}"${ls ? ` letter-spacing="${ls}"` : ''}`
  + `${rtl ? ' direction="rtl" unicode-bidi="bidi-override"' : ''}>${esc(s)}</text>`;

/** Greedy wrap for the gloss lines. */
function wrap(s, n) {
  const w = String(s).split(/\s+/); const out = []; let cur = '';
  for (const x of w) { if (cur && (cur + ' ' + x).length > n) { out.push(cur); cur = x; } else cur = cur ? cur + ' ' + x : x; }
  if (cur) out.push(cur);
  return out;
}

export function mlkWheelSvg() {
  // The Greek notices need a margin of their own on the left, or they collide with the wheel's
  // left-hand readings — so the canvas is widened and the wheel sits right of centre.
  const w = 1520, h = 1120, cx = 960, cy = h / 2 + 10;
  const n = READINGS.length;
  const rSpoke = 250, rCard = 395;
  let body = '';

  // the eight-armed ground: spokes to every reading, drawn first so they sit under the cards
  READINGS.forEach((r, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x1 = cx + Math.cos(a) * 96, y1 = cy + Math.sin(a) * 96;
    const x2 = cx + Math.cos(a) * rSpoke, y2 = cy + Math.sin(a) * rSpoke;
    const col = COLOUR[r.kind];
    body += `<line x1="${f(x1)}" y1="${f(y1)}" x2="${f(x2)}" y2="${f(y2)}" stroke="${col}" stroke-width="2" opacity="0.5"/>`;
    // arrowhead, so it reads as the radiating chaos sign rather than a wheel
    const ah = 11;
    const bx = cx + Math.cos(a) * (rSpoke + 4), by = cy + Math.sin(a) * (rSpoke + 4);
    body += `<path d="M ${f(bx)},${f(by)} L ${f(bx - Math.cos(a - 0.42) * ah)},${f(by - Math.sin(a - 0.42) * ah)}`
      + ` L ${f(bx - Math.cos(a + 0.42) * ah)},${f(by - Math.sin(a + 0.42) * ah)} Z" fill="${col}" opacity="0.75"/>`;
  });

  // the readings themselves
  READINGS.forEach((r, i) => {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const x = cx + Math.cos(a) * rCard, y = cy + Math.sin(a) * rCard;
    const col = COLOUR[r.kind];
    body += text(x, y - 12, r.heb, { size: 30, font: HEB, fill: col, weight: 700, rtl: true });
    body += text(x, y + 10, r.tr, { size: 14.5, fill: BONE, weight: 600 });
    wrap(r.gloss, 30).forEach((line, k) => { body += text(x, y + 30 + k * 16, line, { size: 12.5, fill: DIM }); });
  });

  // the centre: the bare consonants
  body += `<circle cx="${f(cx)}" cy="${f(cy)}" r="92" fill="${INK}" stroke="${GOLD}" stroke-width="2"/>`;
  body += text(cx, cy + 16, 'מלך', { size: 70, font: HEB, fill: BONE, weight: 700, rtl: true });
  body += text(cx, cy + 48, 'm · l · k', { size: 14, fill: GOLD, ls: 3 });
  body += text(cx, cy - 56, 'three letters, no vowels', { size: 12.5, fill: DIM });

  // the Greek notices — a column down the left, deliberately set apart from the wheel so that nothing
  // here reads as another arm of the root
  let gy = 210;
  body += text(64, gy, 'WHERE GREEK MET THESE WORDS', { size: 12, fill: GREEK, ls: 2.5, weight: 600, anchor: 'start' });
  body += text(64, gy + 18, 'not the same root — notice, not identity', { size: 11, fill: DIM, anchor: 'start' });
  gy += 44;
  for (const g of GREEK_NOTICES) {
    body += text(64, gy, g.gk, { size: 21, font: HEB, fill: GREEK, weight: 700, anchor: 'start' });
    body += text(64, gy + 17, g.tr, { size: 11.5, fill: BONE, anchor: 'start' });
    wrap(g.note, 30).forEach((l, k) => { body += text(64, gy + 33 + k * 13, l, { size: 10.5, fill: DIM, anchor: 'start' }); });
    gy += 40 + wrap(g.note, 30).length * 13;
  }

  // key
  const ky = h - 96;
  const keys = [[SAME, 'written מלך — the same three letters'], [PUNIC, 'Punic: Melqart, and the offering on the tophet stones'], [OTHER, "carries an aleph — from l-ʾ-k, 'to send'"]];
  keys.forEach(([c, t], i) => {
    const x = 70, y = ky + i * 22;
    body += `<circle cx="${f(x)}" cy="${f(y - 4)}" r="6" fill="${c}"/>`;
    body += text(x + 16, y, t, { size: 13, fill: BONE, anchor: 'start' });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="The M-L-K root and its readings">`
    + `<rect width="${w}" height="${h}" fill="${INK}"/>`
    + `<rect x="22" y="22" width="${w - 44}" height="${h - 44}" fill="none" stroke="${GOLD}" stroke-width="1" opacity="0.45"/>`
    + text(cx, 62, 'מלך', { size: 34, font: HEB, fill: BONE, weight: 700, rtl: true })
    + text(cx, 92, 'ONE ROOT, AND EVERY READING IT CARRIES', { size: 15, fill: GOLD, ls: 4, weight: 600 })
    + text(cx, 118, 'Hebrew was written without vowels. On the page these are the same letters.', { size: 13.5, fill: DIM })
    + body
    + text(cx, h - 36, 'The Masoretes chose from this field, and passed their choice on. The readings not taken were live, not wrong.', { size: 13, fill: DIM })
    + '</svg>';
}
