// ad-templates.mjs — Herald's native ad-composition engine.
//
// Pure SVG → PNG (via sharp). No model, no key, no network, no external fonts: an SVG string is built
// deterministically from a format (real ad pixel dimensions), a theme (a colour palette) and the ad copy,
// then rasterised. The heroes are drawn separately on our own CPU-SD worker and handed in as a data: URI.
//
//   import { renderTemplate, THEME_IDS, PRODUCTS, CTAS, BRAND_NEG } from './ad-templates.mjs';
//   const png = await renderTemplate('ig-square', 'vaporwave', { slogan, cta, heroDataUri, surfaces, eyebrow });
//   const png = await renderTemplate('fb-link',  'temple-gold', { layout: 'cover', slogan, eyebrow, sub, heroDataUri });
//
// The only consumer is gen-marketing-batch.mjs, which pipes the PNG through sharp().resize(1000x1000 inside).
//
// ── COPY RULE (load-bearing) ──────────────────────────────────────────────────────────────────────────
// Nothing in PRODUCTS or CTAS below is written by an AI. Every slogan and every call-to-action is lifted
// verbatim (or trimmed verbatim) from our own already-published pages, and carries a `// source:` comment
// saying which page it came from. The operator's standing rule is that MELEK wording is his, not Claude's —
// and the previous creative pool's invented one-liners ("Earn for Blogging.", "Game On-Chain.") are half of
// what he objected to on 2026-10-17. If a product has no real published copy, it gets fewer slogans. It
// never gets an invented one.
//
// House style: ESM, esc() all interpolation, soft-fail never throw, lazy sharp import, CLI guarded.

// ── escaping ─────────────────────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// ── formats — real ad dimensions, keyed by the ids in gen-marketing-batch.mjs's FMT_ROT ──────────────
export const FORMATS = {
  'ig-square': { w: 1080, h: 1080, label: 'Instagram square' },
  'ig-portrait': { w: 1080, h: 1350, label: 'Instagram portrait' },
  'story-reel': { w: 1080, h: 1920, label: 'Story / Reel' },
  'pinterest-pin': { w: 1000, h: 1500, label: 'Pinterest pin' },
  'fb-link': { w: 1200, h: 628, label: 'Facebook link card' },
  'x-post': { w: 1600, h: 900, label: 'X post image' },
  'yt-thumb': { w: 1280, h: 720, label: 'YouTube thumbnail' },
  'fb-cover': { w: 1640, h: 664, label: 'Facebook page cover' },
  'li-banner': { w: 1584, h: 396, label: 'LinkedIn banner' },
  'business-card': { w: 1050, h: 600, label: 'Business card (3.5×2in @300dpi)' },
  'postcard-4x6': { w: 1800, h: 1200, label: 'Postcard (6×4in @300dpi)' },
  'disp-medrect': { w: 300, h: 250, label: 'Display medium rectangle' },
  'disp-leaderboard': { w: 728, h: 90, label: 'Display leaderboard' },
  'disp-halfpage': { w: 300, h: 600, label: 'Display half page' },
  'web-hero': { w: 1920, h: 640, label: 'Web hero banner' },
  'blog-featured': { w: 1200, h: 675, label: 'Blog featured image' },
  'qr-card': { w: 1080, h: 1080, label: 'QR / handout card' },
  'podcast-cover': { w: 1400, h: 1400, label: 'Podcast cover' },
};
export const FORMAT_IDS = Object.keys(FORMATS);
const DEFAULT_FMT = 'ig-square';

