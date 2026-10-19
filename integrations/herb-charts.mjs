// herb-charts.mjs — the full set of charts drawn from the Herb and Chemical Atlas datasets.
//
// integrations/herb-atlas.mjs holds the hand-kept allylbenzene series and a short plant set for the
// two wiki figures. THIS file reads the big datasets (knowledge/herb-atlas/plants.json and
// applications.json) and draws the rest: every plant, the enzyme matrix, the dye plants, and the
// share-shaped "informed diagrams".
//
// Operator, 2026-10-19, on the Pinterest/witchy material: "not Cards like You Had Started, Informed
// Diagrams, You can make more Using these Charts we have." So these are not decorated captions over
// generated art — each one is a real diagram built from the dataset, in a shape that shares well.
//
// Canvas comes from the format research in knowledge/herbal-cards/FORMAT_RESEARCH.md: the Pinterest
// standard pin is 1000x1500 (2:3), with the Instagram 4:5 crop-safe band the central y=125..1375.
// Nothing load-bearing goes outside that band.
//
// Everything here is pure: data in, SVG string out. No network, no randomness, no image model.

import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '..', 'knowledge', 'herb-atlas');
const load = (f) => (existsSync(join(DATA, f)) ? JSON.parse(readFileSync(join(DATA, f), 'utf8')) : null);

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const f = (n) => Math.round(n * 100) / 100;

// ── look ─────────────────────────────────────────────────────────────────────────────────────────
// A dark botanical register: ink ground, bone text, gold rules, and the constituent-class colours
// carried over from herb-atlas.mjs so a reader who has seen one chart can read the next.
export const INK = '#171410', BONE = '#efe7d7', GOLD = '#c8a24a';
const SERIF = 'Georgia,"Iowan Old Style","Times New Roman",serif';
const SANS = 'system-ui,-apple-system,"Segoe UI",sans-serif';
const DIM = '#9b9382';

export const CLASS_COLOUR = {
  phenylpropanoid: '#4e9a4e',
  aldehyde: '#b4793a',
  terpene: '#4f8fd4',
  phenol: '#cf5347',
  alkaloid: '#9b6bc0',
  other: '#8d8574',
};

// Which family a named constituent belongs to, for colouring. Prefix/substring rules, longest first.
const FAMILY = [
  [/asarone|safrole|myristicin|elemicin|apiole|dillapiole|estragole|eugenol|anethole|chavicol|chavibetol|croweacin|asaricin|sarisan|allylbenzene|methyl ?eugenol|isoeugenol/i, 'phenylpropanoid'],
  [/aldehyde|cinnamal|citral|vanillin|benzaldehyde|safranal/i, 'aldehyde'],
  [/thymol|carvacrol|eugenol ?acetate|phenol/i, 'phenol'],
  [/piperine|capsaicin|caffeine|nicotine|berberine|gingerol|shogaol|alkaloid|kavain|methysticin|yangonin/i, 'alkaloid'],
  [/pinene|limonene|cineole|terpine|terpino|myrcene|linalool|linalyl|geran|citronell|caryophyll|humulene|sabinene|camphor|thujone|menthol|menthone|carvone|borneol|bisabolol|chamazulene|nerolidol|cymene|ocimene|farnesene|terpene|zingiberene|turmerone|fenchone|pulegone|valeren/i, 'terpene'],
];
export const familyOf = (name) => (FAMILY.find(([re]) => re.test(String(name)))?.[1]) || 'other';

/** "15-35" / "2-7 (variable)" / "trace-1" → a midpoint number, or null when it is not a number at all. */
export function midPct(pct) {
  const s = String(pct == null ? '' : pct).replace(/trace/gi, '0.1');
  const nums = [...s.matchAll(/\d+(?:\.\d+)?/g)].map((m) => Number(m[0]));
  if (!nums.length) return null;
  if (nums.length === 1) return nums[0];
  return (nums[0] + nums[1]) / 2;
}

/** The constituents of a plant record, flattened across chemotypes, de-duped, biggest first. */
export function constituentsOf(plant, limit = 6) {
  const eo = plant?.constituents?.essential_oil || {};
  const out = new Map();
  const push = (c) => {
    if (!c?.compound) return;
    const mid = midPct(c.pct);
    if (!out.has(c.compound) || (mid || 0) > (out.get(c.compound).mid || 0)) {
      out.set(c.compound, { name: c.compound, pct: c.pct, mid, family: familyOf(c.compound) });
    }
  };
  for (const ct of (eo.chemotypes || [])) for (const c of (ct.components || [])) push(c);
  for (const c of (eo.components || [])) push(c);
  return [...out.values()].sort((a, b) => (b.mid || 0) - (a.mid || 0)).slice(0, limit);
}

