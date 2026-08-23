// pentecaust/herald/creative-studio.mjs — the Herald CREATIVE STUDIO: the ad/video CREATIVE planner.
//
// The "Create" lane of the Herald growth engine. You state a brand + product + goal (+ optional styles /
// count / formats) and this emits a deterministic set of creative BRIEFS — scroll-stopping static, video,
// and social ad variants with A/B-testable headline / subhead / CTA copy (the Arcads/Creatify bulk-variant
// idea, but ours). It does NOT call a model: the copy is generated deterministically from the inputs, the
// static ad is rendered by REUSING site/genai/ad-maker.mjs (no SVG re-implementation here), and the video
// piece is emitted as a STORYBOARD (the scene plan a video model or editor executes) rather than a video.
//
// Pure + deterministic given inputs — no clocks, no randomness (variation comes from the item index), no
// network in any tested path. Soft-fail-never-throw: bad input yields a shaped, empty-but-valid result.
//
//   import { planCreatives, renderStatic, videoStoryboard, summary, handler } from './creative-studio.mjs'
//
//   POST /api/creatives  { brand, product, goal, styles, count, formats } → JSON plan
//   GET  /health                                                          → { ok:true }
//
//   node pentecaust/herald/creative-studio.mjs      # demo plan for a sample brand

import { fileURLToPath } from 'node:url';
import { buildAdSvg, STYLE_IDS, esc } from '../../site/genai/ad-maker.mjs';

export { esc };

const clean = (s) => String(s == null ? '' : s).trim();
const arr = (a) => (Array.isArray(a) ? a.map(clean).filter(Boolean) : []);

// The creative formats we plan. 'static' → ad-maker image, 'video' → storyboard, 'social' → post creative.
export const FORMATS = ['static', 'video', 'social'];

// Default style rotation reuses ad-maker's on-brand style set so renderStatic always maps cleanly.
export const DEFAULT_STYLES = STYLE_IDS.slice();

// ── deterministic copy pools — variation is by index, never random ──────────────────────────────────────
// Each pattern is a function of the cleaned inputs so every brief is tailored to brand / product / goal.

const HEADLINE_PATTERNS = [
  ({ product, goal }) => `${product} that ${goal}`,
  ({ brand }) => `This is ${brand}`,
  ({ product }) => `Stop scrolling. Start with ${product}.`,
  ({ goal }) => `The fastest way to ${goal}`,
  ({ brand, product }) => `${brand}: ${product}, done right`,
  ({ goal }) => `Ready to ${goal}?`,
];

const SUBHEAD_PATTERNS = [
  ({ product, goal }) => `${product} built to ${goal} — no fluff.`,
  ({ brand }) => `Thousands already moved to ${brand}.`,
  ({ goal }) => `Everything you need to ${goal}, in one place.`,
  ({ product }) => `${product} that pays for itself.`,
  ({ goal }) => `Join the people who chose to ${goal}.`,
  ({ brand, product }) => `${brand} makes ${product} effortless.`,
];

const CTA_PATTERNS = [
  () => 'Get started',
  () => 'Try it free',
  () => 'Join now',
  () => 'Learn more',
  () => 'Claim your spot',
  () => 'See how',
];

// Pick a pattern by index (wraps), run it against ctx, and clean the result. Soft-fails to ''.
function pick(pool, i, ctx) {
  try { return clean(pool[((i % pool.length) + pool.length) % pool.length](ctx)); } catch { return ''; }
}

// Compose the model/reference prompt for one creative (the text an image/video model would receive).
function creativePrompt({ brand, product, goal, style, format, headline, subhead, cta }) {
  const bits = [
    `${format} ad creative for ${brand || 'the brand'}`,
    product ? `promoting ${product}` : '',
    goal ? `to ${goal}` : '',
    `in the "${style}" visual style`,
    `Headline: "${headline}"`,
    subhead ? `Subhead: "${subhead}"` : '',
    cta ? `Call to action: "${cta}"` : '',
    'Scroll-stopping, on-brand, high contrast.',
  ].filter(Boolean);
  return bits.join('. ') + '.';
}

// ── planCreatives — the deterministic bulk-variant brief set ────────────────────────────────────────────

/**
 * Build a deterministic set of creative briefs tailored to the inputs.
 * @param {{brand?:string, product?:string, goal?:string, styles?:string[], count?:number, formats?:string[]}} [input]
 * @returns {Array<{id,format,style,headline,subhead,cta,prompt}>}  (empty array on bad input — never throws)
 */