// ── themes — palettes only (visual design, no copy) ──────────────────────────────────────────────────
// Carried forward from site/hathor/ad-maker.mjs's MELEK brand aesthetics. `scrim` is a NEUTRAL veil colour
// used behind cover-layout type: it cannot be derived from bg2, which on a bright palette (vaporwave) is
// itself a highlight and leaves the type unreadable over a light hero.
export const THEMES = [
  { id: 'vaporwave', bg0: '#2b0a45', bg1: '#7b2ff7', bg2: '#ff5ea8', panel: '#1b0730', ink: '#fdf6ff', dim: '#e2c7ff', accent: '#00e5ff', onAccent: '#140425', scrim: '#140322', serif: false },
  { id: 'temple-gold', bg0: '#12100b', bg1: '#241d10', bg2: '#0c0a06', panel: '#1a160d', ink: '#f4efe2', dim: '#c8bfa6', accent: '#d8a340', onAccent: '#12100b', scrim: '#0a0906', serif: true },
  { id: 'cyan-egypt', bg0: '#04201f', bg1: '#062e2c', bg2: '#02120f', panel: '#052623', ink: '#f2ecd8', dim: '#9fc6c2', accent: '#0fb5b5', onAccent: '#02120f', scrim: '#021210', serif: true },
  { id: 'kurdish-sun', bg0: '#20301f', bg1: '#121a12', bg2: '#0b0f0b', panel: '#15200f', ink: '#f6f2e6', dim: '#c9c2ad', accent: '#f7c53a', onAccent: '#0b0f0b', scrim: '#080c08', serif: true },
  { id: 'midnight-neon', bg0: '#060a1a', bg1: '#0d1536', bg2: '#03060f', panel: '#0a1130', ink: '#eaf2ff', dim: '#93a7d6', accent: '#4de2ff', onAccent: '#03060f', scrim: '#02050c', serif: false },
  { id: 'rose-quartz', bg0: '#2a0d22', bg1: '#4d1540', bg2: '#15050f', panel: '#2d0e24', ink: '#fff0fa', dim: '#e3b6d6', accent: '#ff79c6', onAccent: '#1b0615', scrim: '#120410', serif: false },
  { id: 'parchment', bg0: '#efe6d2', bg1: '#e3d6ba', bg2: '#f6efe0', panel: '#e8ddc4', ink: '#2a2316', dim: '#6a5d42', accent: '#9a6b12', onAccent: '#f6efe0', scrim: '#f8f3e8', serif: true },
  { id: 'fantasy', bg0: '#140b2e', bg1: '#2d1a63', bg2: '#070318', panel: '#1a1040', ink: '#f3edff', dim: '#b9a7e8', accent: '#9d7bff', onAccent: '#070318', scrim: '#060214', serif: true },
];
export const THEME_IDS = THEMES.map((t) => t.id);
const theme = (id) => THEMES.find((t) => t.id === id) || THEMES[0];

const SANS = 'DejaVu Sans, Liberation Sans, Helvetica, Arial, sans-serif';
const SERIF = 'DejaVu Serif, Liberation Serif, Georgia, Times New Roman, serif';

// ── negative prompt handed to our own CPU-SD worker when it draws the heroes ─────────────────────────
// Technical generation parameter, not ad copy: the ad engine lays the words on itself, so the hero must
// carry none of its own.
export const BRAND_NEG = 'text, words, letters, typography, watermark, signature, logo, caption, subtitles, '
  + 'ui, interface, frame, border, collage, grid, panels, lowres, blurry, out of focus, jpeg artifacts, '
  + 'deformed hands, extra fingers, extra limbs, mutated, disfigured, bad anatomy, nsfw, nudity';

// ── calls to action — every one a real link/button label from one of our own live pages ──────────────
export const CTAS = [
  'Start mining',                 // source: pool.soapbox.community — the "▶ Start mining" button
  'Start mining in 5 seconds',    // source: pool.soapbox.community — section heading
  'create your wallet here',      // source: pool.soapbox.community — wallet link
  'open My Coins',                // source: pool.soapbox.community — nav/link label
  'Join MELEK',                   // source: vankushfamily.com — the "Join MELEK →" button
  'See the roadmap',              // source: vankushfamily.com — button
  'Learn to make it yourself',    // source: hathor.soapbox.community — Hathor Studio link
  'See the full gallery',         // source: hathor.soapbox.community — "See the full gallery →"
  'Sign in with MELEK',           // source: hathor.soapbox.community — sign-in button
  'Join the Discord',             // source: hathor.soapbox.community — "Join the Discord →"
  'Check a wallet on Hive-Engine', // source: melek.salon/holders (site/holders/build.mjs) — link text
  'Witness School',               // source: vankushfamily.com — nav label
];

