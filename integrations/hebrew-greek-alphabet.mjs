// hebrew-greek-alphabet.mjs — the two alphabets, shown rather than listed.
//
// Operator, 2026-10-20: "Also, do the Greek and Hebrew Alphabets how he would have" / "Another Graphic
// for that" / "Not a Greek Margin, it needs to be Visibly Shown to the Person looking."
//
// So the proof in this figure is the SHAPES, drawn, at size — not a table of transliterations. Each of
// the twenty-two Phoenician letters is drawn here as stroke paths (no font dependency: the Phoenician
// Unicode block is not reliably installed anywhere), set between the Hebrew square letter it became on
// one side and the Greek letter it became on the other. A person looking at it sees the thing directly:
//
//   ʿayin is an eye — a circle. Greek Ο.          ḥēt is a fence — a ladder. Greek Η, which is H.
//   ṭēt is a wheel — a circle crossed. Greek Θ.   sāmek is three bars on a post. Greek Ξ is the bars.
//   mēm is water — a zigzag. Greek Μ.             rēš is a head — a loop on a stem. Greek Ρ, which is P.
//   dālet is a door — a triangle. Greek Δ.        šīn is teeth — a W. Turn it: Greek Σ.
//   qōp is a circle with a tail. Greek Ϙ, koppa.  lāmed is a crook. Turn it: Greek Λ.
//
// Several of them Greek rotated or mirrored, because Phoenician was written right to left and Greek
// settled on left to right; `turn` records that per letter. The rest Greek simply kept.
//
// AND THE REST OF THE CASE, which is all consensus and all checkable:
//   SAME ORDER — twenty-two signs, one sequence, ʾālep to tāw and alpha to tau.
//   SAME NAMES — ἄλφα is ʾālep, βῆτα is bēt: the Hebrew names with a Greek ending stuck on.
//   MEANING ON ONE SIDE ONLY — ox, house, camel, door, water, eye, head, tooth. In Greek those same
//     names mean nothing whatever. A Greek child reciting the alphabet is reciting Semitic nouns.
//   SAME NUMBERS — both alphabets count as well as spell, 1 to 400, in the same order. Greek stopped
//     writing three of them and never stopped counting with them: digamma 6, koppa 90, sampi 900.
//   AND HERODOTUS SAYS SO — 5.58: the Ionians were taught the letters, "changed the shape of a few of
//     them", and went on calling them Phoenician letters, because the Phoenicians had brought them in.
//
// Recorded on the face of the figure rather than hidden: Willemijn Waal has argued Herodotus misread
// his own tradition, and four of the twenty-two name meanings are not securely known. The derivation
// itself is not in dispute — every early Greek local alphabet comes from a Phoenician source.
//
// The three letters of מלך are marked, because that is what this figure is for.
//
// Pure: data in, SVG out. No network, no randomness.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const f = (n) => Math.round(n * 100) / 100;

const SCRIPT = "'Noto Sans Hebrew','Noto Serif Hebrew','SBL Hebrew','Times New Roman','DejaVu Sans','FreeSerif',serif";
const SANS = "system-ui,-apple-system,'Segoe UI',sans-serif";
const INK = '#141210', BONE = '#f0e9db', GOLD = '#c8a24a', DIM = '#968d7c';
const PHO = '#d9d0bd', HEB = '#c8a24a', GRK = '#8a7fc0', ROOT = '#e4c46a', RETIRED = '#c0553f';

/**
 * The twenty-two, in order.
 *   `draw`  — the Phoenician letter as stroke data in a 0–100 box, y downward. `p` is a polyline,
 *             `c` a circle [cx, cy, r]. Early forms, c. 9th century BC.
 *   `turn`  — what Greek did to the shape, where it did anything.
 *   `mean`  — what the Hebrew name is a word for; `unsure` marks the four not securely known.
 *   `num`   — numeral value. Where two are given, the second is the Greek one after Greek retired sān,
 *             which shifted the tail of the sequence by a place.
 *   `retired` — a sign Greek stopped writing and kept as a number. `root` — a letter of מלך.
 *   `see`   — one of the marquee letters shown large at the top.
 */