export function planCreatives(input = {}) {
  try {
    if (!input || typeof input !== 'object') return []; // bad input → shaped empty plan
    const src = input;
    const brand = clean(src.brand);
    const product = clean(src.product) || 'it';
    const goal = clean(src.goal) || 'win';
    const styles = arr(src.styles).length ? arr(src.styles) : DEFAULT_STYLES;
    const formats = arr(src.formats).filter((f) => FORMATS.includes(f));
    const useFormats = formats.length ? formats : FORMATS;

    let count = Math.floor(Number(src.count));
    if (!Number.isFinite(count) || count < 1) count = useFormats.length * 2; // sensible default: 2 per format
    if (count > 100) count = 100; // guardrail

    const ctxBase = { brand: brand || 'the brand', product, goal };
    const out = [];
    for (let i = 0; i < count; i++) {
      const format = useFormats[i % useFormats.length];
      const style = clean(styles[i % styles.length]) || 'melek';
      const headline = pick(HEADLINE_PATTERNS, i, ctxBase);
      const subhead = pick(SUBHEAD_PATTERNS, i, ctxBase);
      const cta = pick(CTA_PATTERNS, i, ctxBase);
      out.push({
        id: `cr-${i + 1}`,
        format,
        style,
        headline,
        subhead,
        cta,
        prompt: creativePrompt({ brand, product, goal, style, format, headline, subhead, cta }),
      });
    }
    return out;
  } catch { return []; }
}

// ── renderStatic — REUSE ad-maker.mjs (no SVG re-implementation) ────────────────────────────────────────

/**
 * Render one brief's static ad by delegating to ad-maker's pure buildAdSvg(). We map the brief's copy onto
 * ad-maker's slots — line1 = headline, line2 = CTA (the bold second line), sub = subhead, wordmark = brand
 * — and coerce brief.style to a valid ad-maker style (falling back to 'melek'). buildAdSvg is pure and
 * synchronous (no model, no key, no network), so this stays fully offline. For a PNG buffer, callers can
 * pass the same style/opts to ad-maker's async renderAd() (lazy sharp) — intentionally NOT done here so the
 * tested path needs no native deps.
 * @returns {{ok:boolean, id?:string, format:'static', style:string, svg?:string, reason?:string}}
 */
export function renderStatic(brief, opts = {}) {
  try {
    if (!brief || typeof brief !== 'object') return { ok: false, format: 'static', style: 'melek', reason: 'bad-brief' };
    const b = brief;
    const requested = clean(b.style);
    const style = STYLE_IDS.includes(requested) ? requested : 'melek';
    const brand = clean(opts.brand) || clean(b.brand) || 'MELEK.salon';
    const svg = buildAdSvg(style, {
      line1: clean(b.headline) || 'Your Voice is',
      line2: clean(b.cta) || 'Worth Something',
      sub: clean(b.subhead) || undefined,
      wordmark: brand,
    });
    return { ok: true, id: clean(b.id) || undefined, format: 'static', style, svg };
  } catch { return { ok: false, format: 'static', style: 'melek', reason: 'render-failed' }; }
}

// ── videoStoryboard — the AI-writes-script-and-scenes piece (deterministic) ──────────────────────────────

// The canonical short-ad arc: shot type, on-screen-text role, VO role, seconds. Scenes are taken in order.
const ARC = [
  { shot: 'Hook — tight product close-up, fast push-in', seconds: 3, otRole: 'headline', voRole: 'hook' },
  { shot: 'Problem — relatable frustration, handheld', seconds: 4, otRole: 'pain', voRole: 'pain' },
  { shot: 'Solution — product in use, clean reveal', seconds: 5, otRole: 'subhead', voRole: 'solution' },
  { shot: 'Proof — quick benefit montage / UGC cuts', seconds: 4, otRole: 'benefit', voRole: 'proof' },
  { shot: 'Brand — logo lockup, calm hold', seconds: 3, otRole: 'brand', voRole: 'brand' },
  { shot: 'CTA — button/URL, bold end card', seconds: 3, otRole: 'cta', voRole: 'cta' },
];

/**
 * Emit a deterministic ordered storyboard for a short video ad from one brief.
 * @param {object} brief   a brief from planCreatives (headline/subhead/cta/prompt used for copy)
 * @param {{scenes?:number}} [opts]  how many scenes (clamped to [1, ARC.length]); default 4
 * @returns {{ok:boolean, id?:string, format:'video', style:string, totalSeconds:number,
 *            scenes:Array<{n,shot,onScreenText,voiceover,seconds}>, reason?:string}}
 */