// ── products — the operator's own self-advertising list, with copy lifted from our published pages ───
// Spec (operator, "Self-Advertising Strategy"): rotate internal ads for VKBT, the mining pool, and
// Hathor-Mehit AI content. No external ads. Two entries from the original transcript were retired by the
// operator on 2026-10-22 and are deliberately absent: "Temple of Van Kush" (does not exist) and the
// "Book of Tanit" (a content subject we cover, not something we advertise).
export const PRODUCTS = [
  {
    id: 'vkbt',
    kicker: 'VKBT · Hive-Engine token',
    surface: 'melek.salon/holders',
    heroes: ['earn_coins', 'kpop_creator', 'creator_desk', 'friends_group', 'blogger_cafe'],
    slogans: [
      // source: wiki.soapbox.community/wiki/VKBT_Token — <meta name=description>, opening sentence
      'The Van Kush Beauty Token (VKBT) is a cryptocurrency token within the Van Kush Family ecosystem, primarily operating on the HIVE-Engine platform.',
      // source: wiki.soapbox.community/wiki/VKBT_Token — "Utility and Purpose", Education
      'A primary token for teaching trading and earning.',
      // source: wiki.soapbox.community/wiki/VKBT_Token — "Utility and Purpose", Rewards
      'It is used to reward Van Kush Beauty customers and community members.',
      // source: wiki.soapbox.community/wiki/VKBT_Token — "Utility and Purpose", Discounts
      'Holders can receive product discounts.',
      // source: wiki.soapbox.community/wiki/VKBT_Token — "Utility and Purpose", Staking
      'The token offers staking rewards.',
      // source: melek.salon/holders (site/holders/build.mjs) — <meta name=description>
      'Every account holding VKBT or CURE on Hive-Engine, with links to check each wallet. Many holders don’t know they have them.',
      // source: melek.salon/holders (site/holders/build.mjs) — opening paragraph
      'VKBT and CURE have been handed out on Hive-Engine for years, starting with the r2cornell community.',
      // source: soapbox.community coin directory (site/soapbox/content.mjs) — tokens entry detail
      'VKBT (Van Kush Beauty Token) and CURE (Curator Rewards Token) are first-party Hive-Engine tokens.',
    ],
  },
  {
    id: 'pool',
    kicker: 'SoapBox Mining Pool',
    surface: 'pool.soapbox.community',
    heroes: ['vaporwave_city', 'earn_coins', 'fantasy_portal', 'dj_techno', 'creator_desk'],
    slogans: [
      // source: pool.soapbox.community — hero paragraph
      'Mine right now in your browser — no install, even on a phone.',
      // source: pool.soapbox.community — section heading
      'Start mining in 5 seconds — no install, even on your phone.',
      // source: pool.soapbox.community — hero paragraph
      'A multi-coin pool: RandomX / CryptoNote and Ethash / Etchash side by side, plus our own currencies.',
      // source: pool.soapbox.community — hero paragraph
      'You always mine to an address you control; the pool never holds your spend keys.',
      // source: pool.soapbox.community — browser-miner panel
      'This runs a real RandomX miner right here in your browser tab and submits real shares to our pool.',
      // source: pool.soapbox.community — wallet picker
      'No address? The pool makes you one — create your wallet here.',
      // source: wiki.soapbox.community/wiki/SoapBox_Mining_Pool — "Function"
      'It offers browser-based mining alongside conventional miner connections, and includes in-browser wallet generation so a participant can begin without installing separate software.',
      // source: wiki.soapbox.community/wiki/SoapBox_Mining_Pool — <meta name=description>, opening sentence
      'The SoapBox mining pool is the ecosystem’s mining pool, published at pool.soapbox.community.',
    ],
  },
  {
    id: 'hathor',
    kicker: 'Hathor Studio · MELEK',
    surface: 'hathor.soapbox.community',
    heroes: ['hathor_mehit', 'hathor_angel', 'temple_angel_statue', 'angel_egypt_syncretic', 'vaporwave_temple_wide', 'biblical_gold'],
    slogans: [
      // source: hathor.soapbox.community — <meta name=description>
      'Hathor Studio — make images, remakes of ancient art, and videos, free with no login, on our own servers.',
      // source: hathor.soapbox.community — <title>
      'Generative AI — make images now.',
      // source: hathor.soapbox.community — studio intro paragraph
      'This is Hathor’s studio — make AI images free, no account, no card.',
      // source: hathor.soapbox.community — "A word from Hathor"
      'My studio is open. Become anything through 130+ effects, appear with me in dozens of scenes.',
      // source: hathor.soapbox.community — <meta name=description> continuation
      'Templates, character effects, ancient scripts, and your own engine if you want more.',
      // source: wiki.soapbox.community/wiki/Hathor — opening sentence
      'Hathor is the founding artificial-intelligence witness of the MELEK blockchain.',
      // source: wiki.soapbox.community/wiki/Hathor — opening paragraph
      'It is not a service running under an account — it is the account.',
      // source: wiki.soapbox.community/wiki/Hathor — "Forkable by design"
      'Hathor’s character, voice, and knowledge live in a public code repository and on-chain, not in any single model’s weights.',
    ],
  },
];

