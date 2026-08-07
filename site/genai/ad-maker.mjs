// ad-maker.mjs — MELEK brand ad mockups (deterministic SVG → PNG). The companion to the AI-image genai
// page: those images come from a model; these are on-brand MELEK ads in fixed aesthetics, generated
// instantly with no model, no key, no network. Seeded from the "Your Voice is Worth Something" set.
//
//   import { buildAdSvg, renderAd, STYLES } from './ad-maker.mjs';
//   const svg = buildAdSvg('kurdish', { line1: 'Your Voice is', line2: 'Worth Something' });  // pure, testable
//   const png = await renderAd('vaporwave', { wordmark: 'MELEK.salon' });                     // Buffer (lazy sharp)
//
// CLI:  node site/genai/ad-maker.mjs <style> [--line1=…] [--line2=…] [--wordmark=…] [--out=/path.png]
//       node site/genai/ad-maker.mjs all --dir=/tmp/ads          # render every style

const W = 1200, H = 630;

export const STYLES = [
  { id: 'kurdish', label: 'Kurdish — King & Angel (21-ray sun)', eyebrow: 'MELEK · THE KING AND THE ANGEL' },
  { id: 'vaporwave', label: 'Vaporwave — neon sun + grid', eyebrow: '' },
  { id: 'egypt', label: 'Cyan Egypt — Hathor horned sun-disk', eyebrow: 'HATHOR · THE WITNESS OF MELEK' },
  { id: 'melek', label: 'MELEK homage — gold waves', eyebrow: '' },
];
export const STYLE_IDS = STYLES.map((s) => s.id);

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// a filled sun disk with `rays` triangular rays — the Kurdish 21-ray sun / the Egyptian sun-disk
function sunDisk(cx, cy, r, rays, fill, rayLen) {
  let p = '';
  for (let i = 0; i < rays; i++) {
    const a = (i / rays) * Math.PI * 2;
    const x1 = cx + Math.cos(a) * (r + 6), y1 = cy + Math.sin(a) * (r + 6);
    const x2 = cx + Math.cos(a) * (r + rayLen), y2 = cy + Math.sin(a) * (r + rayLen);
    const a2 = ((i + 0.5) / rays) * Math.PI * 2;
    const xm = cx + Math.cos(a2) * (r + rayLen * 0.55), ym = cy + Math.sin(a2) * (r + rayLen * 0.55);
    p += `<path d="M${x1} ${y1} L${xm} ${ym} L${x2} ${y2} Z" fill="${fill}"/>`;
  }
  return p + `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"/>`;
}

/**
 * Build an ad SVG (pure — no I/O). style ∈ STYLE_IDS. Text is escaped.
 * @param {string} style
 * @param {{line1?:string, line2?:string, wordmark?:string, eyebrow?:string, sub?:string}} [opts]
 */
