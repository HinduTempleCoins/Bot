// herb-atlas.mjs — the data behind the Herb and Chemical Atlas charts.
//
// Two charts the operator asked for (2026-10-19): one that shows CHEMICAL STRUCTURES colour-coded by
// what sits at each ring position, and one that shows PLANTS and what is in them. Both are drawn from
// the data below rather than fetched, so they are correct, identical on every load, and readable in
// print — the same rule the rest of site/wiki/figures.mjs follows.
//
// THE COLOUR KEY is the operator's long-standing allylbenzene chart (herbpedia.wikidot.com/allylbenzenes,
// the 69Ron material he has referenced since 2018). Ring position 1 carries the allyl side chain; the
// other five positions are coloured so that two molecules can be compared at a glance:
//   1 black · 2 brown · 3 red · 4 green · 5 blue · 6 purple
// What a substituent at each position is SAID to do comes from that community material and is labelled
// as such on the page — it is not a peer-reviewed structure-activity result.
//
// RING PATTERNS are taken from knowledge/shulgin-pihkal-tihkal/shulgin_ten_essential_oils.json, whose
// category names ARE the substitution patterns, cross-checked against PubChem records.
//
//   import { ALLYLBENZENES, POSITION_KEY, ringSvg, allylbenzeneMapSvg } from './herb-atlas.mjs'

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const f = (n) => Math.round(n * 100) / 100;
const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';
const INK = '#1d1b17', MUT = '#6b665c', PAPER = '#f6f4ef';

/** The operator's position colour key. `says` is the community claim, not a verified finding. */
export const POSITION_KEY = [
  { pos: 1, colour: '#1d1b17', name: 'black', says: 'the allyl side chain — the part that is converted to an alkaloid at all' },
  { pos: 2, colour: '#8a5a2b', name: 'brown', says: 'a methoxy here is said to give LSD-like mental effects' },
  { pos: 3, colour: '#c0392b', name: 'red', says: 'no distinct effect claimed' },
  { pos: 4, colour: '#2e7d32', name: 'green', says: 'must be methoxy or methylenedioxy for psychedelic activity; a hydroxy here gives stimulant effects only' },
  { pos: 5, colour: '#1f6feb', name: 'blue', says: 'said to enhance visual effects' },
  { pos: 6, colour: '#7b3fa0', name: 'purple', says: 'said to add speedy, amphetamine-like effects' },
];

// Substituents: OMe = methoxy, OH = hydroxy, MDO = methylenedioxy bridging this position and the next,
// MDO2 = the second half of that bridge (drawn as part of the bridge, not labelled separately).
const O = 'OMe', H = 'OH', M = 'MDO', M2 = 'MDO2';

/**
 * The allylbenzene/propenylbenzene series. `pos` is positions 2..6 in order.
 * `chain`: 'allyl' forms the alkaloid metabolites; 'propenyl' does not (Peele & Oswald, PMID 870079).
 */