// ── text measurement + wrapping (no font metrics available offline — a calibrated approximation) ─────
const charW = (ch) => {
  if ('iIl|.,:;\'!`[]()'.includes(ch)) return 0.30;
  if (ch === ' ') return 0.28;
  if ('mMWw@'.includes(ch)) return 0.90;
  if (ch === '—' || ch === '–') return 0.90;
  if (ch >= 'A' && ch <= 'Z') return 0.68;
  if (ch >= '0' && ch <= '9') return 0.58;
  return 0.53;
};

// Calibrated against DejaVu Sans/Serif rasterised by sharp: the raw table runs ~11% narrow on real copy
// (worst case 1.19× on strings like "pool.soapbox.community" and "WWWWW"). These multipliers put the
// estimate safely ABOVE the truth — over-estimating only makes type a little smaller, under-estimating
// runs it off the edge of the ad, which is what shipped in the first pool.
const SAFETY_BOLD = 1.27;
const SAFETY_REG = 1.16;

/** Approximate (deliberately conservative) rendered width of `s` at `size` px. Pure. */
export function textWidth(s, size, bold = false) {
  let u = 0;
  for (const ch of String(s == null ? '' : s)) u += charW(ch);
  return u * size * (bold ? SAFETY_BOLD : SAFETY_REG);
}

// Break opportunities: between words, and after a hyphen/slash/dash INSIDE a long compound, so
// "artificial-intelligence" splits as "artificial-" / "intelligence" instead of mid-syllable. A piece
// produced by such a split carries tight=true: it rejoins its predecessor with no space, unlike a real
// word boundary (a free-standing "\u2014" is a word, and must keep the space the operator's copy has).
function segments(s) {
  const out = [];
  for (const w of String(s == null ? '' : s).split(/\s+/).filter(Boolean)) {
    const parts = w.length > 8 ? w.split(/(?<=[-\u2013\u2014/])/).filter(Boolean) : [w];
    parts.forEach((t, i) => out.push({ t, tight: i > 0 }));
  }
  return out;
}

/** Greedy word-wrap to `maxW` px at `size` px. Breaks over-long words only as a last resort. Pure. */
export function wrapText(s, size, maxW, bold = false) {
  const lines = [];
  let cur = '';
  const push = () => { if (cur) { lines.push(cur); cur = ''; } };
  for (const seg of segments(s)) {
    let w = seg.t;
    while (textWidth(w, size, bold) > maxW && w.length > 1) {
      let cut = w.length;
      while (cut > 1 && textWidth(w.slice(0, cut), size, bold) > maxW) cut--;
      push(); lines.push(w.slice(0, cut)); w = w.slice(cut);
    }
    const next = cur ? `${cur}${seg.tight ? '' : ' '}${w}` : w;
    if (textWidth(next, size, bold) <= maxW) cur = next; else { push(); cur = w; }
  }
  push();
  return lines.length ? lines : [''];
}

/** True when no single word has to be broken mid-word at this size. Pure. */
const wordsFit = (s, size, maxW, bold) => segments(s).every((w) => textWidth(w.t, size, bold) <= maxW);