export function buildAdSvg(style, opts = {}) {
  const line1 = esc(opts.line1 || 'Your Voice is');
  const line2 = esc(opts.line2 || 'Worth Something');
  const wm = esc(opts.wordmark || 'MELEK.salon');
  const wmDot = wm.includes('.') ? `${esc(wm.split('.')[0])}<tspan>.${esc(wm.split('.').slice(1).join('.'))}</tspan>` : wm;
  const styleDef = STYLES.find((s) => s.id === style);
  const eyebrow = esc(opts.eyebrow != null ? opts.eyebrow : (styleDef ? styleDef.eyebrow : ''));

  const wordmark = (dotColor, base) => `<text x="80" y="560" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="30" fill="${base}">${wm.split('.')[0]}<tspan fill="${dotColor}">.${esc(wm.split('.').slice(1).join('.') || 'salon')}</tspan></text>`;

  if (style === 'kurdish') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><radialGradient id="kg" cx="72%" cy="45%" r="70%"><stop offset="0%" stop-color="#20301f"/><stop offset="60%" stop-color="#121a12"/><stop offset="100%" stop-color="#0b0f0b"/></radialGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#kg)"/>
  <rect width="${W}" height="10" fill="#e0322f"/><rect width="${W}" height="10" y="${H - 10}" fill="#2a9d4a"/>
  <g opacity="0.96">${sunDisk(915, 315, 78, 21, '#f7c53a', 78)}</g>
  <circle cx="915" cy="315" r="60" fill="#0b0f0b"/><circle cx="915" cy="315" r="52" fill="#f7c53a"/><circle cx="915" cy="315" r="30" fill="#e0322f" opacity="0.9"/>
  <text x="80" y="150" font-family="DejaVu Serif, serif" font-size="20" letter-spacing="5" fill="#f7c53a">${eyebrow}</text>
  <text x="76" y="300" font-family="DejaVu Serif, serif" font-weight="bold" font-size="72" fill="#f6f2e6">${line1}</text>
  <text x="76" y="384" font-family="DejaVu Serif, serif" font-weight="bold" font-size="72" fill="#f7c53a">${line2}</text>
  <text x="80" y="450" font-family="DejaVu Sans, sans-serif" font-size="26" fill="#c9c2ad">${esc(opts.sub || 'Post. Curate. Walk. Earn — on a chain that is yours.')}</text>
  ${wordmark('#f7c53a', '#f6f2e6')}</svg>`;
  }

  if (style === 'vaporwave') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#2b0a45"/><stop offset="55%" stop-color="#7b2ff7"/><stop offset="100%" stop-color="#ff5ea8"/></linearGradient>
    <linearGradient id="vsun" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#fff27a"/><stop offset="55%" stop-color="#ff8fc7"/><stop offset="100%" stop-color="#ff2d95"/></linearGradient>
    <clipPath id="scut"><circle cx="600" cy="290" r="150"/></clipPath>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#sky)"/>
  <g clip-path="url(#scut)"><rect x="450" y="140" width="300" height="300" fill="url(#vsun)"/>${[0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="450" y="${300 + i * 16}" width="300" height="${5 + i * 1.5}" fill="#2b0a45"/>`).join('')}</g>
  <g stroke="#00e5ff" stroke-width="2" opacity="0.85">${[...Array(14)].map((_, i) => `<line x1="${600 + (i - 7) * 180}" y1="440" x2="${600 + (i - 7) * 46}" y2="630"/>`).join('')}${[0, 1, 2, 3, 4, 5].map((i) => `<line x1="0" y1="${445 + i * i * 7}" x2="1200" y2="${445 + i * i * 7}"/>`).join('')}</g>
  <text x="600" y="150" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="72" fill="#fdf6ff" letter-spacing="2">${line1}</text>
  <text x="600" y="228" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="72" fill="#00e5ff" letter-spacing="2">${line2}</text>
  <text x="600" y="585" text-anchor="middle" font-family="DejaVu Sans, sans-serif" font-weight="bold" font-size="40" letter-spacing="14" fill="#fdf6ff">${esc((opts.wordmark || 'MELEK').split('.')[0].split('').join(' '))}</text></svg>`;
  }

  if (style === 'egypt') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs><linearGradient id="eg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#04201f"/><stop offset="55%" stop-color="#062e2c"/><stop offset="100%" stop-color="#02120f"/></linearGradient></defs>
  <rect width="${W}" height="${H}" fill="url(#eg)"/>
  <g stroke="#0fb5b5" stroke-width="3" opacity="0.5" fill="none"><rect x="26" y="26" width="${W - 52}" height="${H - 52}"/><rect x="40" y="40" width="${W - 80}" height="${H - 80}"/></g>
  <g transform="translate(915,300)"><path d="M-95,40 C-95,-70 -20,-95 0,-40 C20,-95 95,-70 95,40" fill="none" stroke="#e8b923" stroke-width="14" stroke-linecap="round"/>${sunDisk(0, -8, 52, 16, '#e8b923', 26)}<circle r="52" cx="0" cy="-8" fill="#e8b923"/><circle r="40" cx="0" cy="-8" fill="#0fb5b5"/><circle r="40" cx="0" cy="-8" fill="none" stroke="#04201f" stroke-width="4"/></g>
  <g transform="translate(120,470)" stroke="#0fb5b5" stroke-width="5" fill="none" opacity="0.8" stroke-linecap="round"><path d="M0,0 C20,-22 60,-22 80,0 C60,14 20,14 0,0Z"/><circle cx="40" cy="-2" r="8" fill="#e8b923" stroke="none"/><path d="M80,0 c14,4 20,14 18,30"/><path d="M40,12 l-6,26"/></g>
  <text x="80" y="150" font-family="DejaVu Serif, serif" font-size="20" letter-spacing="6" fill="#0fb5b5">${eyebrow}</text>
  <text x="76" y="300" font-family="DejaVu Serif, serif" font-weight="bold" font-size="70" fill="#f2ecd8">${line1}</text>
  <text x="76" y="382" font-family="DejaVu Serif, serif" font-weight="bold" font-size="70" fill="#e8b923">${line2}</text>
  ${wordmark('#0fb5b5', '#f2ecd8')}</svg>`;
  }

  // 'melek' (default) — clean gold-waves homage of the original
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#12100b"/><rect width="${W}" height="${H}" fill="none" stroke="#b8862b" stroke-width="2" opacity="0.4"/>
  <g transform="translate(880,315)" fill="none" stroke-linecap="round">${[0, 1, 2].map((i) => `<path d="M${-40 + i * 44},-120 C${10 + i * 44},-70 ${-70 + i * 44},-30 ${-10 + i * 44},20 C${40 + i * 44},70 ${-40 + i * 44},95 ${5 + i * 44},150" stroke="${['#8a5f16', '#b8862b', '#d8a340'][i]}" stroke-width="20"/>`).join('')}</g>
  <text x="90" y="250" font-family="DejaVu Serif, serif" font-weight="bold" font-size="66" fill="#f4efe2">${line1}</text>
  <text x="90" y="326" font-family="DejaVu Serif, serif" font-weight="bold" font-size="66" fill="#d8a340">${line2}.</text>
  <text x="94" y="404" font-family="DejaVu Sans, sans-serif" font-size="34" letter-spacing="2" fill="#c8bfa6">${esc(opts.sub || 'Post. Get paid.')}</text>
  ${wordmark('#d8a340', '#f4efe2')}</svg>`;
}

/** Render an ad style to a PNG Buffer (lazy sharp import so the module loads without it for tests). */
export async function renderAd(style, opts = {}) {
  const svg = buildAdSvg(style, opts);
  const sharpMod = await import('sharp');
  const sharp = sharpMod.default || sharpMod;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// ── CLI ──────────────────────────────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const args = process.argv.slice(2);
  const opt = (n, d) => { const a = args.find((x) => x.startsWith(`--${n}=`)); return a ? a.split('=').slice(1).join('=') : d; };
  const style = args.find((a) => !a.startsWith('--')) || 'melek';
  const o = { line1: opt('line1'), line2: opt('line2'), wordmark: opt('wordmark'), sub: opt('sub') };
  for (const k of Object.keys(o)) if (o[k] == null) delete o[k];
  if (style === 'all') {
    const dir = opt('dir', '/tmp/melek-ads'); mkdirSync(dir, { recursive: true });
    for (const s of STYLE_IDS) { writeFileSync(`${dir}/voice-${s}.png`, await renderAd(s, o)); console.log('wrote', `${dir}/voice-${s}.png`); }
  } else {
    const out = opt('out', `/tmp/voice-${style}.png`);
    writeFileSync(out, await renderAd(style, o)); console.log('wrote', out);
  }
}