export const ALLYLBENZENES = [
  { id: 'chavicol', name: 'Chavicol', pattern: '4-hydroxy', chain: 'allyl', pos: [null, null, H, null, null], shulgin: null, note: 'hydroxy at 4 — stimulant pattern only' },
  { id: 'estragole', name: 'Estragole', aka: 'methyl chavicol', pattern: '4-methoxy', chain: 'allyl', pos: [null, null, O, null, null], shulgin: '4-MA', found: 'sweet basil, tarragon, fennel' },
  { id: 'hydroxychavicol', name: 'Hydroxychavicol', pattern: '3,4-dihydroxy', chain: 'allyl', pos: [null, H, H, null, null], shulgin: null, found: 'betel leaf' },
  { id: 'chavibetol', name: 'Chavibetol', pattern: '3-hydroxy-4-methoxy', chain: 'allyl', pos: [null, H, O, null, null], shulgin: null, found: 'betel leaf' },
  { id: 'eugenol', name: 'Eugenol', pattern: '3-methoxy-4-hydroxy', chain: 'allyl', pos: [null, O, H, null, null], shulgin: null, found: 'clove, allspice, cinnamon leaf' },
  { id: 'methyleugenol', name: 'Methyl eugenol', pattern: '3,4-dimethoxy', chain: 'allyl', pos: [null, O, O, null, null], shulgin: '3,4-DMA', found: 'bay, tarragon, basil, nutmeg' },
  { id: 'safrole', name: 'Safrole', pattern: '3,4-methylenedioxy', chain: 'allyl', pos: [null, M, M2, null, null], shulgin: 'MDA', found: 'sassafras, star anise, nutmeg, camphor' },
  { id: 'croweacin', name: 'Croweacin', pattern: '2-methoxy-3,4-methylenedioxy', chain: 'allyl', pos: [O, M, M2, null, null], shulgin: 'MMDA-3a' },
  { id: 'asaricin', name: 'Asaricin', aka: 'sarisan', pattern: '2-methoxy-4,5-methylenedioxy', chain: 'allyl', pos: [O, null, M, M2, null], shulgin: 'MMDA-2' },
  { id: 'myristicin', name: 'Myristicin', pattern: '3-methoxy-4,5-methylenedioxy', chain: 'allyl', pos: [null, O, M, M2, null], shulgin: 'MMDA', found: 'nutmeg, mace, parsley seed, dill' },
  { id: 'apiole', name: 'Apiole', pattern: '2,5-dimethoxy-3,4-methylenedioxy', chain: 'allyl', pos: [O, M, M2, O, null], shulgin: 'DMMDA', found: 'parsley seed, celery' },
  { id: 'dillapiole', name: 'Dillapiole', pattern: '2,3-dimethoxy-4,5-methylenedioxy', chain: 'allyl', pos: [O, O, M, M2, null], shulgin: 'DMMDA-2', found: 'dill seed' },
  { id: 'elemicin', name: 'Elemicin', pattern: '3,4,5-trimethoxy', chain: 'allyl', pos: [null, O, O, O, null], shulgin: 'TMA', found: 'nutmeg, mace, elemi' },
  { id: 'gamma-asarone', name: 'γ-Asarone', aka: 'euasarone', pattern: '2,4,5-trimethoxy', chain: 'allyl', pos: [O, null, O, O, null], shulgin: 'TMA-2', note: 'the rare ALLYL calamus isomer — the common α- and β-asarone are propenyl' },
  { id: 'tetramethoxy', name: '2,3,4,5-Tetramethoxy­allylbenzene', pattern: '2,3,4,5-tetramethoxy', chain: 'allyl', pos: [O, O, O, O, null], shulgin: 'TA', note: "Shulgin's synthetic-intermediate aside" },
  { id: 'anethole', name: 'Anethole', pattern: '4-methoxy', chain: 'propenyl', pos: [null, null, O, null, null], shulgin: null, found: 'anise, star anise, fennel', note: 'PROPENYL — forms no alkaloid metabolites' },
  { id: 'alpha-asarone', name: 'α-Asarone', pattern: '2,4,5-trimethoxy', chain: 'propenyl', pos: [O, null, O, O, null], shulgin: null, found: 'calamus', note: 'PROPENYL — forms no alkaloid metabolites' },
  { id: 'isoeugenol', name: 'Isoeugenol', pattern: '3-methoxy-4-hydroxy', chain: 'propenyl', pos: [null, O, H, null, null], shulgin: null, found: 'ylang-ylang, nutmeg', note: 'PROPENYL — forms no alkaloid metabolites' },
];

// ── plants ───────────────────────────────────────────────────────────────────────────────────────
// Typical shares of the ESSENTIAL OIL (not of the plant), as published ranges. Chemotype decides more
// than species does for several of these — basil, calamus and thyme especially — so a range is the
// honest unit and the chart draws the midpoint. `class` drives the colour.
//   phenylpropanoid = the allyl/propenylbenzene family · terpene = mono/sesquiterpene · other = the rest

export const CONSTITUENT_CLASS = {
  phenylpropanoid: { colour: '#2e7d32', label: 'Allyl- and propenylbenzenes' },
  aldehyde: { colour: '#8a5a2b', label: 'Aromatic aldehydes' },
  terpene: { colour: '#1f6feb', label: 'Terpenes and terpenoids' },
  phenol: { colour: '#c0392b', label: 'Terpene phenols' },
  alkaloid: { colour: '#7b3fa0', label: 'Alkaloids and pungents' },
  other: { colour: '#6b665c', label: 'Other' },
};