export const LETTERS = [
  { n: 1, he: 'א', heName: 'ʾālep', mean: 'ox', gk: 'Α α', gkName: 'ἄλφα', num: '1',
    draw: { p: [[[8, 50], [92, 50]], [[8, 50], [44, 16]], [[8, 50], [44, 84]]] }, turn: 'turned upright → A' },
  { n: 2, he: 'ב', heName: 'bēt', mean: 'house', gk: 'Β β', gkName: 'βῆτα', num: '2',
    draw: { p: [[[64, 8], [20, 28], [64, 48]], [[64, 48], [26, 94]]] }, turn: 'mirrored → B' },
  { n: 3, he: 'ג', heName: 'gīmel', mean: 'camel', gk: 'Γ γ', gkName: 'γάμμα', num: '3',
    draw: { p: [[[76, 12], [32, 46], [32, 94]]] }, turn: 'squared off → Γ' },
  { n: 4, he: 'ד', heName: 'dālet', seeShort: 'door', mean: 'door', gk: 'Δ δ', gkName: 'δέλτα', num: '4',
    draw: { p: [[[16, 84], [50, 14], [84, 84], [16, 84]]] }, turn: 'kept — Δ is the door', see: true },
  { n: 5, he: 'ה', heName: 'hē', mean: 'window?', gk: 'Ε ε', gkName: 'εἶ', num: '5', unsure: true,
    draw: { p: [[[30, 8], [30, 94]], [[30, 14], [84, 6]], [[30, 48], [84, 40]], [[30, 82], [84, 74]]] }, turn: 'mirrored → E' },
  { n: 6, he: 'ו', heName: 'wāw', mean: 'hook, peg', gk: 'Ϝ ϝ', gkName: 'ϝαῦ (digamma)', num: '6', retired: true,
    draw: { p: [[[50, 94], [50, 44]], [[50, 44], [18, 10]], [[50, 44], [82, 10]]] }, turn: 'kept as Y, and as the number 6' },
  { n: 7, he: 'ז', heName: 'zayin', mean: 'weapon', gk: 'Ζ ζ', gkName: 'ζῆτα', num: '7',
    draw: { p: [[[22, 12], [78, 12]], [[50, 12], [50, 88]], [[22, 88], [78, 88]]] }, turn: 'kept — archaic zeta is this I' },
  { n: 8, he: 'ח', heName: 'ḥēt', seeShort: 'fence', mean: 'fence, wall', gk: 'Η η', gkName: 'ἦτα', num: '8',
    draw: { p: [[[24, 8], [24, 92]], [[76, 8], [76, 92]], [[24, 34], [76, 34]], [[24, 66], [76, 66]]] }, turn: 'kept — Η is H', see: true },
  { n: 9, he: 'ט', heName: 'ṭēt', seeShort: 'wheel', mean: 'wheel?', gk: 'Θ θ', gkName: 'θῆτα', num: '9', unsure: true,
    draw: { c: [50, 50, 36], p: [[[14, 50], [86, 50]], [[50, 14], [50, 86]]] }, turn: 'kept — Θ is the wheel', see: true },
  { n: 10, he: 'י', heName: 'yōd', mean: 'hand', gk: 'Ι ι', gkName: 'ἰῶτα', num: '10',
    draw: { p: [[[78, 10], [34, 34], [70, 54], [28, 74], [44, 94]]] }, turn: 'straightened → Ι' },
  { n: 11, he: 'כ', heName: 'kap', mean: 'palm of the hand', gk: 'Κ κ', gkName: 'κάππα', num: '20', root: true,
    draw: { p: [[[30, 94], [30, 46]], [[30, 46], [78, 12]], [[30, 46], [84, 46]], [[30, 46], [78, 80]]] }, turn: 'mirrored → K — and Greek Χ χ' },
  { n: 12, he: 'ל', heName: 'lāmed', seeShort: 'ox-goad', mean: 'ox-goad', gk: 'Λ λ', gkName: 'λάμβδα', num: '30', root: true,
    draw: { p: [[[60, 8], [60, 72], [22, 94]]] }, turn: 'turned → Λ', see: true },
  { n: 13, he: 'מ', heName: 'mēm', seeShort: 'water', mean: 'water', gk: 'Μ μ', gkName: 'μῦ', num: '40', root: true,
    draw: { p: [[[20, 94], [20, 22], [40, 48], [60, 22], [80, 48], [94, 24]]] }, turn: 'squared up → Μ, which is M', see: true },
  { n: 14, he: 'נ', heName: 'nūn', mean: 'fish', gk: 'Ν ν', gkName: 'νῦ', num: '50',
    draw: { p: [[[26, 94], [26, 26], [54, 54], [82, 22]]] }, turn: 'squared up → Ν, which is N' },
  { n: 15, he: 'ס', heName: 'sāmek', seeShort: 'prop', mean: 'prop, support', gk: 'Ξ ξ', gkName: 'ξεῖ', num: '60',
    draw: { p: [[[50, 8], [50, 94]], [[16, 24], [84, 24]], [[16, 50], [84, 50]], [[16, 76], [84, 76]]] }, turn: 'post dropped, bars kept → Ξ', see: true },
  { n: 16, he: 'ע', heName: 'ʿayin', seeShort: 'eye', mean: 'eye', gk: 'Ο ο', gkName: 'οὖ', num: '70',
    draw: { c: [50, 50, 36] }, turn: 'kept — the eye is Ο', see: true },
  { n: 17, he: 'פ', heName: 'pē', mean: 'mouth', gk: 'Π π', gkName: 'πεῖ', num: '80',
    draw: { p: [[[82, 14], [34, 14], [26, 54], [36, 94]]] }, turn: 'mirrored and squared → Π' },
  { n: 18, he: 'צ', heName: 'ṣādē', mean: 'fish-hook?', gk: 'Ϻ ϻ', gkName: 'σάν, then sampi', num: '90 · 900', retired: true, unsure: true,
    draw: { p: [[[80, 12], [34, 38], [74, 56], [30, 80]], [[30, 80], [30, 96]]] }, turn: 'retired as a letter, kept as 900' },
  { n: 19, he: 'ק', heName: 'qōp', mean: 'eye of a needle?', gk: 'Ϙ ϙ', gkName: 'κόππα', num: '100 · 90', retired: true, unsure: true,
    draw: { c: [50, 34, 26], p: [[[50, 60], [50, 96]]] }, turn: 'kept as Q and as the number 90' },
  { n: 20, he: 'ר', heName: 'rēš', seeShort: 'head', mean: 'head', gk: 'Ρ ρ', gkName: 'ῥῶ', num: '200 · 100',
    draw: { p: [[[30, 8], [76, 26], [30, 46]], [[30, 46], [30, 94]], [[30, 8], [30, 46]]] }, turn: 'mirrored → Ρ, which is P', see: true },
  { n: 21, he: 'ש', heName: 'šīn', seeShort: 'tooth', mean: 'tooth', gk: 'Σ σ', gkName: 'σῖγμα', num: '300 · 200',
    draw: { p: [[[14, 18], [34, 80], [54, 18], [74, 80], [90, 20]]] }, turn: 'turned on its side → Σ', see: true },
  { n: 22, he: 'ת', heName: 'tāw', mean: 'mark, sign', gk: 'Τ τ', gkName: 'ταῦ', num: '400 · 300',
    draw: { p: [[[16, 18], [84, 82]], [[84, 18], [16, 82]]] }, turn: 'one arm dropped → Τ' },
];

