// metals-explainer.mjs — INTRODUCTORY graphics for the precious-metals industry.
//
// The board in metals-market.mjs answers "what did it do". These answer "what IS this" — the panels a
// reader needs BEFORE a price chart means anything: what each metal is for, why gold and silver behave
// like different asset classes despite sitting in the same case, where supply comes from, and what a
// troy ounce is.
//
// COLOUR IS NOT THE METAL'S OWN COLOUR HERE, and that is deliberate. Gold-coloured gold and grey
// silver read beautifully and fail accessibility: validated against the dataviz checker, the metal
// palette put platinum and palladium 9.3 apart in normal vision (floor is 15) and three slots below
// the chroma floor, i.e. reading as grey. These four hues pass every check on ALL pairs, not just
// adjacent ones. Palladium is deliberately NOT given a categorical hue — it appears only as a labelled
// row, never as a colour-coded series, because adding it breaks the all-pairs check.
//
// Every figure here is sourced in SOURCES below. Nothing is drawn from a number I could not cite.

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (n) => Math.round(Number(n) * 100) / 100;
const money = (n, d = 0) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const INK = '#1d1b17', MUT = '#6b665c', LINE = '#ddd6c8', PAPER = '#f6f4ef', PANEL = '#fffdf8';

/** Validated categorical palette (dataviz skill, all-pairs pass, light surface). */
export const HUE = { gold: '#eda100', silver: '#2a78d6', platinum: '#1baf7a', copper: '#c2410c', neutral: MUT };

/** Ink or paper on top of a hue, chosen by luminance — white on #eda100 is only 2.11:1 and unreadable.
 *  The validator flags the hue's contrast against the SURFACE; this is the other half, text ON the hue. */
export function onColour(hex) {
  const h = String(hex).replace('#', '');
  const [r, g, bl] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(bl);
  return L > 0.42 ? INK : '#ffffff';
}

const text = (x, y, s, { size = 12, weight = 400, anchor = 'middle', fill = INK, font = FONT, op = 1 } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}"${op !== 1 ? ` opacity="${op}"` : ''}>${esc(s)}</text>`;

