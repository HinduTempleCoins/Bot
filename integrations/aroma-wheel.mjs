// integrations/aroma-wheel.mjs — AROMA WHEELS, generated.
//
// The wine aroma wheel (Ann Noble, UC Davis, 1984) solved a real problem: tasters had no shared
// vocabulary, so nobody could tell whether two people describing a wine meant the same thing. The wheel
// is a controlled vocabulary arranged by kinship — broad families at the centre, specific terms at the
// rim — so a taster moves outward from "fruity" to "citrus" to "grapefruit" and lands on a word everyone
// else uses the same way. Beer, coffee, whisky, cannabis and essential-oil wheels all copy that shape.
//
// This module draws them from data. One WHEELS entry per domain; add a domain by adding data, not code.
// Deterministic SVG, no dependencies, readable in print — same discipline as site/wiki/figures.mjs.
//
// SCOPE: this is a diagram generator for the library. It does not touch any image-generation path.
//
//   import { wheelSvg, WHEELS, wheel, wheelNames } from './aroma-wheel.mjs'

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const f = (n) => Math.round(n * 100) / 100;
const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';

/**
 * A wheel is: families → each with a colour and its outer terms.
 * Keep terms short; they are drawn on an arc.
 */
export const WHEELS = {
  wine: {
    title: 'Wine aroma wheel',
    note: 'After Ann C. Noble, UC Davis (1984) — the wheel that gave tasting a shared vocabulary.',
    families: [
      { name: 'Fruity', colour: '#c0392b', terms: ['citrus', 'berry', 'tree fruit', 'tropical', 'dried fruit'] },
      { name: 'Floral', colour: '#d98cb3', terms: ['violet', 'rose', 'orange blossom', 'geranium'] },
      { name: 'Spicy', colour: '#a9601f', terms: ['pepper', 'clove', 'liquorice', 'anise'] },
      { name: 'Woody', colour: '#7a5c45', terms: ['oak', 'vanilla', 'cedar', 'smoky', 'coffee'] },
      { name: 'Earthy', colour: '#6b705c', terms: ['mushroom', 'forest floor', 'dusty', 'truffle'] },
      { name: 'Vegetal', colour: '#4f7a3f', terms: ['bell pepper', 'grass', 'asparagus', 'hay'] },
      { name: 'Chemical', colour: '#5c7fa3', terms: ['sulfur', 'petrol', 'acetone', 'cork taint'] },
      { name: 'Microbial', colour: '#9c7ba8', terms: ['yeast', 'lactic', 'sweaty', 'barnyard'] },
    ],
  },
  beer: {
    title: 'Beer flavour wheel',
    note: 'After Morten Meilgaard (1979) — the model the other wheels were built on.',
    families: [
      { name: 'Malty', colour: '#a9601f', terms: ['bready', 'caramel', 'toffee', 'roasted', 'burnt'] },
      { name: 'Hoppy', colour: '#4f7a3f', terms: ['resinous', 'citrus', 'tropical', 'herbal', 'grassy'] },
      { name: 'Fruity (ester)', colour: '#c0392b', terms: ['banana', 'pear', 'apple', 'stone fruit'] },
      { name: 'Spicy (phenol)', colour: '#8a6a2a', terms: ['clove', 'pepper', 'smoke', 'medicinal'] },
      { name: 'Sour / acid', colour: '#c8a02c', terms: ['lactic', 'acetic', 'citric'] },
      { name: 'Sulfury', colour: '#5c7fa3', terms: ['cooked corn', 'struck match', 'skunk'] },
      { name: 'Stale / oxidised', colour: '#6b705c', terms: ['cardboard', 'sherry', 'leather'] },
      { name: 'Sweet / other', colour: '#d98cb3', terms: ['honey', 'vanilla', 'buttery'] },
    ],
  },
  coffee: {
    title: 'Coffee flavour wheel',
    note: 'After the SCA / World Coffee Research Sensory Lexicon.',
    families: [
      { name: 'Fruity', colour: '#c0392b', terms: ['berry', 'citrus', 'stone fruit', 'dried fruit'] },
      { name: 'Floral', colour: '#d98cb3', terms: ['jasmine', 'rose', 'chamomile'] },
      { name: 'Sweet', colour: '#c8a02c', terms: ['honey', 'caramel', 'molasses', 'vanilla'] },
      { name: 'Nutty / cocoa', colour: '#8a6a2a', terms: ['almond', 'hazelnut', 'chocolate'] },
      { name: 'Spices', colour: '#a9601f', terms: ['clove', 'cinnamon', 'nutmeg', 'pepper'] },
      { name: 'Roasted', colour: '#5a4332', terms: ['toast', 'smoky', 'ashy', 'burnt'] },
      { name: 'Green / vegetative', colour: '#4f7a3f', terms: ['grassy', 'peapod', 'hay'] },
      { name: 'Sour / fermented', colour: '#9c7ba8', terms: ['winey', 'overripe', 'acetic'] },
    ],
  },
  cannabis: {
    title: 'Cannabis aroma wheel',
    note: 'Terpene families plus the trace sulfur compounds that actually carry "gas". See the dank chemistry page.',
    families: [
      { name: 'Gas / skunk', colour: '#6b705c', terms: ['diesel', 'skunk', 'garlic', 'rubber'] },
      { name: 'Citrus', colour: '#c8a02c', terms: ['lemon', 'orange', 'grapefruit', 'lime'] },
      { name: 'Sweet / candy', colour: '#d98cb3', terms: ['berry', 'grape', 'bubblegum', 'cream'] },
      { name: 'Earthy', colour: '#7a5c45', terms: ['soil', 'musk', 'hash', 'leather'] },
      { name: 'Pine / woody', colour: '#3f6b46', terms: ['pine', 'cedar', 'eucalyptus'] },
      { name: 'Floral', colour: '#b07bbd', terms: ['lavender', 'rose', 'violet'] },
      { name: 'Spice / herbal', colour: '#a9601f', terms: ['pepper', 'clove', 'sage', 'mint'] },
      { name: 'Tropical', colour: '#c0392b', terms: ['mango', 'pineapple', 'guava'] },
    ],
  },
  essentialOils: {
    title: 'Essential-oil families',
    note: "The perfumer's classification by material family, with the note tier each tends to occupy.",
    families: [
      { name: 'Citrus (top)', colour: '#c8a02c', terms: ['bergamot', 'lemon', 'neroli', 'petitgrain'] },
      { name: 'Floral (heart)', colour: '#d98cb3', terms: ['rose', 'jasmine', 'ylang', 'lavender'] },
      { name: 'Herbaceous', colour: '#4f7a3f', terms: ['rosemary', 'sage', 'basil', 'marjoram'] },
      { name: 'Minty', colour: '#3f8a7a', terms: ['peppermint', 'spearmint', 'eucalyptus'] },
      { name: 'Spicy', colour: '#a9601f', terms: ['clove', 'cinnamon', 'black pepper', 'ginger'] },
      { name: 'Woody (base)', colour: '#7a5c45', terms: ['cedarwood', 'sandalwood', 'vetiver'] },
      { name: 'Resinous (base)', colour: '#8a6a2a', terms: ['frankincense', 'myrrh', 'benzoin', 'labdanum'] },
      { name: 'Earthy', colour: '#6b705c', terms: ['patchouli', 'oakmoss', 'orris'] },
    ],
  },
  outdoor: {
    title: 'Outdoor smells',
    note: 'The named compounds behind ordinary outdoor air.',
    families: [
      { name: 'Rain / soil', colour: '#6b705c', terms: ['petrichor', 'geosmin', 'ozone before storm'] },
      { name: 'Forest', colour: '#3f6b46', terms: ['pine resin', 'leaf litter', 'moss', 'fungal'] },
      { name: 'Sea', colour: '#5c7fa3', terms: ['dimethyl sulfide', 'iodine', 'seaweed', 'salt spray'] },
      { name: 'Grass / hay', colour: '#4f7a3f', terms: ['cut grass', 'coumarin hay', 'silage'] },
      { name: 'Smoke', colour: '#5a4332', terms: ['wood smoke', 'guaiacol', 'bonfire', 'creosote'] },
      { name: 'Flowers', colour: '#d98cb3', terms: ['linden', 'jasmine', 'honeysuckle', 'elder'] },
      { name: 'Urban', colour: '#8a8a8a', terms: ['hot asphalt', 'diesel', 'drains'] },
      { name: 'Farm', colour: '#a9601f', terms: ['manure', 'silage', 'wet wool'] },
    ],
  },
  indoor: {
    title: 'Indoor smells',
    note: 'What a room is actually made of, olfactorily.',
    families: [
      { name: 'Clean / laundry', colour: '#5c7fa3', terms: ['soap', 'musk', 'bleach', 'linen'] },
      { name: 'Cooking', colour: '#a9601f', terms: ['Maillard', 'onion', 'baking', 'frying'] },
      { name: 'Old building', colour: '#7a5c45', terms: ['dust', 'old paper', 'damp', 'mustiness'] },
      { name: 'New building', colour: '#8a8a8a', terms: ['paint', 'adhesive', 'new carpet', 'plastic'] },
      { name: 'Wood / fire', colour: '#5a4332', terms: ['cedar chest', 'fireplace', 'beeswax'] },
      { name: 'Bodies', colour: '#c0392b', terms: ['skin', 'hair', 'sweat', 'breath'] },
      { name: 'Plants', colour: '#4f7a3f', terms: ['potting soil', 'cut flowers', 'tomato leaf'] },
      { name: 'Animals', colour: '#9c7ba8', terms: ['dog', 'cat', 'litter', 'aquarium'] },
    ],
  },
};