/** Shrink `s` until it wraps inside (maxW × maxH) in at most `maxLines`. Pure. → { size, lines, lineH } */
export function fitText(s, { maxW, maxH, max = 96, min = 9, maxLines = 5, bold = true, lineH = 1.16 }) {
  const W = Math.max(8, maxW), H = Math.max(8, maxH);
  const step = (size) => Math.max(1, Math.round(size * 0.05));
  // Pass 1: a size where everything fits AND nothing is broken mid-word.
  for (let size = Math.max(min, max); size >= min; size -= step(size)) {
    if (!wordsFit(s, size, W, bold)) continue;
    const lines = wrapText(s, size, W, bold);
    if (lines.length <= maxLines && lines.length * size * lineH <= H) return { size, lines, lineH };
  }
  // Pass 2: allow mid-word breaks rather than give up.
  for (let size = Math.max(min, max); size >= min; size -= step(size)) {
    const lines = wrapText(s, size, W, bold);
    if (lines.length <= maxLines && lines.length * size * lineH <= H) return { size, lines, lineH };
  }
  const all = wrapText(s, min, W, bold);
  const room = Math.max(1, Math.floor(H / (min * lineH)));
  const keep = all.slice(0, Math.max(1, Math.min(maxLines, room)));
  if (keep.length && all.length > keep.length) keep[keep.length - 1] = `${keep[keep.length - 1]}…`;
  return { size: min, lines: keep.length ? keep : [''], lineH };
}

// ── hero handling ────────────────────────────────────────────────────────────────────────────────────
const HERO_RE = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/;

/** Return a safe, embeddable data URI, or '' when it is missing/malformed. Never throws. */
export function safeHero(uri) {
  try {
    if (typeof uri !== 'string') return '';
    const s = uri.trim().replace(/\s+/g, '');
    if (s.length < 96 || s.length > 24 * 1024 * 1024) return '';
    if (!HERO_RE.test(s)) return '';
    return s;
  } catch { return ''; }
}

const heroTag = (uri, x, y, w, h, clip) => (uri
  ? `<image ${clip ? `clip-path="url(#${clip})" ` : ''}x="${x}" y="${y}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" href="${uri}" xlink:href="${uri}"/>`
  : '');

// ── small SVG pieces ─────────────────────────────────────────────────────────────────────────────────
function textBlock(lines, x, y, size, lineH, fill, font, bold, anchor = 'start', letter = 0) {
  return lines.map((ln, i) => `<text x="${x}" y="${(y + size * (0.82 + i * lineH)).toFixed(1)}" font-family="${font}" font-size="${size.toFixed(1)}"`
    + `${bold ? ' font-weight="bold"' : ''}${letter ? ` letter-spacing="${letter.toFixed(2)}"` : ''} text-anchor="${anchor}" fill="${fill}">${esc(ln)}</text>`).join('');
}

function ctaPill(text, x, y, w, h, t) {
  if (!text) return '';
  const pad = h * 0.42;
  const fit = fitText(text, { maxW: w - pad * 2, maxH: h * 0.72, max: h * 0.5, min: 7, maxLines: 1, bold: true });
  const tw = Math.min(w, textWidth(fit.lines[0], fit.size, true) + pad * 2);
  return `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${tw.toFixed(1)}" height="${h.toFixed(1)}" rx="${(h / 2).toFixed(1)}" fill="${t.accent}"/>`
    + `<text x="${(x + tw / 2).toFixed(1)}" y="${(y + h / 2 + fit.size * 0.35).toFixed(1)}" font-family="${SANS}" font-weight="bold" font-size="${fit.size.toFixed(1)}" text-anchor="middle" fill="${t.onAccent}">${esc(fit.lines[0])}</text>`;
}

function background(w, h, t) {
  return `<defs>
    <linearGradient id="bgg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="${t.bg0}"/><stop offset="55%" stop-color="${t.bg1}"/><stop offset="100%" stop-color="${t.bg2}"/></linearGradient>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${t.scrim}" stop-opacity="0.15"/><stop offset="40%" stop-color="${t.scrim}" stop-opacity="0.62"/><stop offset="100%" stop-color="${t.scrim}" stop-opacity="0.97"/></linearGradient>
    <linearGradient id="topscrim" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${t.scrim}" stop-opacity="0.88"/><stop offset="100%" stop-color="${t.scrim}" stop-opacity="0"/></linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#bgg)"/>`;
}