const frame = (w, h, title, subtitle, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">`
  + `<rect width="${w}" height="${h}" fill="${PAPER}"/>`
  + text(w / 2, 28, title, { size: 18, weight: 800 })
  + (subtitle ? text(w / 2, 48, subtitle, { size: 11.5, fill: MUT }) : '')
  + body + '</svg>';

/** Wrap a string to lines of at most `n` characters, breaking on spaces. */
export function wrap(s, n) {
  const words = String(s || '').split(/\s+/).filter(Boolean);
  const out = []; let line = '';
  for (const w of words) {
    if (!line) { line = w; continue; }
    if ((line + ' ' + w).length <= n) line += ' ' + w; else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

export const SOURCES = {
  goldStock: 'World Gold Council market primer, above-ground stock ~220,700 t (end-2025). Estimates vary; USGS is materially lower at ~187,000 t.',
  goldMine: 'Global mine production ~3,672 t in 2025.',
  silver: 'Metals Focus / The Silver Institute, World Silver Survey — 2026 forecast demand 1,112.6 Moz against 1,066.4 Moz supply, a sixth consecutive annual deficit.',
};

export const METALS = [
  { key: 'gold', name: 'Gold', sym: 'Au', price: 4049.05, unit: 'troy oz',
    is: 'The monetary metal. Does not corrode, so essentially every ounce ever refined still exists.',
    used: 'Jewellery, central-bank reserves, private investment. Industry is a small slice.',
    tell: 'Hoarded' },
  { key: 'silver', name: 'Silver', sym: 'Ag', price: 53.91, unit: 'troy oz',
    is: 'Half money, half industrial input — and the industrial half is the bigger one.',
    used: 'Solar cells, electrical contacts, brazing alloys, vehicle and data-centre electronics.',
    tell: 'Consumed' },
  { key: 'platinum', name: 'Platinum', sym: 'Pt', price: 1540, unit: 'troy oz', approx: true,
    is: 'An industrial catalyst metal that happens to be precious. Supply is highly concentrated.',
    used: 'Autocatalysts, chemical and petroleum refining, laboratory ware, some jewellery.',
    tell: 'Consumed' },
  { key: 'copper', name: 'Copper', sym: 'Cu', price: 6.65, unit: 'pound', approx: true,
    is: 'Not a precious metal at all — the industrial base metal every electrical system runs on.',
    used: 'Wiring, motors, grid infrastructure, construction, electric vehicles.',
    tell: 'Consumed' },
];

// ── PANEL A: the four metals, at a glance ──────────────────────────────────────────────────────────
/** The orientation card. What each metal IS, before any price history means anything. */
export function atAGlanceSvg(metals = METALS) {
  const W = 940, cardH = 150, top = 78, H = top + metals.length * cardH + 46;
  let b = '';
  metals.forEach((m, i) => {
    const y = top + i * cardH;
    const c = HUE[m.key] || MUT;
    b += `<rect x="22" y="${y}" width="${W - 44}" height="${cardH - 14}" rx="8" fill="${PANEL}" stroke="${LINE}"/>`;
    b += `<rect x="22" y="${y}" width="6" height="${cardH - 14}" rx="3" fill="${c}"/>`;
    // identity
    b += `<circle cx="72" cy="${y + 42}" r="21" fill="${c}"/>`;
    b += text(72, y + 48, m.sym, { size: 17, weight: 800, fill: onColour(c) });
    b += text(72, y + 86, m.name, { size: 14, weight: 700 });
    b += `<rect x="42" y="${y + 98}" width="60" height="18" rx="9" fill="${c}" opacity="0.14"/>`;
    b += text(72, y + 111, m.tell, { size: 10, weight: 700, fill: c });
    // price
    b += text(260, y + 44, `$${money(m.price, m.price < 100 ? 2 : 0)}`, { anchor: 'end', size: 25, weight: 800, font: MONO });
    b += text(260, y + 62, `per ${m.unit}${m.approx ? ' · approx' : ''}`, { anchor: 'end', size: 10, fill: MUT });
    // prose
    wrap(m.is, 74).forEach((ln, k) => { b += text(292, y + 32 + k * 16, ln, { anchor: 'start', size: 12.5 }); });
    b += text(292, y + 86, 'WHERE IT GOES', { anchor: 'start', size: 9, weight: 700, fill: MUT });
    wrap(m.used, 74).forEach((ln, k) => { b += text(292, y + 102 + k * 15, ln, { anchor: 'start', size: 11.5, fill: MUT }); });
  });
  b += text(W / 2, H - 20, 'Gold and silver quotes verified; platinum and copper are consensus readings and marked approx.', { size: 10.5, fill: MUT });
  return frame(W, H, 'The Four Metals, at a Glance', 'what each one actually is, before any chart means anything', b);
}

// ── PANEL B: hoarded vs consumed ───────────────────────────────────────────────────────────────────
/**
 * The single most useful idea in the industry, and the one most often skipped: gold and silver are
 * not two versions of the same trade. One is a stock that persists; the other is a flow that is used
 * up. It changes what a deficit means, what a price means, and what supply even is.
 */
export function hoardedVsConsumedSvg() {
  const W = 940, H = 470;
  let b = '';
  const col = (x, w, hue, title, lede, rows, foot) => {
    let s = `<rect x="${x}" y="84" width="${w}" height="${H - 150}" rx="10" fill="${PANEL}" stroke="${LINE}"/>`;
    s += `<rect x="${x}" y="84" width="${w}" height="5" rx="2.5" fill="${hue}"/>`;
    s += text(x + w / 2, 118, title, { size: 16, weight: 800, fill: hue });
    wrap(lede, 46).forEach((ln, i) => { s += text(x + w / 2, 142 + i * 16, ln, { size: 12 }); });
    rows.forEach((r, i) => {
      const y = 196 + i * 62;
      s += text(x + 26, y, r[0], { anchor: 'start', size: 10, weight: 700, fill: MUT });
      s += text(x + 26, y + 24, r[1], { anchor: 'start', size: 20, weight: 800, font: MONO, fill: INK });
      s += text(x + 26, y + 40, r[2], { anchor: 'start', size: 10.5, fill: MUT });
    });
    s += `<line x1="${x + 20}" y1="${H - 104}" x2="${x + w - 20}" y2="${H - 104}" stroke="${LINE}"/>`;
    wrap(foot, 48).forEach((ln, i) => { s += text(x + w / 2, H - 84 + i * 15, ln, { size: 11.5, weight: 600 }); });
    return s;
  };
  b += col(26, 430, HUE.gold, 'GOLD — a stock', 'Almost nothing is destroyed, so the pile only grows.', [
    ['ABOVE-GROUND STOCK', '~220,700 t', 'every ounce ever refined, near enough'],
    ['MINED PER YEAR', '~3,672 t', 'about 1.7% added to the pile annually'],
  ], 'Supply is not the mine. Supply is the whole pile, and anyone holding it can sell.');
  b += col(484, 430, HUE.silver, 'SILVER — a flow', 'Most of it is used up in things and never comes back.', [
    ['DEMAND, 2026F', '1,112.6 Moz', '58% of it industrial fabrication'],
    ['SUPPLY, 2026F', '1,066.4 Moz', 'a sixth consecutive annual deficit'],
  ], 'A deficit draws down stock rather than the mine, so it can run for years without forcing price.');
  b += text(W / 2, 66, 'Both sit in the same display case. They are not the same kind of asset.', { size: 12.5, weight: 600, fill: MUT });
  return frame(W, H, 'Hoarded or Consumed', 'the distinction that decides what a price even means', b);
}

// ── PANEL C: where the metal comes from ────────────────────────────────────────────────────────────
/** The chain from rock to buyer, and the four places demand actually sits. */
export function supplyChainSvg() {
  const W = 940, H = 400;
  const stages = [
    ['Mine', 'ore out of the ground', HUE.copper],
    ['Refine', 'to 99.5%+ purity, cast into bars', HUE.platinum],
    ['Market', 'dealers, exchanges, vaults', HUE.silver],
  ];
  const demand = [
    ['Investment', 'coins, bars, funds'],
    ['Jewellery', 'worn, and recoverable'],
    ['Industry', 'used up in products'],
    ['Central banks', 'reserves, gold only'],
  ];
  let b = '';
  const bw = 236, gap = 26, y = 96;
  stages.forEach(([t, s, c], i) => {
    const x = 36 + i * (bw + gap);
    b += `<rect x="${x}" y="${y}" width="${bw}" height="82" rx="9" fill="${PANEL}" stroke="${c}" stroke-width="2"/>`;
    b += text(x + bw / 2, y + 34, t, { size: 15, weight: 800, fill: c });
    wrap(s, 30).forEach((ln, k) => { b += text(x + bw / 2, y + 54 + k * 14, ln, { size: 11, fill: MUT }); });
    if (i < stages.length - 1) {
      const ax = x + bw + 4;
      b += `<path d="M${ax} ${y + 41} L${ax + gap - 8} ${y + 41}" stroke="${MUT}" stroke-width="2"/>`;
      b += `<path d="M${ax + gap - 13} ${y + 36} L${ax + gap - 8} ${y + 41} L${ax + gap - 13} ${y + 46}" fill="none" stroke="${MUT}" stroke-width="2"/>`;
    }
  });
  // Recycling runs MARKET -> REFINE, not refine -> mine. Scrap comes back from the people holding it
  // and is re-refined; it never returns to the ground. An arrowhead makes the direction unambiguous.
  const xMarket = 36 + 2 * (bw + gap) + bw / 2;
  const xRefine = 36 + (bw + gap) + bw / 2;
  b += `<path d="M${xMarket} ${y + 88} C${xMarket} ${y + 136}, ${xRefine} ${y + 136}, ${xRefine} ${y + 96}" fill="none" stroke="${MUT}" stroke-width="1.8" stroke-dasharray="5 4"/>`;
  b += `<path d="M${xRefine - 5} ${y + 102} L${xRefine} ${y + 94} L${xRefine + 5} ${y + 102}" fill="none" stroke="${MUT}" stroke-width="1.8"/>`;
  b += text((xRefine + xMarket) / 2, y + 152, 'recycling — scrap returns from the market and is re-refined', { size: 10.5, fill: MUT });
  b += `<line x1="36" y1="276" x2="${W - 36}" y2="276" stroke="${LINE}"/>`;
  b += text(W / 2, 296, 'and demand sits in four places', { size: 12, weight: 700, fill: MUT });
  const dw = (W - 72 - 3 * 14) / 4;
  demand.forEach(([t, s], i) => {
    const x = 36 + i * (dw + 14);
    b += `<rect x="${x}" y="310" width="${dw}" height="56" rx="8" fill="${PANEL}" stroke="${LINE}"/>`;
    b += text(x + dw / 2, 332, t, { size: 12.5, weight: 700 });
    b += text(x + dw / 2, 350, s, { size: 10.5, fill: MUT });
  });
  return frame(W, H, 'Where the Metal Comes From', 'rock to buyer, and the four places demand sits', b);
}

// ── PANEL D: units ─────────────────────────────────────────────────────────────────────────────────
/** Nobody says this out loud and everybody gets caught by it once. */
export function unitsSvg() {
  const W = 940, H = 300;
  const rows = [
    ['1 troy ounce', '31.1035 g', 'how gold, silver, platinum and palladium are quoted'],
    ['1 ordinary ounce', '28.3495 g', 'NOT the same thing — about 10% lighter, and not used for metal'],
    ['1 kilogram', '32.1507 troy oz', 'the common bar size outside the United States'],
    ['1 metric tonne', '32,150.7 troy oz', 'how mine output and national reserves are reported'],
    ['1 pound', '453.592 g', 'copper is quoted per pound, or per tonne — never per troy ounce'],
  ];
  let b = text(W / 2, 70, 'A troy ounce is not an ounce. This catches everyone exactly once.', { size: 12.5, weight: 600, fill: MUT });
  rows.forEach((r, i) => {
    const y = 96 + i * 38;
    if (i % 2 === 0) b += `<rect x="26" y="${y - 20}" width="${W - 52}" height="36" fill="${PANEL}"/>`;
    b += text(44, y + 4, r[0], { anchor: 'start', size: 13, weight: 700 });
    b += text(300, y + 4, r[1], { anchor: 'end', size: 13.5, weight: 800, font: MONO, fill: HUE.platinum });
    b += text(330, y + 4, r[2], { anchor: 'start', size: 11.5, fill: MUT });
  });
  b += text(W / 2, H - 22, 'A "$4,000 ounce" and a "$4,000 kilo" are different planets. Check the unit first, always.', { size: 11.5, weight: 600 });
  return frame(W, H, 'Units, Before Anything Else', 'the one place a beginner loses an order of magnitude', b);
}

export const EXPLAINERS = {
  'metals-at-a-glance': atAGlanceSvg,
  'hoarded-vs-consumed': hoardedVsConsumedSvg,
  'metals-supply-chain': supplyChainSvg,
  'metals-units': unitsSvg,
};
export const explainerSvg = (n) => (EXPLAINERS[String(n || '').toLowerCase()] || (() => ''))();

if (process.argv[1] && /metals-explainer\.mjs$/.test(process.argv[1])) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const out = process.argv[2] || './explainer-out';
  mkdirSync(out, { recursive: true });
  for (const n of Object.keys(EXPLAINERS)) {
    const svg = explainerSvg(n);
    writeFileSync(`${out}/${n}.svg`, svg);
    console.log(`${n}.svg  ${svg.length} bytes`);
  }
}