export const wheelNames = () => Object.keys(WHEELS);
export const wheel = (name) => WHEELS[String(name || '')] || null;

const polar = (cx, cy, r, deg) => {
  const a = (deg - 90) * Math.PI / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
};

/** an annular sector path */
function sector(cx, cy, r0, r1, a0, a1) {
  const [x0, y0] = polar(cx, cy, r1, a0);
  const [x1, y1] = polar(cx, cy, r1, a1);
  const [x2, y2] = polar(cx, cy, r0, a1);
  const [x3, y3] = polar(cx, cy, r0, a0);
  const big = a1 - a0 > 180 ? 1 : 0;
  return `M ${f(x0)},${f(y0)} A ${f(r1)},${f(r1)} 0 ${big} 1 ${f(x1)},${f(y1)} `
    + `L ${f(x2)},${f(y2)} A ${f(r0)},${f(r0)} 0 ${big} 0 ${f(x3)},${f(y3)} Z`;
}

/** text on a curved path, centred in its sector */
function arcLabel(id, cx, cy, r, a0, a1, label, { size = 10.5, fill = '#1d1b17', weight = 400 } = {}) {
  const mid = (a0 + a1) / 2;
  const flip = mid > 90 && mid < 270;              // keep text upright on the bottom half
  const [sx, sy] = polar(cx, cy, r, flip ? a1 : a0);
  const [ex, ey] = polar(cx, cy, r, flip ? a0 : a1);
  const sweep = flip ? 0 : 1;
  return `<path id="${id}" d="M ${f(sx)},${f(sy)} A ${f(r)},${f(r)} 0 0 ${sweep} ${f(ex)},${f(ey)}" fill="none"/>`
    + `<text font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}">`
    + `<textPath href="#${id}" startOffset="50%" text-anchor="middle">${esc(label)}</textPath></text>`;
}