export const PLANTS = [
  { id: 'nutmeg', name: 'Nutmeg', latin: 'Myristica fragrans', part: 'seed', c: [
    ['sabinene', 'terpene', 15, 30], ['α-pinene', 'terpene', 15, 25], ['myristicin', 'phenylpropanoid', 4, 8], ['elemicin', 'phenylpropanoid', 1, 3], ['safrole', 'phenylpropanoid', 0.5, 2] ] },
  { id: 'mace', name: 'Mace', latin: 'Myristica fragrans', part: 'aril', c: [
    ['sabinene', 'terpene', 15, 30], ['myristicin', 'phenylpropanoid', 5, 12], ['elemicin', 'phenylpropanoid', 2, 4] ] },
  { id: 'parsley-seed', name: 'Parsley seed', latin: 'Petroselinum crispum', part: 'seed', c: [
    ['apiole', 'phenylpropanoid', 20, 60], ['myristicin', 'phenylpropanoid', 5, 30] ] },
  { id: 'dill-seed', name: 'Dill seed', latin: 'Anethum graveolens', part: 'seed', c: [
    ['carvone', 'terpene', 40, 60], ['limonene', 'terpene', 30, 40], ['dillapiole', 'phenylpropanoid', 0, 20] ] },
  { id: 'basil', name: 'Sweet basil', latin: 'Ocimum basilicum', part: 'leaf', c: [
    ['estragole', 'phenylpropanoid', 20, 85], ['linalool', 'terpene', 20, 50], ['eugenol', 'phenylpropanoid', 1, 10] ], note: 'chemotype decides: an estragole basil and a linalool basil are the same species' },
  { id: 'tarragon', name: 'Tarragon', latin: 'Artemisia dracunculus', part: 'leaf', c: [
    ['estragole', 'phenylpropanoid', 60, 75], ['methyleugenol', 'phenylpropanoid', 1, 5] ] },
  { id: 'sassafras', name: 'Sassafras', latin: 'Sassafras albidum', part: 'root bark', c: [
    ['safrole', 'phenylpropanoid', 80, 90] ] },
  { id: 'star-anise', name: 'Star anise', latin: 'Illicium verum', part: 'fruit', c: [
    ['anethole', 'phenylpropanoid', 80, 90], ['safrole', 'phenylpropanoid', 0, 2] ] },
  { id: 'anise', name: 'Anise', latin: 'Pimpinella anisum', part: 'seed', c: [
    ['anethole', 'phenylpropanoid', 80, 95] ] },
  { id: 'fennel', name: 'Fennel', latin: 'Foeniculum vulgare', part: 'seed', c: [
    ['anethole', 'phenylpropanoid', 50, 80], ['fenchone', 'terpene', 5, 20], ['estragole', 'phenylpropanoid', 2, 6] ] },
  { id: 'clove', name: 'Clove', latin: 'Syzygium aromaticum', part: 'bud', c: [
    ['eugenol', 'phenylpropanoid', 70, 90], ['eugenyl acetate', 'phenylpropanoid', 5, 15], ['β-caryophyllene', 'terpene', 5, 15] ] },
  { id: 'cinnamon-bark', name: 'Cinnamon bark', latin: 'Cinnamomum verum', part: 'bark', c: [
    ['cinnamaldehyde', 'aldehyde', 60, 75], ['eugenol', 'phenylpropanoid', 4, 10] ] },
  { id: 'cassia', name: 'Cassia', latin: 'Cinnamomum cassia', part: 'bark', c: [
    ['cinnamaldehyde', 'aldehyde', 80, 90], ['coumarin', 'other', 0.5, 5] ], note: 'the coumarin is why cassia has a tolerable daily intake and Ceylon cinnamon effectively does not' },
  { id: 'cinnamon-leaf', name: 'Cinnamon leaf', latin: 'Cinnamomum verum', part: 'leaf', c: [
    ['eugenol', 'phenylpropanoid', 70, 80], ['cinnamaldehyde', 'aldehyde', 1, 5] ] },
  { id: 'allspice', name: 'Allspice', latin: 'Pimenta dioica', part: 'berry', c: [
    ['eugenol', 'phenylpropanoid', 60, 80], ['β-caryophyllene', 'terpene', 5, 15] ] },
  { id: 'calamus', name: 'Calamus', latin: 'Acorus calamus', part: 'rhizome', c: [
    ['β-asarone', 'phenylpropanoid', 0, 96] ], note: 'ploidy is CORRELATED with β-asarone but is not a safety test: North American and Siberian diploid material is reported at zero to trace, yet measured Himalayan diploid populations carried 7.4% and 11.7%, and one 20-accession study found no ploidy correlation at all. Treat unanalysed calamus as the high-β-asarone type.' },
  { id: 'black-pepper', name: 'Black pepper', latin: 'Piper nigrum', part: 'fruit', c: [
    ['piperine', 'alkaloid', 5, 9], ['β-caryophyllene', 'terpene', 10, 30], ['limonene', 'terpene', 10, 20] ], note: 'piperine is non-volatile — it is in the fruit, not the distilled oil' },
  { id: 'betel', name: 'Betel leaf', latin: 'Piper betle', part: 'leaf', c: [
    ['chavibetol', 'phenylpropanoid', 20, 50], ['hydroxychavicol', 'phenylpropanoid', 5, 20] ] },
  { id: 'lavender', name: 'Lavender', latin: 'Lavandula angustifolia', part: 'flower', c: [
    ['linalyl acetate', 'terpene', 25, 45], ['linalool', 'terpene', 25, 38] ] },
  { id: 'peppermint', name: 'Peppermint', latin: 'Mentha × piperita', part: 'leaf', c: [
    ['menthol', 'terpene', 30, 55], ['menthone', 'terpene', 14, 32] ] },
  { id: 'thyme', name: 'Thyme', latin: 'Thymus vulgaris', part: 'leaf', c: [
    ['thymol', 'phenol', 30, 55], ['carvacrol', 'phenol', 1, 10], ['p-cymene', 'terpene', 10, 25] ] },
  { id: 'oregano', name: 'Oregano', latin: 'Origanum vulgare', part: 'leaf', c: [
    ['carvacrol', 'phenol', 40, 80], ['thymol', 'phenol', 1, 20] ] },
  { id: 'rosemary', name: 'Rosemary', latin: 'Salvia rosmarinus', part: 'leaf', c: [
    ['1,8-cineole', 'terpene', 15, 55], ['camphor', 'terpene', 5, 20], ['α-pinene', 'terpene', 10, 25] ] },
  { id: 'chamomile-german', name: 'German chamomile', latin: 'Matricaria chamomilla', part: 'flower', c: [
    ['α-bisabolol', 'terpene', 10, 30], ['chamazulene', 'terpene', 1, 15] ] },
  { id: 'wormwood', name: 'Wormwood', latin: 'Artemisia absinthium', part: 'herb', c: [
    ['α/β-thujone', 'terpene', 20, 70] ] },
  { id: 'caraway', name: 'Caraway', latin: 'Carum carvi', part: 'seed', c: [
    ['carvone', 'terpene', 50, 75], ['limonene', 'terpene', 20, 45] ] },
  { id: 'cumin', name: 'Cumin', latin: 'Cuminum cyminum', part: 'seed', c: [
    ['cuminaldehyde', 'aldehyde', 20, 40], ['p-cymene', 'terpene', 10, 30] ] },
  { id: 'cardamom', name: 'Cardamom', latin: 'Elettaria cardamomum', part: 'seed', c: [
    ['α-terpinyl acetate', 'terpene', 30, 45], ['1,8-cineole', 'terpene', 20, 40] ] },
  { id: 'turmeric', name: 'Turmeric', latin: 'Curcuma longa', part: 'rhizome', c: [
    ['curcumin', 'other', 2, 5], ['turmerone', 'terpene', 30, 60] ], note: 'curcumin is the dye and the studied compound; it is non-volatile' },
  { id: 'ginger', name: 'Ginger', latin: 'Zingiber officinale', part: 'rhizome', c: [
    ['zingiberene', 'terpene', 20, 35], ['gingerols', 'alkaloid', 1, 3] ] },
  { id: 'grapefruit', name: 'Grapefruit', latin: 'Citrus × paradisi', part: 'peel and juice', c: [
    ['limonene', 'terpene', 85, 95], ['bergamottin', 'other', 0.1, 1] ], note: 'the furanocoumarins are the interaction, and they are in the juice, not the peel oil' },
  { id: 'lemon', name: 'Lemon', latin: 'Citrus limon', part: 'peel', c: [
    ['limonene', 'terpene', 60, 75], ['β-pinene', 'terpene', 7, 17] ] },
];

