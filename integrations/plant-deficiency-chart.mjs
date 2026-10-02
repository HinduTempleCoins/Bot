// integrations/plant-deficiency-chart.mjs — the nutrient-deficiency leaf chart, DRAWN rather than guessed.
//
// WHY THIS IS NOT AN AI IMAGE. A deficiency chart is a diagnostic instrument: if the yellow is in the wrong
// place the chart is worse than nothing, because it teaches a wrong diagnosis. An image model will produce
// a handsome leaf with the chlorosis wherever it feels right. So this module DRAWS each leaf from the
// symptom description — the leaf geometry is parametric, and every symptom is a rule applied to it.
//
// THE DIAGNOSTIC RULE THE CHART EXISTS TO TEACH. Nutrients divide into MOBILE and IMMOBILE:
//   • MOBILE (N, P, K, Mg, Mo) — the plant can strip them out of old leaves and move them to new
//     growth. So a shortage shows on the OLD, LOWER leaves first while the top stays green.
//   • IMMOBILE (Ca, S, Fe, B, Mn, Cu; Zn is intermediate) — once laid down they stay put. A shortage
//     shows on the NEW,
//     UPPER growth first while the bottom stays green.
// Where the symptom appears tells you more than what colour it is. That is the whole chart.
//
// Output is plain SVG: no dependencies, no network, deterministic, and legible in print.
//
//   import { leafSvg, chartSvg, DEFICIENCIES, deficiency } from './plant-deficiency-chart.mjs'

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const f = (n) => Math.round(n * 100) / 100;

// ── the leaf ────────────────────────────────────────────────────────────────────────────────────────
// A cannabis leaf is palmately compound: an odd number of lanceolate, serrated leaflets from one point.
// Each leaflet is built as a serrated outline so the chart reads as the plant and not as a generic blob.

/** one leaflet, pointing up from (0,0), length L, half-width W, with `teeth` serrations a side */
export function leafletPath(L, W, teeth = 9) {
  const pts = [];
  const edge = (side) => {
    for (let i = 0; i <= teeth; i++) {
      const t = i / teeth;                       // 0 at base → 1 at tip
      // lanceolate profile: widest about a third of the way up, tapering to a point
      const prof = Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - t * 0.15);
      const y = -L * t;
      const w = W * prof;
      // serration: every tooth juts out then cuts back toward the midrib
      const tip = { x: side * w, y };
      const notch = { x: side * w * 0.72, y: y + L / teeth * 0.42 };
      if (side > 0) pts.push(notch, tip);
      else pts.push(tip, notch);
    }
  };
  edge(1);                                        // up the right side
  pts.push({ x: 0, y: -L * 1.02 });               // the point
  const left = [];
  const save = pts.length;
  edge(-1);
  // edge(-1) appended in base→tip order; reverse that segment so the outline closes tip→base
  const back = pts.splice(save).reverse();
  pts.push(...back, { x: 0, y: 0 });
  return `M ${pts.map((p) => `${f(p.x)},${f(p.y)}`).join(' L ')} Z`;
}

/** the leaflet angles of a palmate leaf with `n` leaflets (odd), centre leaflet upright */
export function fan(n = 7) {
  const half = (n - 1) / 2;
  const spread = 68;                              // degrees from centre to the outermost leaflet
  const out = [];
  for (let i = -half; i <= half; i++) {
    const t = half ? i / half : 0;
    out.push({ angle: t * spread, scale: 1 - Math.abs(t) * 0.42 });
  }
  return out;
}