/**
 * A term label running OUTWARD along its own radius. Arc text clips on a narrow sector; radial text has
 * the full ring depth to use, which is how the printed wheels do it.
 */
function radialLabel(cx, cy, r0, r1, deg, label) {
  const flip = deg > 180;                           // keep text readable on the left half
  const r = flip ? r1 - 4 : r0 + 4;
  const [x, y] = polar(cx, cy, r, deg);
  const rot = flip ? deg + 90 : deg - 90;
  const anchor = flip ? 'end' : 'start';
  return `<text x="${f(x)}" y="${f(y)}" transform="rotate(${f(rot)} ${f(x)} ${f(y)})" text-anchor="${anchor}" `
    + `dominant-baseline="middle" font-family="${FONT}" font-size="9.5" fill="#1d1b17">${esc(label)}</text>`;
}

/**
 * Draw a wheel. Two rings: families inside, their terms outside.
 */
export function wheelSvg(name, { size = 720 } = {}) {
  const w = wheel(name);
  if (!w) return '';
  const cx = size / 2, cy = size / 2 + 34;
  const rHub = size * 0.095, rFam = size * 0.20, rTerm = size * 0.405;
  const fams = w.families;
  const step = 360 / fams.length;
  const uid = String(name).replace(/[^a-z0-9]/gi, '');

  let body = '';
  fams.forEach((fam, i) => {
    const a0 = i * step, a1 = (i + 1) * step;
    body += `<path d="${sector(cx, cy, rHub, rFam, a0 + 0.6, a1 - 0.6)}" fill="${fam.colour}" opacity="0.92"/>`;
    body += arcLabel(`${uid}f${i}`, cx, cy, (rHub + rFam) / 2 + 3, a0 + 0.6, a1 - 0.6, fam.name, { size: 11, weight: 700, fill: '#fff' });
    const tstep = (step - 1.2) / fam.terms.length;
    fam.terms.forEach((t, j) => {
      const b0 = a0 + 0.6 + j * tstep, b1 = b0 + tstep;
      body += `<path d="${sector(cx, cy, rFam + 2, rTerm, b0 + 0.3, b1 - 0.3)}" fill="${fam.colour}" opacity="${0.20 + 0.10 * (j % 3)}" stroke="#fff" stroke-width="0.6"/>`;
      body += radialLabel(cx, cy, rFam + 8, rTerm, (b0 + b1) / 2, t);
    });
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + 78}" width="${size}" height="${size + 78}" role="img" aria-label="${esc(w.title)}">
<rect width="${size}" height="${size + 78}" fill="#f6f4ef"/>
<text x="${cx}" y="30" text-anchor="middle" font-family="${FONT}" font-size="19" font-weight="800" fill="#1d1b17">${esc(w.title)}</text>
${body}
<circle cx="${f(cx)}" cy="${f(cy)}" r="${f(rHub)}" fill="#fff" stroke="#ddd6c8"/>
<text x="${f(cx)}" y="${f(cy + 4)}" text-anchor="middle" font-family="${FONT}" font-size="12" font-weight="700" fill="#6b665c">smell</text>
<text x="${cx}" y="${size + 62}" text-anchor="middle" font-family="${FONT}" font-size="11.5" fill="#6b665c">${esc(w.note)}</text>
</svg>`;
}