export const ADDED = 'Υ υ · Φ φ · Χ χ · Ψ ψ · Ω ω — the five Greek added at the end, after tāw, and went on numbering from there.';

export const HERODOTUS = {
  en: '“The Phoenicians who came with Cadmus brought into Greece, upon their settling in the land, letters which, as it seems to me, the Greeks did not have before. The Ionians who were taught letters by the Phoenicians changed the shape of a few of them, and in using them called them Phoenician letters — as was only right, since the Phoenicians had brought them in.”',
  cite: 'Herodotus, Histories 5.58',
};

export const POINTS = [
  ['SAME SHAPES', 'Drawn above, letter by letter. Greek turned some of them, because Phoenician runs right to left and Greek settled on left to right. The rest it simply kept.'],
  ['SAME ORDER', 'Twenty-two signs in one sequence, ʾālep to tāw and alpha to tau.'],
  ['SAME NAMES', 'ἄλφα is ʾālep. βῆτα is bēt. γάμμα is gīmel. The Greek names are the Hebrew names with a Greek ending stuck on.'],
  ['MEANING ON ONE SIDE ONLY', 'Ox, house, camel, door, water, eye, head, tooth. In Greek the same names mean nothing at all — a Greek child reciting the alphabet is reciting Semitic nouns.'],
  ['SAME NUMBERS', 'Both alphabets count as well as spell, 1 to 400, in the same order. Greek retired wāw, ṣādē and qōp as letters and went on counting with them: digamma is still 6, koppa 90, sampi 900.'],
];