// ── layouts ──────────────────────────────────────────────────────────────────────────────────────────
function coverSvg(w, h, t, o, hero) {
  const pad = Math.max(10, Math.min(w, h) * 0.065);
  const inner = w - pad * 2;
  const font = t.serif ? SERIF : SANS;
  const eyeSize = Math.max(8, Math.min(h * 0.035, 30));
  const subSize = Math.max(8, Math.min(h * 0.040, 34));
  const slog = fitText(o.slogan, { maxW: inner, maxH: h * 0.46, max: Math.min(w * 0.11, 104), min: 10, maxLines: 5, bold: true });
  const slogH = slog.lines.length * slog.size * slog.lineH;
  const subY = h - pad - subSize * 1.1;
  const slogY = subY - slogH - Math.max(6, pad * 0.5);
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${background(w, h, t)}
${heroTag(hero, 0, 0, w, h)}
<rect width="${w}" height="${h}" fill="url(#scrim)"/>
${o.eyebrow ? `<rect x="0" y="0" width="${w}" height="${(pad * 2 + eyeSize * 1.4).toFixed(1)}" fill="url(#topscrim)"/>` : ''}
<rect x="0" y="0" width="${w}" height="${Math.max(3, h * 0.012).toFixed(1)}" fill="${t.accent}"/>
${o.eyebrow ? textBlock(wrapText(o.eyebrow, eyeSize, inner).slice(0, 1), pad, pad, eyeSize, 1.2, t.accent, SANS, true, 'start', eyeSize * 0.12) : ''}
${textBlock(slog.lines, pad, slogY, slog.size, slog.lineH, t.ink, font, true)}
${o.sub ? textBlock(wrapText(o.sub, subSize, inner).slice(0, 1), pad, subY, subSize, 1.2, t.accent, SANS, true) : ''}
</svg>`;
}

function standardSvg(w, h, t, o, hero) {
  const ar = w / h;
  const pad = Math.max(7, Math.min(w, h) * 0.055);
  const font = t.serif ? SERIF : SANS;
  const surfaces = (Array.isArray(o.surfaces) ? o.surfaces : []).filter(Boolean).map(String);
  const surfLine = surfaces.join(' · ');

  // Where the hero sits: a left square on a wide banner, the right column on a landscape, the top on the rest.
  let hx = 0, hy = 0, hw = 0, hh = 0, tx = pad, ty = pad, tw = w - pad * 2, th = h - pad * 2;
  if (ar >= 3.2) { hw = hh = h; hx = 0; hy = 0; tx = h + pad; tw = w - h - pad * 2; }
  else if (ar >= 1.3) { hw = Math.round(w * 0.40); hh = h; hx = w - hw; hy = 0; tw = w - hw - pad * 2; }
  else { hw = w; hh = Math.round(h * 0.46); hx = 0; hy = 0; ty = hh + pad; th = h - hh - pad * 2; }
  tw = Math.max(24, tw); th = Math.max(24, th);

  const eyeSize = Math.max(7, Math.min(th * 0.10, Math.min(w, h) * 0.035, 28));
  const ctaH = Math.max(16, Math.min(th * 0.20, Math.min(w, h) * 0.10, 72));
  const surfSize = Math.max(7, Math.min(th * 0.085, Math.min(w, h) * 0.030, 24));
  const haveCta = !!o.cta;
  const haveSurf = !!surfLine;
  const reserved = (o.eyebrow ? eyeSize * 1.9 : 0) + (haveCta ? ctaH * 1.5 : 0) + (haveSurf ? surfSize * 1.9 : 0);
  const slog = fitText(o.slogan, { maxW: tw, maxH: Math.max(14, th - reserved), max: Math.min(tw * 0.17, 92), min: 7, maxLines: ar >= 3.2 ? 3 : 6, bold: true });

  let cy = ty;
  let out = '';
  if (o.eyebrow) { out += textBlock(wrapText(o.eyebrow, eyeSize, tw).slice(0, 1), tx, cy, eyeSize, 1.2, t.accent, SANS, true, 'start', eyeSize * 0.12); cy += eyeSize * 1.9; }
  out += textBlock(slog.lines, tx, cy, slog.size, slog.lineH, t.ink, font, true);
  cy += slog.lines.length * slog.size * slog.lineH + Math.max(4, pad * 0.4);
  const bottom = ty + th;
  if (haveSurf) {
    const sy = bottom - surfSize * 1.2;
    out += textBlock(wrapText(surfLine, surfSize, tw).slice(0, 1), tx, sy, surfSize, 1.2, t.dim, SANS, false);
  }
  if (haveCta) {
    const cyPill = Math.min(cy, bottom - (haveSurf ? surfSize * 1.9 : 0) - ctaH);
    out += ctaPill(o.cta, tx, Math.max(ty, cyPill), tw, ctaH, t);
  }

  const divider = ar >= 1.3 && ar < 3.2
    ? `<rect x="${hx - Math.max(2, w * 0.004)}" y="0" width="${Math.max(2, w * 0.004)}" height="${h}" fill="${t.accent}" opacity="0.9"/>`
    : `<rect x="0" y="${hy + hh}" width="${w}" height="${Math.max(2, h * 0.006)}" fill="${t.accent}" opacity="0.9"/>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
${background(w, h, t)}
<rect x="${hx}" y="${hy}" width="${hw}" height="${hh}" fill="${t.panel}"/>
${heroTag(hero, hx, hy, hw, hh)}
${divider}
${out}
</svg>`;
}

/**
 * Build the ad SVG. Pure — no I/O, never throws. Unknown format/theme fall back to sane defaults.
 * @param {string} fmt   one of FORMAT_IDS
 * @param {string} themeId one of THEME_IDS
 * @param {{layout?:string, slogan?:string, eyebrow?:string, sub?:string, cta?:string, surfaces?:string[], heroDataUri?:string}} opts
 * @returns {string} SVG
 */
export function buildAdSvg(fmt, themeId, opts = {}) {
  const f = FORMATS[fmt] || FORMATS[DEFAULT_FMT];
  const t = theme(themeId);
  const o = opts && typeof opts === 'object' ? opts : {};
  const hero = safeHero(o.heroDataUri);
  const copy = { ...o, slogan: String(o.slogan == null ? '' : o.slogan), eyebrow: o.eyebrow ? String(o.eyebrow) : '', sub: o.sub ? String(o.sub) : '', cta: o.cta ? String(o.cta) : '' };
  return o.layout === 'cover' ? coverSvg(f.w, f.h, t, copy, hero) : standardSvg(f.w, f.h, t, copy, hero);
}

/** Lazy sharp import so the module (and its copy tables) load in environments without it. */
async function getSharp() {
  const m = await import('sharp');
  return m.default || m;
}

/**
 * Render one ad to a PNG Buffer at the format's real pixel dimensions.
 * Soft-fails on a bad hero: if the embedded image cannot be rasterised, the ad is re-rendered without it.
 * @returns {Promise<Buffer>}
 */
export async function renderTemplate(fmt, themeId, opts = {}) {
  const sharp = await getSharp();
  const svg = buildAdSvg(fmt, themeId, opts);
  try {
    return await sharp(Buffer.from(svg)).png().toBuffer();
  } catch {
    const bare = buildAdSvg(fmt, themeId, { ...(opts && typeof opts === 'object' ? opts : {}), heroDataUri: '' });
    return sharp(Buffer.from(bare)).png().toBuffer();
  }
}

// ── CLI — render one sample of every format so the engine can be eyeballed ───────────────────────────
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const a = (n, d) => { const x = process.argv.find((s) => s.startsWith(`--${n}=`)); return x ? x.slice(n.length + 3) : d; };
  const dir = a('out', './herald-ad-samples');
  mkdirSync(dir, { recursive: true });
  let i = 0;
  for (const fmt of FORMAT_IDS) {
    const prod = PRODUCTS[i % PRODUCTS.length];
    const th = THEME_IDS[i % THEME_IDS.length];
    const cover = i % 2 === 0;
    const o = cover
      ? { layout: 'cover', slogan: prod.slogans[i % prod.slogans.length], eyebrow: prod.kicker, sub: prod.surface }
      : { slogan: prod.slogans[i % prod.slogans.length], cta: CTAS[i % CTAS.length], surfaces: [prod.surface, 'melek.salon'], eyebrow: prod.kicker };
    writeFileSync(`${dir}/${fmt}-${th}.png`, await renderTemplate(fmt, th, o));
    console.log('wrote', `${dir}/${fmt}-${th}.png`, `${FORMATS[fmt].w}x${FORMATS[fmt].h}`);
    i++;
  }
}