export function videoStoryboard(brief, opts = {}) {
  try {
    if (!brief || typeof brief !== 'object') return { ok: false, format: 'video', style: 'melek', totalSeconds: 0, scenes: [], reason: 'bad-brief' };
    const b = brief;
    const style = clean(b.style) || 'melek';
    const brand = clean(b.brand) || 'the brand';
    const headline = clean(b.headline) || `Meet ${brand}`;
    const subhead = clean(b.subhead) || 'Built for you.';
    const cta = clean(b.cta) || 'Get started';

    let n = Math.floor(Number(opts && opts.scenes));
    if (!Number.isFinite(n) || n < 1) n = 4;
    if (n > ARC.length) n = ARC.length;

    const OT = { headline, pain: 'Still doing it the hard way?', subhead, benefit: 'Faster. Cleaner. Yours.', brand, cta };
    const VO = {
      hook: headline,
      pain: `Tired of the old way? ${subhead}`,
      solution: subhead,
      proof: 'Real results, no gimmicks.',
      brand: `${brand}.`,
      cta: `${cta} — today.`,
    };

    const scenes = [];
    let total = 0;
    for (let i = 0; i < n; i++) {
      const a = ARC[i];
      total += a.seconds;
      scenes.push({
        n: i + 1,
        shot: a.shot,
        onScreenText: clean(OT[a.otRole]) || headline,
        voiceover: clean(VO[a.voRole]) || headline,
        seconds: a.seconds,
      });
    }
    return { ok: true, id: clean(b.id) || undefined, format: 'video', style, totalSeconds: total, scenes };
  } catch { return { ok: false, format: 'video', style: 'melek', totalSeconds: 0, scenes: [], reason: 'storyboard-failed' }; }
}

// ── summary — counts by format / style ──────────────────────────────────────────────────────────────────

/**
 * Count a plan by format and by style. Accepts the planCreatives array (or a { creatives:[...] } wrapper).
 * @returns {{total:number, byFormat:object, byStyle:object}}
 */
export function summary(plan) {
  const byFormat = {};
  const byStyle = {};
  let total = 0;
  try {
    const list = Array.isArray(plan) ? plan : (plan && Array.isArray(plan.creatives) ? plan.creatives : []);
    for (const c of list) {
      if (!c || typeof c !== 'object') continue;
      total += 1;
      const f = clean(c.format) || 'unknown';
      const s = clean(c.style) || 'unknown';
      byFormat[f] = (byFormat[f] || 0) + 1;
      byStyle[s] = (byStyle[s] || 0) + 1;
    }
  } catch { /* soft-fail to whatever we counted */ }
  return { total, byFormat, byStyle };
}

// ── optional tiny HTTP surface ──────────────────────────────────────────────────────────────────────────
// POST /api/creatives  { brand, product, goal, styles, count, formats } → JSON plan + summary.

function readBody(req) {
  return new Promise((resolve) => {
    try {
      if (req.body != null) return resolve(typeof req.body === 'string' ? safeJson(req.body) : req.body);
      let data = '';
      req.on('data', (c) => { data += c; });
      req.on('end', () => resolve(safeJson(data)));
      req.on('error', () => resolve({}));
    } catch { resolve({}); }
  });
}
function safeJson(s) { try { return s ? JSON.parse(s) : {}; } catch { return {}; } }

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  try {
    if (typeof res.writeHead === 'function') res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8' });
    else { res.statusCode = code; if (res.setHeader) res.setHeader('Content-Type', 'application/json; charset=utf-8'); }
  } catch { /* soft-fail headers */ }
  res.end(body);
}

/** handler(req,res) — soft-fail, JSON only. esc() applied to any echoed error text. */
export async function handler(req, res) {
  const url = String(req.url || '');
  const method = String(req.method || 'GET').toUpperCase();
  const path = url.split('?')[0].replace(/\/+$/, '') || '/';
  try {
    if (path === '/health') return sendJson(res, 200, { ok: true, service: 'herald-creative-studio' });
    if (path === '/api/creatives' && method === 'POST') {
      const body = await readBody(req);
      const creatives = planCreatives(body || {});
      return sendJson(res, 200, { ok: true, count: creatives.length, creatives, summary: summary(creatives) });
    }
    return sendJson(res, 404, { ok: false, error: esc(`no route for ${method} ${path}`) });
  } catch (e) {
    return sendJson(res, 200, { ok: false, error: esc(String((e && e.message) || e)) });
  }
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const creatives = planCreatives({
    brand: 'MELEK',
    product: 'a chain that is yours',
    goal: 'get paid to post',
    count: 6,
  });
  const first = creatives[0];
  console.log(JSON.stringify({
    creatives,
    summary: summary(creatives),
    firstStaticSvgBytes: (renderStatic(first).svg || '').length,
    firstStoryboard: videoStoryboard(first, { scenes: 5 }),
  }, null, 2));
}
