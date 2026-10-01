// logos.mjs — the two marks: HATHOR METATRON = Metatron's Cube (the 13 circles of the Fruit of Life, every centre
// joined to every other); HATHOR SANDALPHON = a harp. Pure SVG strings, drawn from geometry (no image files), usable
// inline in headers and as data-URI favicons.

const f = (n) => Math.round(n * 100) / 100;

/** Metatron's Cube: centre + inner hexagon (r) + outer hexagon (2r), 13 circles, all 78 centre-to-centre lines. */
export function metatronCubeSvg(size = 40, color = '#c9a64a') {
  const c = 50, r = 14.5, cr = 7.2;
  const pts = [[c, c]];
  for (const k of [1, 2]) for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; pts.push([c + k * r * Math.cos(a), c + k * r * Math.sin(a)]); }
  const lines = [];
  for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) lines.push(`<line x1="${f(pts[i][0])}" y1="${f(pts[i][1])}" x2="${f(pts[j][0])}" y2="${f(pts[j][1])}"/>`);
  const circles = pts.map(([x, y]) => `<circle cx="${f(x)}" cy="${f(y)}" r="${cr}"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Metatron's Cube"><g fill="none" stroke="${color}" stroke-width="0.9" stroke-linecap="round">${lines.join('')}${circles}</g></svg>`;
}

/** A harp: curved neck, pillar, sound-box and strings. */
export function harpSvg(size = 40, color = '#8fb4ff') {
  // each string runs from the neck curve down to the sound-box line, so both ends sit on the frame
  const P = [[28, 14], [46, 8], [58, 22], [84, 26]];
  const neck = (t) => [0, 1].map((k) => (1 - t) ** 3 * P[0][k] + 3 * (1 - t) ** 2 * t * P[1][k] + 3 * (1 - t) * t ** 2 * P[2][k] + t ** 3 * P[3][k]);
  const neckY = (x) => { let lo = 0, hi = 1; for (let n = 0; n < 30; n++) { const m = (lo + hi) / 2; if (neck(m)[0] < x) lo = m; else hi = m; } return neck(lo)[1]; };
  const boxY = (x) => 88 - (x - 28) * 58 / 56;
  const strings = [];
  for (let i = 0; i < 8; i++) {
    const x = 34 + i * 6;
    strings.push(`<line x1="${f(x)}" y1="${f(neckY(x) + 1.5)}" x2="${f(x)}" y2="${f(boxY(x) - 2)}" stroke-width="0.9"/>`);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="${size}" height="${size}" role="img" aria-label="Harp"><g fill="none" stroke="${color}" stroke-linecap="round" stroke-linejoin="round">
<path d="M28 88 L28 14" stroke-width="4"/>
<path d="M28 14 C 46 8, 58 22, 84 26" stroke-width="3.5"/>
<path d="M28 88 L84 30" stroke-width="5"/>
${strings.join('')}
<circle cx="28" cy="13" r="3.5" fill="${color}"/></g></svg>`;
}

/** an SVG as a data-URI (for <link rel=icon>) */
export const svgDataUri = (svg) => `data:image/svg+xml,${encodeURIComponent(svg)}`;
