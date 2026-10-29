// integrations/metals-market.mjs — THE METALS MARKET BOARD, drawn the way a bullion broker lays one out.
//
// WHY THIS IS DRAWN AND NOT GENERATED. Same rule as plant-deficiency-chart.mjs and site/wiki/figures.mjs:
// a price chart is an instrument, not decoration. If the line is in the wrong place the chart is worse
// than no chart, because somebody buys on it. So every panel here is computed from a data constant in
// this file and emitted as plain SVG — deterministic, dependency-free, legible in print, and identical
// on every load. No image model touches a number.
//
// WHAT A BROKER ACTUALLY PUBLISHES (the layout this module reproduces):
//   • a SPOT BOARD      — price, the day's move, year-to-date, and where price sits in its yearly range
//   • a RATIO DIAL      — the gold/silver ratio, the oldest relative-value gauge in the trade
//   • a DRAWDOWN panel  — distance below the 2026 peak, which is the whole story this year
//   • DEMAND donuts     — where the metal physically goes, because that is the supply/demand case
//   • a DEMAND-CHANGE   — what grew and what collapsed, year on year
//   • a LONG HISTORY    — decades on a LOG axis, because gold went 35 -> 4,049 and a linear axis
//                         flattens the first thirty years into a straight line and lies about them
//   • a DECADE table    — computed from the series, not typed in
//
// THE AXIS IS LOGARITHMIC ON PURPOSE. A 115x range cannot be shown linearly without destroying the
// early decades. On a log axis equal vertical distance is equal PERCENTAGE change, which is what a
// holder actually experiences, so the 1970s and the 2020s become comparable instead of one dwarfing
// the other.
//
//   import { marketPageHtml, CHARTS, SPOT, ASOF } from './metals-market.mjs'
//
// House style: ESM .mjs, esc() on all interpolation, pure functions, soft-fail, injectable fetch for
// the optional live reader, CLI guarded by argv[1].

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const f = (n) => Math.round(Number(n) * 100) / 100;
const money = (n, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const pct = (n, d = 2) => `${n > 0 ? '+' : ''}${Number(n).toFixed(d)}%`;

// ── house palette ───────────────────────────────────────────────────────────────────────────────────
// Metal colours are the metals themselves, so a reader never has to consult the legend twice.
const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const INK = '#1d1b17', MUT = '#6b665c', LINE = '#ddd6c8', PAPER = '#f6f4ef', PANEL = '#fffdf8';
const UP = '#1f7a4d', DOWN = '#b4322a';
export const METAL_COLOUR = {
  gold: '#c8a24a', silver: '#8e99a4', platinum: '#5f7f96', palladium: '#9b7fa8', copper: '#b4654a',
};
export const METAL_NAME = {
  gold: 'Gold', silver: 'Silver', platinum: 'Platinum', palladium: 'Palladium', copper: 'Copper',
};

const text = (x, y, s, { size = 12, weight = 400, anchor = 'middle', fill = INK, font = FONT, op = 1 } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}"${op !== 1 ? ` opacity="${op}"` : ''}>${esc(s)}</text>`;

const frame = (w, h, title, subtitle, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">`
  + `<rect width="${w}" height="${h}" fill="${PAPER}"/>`
  + text(w / 2, 26, title, { size: 17, weight: 800 })
  + (subtitle ? text(w / 2, 45, subtitle, { size: 11.5, fill: MUT }) : '')
  + body + '</svg>';

/** A donut/pie segment. Angles in radians, 0 = 12 o'clock, clockwise. rInner 0 gives a true pie. */
export function arcPath(cx, cy, rOuter, rInner, a0, a1) {
  const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const large = (a1 - a0) > Math.PI ? 1 : 0;
  const [x0, y0] = p(rOuter, a0), [x1, y1] = p(rOuter, a1);
  if (rInner <= 0) {
    return `M${f(cx)} ${f(cy)} L${f(x0)} ${f(y0)} A${rOuter} ${rOuter} 0 ${large} 1 ${f(x1)} ${f(y1)} Z`;
  }
  const [x2, y2] = p(rInner, a1), [x3, y3] = p(rInner, a0);
  return `M${f(x0)} ${f(y0)} A${rOuter} ${rOuter} 0 ${large} 1 ${f(x1)} ${f(y1)}`
       + ` L${f(x2)} ${f(y2)} A${rInner} ${rInner} 0 ${large} 0 ${f(x3)} ${f(y3)} Z`;
}

// ── DATA: today's board ─────────────────────────────────────────────────────────────────────────────
// Verified 2026-10-28. Gold and silver (price, day move, YTD, yearly range, peak) come from the USAGOLD
// daily market report of that date and are corroborated to the cent by PAX Gold / Kinesis tokenised
// metal. Platinum, palladium and copper are cross-source consensus readings with no published daily
// move, so they carry approx:true and are printed WITHOUT a fake change column. An approximate number
// labelled approximate is honest; an approximate number dressed as a tick is not.
export const ASOF = '2026-10-28';
export const SPOT = {
  gold: {
    price: 4049.05, unit: 'oz', day: -11.33, dayPct: -0.28,
    ytdAbs: -269.06, ytdPct: -6.23, yearLow: 3942.52, peak: 5598.58, offPeakPct: -27.7,
  },
  silver: {
    price: 53.91, unit: 'oz', day: -0.51, dayPct: -0.94,
    ytdAbs: -17.68, ytdPct: -24.70, yearLow: 52.66, peak: 121.67, offPeakPct: -55.7,
  },
  platinum: { price: 1540, unit: 'oz', approx: true },
  palladium: { price: 1020, unit: 'oz', approx: true },
  copper: { price: 6.65, unit: 'lb', approx: true },
};
/** The gold/silver ratio, and where it started the year. */
export const RATIO = { now: 75.1, yearStart: 60 };

/** Silver demand, 2026 forecast, million ounces. Metals Focus / The Silver Institute. */
export const SILVER_DEMAND = [
  ['Industrial fabrication', 650, 'solar, electronics, brazing, autos, data centres'],
  ['Physical investment', 227, 'coins and bars'],
  ['Jewellery', 178, 'second straight annual fall'],
  ['Silverware', 42, '68% of it is India — the Western table is gone'],
  ['Other', 16, 'hedging and residual'],
];
export const SILVER_BALANCE = { demand: 1112.6, supply: 1066.4, deficit: 46.3, consecutiveDeficits: 6 };

/** Year-on-year change by end use. Negative numbers are the point of the panel. */
export const DEMAND_CHANGE = [
  ['Physical investment', +20, '227 Moz — a three-year high'],
  ['Industrial', -3, '657.4 Moz — still 58% of all silver demand'],
  ['Photovoltaic (solar)', -6, '186.6 Moz — thrifted and substituted, forecast -19% again'],
  ['Jewellery', -9, '178 Moz — lowest since 2020'],
  ['Silverware', -21, '42.1 Moz — volatile and India-led, not a smooth decline'],
];

// ── DATA: 66 years of annual averages ───────────────────────────────────────────────────────────────
// World Bank Commodity Markets "Pink Sheet" monthly series, averaged per calendar year by us.
// Gold / silver / platinum are US$ per troy ounce; copper is US$ per metric tonne.
export const YEAR0 = 1960;
export const ANNUAL = {
  gold: [35.27, 35.25, 35.23, 35.09, 35.1, 35.12, 35.13, 34.95, 38.93, 41.08, 35.94, 40.8, 58.16, 97.33, 159.25, 161.03, 124.82, 147.72, 193.24, 306.67, 607.86, 459.75, 375.8, 422.53, 360.48, 317.91, 367.69, 446.47, 437.05, 381.43, 383.47, 362.18, 343.73, 359.77, 384.01, 384.16, 387.7, 331.1, 294.16, 278.77, 279.03, 270.99, 309.97, 363.51, 409.21, 444.84, 604.34, 696.72, 871.71, 972.97, 1224.66, 1569.21, 1669.52, 1411.46, 1265.58, 1160.66, 1248.99, 1257.56, 1269.23, 1392.5, 1770.25, 1799.63, 1800.6, 1942.67, 2387.7, 3441.51],
  silver: [0.91, 0.92, 1.08, 1.28, 1.29, 1.29, 1.29, 1.55, 2.14, 1.79, 1.77, 1.55, 1.68, 2.56, 4.71, 4.42, 4.36, 4.64, 5.42, 11.1, 20.8, 10.52, 7.93, 11.43, 8.14, 6.12, 5.44, 7.01, 6.53, 5.51, 4.83, 4.05, 3.95, 4.31, 5.28, 5.2, 5.2, 4.91, 5.55, 5.22, 4.95, 4.38, 4.6, 4.88, 6.66, 7.31, 11.56, 13.39, 15.0, 14.64, 20.15, 35.22, 31.14, 23.85, 19.07, 15.72, 17.15, 17.07, 15.71, 16.22, 20.54, 25.16, 21.79, 23.4, 28.27, 39.8],
  platinum: [83.5, 83.5, 83.5, 80.93, 88.48, 98.04, 99.72, 110.25, 117.21, 124.19, 132.5, 123.04, 127.12, 152.18, 184.98, 169.87, 159.65, 158.32, 260.65, 442.8, 679.1, 447.48, 328.29, 423.31, 357.81, 292.5, 465.04, 555.72, 530.34, 509.64, 471.59, 375.82, 359.69, 374.03, 405.26, 424.34, 397.11, 394.91, 372.28, 376.95, 544.63, 529.53, 539.51, 691.71, 845.35, 896.53, 1140.78, 1304.94, 1574.5, 1203.4, 1609.75, 1719.48, 1550.84, 1486.55, 1383.57, 1053.2, 987.09, 948.45, 879.55, 863.99, 883.39, 1091.13, 961.72, 966.36, 955.17, 1278.29],
  copper: [678.76, 633.08, 645.14, 645.95, 969.75, 1292.84, 1531.51, 1134.77, 1241.95, 1467.34, 1415.7, 1081.42, 1057.67, 1785.36, 2058.5, 1234.75, 1400.75, 1308.75, 1364.83, 1985.26, 2182.09, 1741.95, 1480.44, 1591.92, 1377.32, 1417.38, 1373.78, 1782.5, 2601.67, 2848.41, 2661.48, 2338.78, 2281.16, 1913.08, 2307.42, 2935.61, 2294.86, 2276.77, 1654.06, 1572.86, 1813.47, 1578.29, 1559.48, 1779.14, 2865.88, 3678.88, 6722.13, 7118.23, 6955.88, 5149.74, 7534.78, 8828.19, 7962.35, 7332.1, 6863.4, 5510.46, 4867.9, 6169.94, 6529.8, 6010.15, 6173.77, 9317.05, 8822.37, 8490.29, 9142.14, 9947.31],
};
export const years = () => ANNUAL.gold.map((_, i) => YEAR0 + i);

/** Compound and total return of a metal between two calendar years, from the annual series. */
export function changeBetween(metal, from, to) {
  const s = ANNUAL[metal]; if (!s) return null;
  const a = s[from - YEAR0], b = s[to - YEAR0];
  if (!(a > 0) || !(b > 0)) return null;
  const n = to - from;
  return { from, to, a, b, totalPct: (b / a - 1) * 100, cagrPct: (Math.pow(b / a, 1 / n) - 1) * 100 };
}

/** Returns by decade, computed — never typed in. */
export function decades(metal) {
  const out = [];
  for (let y = YEAR0; y <= 2020; y += 10) {
    const end = Math.min(y + 9, YEAR0 + ANNUAL[metal].length - 1);
    const c = changeBetween(metal, y, end);
    if (c) out.push({ label: `${y}s`, ...c });
  }
  return out;
}

// ── PANEL 1: the spot board ─────────────────────────────────────────────────────────────────────────
/**
 * The board a broker puts at the top: what it costs, what it did today, what it has done this year,
 * and a range bar showing where price sits between its yearly low and its yearly high.
 */
export function spotBoardSvg(spot = SPOT, { asof = ASOF } = {}) {
  const order = ['gold', 'silver', 'platinum', 'palladium', 'copper'];
  const W = 860, rowH = 62, top = 96;
  const H = top + order.length * rowH + 28;
  let b = '';
  // column heads
  b += text(26, 78, 'METAL', { anchor: 'start', size: 10, weight: 700, fill: MUT });
  b += text(300, 78, 'SPOT', { anchor: 'end', size: 10, weight: 700, fill: MUT });
  b += text(410, 78, 'TODAY', { anchor: 'end', size: 10, weight: 700, fill: MUT });
  b += text(520, 78, 'YEAR TO DATE', { anchor: 'end', size: 10, weight: 700, fill: MUT });
  b += text(690, 78, 'YEARLY RANGE', { size: 10, weight: 700, fill: MUT });
  b += `<line x1="18" y1="84" x2="${W - 18}" y2="84" stroke="${LINE}"/>`;

  order.forEach((m, i) => {
    const s = spot[m]; if (!s) return;
    const y = top + i * rowH;
    const c = METAL_COLOUR[m];
    b += `<rect x="18" y="${y - 6}" width="${W - 36}" height="${rowH - 8}" rx="6" fill="${PANEL}" stroke="${LINE}"/>`;
    b += `<rect x="18" y="${y - 6}" width="5" height="${rowH - 8}" rx="2.5" fill="${c}"/>`;
    b += text(36, y + 18, METAL_NAME[m], { anchor: 'start', size: 15, weight: 700 });
    b += text(36, y + 34, s.unit === 'lb' ? 'per pound' : 'per troy ounce', { anchor: 'start', size: 10, fill: MUT });
    b += text(300, y + 22, `$${money(s.price, s.price < 100 ? 2 : 2)}`, { anchor: 'end', size: 19, weight: 800, font: MONO });

    if (s.approx) {
      b += text(465, y + 22, 'consensus reading — no published daily move', { anchor: 'middle', size: 10.5, fill: MUT });
    } else {
      const col = s.day >= 0 ? UP : DOWN;
      b += text(410, y + 16, `${s.day >= 0 ? '+' : '\u2212'}$${money(Math.abs(s.day))}`, { anchor: 'end', size: 12.5, weight: 700, fill: col, font: MONO });
      b += text(410, y + 32, pct(s.dayPct), { anchor: 'end', size: 11, fill: col, font: MONO });
      const yc = s.ytdPct >= 0 ? UP : DOWN;
      b += text(520, y + 16, pct(s.ytdPct), { anchor: 'end', size: 12.5, weight: 700, fill: yc, font: MONO });
      b += text(520, y + 32, `${s.ytdAbs >= 0 ? '+' : '\u2212'}$${money(Math.abs(s.ytdAbs))}`, { anchor: 'end', size: 11, fill: yc, font: MONO });
    }

    // range bar: low ---- price ---- peak
    if (s.yearLow && s.peak) {
      const bx = 560, bw = 258, by = y + 22;
      const t = Math.max(0, Math.min(1, (s.price - s.yearLow) / (s.peak - s.yearLow)));
      b += `<line x1="${bx}" y1="${by}" x2="${bx + bw}" y2="${by}" stroke="${LINE}" stroke-width="6" stroke-linecap="round"/>`;
      b += `<line x1="${bx}" y1="${by}" x2="${f(bx + bw * t)}" y2="${by}" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`;
      b += `<circle cx="${f(bx + bw * t)}" cy="${by}" r="5.5" fill="${PANEL}" stroke="${c}" stroke-width="2.5"/>`;
      b += text(bx, by - 11, `$${money(s.yearLow, 0)}`, { anchor: 'start', size: 9.5, fill: MUT, font: MONO });
      b += text(bx + bw, by - 11, `$${money(s.peak, 0)}`, { anchor: 'end', size: 9.5, fill: MUT, font: MONO });
      b += text(bx + bw / 2, by + 19, `${(t * 100).toFixed(0)}% of the way up its own year`, { size: 9.5, fill: MUT });
    } else {
      b += text(689, y + 26, 'range not published', { size: 10, fill: MUT, op: 0.8 });
    }
  });
  return frame(W, H, 'The Metals Board', `spot prices, ${asof} — gold and silver verified to the cent; the rest are consensus readings`, b);
}

// ── PANEL 2: the gold/silver ratio dial ─────────────────────────────────────────────────────────────
/**
 * The oldest gauge in the trade: how many ounces of silver one ounce of gold buys. It is a relative
 * value reading, not a prediction — high means silver is cheap AGAINST GOLD, which is not the same as
 * silver being cheap.
 */
export function ratioDialSvg(r = RATIO) {
  const W = 480, H = 330, cx = W / 2, cy = 250, R = 140;
  const LO = 30, HI = 110;                       // the band the ratio has actually lived in
  // A LEFT-TO-RIGHT semicircular gauge: angle runs from PI (9 o'clock) to 2PI (3 o'clock), so sin() is
  // negative throughout and every point sits ABOVE the pivot. Sweeping -PI/2..+PI/2 instead would put
  // the needle below the pivot and off the canvas, which is exactly what it did.
  const ang = (v) => Math.PI + (Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO) * Math.PI;
  const pt = (v, rr) => [cx + rr * Math.cos(ang(v)), cy + rr * Math.sin(ang(v))];
  let b = '';
  const steps = 60;
  for (let i = 0; i < steps; i += 1) {
    const v0 = LO + (HI - LO) * (i / steps), v1 = LO + (HI - LO) * ((i + 1) / steps);
    const [x0, y0] = pt(v0, R), [x1, y1] = pt(v1, R);
    const mix = i / steps;
    b += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" stroke="${mix < 0.5 ? METAL_COLOUR.gold : METAL_COLOUR.silver}" stroke-width="22" opacity="${f(0.35 + Math.abs(mix - 0.5) * 1.1)}"/>`;
  }
  [30, 50, 70, 90, 110].forEach((v) => {
    const [x0, y0] = pt(v, R - 14), [x1, y1] = pt(v, R + 14);
    b += `<line x1="${f(x0)}" y1="${f(y0)}" x2="${f(x1)}" y2="${f(y1)}" stroke="${INK}" stroke-width="1.5" opacity="0.45"/>`;
    const [tx, ty] = pt(v, R + 26);
    b += text(tx, ty + 4, String(v), { size: 11, fill: MUT, font: MONO });
  });
  // where the ratio started the year, so the MOVE is visible and not just the level
  const [sx, sy] = pt(r.yearStart, R - 30);
  b += `<circle cx="${f(sx)}" cy="${f(sy)}" r="4.5" fill="${PAPER}" stroke="${MUT}" stroke-width="2"/>`;
  b += text(sx, sy - 11, `${r.yearStart} in January`, { size: 9.5, fill: MUT });
  // the needle
  const [nx, ny] = pt(r.now, R - 34);
  b += `<line x1="${cx}" y1="${cy}" x2="${f(nx)}" y2="${f(ny)}" stroke="${INK}" stroke-width="3.5" stroke-linecap="round"/>`;
  b += `<circle cx="${cx}" cy="${cy}" r="8" fill="${INK}"/>`;
  b += text(cx, cy + 42, r.now.toFixed(1), { size: 36, weight: 800, font: MONO });
  b += text(cx, cy + 62, 'ounces of silver per ounce of gold', { size: 11, fill: MUT });
  b += text(cx, 64, `up from about ${r.yearStart} in January — silver has fallen against gold all year`, { size: 11, fill: MUT });
  b += text(cx - R + 4, cy + 20, 'silver dear', { size: 10, fill: MUT });
  b += text(cx + R - 4, cy + 20, 'silver cheap', { size: 10, fill: MUT });
  return frame(W, H, 'The Gold / Silver Ratio', '', b);
}

// ── PANEL 3: drawdown from the 2026 peak ────────────────────────────────────────────────────────────
/** What 2026 actually did: both metals made a top and broke. This is the panel that tells the truth. */
export function drawdownSvg(spot = SPOT) {
  const rows = ['gold', 'silver'].map((m) => ({ m, ...spot[m] })).filter((r) => r.peak);
  const W = 560, H = 108 + rows.length * 92;
  let b = '';
  rows.forEach((r, i) => {
    const y = 118 + i * 92, bx = 150, bw = 370;
    const held = 1 + r.offPeakPct / 100;         // fraction of the peak still standing
    b += text(26, y + 8, METAL_NAME[r.m], { anchor: 'start', size: 15, weight: 700 });
    b += text(26, y + 26, `peak $${money(r.peak, 0)}`, { anchor: 'start', size: 10, fill: MUT, font: MONO });
    b += `<rect x="${bx}" y="${y - 12}" width="${bw}" height="30" rx="4" fill="${PANEL}" stroke="${LINE}"/>`;
    b += `<rect x="${bx}" y="${y - 12}" width="${f(bw * held)}" height="30" rx="4" fill="${METAL_COLOUR[r.m]}"/>`;
    b += text(bx + bw * held / 2, y + 8, `$${money(r.price, 0)}`, { size: 13, weight: 800, fill: '#fff', font: MONO });
    b += text(bx + bw, y + 34, `${r.offPeakPct.toFixed(1)}% below the peak`, { anchor: 'end', size: 11.5, weight: 700, fill: DOWN });
    b += text(bx, y + 34, `still ${(held * 100).toFixed(0)}% of it`, { anchor: 'start', size: 10.5, fill: MUT });
  });
  b += text(W / 2, H - 22, 'Silver made the bigger top and took the bigger fall. That is what silver does.', { size: 11, fill: MUT });
  return frame(W, H, 'How far below this year’s top', `as at ${ASOF}`, b);
}

// ── PANEL 4: where silver physically goes ───────────────────────────────────────────────────────────
/** The donut a broker uses to make the supply/demand case. 2026 forecast, million ounces. */
export function demandDonutSvg(rows = SILVER_DEMAND, { balance = SILVER_BALANCE } = {}) {
  const W = 740, H = 420, cx = 210, cy = 232, R = 132, r0 = 72;
  const total = rows.reduce((a, [, v]) => a + v, 0);
  const cols = [METAL_COLOUR.platinum, METAL_COLOUR.gold, '#a8577a', METAL_COLOUR.silver, MUT];
  let b = '', a0 = 0;
  rows.forEach(([, v], i) => {
    const a1 = a0 + (v / total) * Math.PI * 2;
    b += `<path d="${arcPath(cx, cy, R, r0, a0, a1)}" fill="${cols[i % cols.length]}" stroke="${PAPER}" stroke-width="2"/>`;
    a0 = a1;
  });
  b += text(cx, cy - 4, money(total, 0), { size: 27, weight: 800, font: MONO });
  b += text(cx, cy + 14, 'Moz demanded', { size: 10.5, fill: MUT });
  b += text(cx, cy + 30, '2026 forecast', { size: 9.5, fill: MUT, op: 0.85 });
  // legend
  rows.forEach(([label, v, note], i) => {
    const y = 108 + i * 56;
    b += `<rect x="382" y="${y - 10}" width="13" height="13" rx="3" fill="${cols[i % cols.length]}"/>`;
    b += text(403, y + 1, `${label} — ${money(v, 0)} Moz`, { anchor: 'start', size: 12.5, weight: 700 });
    b += text(403, y + 17, `${(v / total * 100).toFixed(1)}% of demand`, { anchor: 'start', size: 10, fill: MUT, font: MONO });
    if (note) b += text(403, y + 31, note, { anchor: 'start', size: 9.5, fill: MUT });
  });
  b += `<line x1="26" y1="${H - 54}" x2="${W - 26}" y2="${H - 54}" stroke="${LINE}"/>`;
  b += text(W / 2, H - 34, `Demand ${money(balance.demand, 1)} Moz against supply ${money(balance.supply, 1)} Moz — a deficit of ${balance.deficit} Moz,`, { size: 11 });
  b += text(W / 2, H - 18, `the ${balance.consecutiveDeficits}th consecutive annual shortfall. The market has not balanced since 2020.`, { size: 11 });
  return frame(W, H, 'Where Silver Actually Goes', 'Metals Focus / The Silver Institute, 2026 forecast', b);
}

// ── PANEL 5: what grew and what collapsed ───────────────────────────────────────────────────────────
/** The operator's point, as data: the silver table is dead and the solar panel is thrifting. */
export function demandChangeSvg(rows = DEMAND_CHANGE) {
  const W = 700, H = 92 + rows.length * 54 + 44;
  const mid = 320, scale = 11.5;                 // px per percentage point
  let b = `<line x1="${mid}" y1="78" x2="${mid}" y2="${H - 52}" stroke="${LINE}" stroke-width="1.5"/>`;
  rows.forEach(([label, v, note], i) => {
    const y = 104 + i * 54;
    const w = Math.abs(v) * scale;
    const x = v >= 0 ? mid : mid - w;
    const col = v >= 0 ? UP : DOWN;
    b += `<rect x="${f(x)}" y="${y - 13}" width="${f(w)}" height="26" rx="3" fill="${col}" opacity="0.88"/>`;
    b += text(v >= 0 ? mid - 10 : mid + 10, y + 5, label, { anchor: v >= 0 ? 'end' : 'start', size: 12.5, weight: 700 });
    b += text(v >= 0 ? x + w + 8 : x - 8, y + 5, `${v > 0 ? '+' : ''}${v}%`, { anchor: v >= 0 ? 'start' : 'end', size: 12.5, weight: 800, fill: col, font: MONO });
    if (note) b += text(v >= 0 ? mid - 10 : mid + 10, y + 21, note, { anchor: v >= 0 ? 'end' : 'start', size: 9.5, fill: MUT });
  });
  b += text(W / 2, H - 26, 'Investment is the only line growing. Everything people USE silver for is shrinking.', { size: 11.5, weight: 600 });
  return frame(W, H, 'What Grew, What Collapsed', 'year-on-year change in silver demand by end use', b);
}

// ── PANEL 6: 66 years, log axis ─────────────────────────────────────────────────────────────────────
/**
 * The long view. Log axis so the 1970s and the 2020s are comparable; annual averages as lines, and
 * today's spot plotted as a separate marker because it is a reading, not a year.
 */
export function historySvg({ metals = ['gold', 'silver', 'platinum'], spot = SPOT, log = true } = {}) {
  const W = 900, H = 470, L = 66, Rr = 150, T = 72, B = 58;
  const ys = years(), y0 = ys[0], y1 = 2026;
  const all = metals.flatMap((m) => ANNUAL[m]).filter((v) => v > 0);
  const vmin = Math.min(...all), vmax = Math.max(...all, ...metals.map((m) => (spot[m] || {}).price || 0));
  const lo = log ? Math.log10(vmin) : vmin, hi = log ? Math.log10(vmax * 1.15) : vmax * 1.1;
  const X = (y) => L + (y - y0) / (y1 - y0) * (W - L - Rr);
  const Y = (v) => H - B - ((log ? Math.log10(Math.max(v, 1e-6)) : v) - lo) / (hi - lo) * (H - T - B);
  let b = '';
  // gridlines at powers of ten — the only honest gridline on a log axis
  for (let p = Math.floor(lo); p <= Math.ceil(hi); p += 1) {
    const v = Math.pow(10, p); const y = Y(v);
    if (y < T - 2 || y > H - B + 2) continue;
    b += `<line x1="${L}" y1="${f(y)}" x2="${W - Rr}" y2="${f(y)}" stroke="${LINE}" stroke-dasharray="2 4"/>`;
    b += text(L - 8, f(y) + 4, v >= 1 ? `$${money(v, 0)}` : `$${v}`, { anchor: 'end', size: 10, fill: MUT, font: MONO });
  }
  for (let y = 1960; y <= 2020; y += 10) {
    b += `<line x1="${f(X(y))}" y1="${T}" x2="${f(X(y))}" y2="${H - B}" stroke="${LINE}" stroke-dasharray="2 4" opacity="0.7"/>`;
    b += text(X(y), H - B + 18, String(y), { size: 10.5, fill: MUT, font: MONO });
  }
  b += text(X(2026), H - B + 18, '2026', { size: 10.5, fill: MUT, font: MONO });
  b += `<line x1="${L}" y1="${H - B}" x2="${W - Rr}" y2="${H - B}" stroke="${INK}" opacity="0.4"/>`;

  metals.forEach((m) => {
    const s = ANNUAL[m]; if (!s) return;
    const d = s.map((v, i) => `${i ? 'L' : 'M'}${f(X(y0 + i))} ${f(Y(v))}`).join(' ');
    b += `<path d="${d}" fill="none" stroke="${METAL_COLOUR[m]}" stroke-width="2.4" stroke-linejoin="round"/>`;
    const sp = (spot[m] || {}).price;
    if (sp) {
      // dashed hop from the last annual average to today's reading: a different KIND of number
      b += `<path d="M${f(X(2025))} ${f(Y(s[s.length - 1]))} L${f(X(2026))} ${f(Y(sp))}" fill="none" stroke="${METAL_COLOUR[m]}" stroke-width="2" stroke-dasharray="4 3" opacity="0.8"/>`;
      b += `<circle cx="${f(X(2026))}" cy="${f(Y(sp))}" r="4.5" fill="${METAL_COLOUR[m]}" stroke="${PAPER}" stroke-width="1.5"/>`;
      b += text(W - Rr + 12, f(Y(sp)) + 4, `${METAL_NAME[m]}  $${money(sp, 0)}`, { anchor: 'start', size: 11.5, weight: 700, fill: METAL_COLOUR[m], font: MONO });
    }
  });
  b += text(L, 58, 'logarithmic — equal height is equal percentage, so the 1970s and the 2020s compare honestly', { anchor: 'start', size: 10, fill: MUT });
  b += text(W / 2, H - 14, 'Lines are calendar-year averages, World Bank Pink Sheet. The dot is today’s spot.', { size: 10, fill: MUT });
  return frame(W, H, 'Sixty-Six Years', `annual averages ${y0}–2025, with ${ASOF} spot`, b);
}

// ── PANEL 7: the decade table ───────────────────────────────────────────────────────────────────────
/** Decade by decade, computed from the series. Gold and silver side by side. */
export function decadeTableSvg({ metals = ['gold', 'silver', 'platinum', 'copper'] } = {}) {
  const ds = decades('gold');
  const W = 760, H = 104 + ds.length * 40 + 30, colW = 150;
  let b = text(26, 86, 'DECADE', { anchor: 'start', size: 10, weight: 700, fill: MUT });
  metals.forEach((m, i) => b += text(230 + i * colW, 86, METAL_NAME[m].toUpperCase(), { anchor: 'middle', size: 10, weight: 700, fill: METAL_COLOUR[m] }));
  b += `<line x1="18" y1="93" x2="${W - 18}" y2="93" stroke="${LINE}"/>`;
  ds.forEach((d, i) => {
    const y = 120 + i * 40;
    if (i % 2 === 0) b += `<rect x="18" y="${y - 19}" width="${W - 36}" height="38" fill="${PANEL}"/>`;
    b += text(26, y + 5, `${d.label}`, { anchor: 'start', size: 13, weight: 700 });
    b += text(96, y + 5, `${d.from}–${d.to}`, { anchor: 'start', size: 9.5, fill: MUT, font: MONO });
    metals.forEach((m, j) => {
      const c = changeBetween(m, d.from, d.to); if (!c) return;
      const col = c.totalPct >= 0 ? UP : DOWN;
      b += text(230 + j * colW, y, `${c.totalPct >= 0 ? '+' : ''}${c.totalPct.toFixed(0)}%`, { size: 13.5, weight: 800, fill: col, font: MONO });
      b += text(230 + j * colW, y + 14, `${c.cagrPct >= 0 ? '+' : ''}${c.cagrPct.toFixed(1)}%/yr`, { size: 9.5, fill: MUT, font: MONO });
    });
  });
  b += text(W / 2, H - 16, 'Change between the first and last calendar-year average of each decade. The 2020s run to 2025.', { size: 10, fill: MUT });
  return frame(W, H, 'By the Decade', 'total change, and the same change expressed per year', b);
}


// ── DATA: silverware, the long view and the country view ────────────────────────────────────────────
// Source: Metals Focus / The Silver Institute, World Silver Survey — Appendix 10 "Silverware Demand"
// (2024 edition, by country, metric tons) and the demand tables of the 2022 and 2024 editions
// (global, million ounces). The two editions overlap on 2015-2021 and agree within normal revision
// noise (2015: 57.9 vs 58.3; 2020: 32.4 vs 31.2), which is why both are trusted here.
//
// A CORRECTION THIS DATA FORCES. "Nobody buys silverware any more" is true of the WEST and false of
// the WORLD, and the honest chart has to say both. Global silverware demand did not glide downward
// over the last decade — it swung between 31 and 74 Moz on Indian festival and wedding buying. What
// actually collapsed is the Western table: the United States has sat at ~40 tons a year, flat, for a
// decade, which is 2% of world demand. So silverware did not die. It emigrated.
export const TON_TO_MOZ = 32150.7 / 1e6;
export const SILVERWARE_YEARS = [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023];
export const SILVERWARE_TONS = [
  ['India',         [952, 1151, 1061, 1236, 1442, 1282, 541, 758, 1667, 1167]],
  ['Nepal',         [110,  134,  123,  143,  167,  149,   63,  88,  193,  135]],
  ['China',         [188,  122,   98,  105,  107,  103,   77,  85,   72,   65]],
  ['Italy',         [ 88,   86,   78,   71,   68,   63,   39,  53,   54,   56]],
  ['Turkey',        [ 20,   19,   17,   17,   22,   29,   26,  39,   47,   50]],
  ['United States', [ 40,   40,   40,   40,   39,   39,   40,  41,   43,   43]],
  ['Others',        [265,  262,  248,  236,  241,  240,  183, 204,  211,  201]],
];
/** Global silverware demand, Moz. 2013-2023 actual; 2025 is the latest reported figure.
 *  2024 is deliberately omitted: the 2024 survey forecast 58.8 and the outturn was revised, so
 *  plotting a forecast beside actuals would put a number on the chart that nothing confirms. */
export const SILVERWARE_GLOBAL = [
  [2013, 46.5], [2014, 53.6], [2015, 58.3], [2016, 53.5], [2017, 59.4],
  [2018, 67.1], [2019, 61.3], [2020, 31.2], [2021, 40.7], [2022, 73.5], [2023, 55.2],
];
export const SILVERWARE_LATEST = [2025, 42.1];

/** Country share of world silverware demand in a given column index. */
export function silverwareShares(idx = SILVERWARE_YEARS.length - 1) {
  const tot = SILVERWARE_TONS.reduce((a, [, v]) => a + v[idx], 0);
  return SILVERWARE_TONS.map(([name, v]) => ({
    name, tons: v[idx], moz: v[idx] * TON_TO_MOZ, sharePct: v[idx] / tot * 100,
  })).sort((a, b) => b.tons - a.tons);
}

// ── PANEL 8: who actually buys silverware ───────────────────────────────────────────────────────────
/** Stacked bars by country, plus a donut of the latest year. The emigration of the silver table. */
export function silverwareByCountrySvg() {
  const W = 900, H = 548, L = 64, T = 92, B = 138, PW = 470;
  const cols = ['#b4654a', '#c8a24a', '#a8577a', '#5f7f96', '#7f9b6a', '#1d1b17', '#b8b0a0'];
  const totals = SILVERWARE_YEARS.map((_, i) => SILVERWARE_TONS.reduce((a, [, v]) => a + v[i], 0));
  const vmax = Math.max(...totals) * 1.1;
  const bw = (PW - L) / SILVERWARE_YEARS.length;
  const Y = (v) => (H - B) - (v / vmax) * (H - T - B);
  let b = '';
  for (let g = 0; g <= 2500; g += 500) {
    if (g > vmax) break;
    b += `<line x1="${L}" y1="${f(Y(g))}" x2="${PW}" y2="${f(Y(g))}" stroke="${LINE}" stroke-dasharray="2 4"/>`;
    b += text(L - 8, f(Y(g)) + 4, money(g, 0), { anchor: 'end', size: 9.5, fill: MUT, font: MONO });
  }
  SILVERWARE_YEARS.forEach((yr, i) => {
    let acc = 0;
    SILVERWARE_TONS.forEach(([, v], j) => {
      const h = Y(acc) - Y(acc + v[i]);
      b += `<rect x="${f(L + i * bw + 3)}" y="${f(Y(acc + v[i]))}" width="${f(bw - 6)}" height="${f(Math.max(h, 0))}" fill="${cols[j]}"/>`;
      acc += v[i];
    });
    b += text(L + i * bw + bw / 2, H - B + 16, String(yr).slice(2), { size: 9.5, fill: MUT, font: MONO });
  });
  b += text(L - 46, T - 14, 'metric tons', { anchor: 'start', size: 9.5, fill: MUT });
  // donut of the latest year
  const sh = silverwareShares();
  const cx = 700, cy = 250, R = 104, r0 = 58;
  const byName = Object.fromEntries(SILVERWARE_TONS.map(([n], j) => [n, cols[j]]));
  let a0 = 0; const tot = sh.reduce((a, r) => a + r.tons, 0);
  sh.forEach((r) => {
    const a1 = a0 + (r.tons / tot) * Math.PI * 2;
    b += `<path d="${arcPath(cx, cy, R, r0, a0, a1)}" fill="${byName[r.name]}" stroke="${PAPER}" stroke-width="2"/>`;
    a0 = a1;
  });
  b += text(cx, cy - 2, `${sh[0].sharePct.toFixed(0)}%`, { size: 30, weight: 800, font: MONO });
  b += text(cx, cy + 17, sh[0].name, { size: 12, weight: 700 });
  b += text(cx, cy + 32, '2023', { size: 9.5, fill: MUT });
  // legend
  SILVERWARE_TONS.forEach(([name], j) => {
    const y = H - 86 + Math.floor(j / 4) * 20, x = 70 + (j % 4) * 200;
    b += `<rect x="${x}" y="${y - 9}" width="11" height="11" rx="2.5" fill="${cols[j]}"/>`;
    const row = sh.find((r) => r.name === name);
    b += text(x + 17, y + 1, `${name} ${row.sharePct.toFixed(1)}%`, { anchor: 'start', size: 10.5 });
  });
  const us = sh.find((r) => r.name === 'United States');
  b += text(W / 2, H - 22, `The United States bought ${us.tons} tons in 2023 — ${us.sharePct.toFixed(1)}% of the world, and flat for ten years.`, { size: 11.5, weight: 600 });
  return frame(W, H, 'Who Buys Silverware', 'Metals Focus / World Silver Survey 2024, Appendix 10 — silverware demand by country, metric tons', b);
}

// ── PANEL 9: global silverware demand, the decade ───────────────────────────────────────────────────
/** The global line, drawn honestly: it is volatile, not a glide path. */
export function silverwareGlobalSvg() {
  const W = 760, H = 360, L = 62, T = 86, B = 70;
  const pts = SILVERWARE_GLOBAL, y0 = pts[0][0], y1 = SILVERWARE_LATEST[0];
  const vmax = Math.max(...pts.map(([, v]) => v), SILVERWARE_LATEST[1]) * 1.18;
  const X = (y) => L + (y - y0) / (y1 - y0) * (W - L - 40);
  const Y = (v) => (H - B) - (v / vmax) * (H - T - B);
  let b = '';
  for (let g = 0; g <= 80; g += 20) {
    b += `<line x1="${L}" y1="${f(Y(g))}" x2="${W - 40}" y2="${f(Y(g))}" stroke="${LINE}" stroke-dasharray="2 4"/>`;
    b += text(L - 8, f(Y(g)) + 4, String(g), { anchor: 'end', size: 9.5, fill: MUT, font: MONO });
  }
  const d = pts.map(([y, v], i) => `${i ? 'L' : 'M'}${f(X(y))} ${f(Y(v))}`).join(' ');
  b += `<path d="${d}" fill="none" stroke="${METAL_COLOUR.silver}" stroke-width="2.8" stroke-linejoin="round"/>`;
  pts.forEach(([y, v]) => {
    b += `<circle cx="${f(X(y))}" cy="${f(Y(v))}" r="3.6" fill="${METAL_COLOUR.silver}"/>`;
    b += text(X(y), H - B + 17, String(y).slice(2), { size: 9.5, fill: MUT, font: MONO });
  });
  // COVID and the Indian spike are the two features a reader must not misread
  const c20 = pts.find(([y]) => y === 2020), c22 = pts.find(([y]) => y === 2022);
  b += text(X(2020), Y(c20[1]) + 20, 'COVID', { size: 9.5, fill: MUT });
  b += text(X(2022), Y(c22[1]) - 12, 'Indian restocking', { size: 9.5, fill: MUT });
  // latest reported, plotted apart because it comes from a later edition
  const [ly, lv] = SILVERWARE_LATEST;
  b += `<path d="M${f(X(2023))} ${f(Y(pts[pts.length - 1][1]))} L${f(X(ly))} ${f(Y(lv))}" fill="none" stroke="${METAL_COLOUR.silver}" stroke-width="2.2" stroke-dasharray="5 4" opacity="0.75"/>`;
  b += `<circle cx="${f(X(ly))}" cy="${f(Y(lv))}" r="5" fill="${PAPER}" stroke="${METAL_COLOUR.silver}" stroke-width="2.5"/>`;
  b += text(X(ly), Y(lv) - 14, `${lv} Moz`, { size: 11, weight: 700, font: MONO });
  b += text(X(ly), H - B + 17, String(ly).slice(2), { size: 9.5, fill: MUT, font: MONO });
  b += text(L, T - 20, 'million ounces', { anchor: 'start', size: 9.5, fill: MUT });
  b += text(W / 2, H - 38, 'Not a glide path. Global silverware swings on Indian weddings and festivals —', { size: 11 });
  b += text(W / 2, H - 22, 'the secular collapse is in the West, which this global line hides.', { size: 11 });
  return frame(W, H, 'Global Silverware Demand', '2013–2023 actual; 2025 is the latest reported figure. 2024 omitted — forecast and outturn disagree', b);
}


// ── DATA: 150 years ────────────────────────────────────────────────────────────────────────────────
// MeasuringWorth: New York market gold price and the gold/silver ratio, annual, 1876-2025. Silver is
// DERIVED as gold / ratio — MeasuringWorth publishes the ratio rather than a silver price, and that is
// exactly how a silver price is recovered from it.
//
// WHY A SECOND SOURCE AT ALL. The World Bank series above starts in 1960, so it cannot show the gold
// standard, and the whole point of a 150-year view is the part before the metal floated. The two
// sources overlap for 66 years and agree: 2025 gold 3,450 here against 3,441.51 at the World Bank,
// 2024 derived silver 28.48 against 28.27. Independent agreement on the overlap is the reason the
// pre-1960 half is trusted at all.
export const Y150 = [1876, 1877, 1878, 1879, 1880, 1881, 1882, 1883, 1884, 1885, 1886, 1887, 1888, 1889, 1890, 1891, 1892, 1893, 1894, 1895, 1896, 1897, 1898, 1899, 1900, 1901, 1902, 1903, 1904, 1905, 1906, 1907, 1908, 1909, 1910, 1911, 1912, 1913, 1914, 1915, 1916, 1917, 1918, 1919, 1920, 1921, 1922, 1923, 1924, 1925, 1926, 1927, 1928, 1929, 1930, 1931, 1932, 1933, 1934, 1935, 1936, 1937, 1938, 1939, 1940, 1941, 1942, 1943, 1944, 1945, 1946, 1947, 1948, 1949, 1950, 1951, 1952, 1953, 1954, 1955, 1956, 1957, 1958, 1959, 1960, 1961, 1962, 1963, 1964, 1965, 1966, 1967, 1968, 1969, 1970, 1971, 1972, 1973, 1974, 1975, 1976, 1977, 1978, 1979, 1980, 1981, 1982, 1983, 1984, 1985, 1986, 1987, 1988, 1989, 1990, 1991, 1992, 1993, 1994, 1995, 1996, 1997, 1998, 1999, 2000, 2001, 2002, 2003, 2004, 2005, 2006, 2007, 2008, 2009, 2010, 2011, 2012, 2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
export const GOLD150 = [23.05, 21.66, 20.84, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 20.67, 24.44, 34.94, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 35.0, 39.26, 41.51, 36.41, 41.25, 58.6, 97.81, 159.74, 161.49, 125.32, 148.31, 193.55, 307.5, 612.56, 459.64, 375.91, 424.0, 360.66, 317.66, 368.24, 447.95, 438.31, 382.58, 384.93, 363.29, 344.97, 360.91, 385.42, 385.5, 389.09, 332.39, 295.24, 279.91, 280.1, 272.22, 311.33, 364.8, 410.52, 446.0, 606.0, 699.0, 874.0, 975.0, 1227.0, 1572.0, 1700.0, 1415.0, 1269.0, 1163.0, 1252.0, 1260.0, 1270.0, 1390.0, 1770.0, 1800.0, 1800.0, 1940.0, 2410.0, 3450.0];
export const RATIO150 = [17.75, 17.2, 17.92, 18.39, 18.05, 18.25, 18.2, 18.64, 18.61, 19.41, 20.78, 21.1, 22.0, 22.1, 19.75, 20.92, 23.72, 26.49, 32.56, 31.6, 30.59, 34.2, 35.03, 34.36, 33.33, 34.68, 39.15, 38.1, 35.7, 33.87, 30.54, 31.24, 38.64, 39.74, 38.22, 38.33, 33.62, 34.19, 37.37, 40.48, 30.78, 24.61, 21.0, 18.44, 20.28, 32.76, 30.43, 31.69, 30.8, 29.78, 33.11, 36.47, 35.34, 38.78, 53.74, 71.25, 73.29, 69.83, 72.36, 54.19, 77.09, 77.44, 80.39, 88.84, 99.76, 99.73, 90.57, 77.67, 77.67, 67.4, 43.67, 48.73, 47.07, 48.61, 47.14, 39.12, 41.16, 41.04, 41.01, 39.24, 38.5, 38.5, 39.27, 38.34, 38.27, 37.82, 32.22, 27.34, 27.04, 27.04, 27.04, 22.56, 18.29, 23.16, 20.54, 26.66, 34.75, 38.21, 33.9, 36.51, 28.76, 32.05, 35.8, 27.69, 29.66, 43.65, 47.24, 37.03, 44.26, 51.68, 67.25, 63.84, 66.95, 69.49, 79.78, 89.83, 87.47, 83.85, 72.79, 74.78, 74.89, 67.91, 53.24, 53.26, 55.96, 61.95, 67.32, 74.22, 61.3, 60.7, 52.2, 51.91, 58.17, 66.27, 60.64, 44.75, 53.58, 59.31, 66.38, 73.98, 72.96, 73.76, 80.77, 85.97, 86.3, 71.58, 82.93, 80.25, 84.62, 85.95];
export const SILVER150 = [1.2986, 1.2593, 1.1629, 1.124, 1.1452, 1.1326, 1.1357, 1.1089, 1.1107, 1.0649, 0.9947, 0.9796, 0.9395, 0.9353, 1.0466, 0.988, 0.8714, 0.7803, 0.6348, 0.6541, 0.6757, 0.6044, 0.5901, 0.6016, 0.6202, 0.596, 0.528, 0.5425, 0.579, 0.6103, 0.6768, 0.6617, 0.5349, 0.5201, 0.5408, 0.5393, 0.6148, 0.6046, 0.5531, 0.5106, 0.6715, 0.8399, 0.9843, 1.1209, 1.0192, 0.631, 0.6793, 0.6523, 0.6711, 0.6941, 0.6243, 0.5668, 0.5849, 0.533, 0.3846, 0.2901, 0.282, 0.35, 0.4829, 0.6459, 0.454, 0.452, 0.4354, 0.394, 0.3508, 0.3509, 0.3864, 0.4506, 0.4506, 0.5193, 0.8015, 0.7182, 0.7436, 0.72, 0.7425, 0.8947, 0.8503, 0.8528, 0.8535, 0.8919, 0.9091, 0.9091, 0.8913, 0.9129, 0.9146, 0.9254, 1.0863, 1.2802, 1.2944, 1.2944, 1.2944, 1.5514, 2.1465, 1.7923, 1.7726, 1.5473, 1.6863, 2.5598, 4.7121, 4.4232, 4.3574, 4.6275, 5.4064, 11.1051, 20.6527, 10.5301, 7.9575, 11.4502, 8.1487, 6.1467, 5.4757, 7.0168, 6.5468, 5.5055, 4.8249, 4.0442, 3.9439, 4.3042, 5.295, 5.1551, 5.1955, 4.8946, 5.5455, 5.2555, 5.0054, 4.3942, 4.6246, 4.9151, 6.6969, 7.3476, 11.6092, 13.4656, 15.0249, 14.7125, 20.2342, 35.1285, 31.7283, 23.8577, 19.1172, 15.7205, 17.1601, 17.0824, 15.7237, 16.1684, 20.5098, 25.1467, 21.7051, 24.1745, 28.4803, 40.1396];

/** The monetary eras the chart annotates. Gold was a PRICE FIXED BY LAW for most of this span. */
export const ERAS = [
  { from: 1876, to: 1932, label: 'classical gold standard', note: '$20.67 fixed' },
  { from: 1934, to: 1967, label: 'Bretton Woods', note: '$35 fixed' },
  { from: 1971, to: 2025, label: 'floating', note: 'Nixon closes the gold window' },
];

// ── PANEL 10: 150 years ────────────────────────────────────────────────────────────────────────────
/**
 * The long view, and the only one that shows what a FIXED price looks like. Two flat shelves —
 * $20.67 and $35 — are not a quiet market; they are a legal price. Everything after 1971 is a market.
 */
export function history150Svg() {
  const W = 940, H = 500, L = 68, R = 150, T = 96, B = 62;
  const y0 = Y150[0], y1 = 2026;
  const sp = { gold: SPOT.gold.price, silver: SPOT.silver.price };
  const all = [...GOLD150, ...SILVER150, sp.gold, sp.silver].filter((v) => v > 0);
  const lo = Math.log10(Math.min(...all)), hi = Math.log10(Math.max(...all) * 1.3);
  const X = (y) => L + (y - y0) / (y1 - y0) * (W - L - R);
  const Y = (v) => H - B - (Math.log10(Math.max(v, 1e-6)) - lo) / (hi - lo) * (H - T - B);
  let b = '';
  for (let p = Math.floor(lo); p <= Math.ceil(hi); p += 1) {
    const v = Math.pow(10, p); const y = Y(v);
    if (y < T - 2 || y > H - B + 2) continue;
    b += `<line x1="${L}" y1="${f(y)}" x2="${W - R}" y2="${f(y)}" stroke="${LINE}" stroke-dasharray="2 4"/>`;
    b += text(L - 8, f(y) + 4, v >= 1 ? `$${money(v, 0)}` : `$${v}`, { anchor: 'end', size: 10, fill: MUT, font: MONO });
  }
  // era bands, because a fixed price is not a market and the chart must say so
  ERAS.forEach((e, i) => {
    const x0 = X(e.from), x1 = X(Math.min(e.to, 2025));
    if (i < 2) b += `<rect x="${f(x0)}" y="${T}" width="${f(x1 - x0)}" height="${H - T - B}" fill="${INK}" opacity="0.035"/>`;
    b += text((x0 + x1) / 2, T - 24, e.label, { size: 10.5, weight: 700, fill: MUT });
    b += text((x0 + x1) / 2, T - 11, e.note, { size: 9.5, fill: MUT, op: 0.9 });
    if (i) b += `<line x1="${f(x0)}" y1="${T - 6}" x2="${f(x0)}" y2="${H - B}" stroke="${INK}" stroke-width="1" opacity="0.28" stroke-dasharray="3 3"/>`;
  });
  for (let y = 1880; y <= 2020; y += 20) {
    b += text(X(y), H - B + 18, String(y), { size: 10.5, fill: MUT, font: MONO });
  }
  b += text(X(2026), H - B + 18, '2026', { size: 10.5, fill: MUT, font: MONO });
  b += `<line x1="${L}" y1="${H - B}" x2="${W - R}" y2="${H - B}" stroke="${INK}" opacity="0.4"/>`;
  [['gold', GOLD150], ['silver', SILVER150]].forEach(([m, series]) => {
    const d = series.map((v, i) => `${i ? 'L' : 'M'}${f(X(Y150[i]))} ${f(Y(v))}`).join(' ');
    b += `<path d="${d}" fill="none" stroke="${METAL_COLOUR[m]}" stroke-width="2.2" stroke-linejoin="round"/>`;
    const last = series[series.length - 1];
    b += `<path d="M${f(X(2025))} ${f(Y(last))} L${f(X(2026))} ${f(Y(sp[m]))}" fill="none" stroke="${METAL_COLOUR[m]}" stroke-width="2" stroke-dasharray="4 3" opacity="0.8"/>`;
    b += `<circle cx="${f(X(2026))}" cy="${f(Y(sp[m]))}" r="4.5" fill="${METAL_COLOUR[m]}" stroke="${PAPER}" stroke-width="1.5"/>`;
    b += text(W - R + 12, f(Y(sp[m])) + 4, `${METAL_NAME[m]}  $${money(sp[m], 0)}`, { anchor: 'start', size: 11.5, weight: 700, fill: METAL_COLOUR[m], font: MONO });
  });
  b += text(W / 2, H - 14, 'Gold: New York market price. Silver: derived from the published gold/silver ratio. Logarithmic.', { size: 10, fill: MUT });
  return frame(W, H, 'One Hundred and Fifty Years', `${y0}\u20132026 \u2014 two flat shelves are a price fixed by law, not a quiet market`, b);
}

/** The ratio across the same span: 17.75 in 1876, 85.95 in 2025. That is a demonetisation. */
export function ratio150Svg() {
  const W = 940, H = 360, L = 60, R = 40, T = 84, B = 58;
  const y0 = Y150[0], y1 = 2026;
  const vmax = Math.max(...RATIO150, RATIO.now) * 1.12;
  const X = (y) => L + (y - y0) / (y1 - y0) * (W - L - R);
  const Y = (v) => H - B - (v / vmax) * (H - T - B);
  let b = '';
  for (let g = 0; g <= 100; g += 20) {
    b += `<line x1="${L}" y1="${f(Y(g))}" x2="${W - R}" y2="${f(Y(g))}" stroke="${LINE}" stroke-dasharray="2 4"/>`;
    b += text(L - 8, f(Y(g)) + 4, String(g), { anchor: 'end', size: 10, fill: MUT, font: MONO });
  }
  const d = RATIO150.map((v, i) => `${i ? 'L' : 'M'}${f(X(Y150[i]))} ${f(Y(v))}`).join(' ');
  b += `<path d="${d}" fill="none" stroke="${METAL_COLOUR.silver}" stroke-width="2.2" stroke-linejoin="round"/>`;
  b += `<path d="M${f(X(2025))} ${f(Y(RATIO150[RATIO150.length - 1]))} L${f(X(2026))} ${f(Y(RATIO.now))}" fill="none" stroke="${METAL_COLOUR.silver}" stroke-width="2" stroke-dasharray="4 3"/>`;
  b += `<circle cx="${f(X(2026))}" cy="${f(Y(RATIO.now))}" r="4.5" fill="${METAL_COLOUR.silver}"/>`;
  // the bimetallic anchor: ~15:1 was written into coinage law
  b += `<line x1="${L}" y1="${f(Y(15))}" x2="${W - R}" y2="${f(Y(15))}" stroke="${METAL_COLOUR.gold}" stroke-width="1.5" stroke-dasharray="6 4"/>`;
  b += text(W - R - 6, f(Y(15)) - 7, '15:1 \u2014 the old bimetallic coinage ratio', { anchor: 'end', size: 10, fill: METAL_COLOUR.gold });
  for (let y = 1880; y <= 2020; y += 20) b += text(X(y), H - B + 18, String(y), { size: 10.5, fill: MUT, font: MONO });
  b += text(X(2026), H - B + 18, '2026', { size: 10.5, fill: MUT, font: MONO });
  b += text(L, T - 18, 'ounces of silver per ounce of gold', { anchor: 'start', size: 10, fill: MUT });
  b += text(W / 2, H - 16, 'Silver left the monetary system and never came back. The ratio is the record of it.', { size: 11, weight: 600 });
  return frame(W, H, 'The Ratio, 1876\u20132026', 'from 17.75 to 85.95 \u2014 silver demonetised', b);
}

// ── the registry + the assembled page ───────────────────────────────────────────────────────────────
export const CHARTS = {
  'metals-board': () => spotBoardSvg(),
  'gold-silver-ratio': () => ratioDialSvg(),
  'metals-drawdown': () => drawdownSvg(),
  'silver-demand': () => demandDonutSvg(),
  'silver-demand-change': () => demandChangeSvg(),
  'metals-history': () => historySvg(),
  'metals-decades': () => decadeTableSvg(),
  'silverware-countries': () => silverwareByCountrySvg(),
  'silverware-global': () => silverwareGlobalSvg(),
  'metals-150y': () => history150Svg(),
  'ratio-150y': () => ratio150Svg(),
};
export const hasChart = (n) => Object.prototype.hasOwnProperty.call(CHARTS, String(n || '').toLowerCase());
export function chartSvg(name) {
  const k = String(name || '').toLowerCase();
  return hasChart(k) ? CHARTS[k]() : '';
}

/** Every panel, in broker reading order, as one HTML fragment. */
export function marketPageHtml({ asof = ASOF } = {}) {
  const order = ['metals-board', 'gold-silver-ratio', 'metals-drawdown', 'silver-demand', 'silver-demand-change', 'silverware-global', 'silverware-countries', 'metals-history', 'metals-150y', 'ratio-150y', 'metals-decades'];
  return `<div class="metals-market" data-asof="${esc(asof)}">`
    + order.map((n) => `<figure class="metals-panel">${chartSvg(n)}</figure>`).join('')
    + '</div>';
}

export const MARKET_CSS = `.metals-market{display:flex;flex-direction:column;gap:1.4rem;align-items:center}
.metals-panel{margin:0;max-width:100%}
.metals-panel svg{max-width:100%;height:auto;border:1px solid ${LINE};border-radius:8px;display:block}`;

// ── optional live reader ────────────────────────────────────────────────────────────────────────────
// The operator's standing note is that nobody needs an API to write about gold. Correct — every panel
// above draws from the constants and needs no network at all. This is here only because tokenised
// metal gives a keyless cross-check: PAXG and XAUT are each one troy ounce of gold, KAG one troy ounce
// of silver, and on 2026-10-28 KAG printed $53.91 against the broker's $53.91. Soft-fails to null.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }
export const PROXY = { gold: ['pax-gold', 'tether-gold'], silver: ['kinesis-silver'] };

export async function fetchSpot({ url = 'https://api.coingecko.com/api/v3/simple/price' } = {}) {
  const ids = [...PROXY.gold, ...PROXY.silver].join(',');
  try {
    const r = await _fetch(`${url}?ids=${ids}&vs_currencies=usd`);
    const j = await r.json();
    const pick = (list) => {
      const vals = list.map((id) => Number((j[id] || {}).usd)).filter((v) => v > 0);
      return vals.length ? vals.reduce((a, v) => a + v, 0) / vals.length : null;
    };
    const gold = pick(PROXY.gold), silver = pick(PROXY.silver);
    if (gold == null && silver == null) return null;
    return { asof: new Date().toISOString().slice(0, 10), gold, silver, source: 'tokenised metal (CoinGecko)' };
  } catch { return null; }
}

// ── CLI (guarded) ───────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && /metals-market\.mjs$/.test(process.argv[1])) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const out = process.argv[2] || './metals-out';
  mkdirSync(out, { recursive: true });
  for (const n of Object.keys(CHARTS)) {
    writeFileSync(`${out}/${n}.svg`, chartSvg(n));
    console.log(`${out}/${n}.svg  ${chartSvg(n).length} bytes`);
  }
  writeFileSync(`${out}/index.html`,
    `<!doctype html><meta charset=utf-8><title>MELEK Metals Board</title><style>body{background:${PAPER};font-family:${FONT};margin:0;padding:2rem}${MARKET_CSS}</style>${marketPageHtml()}`);
  console.log(`${out}/index.html`);
  console.log(`\ngold/silver ratio check: ${(SPOT.gold.price / SPOT.silver.price).toFixed(2)} (board says ${RATIO.now})`);
}