// ── the symptoms ────────────────────────────────────────────────────────────────────────────────────
// Each entry says where it shows (old/new growth — the diagnostic half), the colours, and which visual
// rules to draw. `fix` is kept short and practical; `confusable` names the lookalike it is mistaken for.
export const DEFICIENCIES = [
  { id: 'nitrogen', symbol: 'N', name: 'Nitrogen', mobility: 'mobile', where: 'Oldest, lowest leaves first',
    blade: '#d9d24a', vein: '#d9d24a', pattern: 'uniform', tip: '#c9b23a', note: 'Whole leaf fades to pale yellow from the tip inward; lower leaves yellow and drop while the top stays green.',
    fix: 'Feed nitrogen (any complete grow feed). Fastest of all deficiencies to correct.',
    confusable: 'Normal late-flower fade — which is expected and not a problem.' },
  { id: 'phosphorus', symbol: 'P', name: 'Phosphorus', mobility: 'mobile', where: 'Older leaves first',
    blade: '#2f6b4f', vein: '#27543f', pattern: 'spots', spot: '#4a3a5e', petiole: '#7a3f6b',
    note: 'Dark blue-green, dull leaves; purple or red petioles and stems; blackish-purple or copper blotches; slow growth.',
    fix: 'Check root-zone temperature and pH first — phosphorus locks out when cold or when pH drifts low. Then feed P.',
    confusable: 'Genetic purpling (harmless) and cold stress.' },
  { id: 'potassium', symbol: 'K', name: 'Potassium', mobility: 'mobile', where: 'Older leaves first',
    blade: '#6f9a4a', vein: '#5d8a3f', pattern: 'edge-burn', tip: '#8a4a28',
    note: 'Rusty-brown scorched tips and margins on older leaves, yellowing inward; edges curl up; stretching.',
    fix: 'Feed potassium; flush if salts have built up. Very commonly mistaken for nutrient burn.',
    confusable: 'Nutrient burn — which starts at the very tip of the NEWEST leaves instead.' },
  { id: 'magnesium', symbol: 'Mg', name: 'Magnesium', mobility: 'mobile', where: 'Older leaves first',
    blade: '#dcd857', vein: '#3d7a46', pattern: 'interveinal', spot: '#8a4a28',
    note: 'Classic interveinal chlorosis: the blade yellows while the veins stay sharply green; rust-coloured spots follow; leaf tips curl up.',
    fix: 'Epsom salts (magnesium sulfate) or a Cal-Mag supplement. Very common in coco and under LED.',
    confusable: 'Iron — same pattern but on NEW growth, not old.' },
  { id: 'calcium', symbol: 'Ca', name: 'Calcium', mobility: 'immobile', where: 'New, upper growth first',
    blade: '#5f8f4e', vein: '#4e7a41', pattern: 'spots', spot: '#8a6a2a',
    note: 'New leaves distorted, curled and small; irregular brown-yellow spots with brown borders; dead growing tips; weak stems and stunted roots.',
    fix: 'Cal-Mag, or gypsum/dolomite lime in soil. Check pH — calcium locks out below roughly 6.2 in soil.',
    confusable: 'Heat stress and light burn.' },
  { id: 'sulfur', symbol: 'S', name: 'Sulfur', mobility: 'immobile', where: 'New, upper growth first',
    blade: '#e2dd7a', vein: '#e2dd7a', pattern: 'uniform',
    note: 'Whole new leaves pale uniformly — veins included — while lower growth stays green. Stems weak, growth stalls.',
    fix: 'Magnesium sulfate or any sulfate-form feed. Uncommon; usually a very clean or very alkaline water supply.',
    confusable: 'Nitrogen — same yellow, but nitrogen hits the BOTTOM of the plant.' },
  { id: 'iron', symbol: 'Fe', name: 'Iron', mobility: 'immobile', where: 'Newest growth first',
    blade: '#f0e9a8', vein: '#3d7a46', pattern: 'interveinal',
    note: 'Bright interveinal chlorosis on the newest leaves — nearly white blade with a sharp green vein skeleton. Older leaves stay green.',
    fix: 'Almost always a lockout, not a shortage: bring pH down (5.5–6.2 hydro, 6.0–6.5 soil). Chelated iron if it persists.',
    confusable: 'Magnesium — same pattern, but magnesium hits OLD leaves.' },
  { id: 'manganese', symbol: 'Mn', name: 'Manganese', mobility: 'immobile', where: 'New growth first',
    blade: '#d8dc86', vein: '#49804a', pattern: 'interveinal', spot: '#6b4a2a',
    note: 'Interveinal yellowing on new leaves with brown necrotic specks scattered through the yellow areas.',
    fix: 'Lower pH; manganese locks out when alkaline. Often appears alongside iron and zinc for the same reason.',
    confusable: 'Iron — but iron has no brown specks.' },
  { id: 'zinc', symbol: 'Zn', name: 'Zinc', mobility: 'immobile', where: 'New growth; tops bunch up',
    blade: '#d6d87c', vein: '#4a8050', pattern: 'interveinal', tip: '#a8692f',
    note: 'New leaves thin, small and bunched — the internodes shorten so the top looks compressed. Interveinal yellowing with twisted, rippled blades. (Zinc is strictly intermediate in mobility; in practice it reads as an upper-growth problem.)',
    fix: 'Lower pH; add a micronutrient mix. Common in alkaline or over-limed soil.',
    confusable: 'Heat stress and broad mites — both also distort new growth.' },
  { id: 'boron', symbol: 'B', name: 'Boron', mobility: 'immobile', where: 'Growing tips',
    blade: '#6f9a55', vein: '#5d8a46', pattern: 'spots', spot: '#7a5a2a',
    note: 'Growing tips die back; new leaves thick, brittle and distorted; brown or grey patches; hollow or corky stems.',
    fix: 'Rare. Usually under-watering or very low humidity rather than an actual shortage — boron moves in the transpiration stream.',
    confusable: 'Calcium — both kill the growing tip.' },
];