// ── small svg helpers ────────────────────────────────────────────────────────────────────────────
const text = (x, y, s, { size = 14, weight = 400, anchor = 'start', fill = BONE, font = SANS, ls = 0, op = 1 } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}"${ls ? ` letter-spacing="${ls}"` : ''}${op !== 1 ? ` opacity="${op}"` : ''}>${esc(s)}</text>`;

/** Greedy word wrap at a measured-ish width. Returns the lines. */
export function wrap(s, maxChars) {
  const words = String(s || '').split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    if (cur && (cur + ' ' + w).length > maxChars) { lines.push(cur); cur = w; } else cur = cur ? cur + ' ' + w : w;
  }
  if (cur) lines.push(cur);
  return lines;
}

const para = (x, y, s, { size = 15, lh = 21, maxChars = 58, fill = DIM, font = SANS, anchor = 'start' } = {}) =>
  wrap(s, maxChars).map((l, i) => text(x, y + i * lh, l, { size, fill, font, anchor })).join('');

/** The pin frame: ground, hairline border, title block, and the footer credit. */
function pin({ title, kicker = '', sub = '', body, footer = 'wiki.soapbox.community', h = 1500, w = 1000 }) {
  const titleLines = wrap(title, 22);
  let y = 150;
  let head = '';
  if (kicker) { head += text(w / 2, y, kicker.toUpperCase(), { size: 19, anchor: 'middle', fill: GOLD, ls: 5, font: SANS, weight: 600 }); y += 52; }
  for (const l of titleLines) { head += text(w / 2, y, l, { size: 60, weight: 700, anchor: 'middle', fill: BONE, font: SERIF }); y += 68; }
  if (sub) { y += 4; head += para(w / 2, y, sub, { size: 19, lh: 26, maxChars: 62, anchor: 'middle', fill: DIM }); y += 26 * wrap(sub, 62).length; }
  const top = y + 22;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">`
    + `<rect width="${w}" height="${h}" fill="${INK}"/>`
    + `<rect x="26" y="26" width="${w - 52}" height="${h - 52}" fill="none" stroke="${GOLD}" stroke-width="1.2" opacity="0.5"/>`
    + head
    + `<line x1="${w / 2 - 70}" y1="${f(top - 12)}" x2="${w / 2 + 70}" y2="${f(top - 12)}" stroke="${GOLD}" stroke-width="1.4" opacity="0.8"/>`
    + body(top)
    + text(w / 2, h - 52, footer, { size: 17, anchor: 'middle', fill: GOLD, ls: 2 })
    + '</svg>';
}