/** The plant chart: one bar per plant, segments sized by the midpoint of each published range. */
export function plantConstituentsSvg() {
  const rowH = 26, labelW = 196, barW = 400, left = 16, rangeW = 350;
  const top = 104, w = left + labelW + barW + rangeW, h = top + PLANTS.length * rowH + 112;
  let body = '';
  PLANTS.forEach((p, i) => {
    const y = top + i * rowH;
    body += `<text x="${f(left + labelW - 8)}" y="${f(y + 13)}" text-anchor="end" font-family="${FONT}" font-size="11" font-weight="700" fill="${INK}">${esc(p.name)}</text>`;
    let x = left + labelW;
    let total = 0;
    for (const [, , lo, hi] of p.c) total += (lo + hi) / 2;
    const scale = barW / Math.max(100, total);
    for (const [name, cls, lo, hi] of p.c) {
      const mid = (lo + hi) / 2, segW = mid * scale;
      const k = CONSTITUENT_CLASS[cls] || CONSTITUENT_CLASS.other;
      body += `<rect x="${f(x)}" y="${f(y + 3)}" width="${f(Math.max(segW, 1))}" height="16" rx="2.5" fill="${k.colour}" opacity="0.88"><title>${esc(`${name}: ${lo}–${hi}% of the oil`)}</title></rect>`;
      if (segW > 46) body += `<text x="${f(x + segW / 2)}" y="${f(y + 15)}" text-anchor="middle" font-family="${FONT}" font-size="9" fill="#fff">${esc(name)}</text>`;
      x += segW;
    }
    body += `<text x="${f(left + labelW + barW + 10)}" y="${f(y + 14)}" font-family="${FONT}" font-size="9" fill="${MUT}">${esc(p.c.map(([n, , lo, hi]) => `${n} ${lo}–${hi}%`).join(' · '))}</text>`;
  });
  let ky = top + PLANTS.length * rowH + 22;
  Object.values(CONSTITUENT_CLASS).forEach((k, i) => {
    const x = left + (i % 3) * 230, y = ky + Math.floor(i / 3) * 18;
    body += `<rect x="${f(x)}" y="${f(y - 8)}" width="11" height="11" rx="2" fill="${k.colour}"/>`
      + `<text x="${f(x + 17)}" y="${f(y + 1)}" font-family="${FONT}" font-size="10.5" fill="${INK}">${esc(k.label)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="What is in each plant">`
    + `<rect width="${w}" height="${h}" fill="${PAPER}"/>`
    + `<text x="${f(w / 2)}" y="30" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="800" fill="${INK}">What is in each plant</text>`
    + `<text x="${f(w / 2)}" y="50" text-anchor="middle" font-family="${FONT}" font-size="11.5" fill="${MUT}">Share of the ESSENTIAL OIL, not of the plant. Bars are the midpoint of the published range; the range is printed beside each bar.</text>`
    + `<text x="${f(w / 2)}" y="68" text-anchor="middle" font-family="${FONT}" font-size="11.5" fill="${MUT}">Chemotype and ploidy move these more than species does — basil, thyme and calamus are the same plant at very different compositions.</text>`
    + `<text x="${f(w / 2)}" y="86" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#8a5a2b">Piperine, curcumin and the grapefruit furanocoumarins are NOT volatile — they are in the plant, not the distilled oil.</text>`
    + body + '</svg>';
}

// ── ring drawing ─────────────────────────────────────────────────────────────────────────────────
// A benzene hexagon with position 1 at the bottom (carrying the side chain) and 2..6 going round.
// Each substituent is drawn in its position's colour, so two molecules can be compared by eye.

const HEX = [ // unit offsets for positions 1..6, position 1 at bottom
  [0, 1], [-0.866, 0.5], [-0.866, -0.5], [0, -1], [0.866, -0.5], [0.866, 0.5],
];

/** One molecule: hexagon, side chain, coloured substituents. Returns an SVG group. */
export function ringSvg(mol, cx, cy, r = 26) {
  const pt = (i) => [cx + HEX[i][0] * r, cy + HEX[i][1] * r];
  const ring = HEX.map((_, i) => pt(i).map(f).join(',')).join(' ');
  let s = `<polygon points="${ring}" fill="none" stroke="${INK}" stroke-width="1.6"/>`;
  // the aromatic inner circle
  s += `<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(r * 0.52)}" fill="none" stroke="${INK}" stroke-width="1" opacity="0.5"/>`;

  // position 1: the side chain, drawn downward, always black
  const [x1, y1] = pt(0);
  const propenyl = mol.chain === 'propenyl';
  s += `<path d="M ${f(x1)},${f(y1)} l 0,${f(r * 0.5)} l ${f(r * 0.45)},${f(r * 0.33)} l ${f(r * 0.45)},${f(-r * 0.33)}" fill="none" stroke="${INK}" stroke-width="1.6"/>`;
  // the double bond: allyl has it at the far end, propenyl next to the ring
  const db = propenyl
    ? `M ${f(x1 + 4)},${f(y1 + r * 0.16)} l 0,${f(r * 0.42)}`
    : `M ${f(x1 + r * 0.52)},${f(y1 + r * 0.92)} l ${f(r * 0.42)},${f(-r * 0.31)}`;
  s += `<path d="${db}" stroke="${INK}" stroke-width="1.4"/>`;

  // positions 2..6
  for (let i = 1; i <= 5; i++) {
    const sub = mol.pos[i - 1];
    if (!sub) continue;
    const key = POSITION_KEY[i];
    const [px, py] = pt(i);
    const ox = px + HEX[i][0] * r * 0.72, oy = py + HEX[i][1] * r * 0.72;
    if (sub === 'MDO') {
      // The methylenedioxy bridge: an O on this position and the next, joined by a CH2 — a real
      // 5-membered ring drawn outside the benzene, each O in its own position's colour.
      const [qx, qy] = pt(i + 1);
      const nk = POSITION_KEY[i + 1];
      const o1x = px + HEX[i][0] * r * 0.66, o1y = py + HEX[i][1] * r * 0.66;
      const o2x = qx + HEX[i + 1][0] * r * 0.66, o2y = qy + HEX[i + 1][1] * r * 0.66;
      const mx = (o1x + o2x) / 2 + (HEX[i][0] + HEX[i + 1][0]) * r * 0.42;
      const my = (o1y + o2y) / 2 + (HEX[i][1] + HEX[i + 1][1]) * r * 0.42;
      s += `<line x1="${f(px)}" y1="${f(py)}" x2="${f(o1x)}" y2="${f(o1y)}" stroke="${key.colour}" stroke-width="1.8"/>`;
      s += `<line x1="${f(qx)}" y1="${f(qy)}" x2="${f(o2x)}" y2="${f(o2y)}" stroke="${nk.colour}" stroke-width="1.8"/>`;
      s += `<line x1="${f(o1x)}" y1="${f(o1y)}" x2="${f(mx)}" y2="${f(my)}" stroke="${key.colour}" stroke-width="1.5"/>`;
      s += `<line x1="${f(o2x)}" y1="${f(o2y)}" x2="${f(mx)}" y2="${f(my)}" stroke="${nk.colour}" stroke-width="1.5"/>`;
      s += `<circle cx="${f(o1x)}" cy="${f(o1y)}" r="3.2" fill="${key.colour}"/>`;
      s += `<circle cx="${f(o2x)}" cy="${f(o2y)}" r="3.2" fill="${nk.colour}"/>`;
      continue;
    }
    if (sub === 'MDO2') continue; // drawn as part of the bridge above
    s += `<line x1="${f(px)}" y1="${f(py)}" x2="${f(ox)}" y2="${f(oy)}" stroke="${key.colour}" stroke-width="1.8"/>`;
    s += `<circle cx="${f(ox)}" cy="${f(oy)}" r="3.2" fill="${key.colour}"/>`;
    if (sub === 'OMe') {
      s += `<line x1="${f(ox)}" y1="${f(oy)}" x2="${f(ox + HEX[i][0] * r * 0.5)}" y2="${f(oy + HEX[i][1] * r * 0.5)}" stroke="${key.colour}" stroke-width="1.4"/>`;
    } else if (sub === 'OH') {
      s += `<text x="${f(ox + HEX[i][0] * 9)}" y="${f(oy + HEX[i][1] * 9 + 3.5)}" text-anchor="middle" font-family="${FONT}" font-size="9" font-weight="700" fill="${key.colour}">H</text>`;
    }
  }
  return s;
}

/** The whole structure chart: every molecule in the series, grouped, with the colour key. */
export function allylbenzeneMapSvg() {
  const cols = 4, cellW = 176, cellH = 152;
  const rows = Math.ceil(ALLYLBENZENES.length / cols);
  const w = cols * cellW + 40, top = 112, h = top + rows * cellH + 150;
  let body = '';
  ALLYLBENZENES.forEach((m, i) => {
    const cx = 20 + (i % cols) * cellW + cellW / 2;
    const cy = top + Math.floor(i / cols) * cellH + 62;
    body += `<text x="${f(cx)}" y="${f(cy - 58)}" text-anchor="middle" font-family="${FONT}" font-size="11.5" font-weight="800" fill="${INK}">${esc(m.name)}</text>`;
    body += ringSvg(m, cx, cy);
    body += `<text x="${f(cx)}" y="${f(cy + 56)}" text-anchor="middle" font-family="${FONT}" font-size="9.5" fill="${MUT}">${esc(m.pattern)}</text>`;
    const tail = m.chain === 'propenyl' ? 'propenyl — no alkaloid route' : (m.shulgin ? `→ ${m.shulgin} (hypothetical)` : 'no amphetamine pair');
    body += `<text x="${f(cx)}" y="${f(cy + 69)}" text-anchor="middle" font-family="${FONT}" font-size="9.5" fill="${m.chain === 'propenyl' ? '#8a5a2b' : MUT}">${esc(tail)}</text>`;
  });

  // key
  let ky = top + rows * cellH + 16;
  body += `<text x="20" y="${f(ky)}" font-family="${FONT}" font-size="12" font-weight="800" fill="${INK}">Ring position key</text>`;
  POSITION_KEY.forEach((k, i) => {
    const y = ky + 18 + i * 17;
    body += `<circle cx="27" cy="${f(y - 3.5)}" r="4.5" fill="${k.colour}"/>`;
    body += `<text x="40" y="${f(y)}" font-family="${FONT}" font-size="10.5" fill="${INK}">${esc(`${k.pos} ${k.name} — ${k.says}`)}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Allylbenzenes by ring substitution">`
    + `<rect width="${w}" height="${h}" fill="${PAPER}"/>`
    + `<text x="${f(w / 2)}" y="30" text-anchor="middle" font-family="${FONT}" font-size="17" font-weight="800" fill="${INK}">The allylbenzenes, by what sits where on the ring</text>`
    + `<text x="${f(w / 2)}" y="50" text-anchor="middle" font-family="${FONT}" font-size="11.5" fill="${MUT}">Position 1 carries the side chain. Positions 2–6 are coloured so two molecules can be compared at a glance.</text>`
    + `<text x="${f(w / 2)}" y="68" text-anchor="middle" font-family="${FONT}" font-size="11.5" fill="${MUT}">The amphetamine pairs are Shulgin&#39;s, and every one of them is hypothetical — see the page text.</text>`
    + `<text x="${f(w / 2)}" y="86" text-anchor="middle" font-family="${FONT}" font-size="11" fill="#8a5a2b">What each position is said to do is a community claim from the 69Ron / Herbpedia material, not a verified result.</text>`
    + body + '</svg>';
}