export const deficiency = (id) => DEFICIENCIES.find((d) => d.id === String(id || '').toLowerCase()) || null;

// ── drawing ─────────────────────────────────────────────────────────────────────────────────────────
const HEALTHY = { blade: '#3f8046', vein: '#2f6436' };

function veins(L, W, leaflet) {
  // midrib plus a few laterals, drawn so an interveinal pattern has something to stay green against
  const out = [`<path d="M 0,0 L 0,${f(-L * 0.97)}" stroke="${leaflet.vein}" stroke-width="1.5" fill="none"/>`];
  for (let i = 1; i <= 4; i++) {
    const t = i / 5;
    const y = -L * t;
    const w = W * Math.sin(Math.PI * Math.pow(t, 0.75)) * (1 - t * 0.15) * 0.82;
    out.push(`<path d="M 0,${f(y)} L ${f(w)},${f(y - L * 0.11)}" stroke="${leaflet.vein}" stroke-width="0.9" fill="none"/>`);
    out.push(`<path d="M 0,${f(y)} L ${f(-w)},${f(y - L * 0.11)}" stroke="${leaflet.vein}" stroke-width="0.9" fill="none"/>`);
  }
  return out.join('');
}

/**
 * One leaf showing one deficiency (or healthy when `d` is null).
 * size is the SVG box; the leaf is drawn to fit it.
 */
export function leafSvg(d = null, { size = 180, leaflets = 7, id = '' } = {}) {
  const s = d || HEALTHY;
  const blade = s.blade || HEALTHY.blade;
  const vein = s.vein || HEALTHY.vein;
  const uid = `l${(id || (d && d.id) || 'healthy').replace(/[^a-z0-9]/gi, '')}`;
  const L = size * 0.46, W = size * 0.085;
  const cx = size / 2, cy = size * 0.95;

  // the fill: a flat blade, or a gradient that leaves the midrib green for interveinal patterns,
  // or an edge gradient for tip/margin burn
  let fill = blade;
  let defs = '';
  if (s.pattern === 'interveinal') {
    defs += `<linearGradient id="${uid}iv" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="${vein}"/><stop offset="0.14" stop-color="${blade}"/>
      <stop offset="0.86" stop-color="${blade}"/><stop offset="1" stop-color="${vein}"/></linearGradient>`;
    fill = `url(#${uid}iv)`;
  } else if (s.pattern === 'edge-burn') {
    defs += `<linearGradient id="${uid}eb" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="${blade}"/><stop offset="0.55" stop-color="${blade}"/>
      <stop offset="1" stop-color="${s.tip || '#8a4a28'}"/></linearGradient>`;
    fill = `url(#${uid}eb)`;
  } else if (s.pattern === 'uniform' && s.tip) {
    defs += `<linearGradient id="${uid}un" x1="0" y1="1" x2="0" y2="0">
      <stop offset="0" stop-color="${blade}"/><stop offset="1" stop-color="${s.tip}"/></linearGradient>`;
    fill = `url(#${uid}un)`;
  }

  const path = leafletPath(L, W, 9);
  const body = fan(leaflets).map(({ angle, scale }, i) => {
    const g = `<g transform="rotate(${f(angle)}) scale(${f(scale)})">`
      + `<path d="${path}" fill="${fill}" stroke="${vein}" stroke-width="0.8" stroke-linejoin="round"/>`
      + veins(L, W, { vein })
      + (s.pattern === 'spots' ? spots(L, W, s.spot || '#7a5a2a', i) : '')
      + '</g>';
    return g;
  }).join('');

  const petiole = `<path d="M 0,0 L 0,${f(size * 0.055)}" stroke="${s.petiole || vein}" stroke-width="3" stroke-linecap="round"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" `
    + `aria-label="${esc(d ? `${d.name} deficiency` : 'healthy leaf')}">`
    + (defs ? `<defs>${defs}</defs>` : '')
    + `<g transform="translate(${f(cx)},${f(cy)})">${petiole}${body}</g></svg>`;
}