// ── 1. one plant, in full ────────────────────────────────────────────────────────────────────────
/** "What is actually in <plant>" — the constituent bars, the enzymes it touches, and the caution. */
export function plantPin(plant) {
  const cs = constituentsOf(plant, 6).filter((c) => c.mid != null);
  const enz = (plant.enzymatic?.whole_plant || []).filter((e) => e.target && e.effect).slice(0, 4);
  const caution = plant.cautions || {};
  // Keep prose to the first couple of sentences — a pin is read at a glance, and the article carries the rest.
  const sentences = (s, n) => String(s || '').replace(/\s+/g, ' ').trim().split(/(?<=\.)\s+/).slice(0, n).join(' ');
  const why = sentences(plant.culinary?.why, 2);
  const cautionText = [sentences(caution.toxicity, 2), caution.pregnancy && `Pregnancy: ${sentences(caution.pregnancy, 1)}`]
    .filter(Boolean).join(' ');
  const L = 70, R = 930, COL = 88; // text column in characters at 16px across the full 860px

  // Measure first, so the sections can be spread down the pin instead of bunching at the top.
  const blocks = [];
  blocks.push({ h: 30 + cs.length * 30 });
  if (why) blocks.push({ h: 28 + wrap(why, COL).length * 23 + 10 });
  if (enz.length) blocks.push({ h: 30 + enz.length * 27 + 8 + wrap('Inhibiting an enzyme raises the level of every drug it clears. Inducing one lowers it.', 100).length * 20 });
  if (cautionText) blocks.push({ h: 28 + wrap(cautionText, COL).length * 23 });

  return pin({
    kicker: (plant.categories || [])[0]?.replace(/_/g, ' ') || 'plant',
    title: plant.common || plant.id,
    sub: plant.latin ? `${plant.latin}${plant.part ? ` · ${plant.part}` : ''}` : '',
    body: (top) => {
      const avail = 1500 - 100 - top;              // down to just above the footer
      const used = blocks.reduce((a, b) => a + b.h, 0);
      const gap = Math.max(26, Math.min(110, (avail - used) / Math.max(1, blocks.length)));
      let y = top + 28, s = '', bi = 0;
      const head = (t) => { s += text(L, y, t, { size: 16, fill: GOLD, ls: 3, weight: 600 }); y += 28; };

      head('WHAT IS IN THE OIL');
      s += text(R, y - 28, '% of the essential oil', { size: 13, fill: DIM, anchor: 'end' });
      const max = Math.max(...cs.map((c) => c.mid), 1);
      for (const c of cs) {
        const bw = (c.mid / max) * 430;
        s += text(L, y + 14, c.name, { size: 17, fill: BONE });
        s += `<rect x="420" y="${f(y + 1)}" width="${f(Math.max(bw, 2))}" height="18" rx="3" fill="${CLASS_COLOUR[c.family]}" opacity="0.92"/>`;
        s += text(R, y + 15, String(c.pct), { size: 15, fill: DIM, anchor: 'end' });
        y += 30;
      }
      y += gap; bi++;

      if (why) {
        head('WHY A KITCHEN USES IT');
        s += para(L, y, why, { size: 16, lh: 23, maxChars: COL, fill: BONE });
        y += wrap(why, COL).length * 23 + gap; bi++;
      }

      if (enz.length) {
        head('ENZYMES IT TOUCHES');
        for (const e of enz) {
          const col = /inhibit/i.test(e.effect) ? '#cf5347' : /induc/i.test(e.effect) ? '#4f8fd4' : '#b4793a';
          const target = String(e.target);
          const detail = `${e.effect}${e.evidence ? ` · ${String(e.evidence).replace(/_/g, ' ')}` : ''}`;
          s += text(L, y, target, { size: 18, fill: col, weight: 700 });
          // A long target name would run under its own detail text, so the detail drops to the next line.
          const targetW = target.length * 10.4;
          if (targetW > 126) { y += 23; s += para(L + 16, y, detail, { size: 15, lh: 20, maxChars: 84 }); y += wrap(detail, 84).length * 20 + 6; }
          else { s += text(L + 140, y, detail, { size: 16, fill: DIM }); y += 27; }
        }
        y += 8;
        const note = 'Inhibiting an enzyme raises the level of every drug it clears. Inducing one lowers it.';
        s += para(L, y, note, { size: 14, lh: 20, maxChars: 100 });
        y += wrap(note, 100).length * 20 + gap; bi++;
      }

      if (cautionText) {
        head('CAUTION');
        s += para(L, y, cautionText, { size: 16, lh: 23, maxChars: COL, fill: BONE });
      }
      return s;
    },
  });
}

