// kula-diagrams.mjs — figures for the KULA systems post.
//
// Two of these are DIAGRAMS, not charts: a no-loss lottery and a commit-reveal draw are mechanisms,
// and a mechanism is explained by showing what moves where, not by plotting it. The third is a real
// before/after comparison and is a chart.
//
// Colour is the validated categorical palette from metals-explainer.mjs — same reasons, same checks.

import { HUE, onColour, wrap } from './metals-explainer.mjs';

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const f = (n) => Math.round(Number(n) * 100) / 100;
const money = (n, d = 2) => Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

const FONT = 'system-ui,-apple-system,Segoe UI,sans-serif';
const MONO = 'ui-monospace,SFMono-Regular,Menlo,monospace';
const INK = '#1d1b17', MUT = '#6b665c', LINE = '#ddd6c8', PAPER = '#f6f4ef', PANEL = '#fffdf8';
const GOOD = '#0ca30c';

const text = (x, y, s, { size = 12, weight = 400, anchor = 'middle', fill = INK, font = FONT } = {}) =>
  `<text x="${f(x)}" y="${f(y)}" text-anchor="${anchor}" font-family="${font}" font-size="${size}" font-weight="${weight}" fill="${fill}">${esc(s)}</text>`;

const frame = (w, h, title, subtitle, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${esc(title)}">`
  + `<rect width="${w}" height="${h}" fill="${PAPER}"/>`
  + text(w / 2, 28, title, { size: 18, weight: 800 })
  + (subtitle ? text(w / 2, 48, subtitle, { size: 11.5, fill: MUT }) : '')
  + body + '</svg>';

const arrow = (x0, y0, x1, y1, col = MUT, dash = '') =>
  `<path d="M${f(x0)} ${f(y0)} L${f(x1)} ${f(y1)}" stroke="${col}" stroke-width="2"${dash ? ` stroke-dasharray="${dash}"` : ''}/>`
  + `<path d="M${f(x1 - 6)} ${f(y1 - 5)} L${f(x1)} ${f(y1)} L${f(x1 - 6)} ${f(y1 + 5)}" fill="none" stroke="${col}" stroke-width="2"/>`;

/** Live pool reserves, read from PRANA mainnet 2026-10-29. */
export const POOLS = [
  { pair: 'KULA / WPRANA', beforeA: 8828.74, afterA: 16616.44, beforeB: 5668.39, afterB: 10668.39, a: 'KULA', b: 'WPRANA' },
  { pair: 'KULA / wVKBT', beforeA: 1002.90, afterA: 1089.73, beforeB: 17555.71, afterB: 19075.71, a: 'KULA', b: 'wVKBT' },
  { pair: 'wCURE / KULA', beforeA: 393.43, afterA: 483.43, beforeB: 922.10, afterB: 1133.04, a: 'wCURE', b: 'KULA' },
];

// ── PANEL 1: pool depth, before and after ──────────────────────────────────────────────────────────
/** Paired bars. The point is depth, so the bars are the KULA side of each pool, before against after. */
export function poolDepthSvg(pools = POOLS) {
  const W = 900, H = 400, L = 150, R = 60, T = 92, B = 86;
  const vmax = Math.max(...pools.map((p) => p.afterA)) * 1.16;
  const rowH = (H - T - B) / pools.length;
  const X = (v) => L + (v / vmax) * (W - L - R);
  let b = '';
  pools.forEach((p, i) => {
    const y = T + i * rowH + 14;
    b += text(L - 14, y + 22, p.pair, { anchor: 'end', size: 13, weight: 700 });
    // before — recessive
    b += `<rect x="${L}" y="${y}" width="${f(X(p.beforeA) - L)}" height="18" rx="4" fill="${MUT}" opacity="0.3"/>`;
    b += text(X(p.beforeA) + 8, y + 14, money(p.beforeA, 0), { anchor: 'start', size: 10.5, fill: MUT, font: MONO });
    // after — the headline
    b += `<rect x="${L}" y="${y + 24}" width="${f(X(p.afterA) - L)}" height="18" rx="4" fill="${HUE.silver}"/>`;
    b += text(X(p.afterA) + 8, y + 38, money(p.afterA, 0), { anchor: 'start', size: 11.5, weight: 700, fill: HUE.silver, font: MONO });
  });
  // legend — two series, so a legend is always present
  b += `<rect x="${L}" y="${T - 30}" width="13" height="13" rx="3" fill="${MUT}" opacity="0.3"/>`;
  b += text(L + 19, T - 19, 'before', { anchor: 'start', size: 11, fill: MUT });
  b += `<rect x="${L + 78}" y="${T - 30}" width="13" height="13" rx="3" fill="${HUE.silver}"/>`;
  b += text(L + 97, T - 19, 'after', { anchor: 'start', size: 11, weight: 600 });
  b += text(W / 2, 68, 'KULA side of each pool, in KULA', { size: 11.5, fill: MUT });
  b += `<line x1="${L}" y1="${H - B + 6}" x2="${W - R}" y2="${H - B + 6}" stroke="${LINE}"/>`;
  b += text(W / 2, H - 46, 'Each amount was priced from the pool’s own reserves, so none of these adds moved a price.', { size: 11.5, weight: 600 });
  b += text(W / 2, H - 26, 'Re-pricing a live pool on the way in just hands the difference to an arbitrageur.', { size: 11, fill: MUT });
  return frame(W, H, 'Pool Depth, Before and After', 'a pool with no depth is not a market — every trade moves it, so nobody trades', b);
}

// ── PANEL 2: how a no-loss lottery works ───────────────────────────────────────────────────────────
/** The mechanism. The deposit never leaves the depositor; only the yield is at stake. */
export function noLossSvg() {
  const W = 920, H = 420;
  let b = '';
  const box = (x, y, w, h, col, title, lines, fill) => {
    let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="10" fill="${fill || PANEL}" stroke="${col}" stroke-width="2"/>`;
    s += text(x + w / 2, y + 26, title, { size: 13.5, weight: 800, fill: col });
    lines.forEach((ln, i) => { s += text(x + w / 2, y + 48 + i * 15, ln, { size: 11, fill: MUT }); });
    return s;
  };
  b += box(40, 96, 220, 104, HUE.silver, 'YOUR DEPOSIT', ['KULA you put in.', 'Withdrawable at any time.', 'Never at risk.']);
  b += box(350, 96, 220, 104, HUE.platinum, 'THE YIELD', ['What the pooled deposits', 'earn, plus emission', 'and a cut of fees.']);
  b += box(660, 96, 220, 104, HUE.gold, 'THE PRIZE POOL', ['One depositor takes', 'all of it. Odds weighted', 'by deposit size.']);
  b += arrow(264, 148, 346, 148);
  b += arrow(574, 148, 656, 148);
  b += text(305, 138, 'earns', { size: 10.5, fill: MUT });
  b += text(615, 138, 'funds', { size: 10.5, fill: MUT });
  // the return path — the whole point
  b += `<path d="M150 204 C150 268, 150 268, 150 268 L770 268 C770 268, 770 268, 770 206" fill="none" stroke="${GOOD}" stroke-width="2" stroke-dasharray="6 4"/>`;
  b += `<path d="M144 262 L150 268 L156 262" fill="none" stroke="${GOOD}" stroke-width="2"/>`;
  b += text(460, 288, 'win or lose, your deposit comes back whole', { size: 12.5, weight: 700, fill: GOOD });
  b += `<rect x="40" y="316" width="840" height="64" rx="9" fill="${PANEL}" stroke="${LINE}"/>`;
  b += text(W / 2, 340, 'So what does it cost to play?', { size: 12.5, weight: 700 });
  b += text(W / 2, 362, 'Only the yield you would have earned on that deposit. The capital is never staked — that is the whole design.', { size: 11.5, fill: MUT });
  return frame(W, H, 'How a No-Loss Lottery Works', 'the deposit is not the stake — the yield is', b);
}

// ── PANEL 3: commit and reveal ─────────────────────────────────────────────────────────────────────
/** Why a draw is two transactions, and what each one stops. */
export function commitRevealSvg() {
  const W = 920, H = 400;
  let b = '';
  const step = (x, w, n, col, title, what, stops) => {
    let s = `<rect x="${x}" y="100" width="${w}" height="150" rx="10" fill="${PANEL}" stroke="${col}" stroke-width="2"/>`;
    s += `<circle cx="${x + 28}" cy="128" r="15" fill="${col}"/>`;
    s += text(x + 28, 133, String(n), { size: 14, weight: 800, fill: onColour(col) });
    s += text(x + 52, 133, title, { anchor: 'start', size: 14, weight: 800, fill: col });
    wrap(what, 44).forEach((ln, i) => { s += text(x + 20, 166 + i * 16, ln, { anchor: 'start', size: 11.5 }); });
    s += text(x + 20, 222, 'STOPS', { anchor: 'start', size: 9, weight: 700, fill: MUT });
    wrap(stops, 46).forEach((ln, i) => { s += text(x + 20, 236 + i * 14, ln, { anchor: 'start', size: 10.5, fill: MUT }); });
    return s;
  };
  b += step(40, 390, 1, HUE.silver, 'COMMIT',
    'Publish the hash of a secret salt. This binds the draw to the current block.',
    'the drawer grinding salts until a chosen address wins');
  b += step(490, 390, 2, HUE.gold, 'REVEAL',
    'At least 2 blocks later, publish the salt. The winner is computed and paid.',
    'anyone predicting the winner, since a future block hash is used');
  b += arrow(434, 175, 486, 175);
  b += text(460, 164, '≥ 2 blocks', { size: 10, fill: MUT });
  b += `<rect x="40" y="276" width="840" height="86" rx="9" fill="${PANEL}" stroke="${LINE}"/>`;
  b += text(W / 2, 300, 'Neither side can choose the outcome alone — that is why it takes two transactions.', { size: 12.5, weight: 700 });
  b += text(W / 2, 322, 'The chain only remembers 256 blocks of hashes. A commit left longer than that can never be revealed,', { size: 11, fill: MUT });
  b += text(W / 2, 338, 'so it is cleared and a fresh draw starts. No prize is lost: the pot is only zeroed inside a successful reveal.', { size: 11, fill: MUT });
  b += text(W / 2, 356, 'Draws run twice a week.', { size: 11.5, weight: 600 });
  return frame(W, H, 'Why a Draw Takes Two Transactions', 'commit, then reveal — and what each one prevents', b);
}

export const KULA_FIGURES = {
  'kula-pool-depth': poolDepthSvg,
  'kula-no-loss': noLossSvg,
  'kula-commit-reveal': commitRevealSvg,
};
export const kulaFigureSvg = (n) => (KULA_FIGURES[String(n || '').toLowerCase()] || (() => ''))();

if (process.argv[1] && /kula-diagrams\.mjs$/.test(process.argv[1])) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const out = process.argv[2] || './kula-figs';
  mkdirSync(out, { recursive: true });
  for (const n of Object.keys(KULA_FIGURES)) {
    const svg = kulaFigureSvg(n);
    writeFileSync(`${out}/${n}.svg`, svg);
    console.log(`${n}.svg  ${svg.length} bytes`);
  }
}