/** necrotic specks, placed deterministically so the same leaf always draws the same */
function spots(L, W, colour, seed = 0) {
  const out = [];
  let x = (seed + 1) * 9301;
  const rnd = () => { x = (x * 9301 + 49297) % 233280; return x / 233280; };
  for (let i = 0; i < 7; i++) {
    const t = 0.18 + rnd() * 0.66;
    const w = W * Math.sin(Math.PI * Math.pow(t, 0.75)) * 0.7;
    out.push(`<ellipse cx="${f((rnd() * 2 - 1) * w)}" cy="${f(-L * t)}" rx="${f(1.4 + rnd() * 2)}" ry="${f(1.1 + rnd() * 1.6)}" fill="${colour}" opacity="0.85"/>`);
  }
  return out.join('');
}

/**
 * The whole chart: healthy leaf first, then every deficiency, grouped by mobility so the
 * old-growth / new-growth rule is visible in the layout itself.
 */
export function chartSvg({ cols = 4, cell = 200 } = {}) {
  const items = [{ d: null, name: 'Healthy', where: 'For comparison', mobility: '' }, ...DEFICIENCIES.map((d) => ({ d, name: d.name, where: d.where, mobility: d.mobility, symbol: d.symbol }))];
  const rows = Math.ceil(items.length / cols);
  const H = 108;                                    // header band
  const cellH = cell + 74;
  const w = cols * cell, h = H + rows * cellH + 34;
  const card = (it, i) => {
    const x = (i % cols) * cell, y = H + Math.floor(i / cols) * cellH;
    const inner = leafSvg(it.d, { size: cell - 24, id: it.d ? it.d.id : 'healthy' })
      .replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '');
    const tag = it.mobility === 'mobile' ? 'MOBILE · old leaves first'
      : it.mobility === 'immobile' ? 'IMMOBILE · new growth first' : '';
    const tagFill = it.mobility === 'mobile' ? '#b9741f' : it.mobility === 'immobile' ? '#2f6bb3' : '#888';
    return `<g transform="translate(${x},${y})">
<rect x="6" y="6" width="${cell - 12}" height="${cellH - 14}" rx="12" fill="#ffffff" stroke="#ddd6c8"/>
<g transform="translate(12,10)">${inner}</g>
<text x="${cell / 2}" y="${cell + 6}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="15" font-weight="700" fill="#1d1b17">${esc(it.name)}${it.symbol ? ` (${esc(it.symbol)})` : ''}</text>
${tag ? `<text x="${cell / 2}" y="${cell + 25}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="10.5" font-weight="700" fill="${tagFill}">${esc(tag)}</text>` : ''}
<text x="${cell / 2}" y="${cell + 43}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#6b665c">${esc(it.where)}</text>
</g>`;
  };
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Cannabis nutrient deficiency chart">
<rect width="${w}" height="${h}" fill="#f6f4ef"/>
<text x="${w / 2}" y="34" text-anchor="middle" font-family="system-ui,sans-serif" font-size="23" font-weight="800" fill="#1d1b17">Nutrient deficiencies, leaf by leaf</text>
<text x="${w / 2}" y="58" text-anchor="middle" font-family="system-ui,sans-serif" font-size="13" fill="#6b665c">WHERE it shows tells you more than what colour it is.</text>
<text x="${w / 2}" y="76" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#6b665c"><tspan fill="#b9741f" font-weight="700">Mobile</tspan> nutrients move out of old leaves — the BOTTOM fades first.</text>
<text x="${w / 2}" y="92" text-anchor="middle" font-family="system-ui,sans-serif" font-size="12" fill="#6b665c"><tspan fill="#2f6bb3" font-weight="700">Immobile</tspan> ones cannot move — the TOP goes first.</text>
${items.map(card).join('')}
<text x="${w / 2}" y="${h - 12}" text-anchor="middle" font-family="system-ui,sans-serif" font-size="11" fill="#6b665c">Check pH before adding anything: most "deficiencies" are lockouts. Soil 6.0–6.5 · coco and hydro 5.5–6.2.</text>
</svg>`;
}