// ── 2. the enzyme matrix ─────────────────────────────────────────────────────────────────────────
/** Which kitchen plants touch which drug-metabolising enzyme. One row per plant, one column per enzyme. */
export function enzymeMatrixSvg(plants, { enzymes = ['CYP1A2', 'CYP2C9', 'CYP2C19', 'CYP2D6', 'CYP2E1', 'CYP3A4', 'P-gp', 'MAO-A'], limit = 34 } = {}) {
  const rows = [];
  for (const p of plants) {
    const hits = {};
    for (const e of (p.enzymatic?.whole_plant || [])) {
      const t = String(e.target || '').replace(/\s/g, '');
      const col = enzymes.find((x) => x.replace(/\s/g, '').toLowerCase() === t.toLowerCase());
      if (col) hits[col] = e.effect;
    }
    const mao = p.enzymatic?.mao;
    if (mao && mao.effect && !/none/i.test(mao.effect)) hits['MAO-A'] = mao.effect;
    if (Object.keys(hits).length) rows.push({ name: p.common || p.id, hits });
  }
  rows.sort((a, b) => Object.keys(b.hits).length - Object.keys(a.hits).length);
  const list = rows.slice(0, limit);
  const left = 230, colW = 86, rowH = 30, top = 150;
  const w = left + enzymes.length * colW + 40, h = top + list.length * rowH + 110;
  let body = '';
  enzymes.forEach((e, i) => {
    const x = left + i * colW + colW / 2;
    body += text(x, top - 14, e, { size: 13, anchor: 'middle', fill: GOLD, weight: 700 });
  });
  list.forEach((r, i) => {
    const y = top + i * rowH;
    if (i % 2 === 0) body += `<rect x="20" y="${f(y)}" width="${w - 40}" height="${rowH}" fill="#ffffff" opacity="0.03"/>`;
    body += text(left - 14, y + 20, r.name, { size: 15, anchor: 'end', fill: BONE });
    enzymes.forEach((e, j) => {
      const eff = r.hits[e];
      if (!eff) return;
      const x = left + j * colW + colW / 2;
      const col = /inhibit/i.test(eff) ? '#cf5347' : /induc/i.test(eff) ? '#4f8fd4' : '#b4793a';
      const mark = /inhibit/i.test(eff) ? '−' : /induc/i.test(eff) ? '+' : '~';
      body += `<circle cx="${f(x)}" cy="${f(y + 15)}" r="10" fill="${col}" opacity="0.92"/>`;
      body += text(x, y + 20, mark, { size: 15, anchor: 'middle', fill: '#fff', weight: 700 });
    });
  });
  const ky = top + list.length * rowH + 34;
  const keys = [['#cf5347', '−  inhibits — raises the level of drugs this enzyme clears'], ['#4f8fd4', '+  induces — lowers them'], ['#b4793a', '~  mixed or dose-dependent']];
  keys.forEach(([c, t], i) => {
    body += `<circle cx="34" cy="${f(ky + i * 24 - 4)}" r="8" fill="${c}"/>` + text(50, ky + i * 24, t, { size: 14, fill: DIM });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Which plants touch which drug-metabolising enzyme">`
    + `<rect width="${w}" height="${h}" fill="${INK}"/>`
    + text(w / 2, 48, 'Which plants touch which drug enzyme', { size: 26, anchor: 'middle', fill: BONE, weight: 700, font: SERIF })
    + text(w / 2, 76, 'Evidence grade varies and much of it is in vitro — the full record is in the atlas.', { size: 14, anchor: 'middle', fill: DIM })
    + text(w / 2, 100, 'This is why "natural" and "safe with my medication" are different questions.', { size: 14, anchor: 'middle', fill: GOLD })
    + body + '</svg>';
}

// ── 3. the dye plants ────────────────────────────────────────────────────────────────────────────
const SWATCH = [
  [/indigo|woad|blue/i, '#2a4a7c'], [/madder|alizarin|red|crimson|scarlet/i, '#9d2f2a'],
  [/saffron|yellow|gold/i, '#d4a017'], [/orange|salmon|annatto|bixin/i, '#d2691e'],
  [/brown|walnut|khaki/i, '#6b4a2f'], [/black|logwood|grey/i, '#2b2b2b'],
  [/green|olive/i, '#4a6b35'], [/purple|violet|lilac/i, '#5b3a6e'], [/pink|rose/i, '#b05570'],
];
const swatchFor = (s) => (SWATCH.find(([re]) => re.test(String(s)))?.[1]) || '#8d8574';

/** Dye plants: the colour, the compound that makes it, and the mordant that fixes it. */
export function dyeChartSvg(plants, { limit = 30 } = {}) {
  const list = plants.filter((p) => p.dye?.colour).slice(0, limit);
  const rowH = 44, top = 140, left = 28;
  const w = 1000, h = top + list.length * rowH + 70;
  let body = '';
  list.forEach((p, i) => {
    const y = top + i * rowH;
    body += `<rect x="${left}" y="${f(y)}" width="34" height="30" rx="4" fill="${swatchFor(p.dye.colour)}"/>`;
    body += text(left + 48, y + 14, p.common || p.id, { size: 17, fill: BONE, weight: 600 });
    body += text(left + 48, y + 31, String(p.dye.compound || '').slice(0, 54), { size: 13, fill: DIM });
    body += text(w - 28, y + 14, String(p.dye.colour).slice(0, 52), { size: 14, fill: BONE, anchor: 'end' });
    body += text(w - 28, y + 31, p.dye.mordant ? `mordant: ${String(p.dye.mordant).slice(0, 44)}` : '', { size: 13, fill: DIM, anchor: 'end' });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Dye plants, their colours and mordants">`
    + `<rect width="${w}" height="${h}" fill="${INK}"/>`
    + text(w / 2, 56, 'Dye plants', { size: 30, anchor: 'middle', fill: BONE, weight: 700, font: SERIF })
    + text(w / 2, 86, 'The colour, the compound that makes it, and the mordant that fixes it to the fibre.', { size: 15, anchor: 'middle', fill: DIM })
    + text(w / 2, 110, 'Swatches are indicative. The same plant gives a different colour on a different mordant.', { size: 14, anchor: 'middle', fill: GOLD })
    + body + '</svg>';
}

// ── 4. every plant, by what is in it ─────────────────────────────────────────────────────────────
/** The full constituent chart: every plant that has a measured oil, grouped by category. */
export function allPlantsSvg(plants) {
  const withOil = plants.map((p) => ({ p, cs: constituentsOf(p, 4).filter((c) => c.mid != null) }))
    .filter((x) => x.cs.length);
  const groups = {};
  for (const x of withOil) (groups[(x.p.categories || [])[0] || 'other'] ||= []).push(x);
  const order = Object.entries(groups).sort((a, b) => b[1].length - a[1].length);
  const rowH = 24, labelW = 210, barW = 360, rangeW = 330, left = 16, top = 112;
  const w = left + labelW + barW + rangeW;
  let h = top, body = '';
  for (const [g, items] of order) {
    body += text(left, h + 18, String(g).replace(/_/g, ' ').toUpperCase(), { size: 13, fill: GOLD, ls: 3, weight: 700 });
    h += 30;
    for (const { p, cs } of items.sort((a, b) => String(a.p.common).localeCompare(String(b.p.common)))) {
      body += text(left + labelW - 10, h + 16, (p.common || p.id).slice(0, 30), { size: 12.5, anchor: 'end', fill: BONE });
      let x = left + labelW;
      const total = cs.reduce((s, c) => s + c.mid, 0);
      const scale = barW / Math.max(100, total);
      for (const c of cs) {
        const segW = Math.max(c.mid * scale, 1);
        body += `<rect x="${f(x)}" y="${f(h + 4)}" width="${f(segW)}" height="15" rx="2" fill="${CLASS_COLOUR[c.family]}" opacity="0.9"><title>${esc(`${c.name}: ${c.pct}% of the oil`)}</title></rect>`;
        if (segW > 52) body += text(x + segW / 2, h + 16, c.name.slice(0, 16), { size: 8.5, anchor: 'middle', fill: '#fff' });
        x += segW;
      }
      body += text(left + labelW + barW + 8, h + 16, cs.map((c) => `${c.name} ${c.pct}`).join(' · ').slice(0, 66), { size: 8.5, fill: DIM });
      h += rowH;
    }
    h += 12;
  }
  h += 70;
  let ky = h - 52;
  Object.entries(CLASS_COLOUR).forEach(([k, c], i) => {
    const x = left + (i % 3) * 300, y = ky + Math.floor(i / 3) * 20;
    body += `<rect x="${f(x)}" y="${f(y - 9)}" width="11" height="11" rx="2" fill="${c}"/>` + text(x + 17, y, k.replace(/_/g, ' '), { size: 12, fill: DIM });
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="Every plant, by what is in its oil">`
    + `<rect width="${w}" height="${f(h)}" fill="${INK}"/>`
    + text(w / 2, 44, 'Every plant, by what is in its oil', { size: 26, anchor: 'middle', fill: BONE, weight: 700, font: SERIF })
    + text(w / 2, 70, `${withOil.length} plants. Bars are the midpoint of the published range; the range is printed beside each bar.`, { size: 13, anchor: 'middle', fill: DIM })
    + text(w / 2, 92, 'Share of the ESSENTIAL OIL, not of the plant. Chemotype moves these more than species does.', { size: 13, anchor: 'middle', fill: GOLD })
    + body + '</svg>';
}

// ── the registry ─────────────────────────────────────────────────────────────────────────────────
export function plants() { return load('plants.json')?.plants || []; }

/** Named charts, so a build script or a wiki figure can ask for one by name. */
export const CHARTS = {
  'all-plants': () => allPlantsSvg(plants()),
  'enzyme-matrix': () => enzymeMatrixSvg(plants()),
  'dye-plants': () => dyeChartSvg(plants()),
};

/** The share-shaped diagrams: one per plant that has enough data, plus the standing ones. */
export function pinsFor(ids = []) {
  const all = plants();
  const out = {};
  for (const id of ids) {
    const p = all.find((x) => x.id === id || x.common === id);
    if (p) out[`plant-${p.id}`] = plantPin(p);
  }
  return out;
}