const text = (x, y, s, { size = 14, weight = 400, anchor = 'start', fill = BONE, font = SANS, ls = 0, rtl = false, op = 1 } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${esc(font)}" font-size="${size}"`
  + ` font-weight="${weight}" fill="${fill}"${ls ? ` letter-spacing="${ls}"` : ''}${op !== 1 ? ` opacity="${op}"` : ''}`
  + `${rtl ? ' direction="rtl" unicode-bidi="bidi-override"' : ''}>${esc(s)}</text>`;

export function wrap(s, n) {
  const w = String(s).split(/\s+/); const out = []; let cur = '';
  for (const x of w) { if (cur && (cur + ' ' + x).length > n) { out.push(cur); cur = x; } else cur = cur ? cur + ' ' + x : x; }
  if (cur) out.push(cur);
  return out;
}

/** Draw a Phoenician letter from its stroke data into a size×size box at (x, y). */
export function glyph(d, x, y, size, { stroke = PHO, width = 2.6 } = {}) {
  const k = size / 100, px = (v) => f(x + v * k), py = (v) => f(y + v * k);
  let s = `<g fill="none" stroke="${stroke}" stroke-width="${f(width)}" stroke-linecap="round" stroke-linejoin="round">`;
  for (const [cx, cy, r] of d.c ? [d.c] : []) s += `<circle cx="${px(cx)}" cy="${py(cy)}" r="${f(r * k)}"/>`;
  for (const line of d.p || []) s += `<polyline points="${line.map(([a, b]) => `${px(a)},${py(b)}`).join(' ')}"/>`;
  return s + '</g>';
}

const W = 1560;

export function hebrewGreekAlphabetSvg() {
  let body = '';

  // ── the marquee: a handful shown large, so the point lands before any reading happens
  let y = 352;
  body += text(W / 2, y - 40, 'LOOK AT THE LETTERS THEMSELVES', { size: 13.5, fill: GOLD, ls: 4, weight: 700, anchor: 'middle' });
  const see = LETTERS.filter((L) => L.see);
  const sw = (W - 160) / see.length;
  see.forEach((L, i) => {
    const x = 80 + i * sw, mid = x + sw / 2;
    body += glyph(L.draw, mid - 42, y, 84, { width: 3.6 });
    body += text(mid, y + 134, '↓', { size: 20, fill: DIM, anchor: 'middle', op: 0.7 });
    body += text(mid, y + 196, L.gk.split(' ')[0], { size: 62, font: SCRIPT, fill: GRK, weight: 700, anchor: 'middle' });
    body += text(mid, y + 224, L.heName, { size: 13.5, fill: BONE, anchor: 'middle', weight: 700 });
    body += text(mid, y + 241, L.seeShort, { size: 12, fill: DIM, anchor: 'middle' });
    body += text(mid, y + 259, L.gkName, { size: 12.5, font: SCRIPT, fill: GRK, anchor: 'middle' });
  });
  y += 302;
  body += `<line x1="70" y1="${f(y)}" x2="${f(W - 70)}" y2="${f(y)}" stroke="${GOLD}" stroke-width="1" opacity="0.32"/>`;
  y += 46;

  // ── all twenty-two, two columns of eleven
  body += text(W / 2, y, 'ALL TWENTY-TWO, IN ORDER', { size: 13, fill: GOLD, ls: 4, weight: 700, anchor: 'middle' });
  y += 34;
  const ROW = 76, COLW = (W - 140) / 2, top = y;
  LETTERS.forEach((L, i) => {
    const col = i < 11 ? 0 : 1, r = i % 11;
    const x0 = 70 + col * COLW, yy = top + r * ROW;
    if (L.root) body += `<rect x="${f(x0)}" y="${f(yy)}" width="${f(COLW - 18)}" height="${ROW - 8}" fill="${ROOT}" opacity="0.08"/>`;
    body += text(x0 + 16, yy + 44, String(L.n), { size: 11.5, fill: DIM, anchor: 'middle' });
    body += glyph(L.draw, x0 + 34, yy + 10, 48, { stroke: L.root ? ROOT : PHO, width: 2.4 });
    body += text(x0 + 104, yy + 42, '→', { size: 14, fill: DIM, op: 0.6 });
    body += text(x0 + 156, yy + 46, L.he, { size: 34, font: SCRIPT, fill: L.root ? ROOT : HEB, weight: 700, anchor: 'middle', rtl: true });
    body += text(x0 + 208, yy + 44, L.gk, { size: 25, font: SCRIPT, fill: L.retired ? RETIRED : GRK, weight: 700, anchor: 'middle' });
    body += text(x0 + 258, yy + 26, `${L.heName}  ·  ${L.gkName}`, { size: 13.5, fill: BONE, weight: 600 });
    body += text(x0 + 258, yy + 44, `${L.mean}${L.unsure ? '  (not securely known)' : ''}`, { size: 12, fill: L.unsure ? DIM : BONE });
    body += text(x0 + 258, yy + 60, L.turn, { size: 11.5, fill: DIM });
    body += text(x0 + COLW - 34, yy + 44, L.num, { size: 13.5, fill: L.retired ? RETIRED : BONE, weight: 600, anchor: 'end' });
    body += `<line x1="${f(x0)}" y1="${f(yy + ROW - 8)}" x2="${f(x0 + COLW - 18)}" y2="${f(yy + ROW - 8)}" stroke="${GOLD}" stroke-width="0.5" opacity="0.12"/>`;
  });
  y = top + 11 * ROW + 16;
  body += text(70, y, ADDED, { size: 13, fill: DIM });
  y += 24;
  body += text(70, y, 'The Phoenician letters above are drawn from their stroke forms, c. 9th century BC. The number column gives the value each sign carries as a numeral.', { size: 11.5, fill: DIM });
  y += 46;

  // ── the rest of the case
  for (const [k, v] of POINTS) {
    body += text(86, y, k, { size: 12.5, fill: GOLD, ls: 2.6, weight: 700 });
    const lines = wrap(v, 120);
    lines.forEach((l, i) => { body += text(400, y + i * 17, l, { size: 13, fill: BONE }); });
    y += Math.max(28, lines.length * 17 + 12);
  }
  y += 16;

  body += `<line x1="86" y1="${f(y - 10)}" x2="${f(W - 86)}" y2="${f(y - 10)}" stroke="${GOLD}" stroke-width="0.8" opacity="0.3"/>`;
  y += 24;
  body += text(86, y, 'AND THEIR OWN HISTORIAN SAYS SO', { size: 12.5, fill: GOLD, ls: 2.6, weight: 700 });
  y += 26;
  wrap(HERODOTUS.en, 132).forEach((l) => { body += text(86, y, l, { size: 13.5, fill: BONE }); y += 19; });
  body += text(86, y + 6, HERODOTUS.cite, { size: 12.5, fill: GRK, weight: 600 });
  y += 38;
  body += text(86, y, 'Noted here rather than hidden, because a figure that buries it is the weaker figure: Willemijn Waal has argued that Herodotus misread his own tradition and that', { size: 11.5, fill: DIM });
  y += 16;
  body += text(86, y, 'Cadmus was a Greek hero, and four of the twenty-two name meanings are not securely known. The derivation itself is not in dispute — every early Greek local alphabet', { size: 11.5, fill: DIM });
  y += 16;
  body += text(86, y, 'comes from a Phoenician source, and the Greeks said so themselves.', { size: 11.5, fill: DIM });

  const h = y + 96;
  const key = [[ROOT, 'the three letters of מלך — kap, lāmed, mēm · kappa, lambda, mu'], [RETIRED, 'Greek stopped writing it and went on counting with it']];
  key.forEach(([c, t], i) => {
    const ky = h - 60 + i * 22;
    body += `<circle cx="92" cy="${f(ky - 4)}" r="6" fill="${c}"/>`;
    body += text(108, ky, t, { size: 12.5, fill: BONE });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${f(h)}" width="${W}" height="${f(h)}" role="img" aria-label="The Phoenician, Hebrew and Greek alphabets: the same shapes, order, names and numbers">`
    + `<rect width="${W}" height="${f(h)}" fill="${INK}"/>`
    + `<rect x="22" y="22" width="${W - 44}" height="${f(h - 44)}" fill="none" stroke="${GOLD}" stroke-width="1" opacity="0.4"/>`
    + text(W / 2, 84, 'ONE ALPHABET, WRITTEN TWICE', { size: 20, fill: GOLD, ls: 5, weight: 700, anchor: 'middle' })
    + text(W / 2, 124, 'Same shapes. Same order. Same names. Same numbers.', { size: 16.5, fill: BONE, anchor: 'middle', weight: 600 })
    + text(W / 2, 154, 'The Greek letter names ARE the Hebrew letter names, and in Hebrew they are ordinary words — ox, house, camel, door, water, eye, head, tooth.', { size: 14, fill: BONE, anchor: 'middle' })
    + text(W / 2, 178, 'In Greek the same names mean nothing but the letters themselves.', { size: 14, fill: BONE, anchor: 'middle' })
    + text(W / 2, 212, 'Joseph Yahuda argued in Hebrew Is Greek (1982) that the two languages are one. This is the part of his case that is simply the consensus, which is why it goes first.', { size: 13, fill: DIM, anchor: 'middle' })
    + text(W / 2, 246, 'מלך — Greek says this root’s three letters by their Hebrew names: kap, lāmed, mēm.', { size: 13.5, fill: ROOT, anchor: 'middle' })
    + body
    + '</svg>';
}
