// server.mjs — Generative AI (Phase 1) — genai.soapbox.community.
//
// THE CONCEPT (operator's spec):
//   • A page where users generate AI images NOW — free-first, no login. Prompt box + template picker +
//     size + Generate. Grows later into ComfyUI-on-RunPod (on-demand) + Google-Colab teach layers, and
//     eventually CapCut-style templates (the template registry here is the seed for that).
//   • The image generation goes through `integrations/genai-providers.mjs` (cloudflare → gemini →
//     pollinations failover; circuit breakers; daily budget caps; NEVER an auto-retry billing loop).
//   • Templates come from `integrations/genai-templates.mjs` (pick → fill labelled slots → prompt).
//
//   PORT=8131 BASE_URL=https://genai.soapbox.community node site/genai/server.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /                 prompt box + template picker + size + Generate
//   /templates        the template gallery (pick one → form of slot fields)
//   /templates/:id    one template's slot-fill form (server-rendered) → POSTs to /api/generate
//   /gallery          recent generations grid, newest first (served from DATA_DIR)
//   POST /api/generate  rate-limited per IP; calls the provider adapter; stores image + metadata
//   /img/:file        serves a stored image (path-sanitised; never proxies arbitrary URLs)
//   /health           liveness + provider/template self-check
//   /robots.txt /sitemap.xml /sitemap-index.xml /llms.txt
//
// ── DISCIPLINE ──────────────────────────────────────────────────────────────────────────────────
//   esc() on EVERY interpolated value. NO login. NO arbitrary-URL proxy — we only serve images we
//   generated and saved. Rate-limited per IP (in-memory). Honest footer: which engine made each image +
//   the free-tier note. The provider layer holds keys (env/JIT vault); this server never sees a key.

import { createServer } from 'node:http';
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, basename } from 'node:path';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import * as providersMod from '../../integrations/genai-providers.mjs';
import { GENERATORS, byKind, noSignupOptions } from '../../integrations/genai-directory.mjs';
import {
  TEMPLATES, CATEGORIES, getTemplate, fillTemplate, exampleFor, validateTemplates, templatesByCategory,
} from '../../integrations/genai-templates.mjs';

const PORT = +(process.env.PORT || 8131);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.data', 'genai');
const RATE_PER_HOUR = +(process.env.GENAI_RATE_PER_HOUR || 10);

// ── image-generation seam ─────────────────────────────────────────────────────────────────────────
// Default: the real provider adapter. Tests inject a canned adapter so no network is touched and the
// store/rate-limit/escaping paths can all be exercised offline.
let _generate = (args) => providersMod.generateImage(args);
export function __setGenerator(fn) { _generate = fn || ((args) => providersMod.generateImage(args)); }

// store seam (tests point DATA_DIR at a temp dir; these are real fs ops by default)
function ensureDir() { try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* soft */ } }
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };
function saveGeneration({ base64, mime, prompt, provider, note, size, seed }) {
  ensureDir();
  const ts = Date.now();
  const ext = EXT[mime] || 'png';
  const file = `${ts}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    writeFileSync(join(DATA_DIR, file), Buffer.from(base64, 'base64'));
    const meta = { file, mime, prompt: String(prompt || '').slice(0, 2000), provider, note, size, seed, ts };
    writeFileSync(join(DATA_DIR, file + '.json'), JSON.stringify(meta));
    return meta;
  } catch { return null; }
}
function recentGenerations(limit = 60) {
  try {
    if (!existsSync(DATA_DIR)) return [];
    return readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')); } catch { return null; } })
      .filter(Boolean)
      .sort((a, b) => (b.ts || 0) - (a.ts || 0))
      .slice(0, limit);
  } catch { return []; }
}

// ── per-IP rate limiter (in-memory, sliding hour window) ──────────────────────────────────────────
const hits = new Map(); // ip -> [timestamps]
export function __resetRate() { hits.clear(); }
function clientIp(req) {
  const xf = (req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '';
  const ip = String(xf).split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';
  return ip;
}
function rateOk(ip) {
  const now = Date.now();
  const win = now - 3600 * 1000;
  const arr = (hits.get(ip) || []).filter((t) => t > win);
  if (arr.length >= RATE_PER_HOUR) { hits.set(ip, arr); return false; }
  arr.push(now);
  hits.set(ip, arr);
  return true;
}

// ── house-style helpers (same dark theme as the rest of SoapBox) ──────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const q = (s) => encodeURIComponent(String(s == null ? '' : s));

const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--up:#3fb950}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:6;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px;flex-wrap:wrap}
  .brand{font-weight:800;font-size:18px;color:var(--fg)} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--blue);color:var(--blue);text-decoration:none}
  .wrap{max-width:960px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:18px;margin:18px 0 10px} h3{font-size:15px;margin:0 0 6px}
  .muted{color:var(--mut)} .gold{color:var(--gold)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:12px}
  .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
  .sec{display:block;border:1px solid var(--line2);border-radius:10px;padding:16px 18px;background:var(--panel)}
  .sec:hover{border-color:var(--blue);text-decoration:none} .sec .t{font-weight:700;font-size:16px;color:var(--fg)} .sec .d{color:var(--mut);font-size:13px;margin-top:4px}
  form.gform{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  label.fld{display:block;margin:10px 0 4px;font-weight:600;font-size:14px} label.fld .ex{color:var(--mut);font-weight:400;font-size:12px}
  input.q,select.q,textarea.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;font-family:inherit;width:100%}
  textarea.q{min-height:80px;resize:vertical}
  input.q:focus,select.q:focus,textarea.q:focus{border-color:var(--blue);outline:none}
  button{cursor:pointer;background:var(--blue);border:1px solid var(--blue);border-radius:8px;color:#0d1117;font-weight:700;padding:11px 22px;font-size:15px}
  button:hover{filter:brightness(1.1)}
  .pill{display:inline-block;font-size:13px;border:1px solid var(--line2);border-radius:14px;padding:4px 12px;margin:0 6px 6px 0}
  .pill:hover{border-color:var(--blue)}
  .badge{font-size:11px;background:#1f6feb33;color:var(--blue);border-radius:8px;padding:1px 8px;margin-left:6px;vertical-align:middle}
  .badge.cat{background:#d2992233;color:var(--gold)} .badge.warn{background:#f8514922;color:#f85149}
  .gcard{border:1px solid var(--line2);border-radius:10px;overflow:hidden;background:var(--panel)}
  .gcard img{width:100%;display:block;background:#0b0f14}
  .gcard .meta{padding:8px 10px;font-size:12px;color:var(--mut)} .gcard .meta b{color:var(--fg);font-weight:600}
  .empty{color:var(--mut);padding:14px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>Free-first, no login.</b> Images are made by free / free-tier engines — we try
  <b>Cloudflare Workers AI</b>, then <b>Google Gemini</b>, then <b>Pollinations.ai</b> (keyless), and we
  label which one made each image. Cost-bearing engines run under a daily budget and a circuit breaker —
  no runaway billing. We never see or store your keys, and we never proxy arbitrary URLs — only images
  we generated and saved here. <i>Phase 1.</i> Coming next: ComfyUI on demand and Colab teach-lessons.
  <div style="margin-top:8px"><a href="/">Generate</a> · <a href="/templates">Templates</a> · <a href="/gallery">Gallery</a> · <a href="${esc(WIKI)}">Wiki</a> · <a href="${esc(DATA)}">Data</a></div>
</footer>`;

function pageShell(title, body, opts = {}) {
  const desc = opts.description || 'Generative AI — make images now, free-first, no login. Prompt box, CapCut-style templates, and a gallery. Powered by Cloudflare Workers AI, Google Gemini and Pollinations.ai.';
  const canonical = opts.canonical || `${BASE_URL}/`;
  const robots = opts.robots || 'index,follow,max-image-preview:large';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc)}">
<meta name=robots content="${esc(robots)}">
<link rel=canonical href="${esc(canonical)}">${STYLE}</head><body>
<header class=topbar><a class=brand href="/">✦ GenAI <span>make images now</span></a>
  <div class=topbar-r><a href="/templates">Templates</a><a href="/gallery">Gallery</a><a href="${esc(WIKI)}">Wiki</a><a href="${esc(DATA)}">Data</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

const SIZES = ['1024x1024', '768x1024', '1024x768', '768x768', '512x512'];
function sizeSelect(selected = '1024x1024') {
  return `<select class=q name=size aria-label=Size>${SIZES.map((s) =>
    `<option value="${esc(s)}"${s === selected ? ' selected' : ''}>${esc(s)}</option>`).join('')}</select>`;
}

// ── views ───────────────────────────────────────────────────────────────────────────────────────
export function homePage(opts = {}) {
  const note = opts.note ? `<div class=card><p class=empty>${esc(opts.note)}</p></div>` : '';
  const recent = recentGenerations(6);
  const body = `<h1>Generative AI <span class=muted style="font-size:14px">· make an image now</span></h1>
    <p class=muted>Type a prompt and hit Generate — no account, no card. We try free engines in order and
      tell you which one made it. Want a head start? Pick a <a href="/templates">template</a>.</p>
    ${note}
    <form class=gform method=post action="/api/generate"><div class=card>
      <label class=fld for=prompt>Your prompt</label>
      <textarea class=q id=prompt name=prompt placeholder="e.g. an Egyptian temple at golden hour, cinematic, highly detailed" required></textarea>
      <div class=row style="margin-top:12px">${sizeSelect()}
        <input class=q style="flex:1 1 140px;width:auto" name=seed type=number min=0 placeholder="seed (optional)">
        <button type=submit>Generate</button></div>
    </div></form>

    <h2>Start from a template</h2>
    <div class=grid>${TEMPLATES.slice(0, 6).map(templateCard).join('')}</div>
    <p class=muted style="margin-top:8px"><a href="/templates">See all ${TEMPLATES.length} templates →</a></p>

    ${recent.length ? `<h2>Recent generations</h2><div class=gallery>${recent.map(galleryCard).join('')}</div>
      <p class=muted style="margin-top:8px"><a href="/gallery">See the full gallery →</a></p>` : ''}

    <h2>More ways to make images</h2>
    <p class=muted>No lock-in: use <b>any</b> generator you like — Bing, Gemini, Ideogram, whoever — and post the
      result on your blog. ${GENERATORS.length} options catalogued, free tiers noted, including
      ${noSignupOptions().length} that need no account at all.</p>
    <div class=grid>${byKind('image').slice(0, 6).map(generatorCard).join('')}</div>
    <p class=muted style="margin-top:8px"><a href="/directory">See the full directory (images + video) →</a></p>`;
  return pageShell('Generative AI — make images now', body, { canonical: `${BASE_URL}/` });
}

// ── the open competitor directory (operator: "we want People to use Bing and whatever else") ──────
function generatorCard(g) {
  return `<a class=sec href="${esc(g.url)}" target=_blank rel="noopener nofollow">
    <div class=t>${esc(g.name)} <span class="badge cat">${esc(g.signup === 'none' ? 'no signup' : g.kind)}</span></div>
    <div class=d>${esc(g.strengths)}<br><span class=muted>${esc(g.free)}</span></div></a>`;
}

export function directoryView() {
  const img = byKind('image'), vid = byKind('video'), open = noSignupOptions();
  const body = `<h1>Every way to make images <span class=muted style="font-size:14px">· for your blog</span></h1>
    <p class=muted>Make images <a href="/">right here</a> with our free engines, or use any of these —
      the goal is great images on your MELEK posts, wherever they were made. Free-tier shapes noted on each.</p>
    <h2>Zero signup — go right now</h2>
    <div class=grid>${open.map(generatorCard).join('')}</div>
    <h2>Image generators</h2>
    <div class=grid>${img.filter((g) => g.signup !== 'none').map(generatorCard).join('')}</div>
    <h2>Video &amp; templates <span class=muted style="font-size:13px">(the CapCut lane — our own template maker grows here)</span></h2>
    <div class=grid>${vid.map(generatorCard).join('')}</div>`;
  return pageShell('Image &amp; video generator directory — Generative AI', body, { canonical: `${BASE_URL}/directory` });
}

function templateCard(t) {
  return `<a class=sec href="/templates/${esc(t.id)}">
    <div class=t>${esc(t.title)} <span class="badge cat">${esc(t.category)}</span></div>
    <div class=d>${esc(exampleFor(t.id)).slice(0, 110)}…</div></a>`;
}

export function templatesIndexView() {
  const byCat = CATEGORIES.map((c) => ({ c, list: templatesByCategory(c) })).filter((g) => g.list.length);
  const body = `<h1>Templates</h1>
    <p class=muted>Pick a template, fill a few labelled fields, and generate. ${TEMPLATES.length} starters across
      ${byCat.length} categories — the seed of a CapCut-style template library.</p>
    ${byCat.map((g) => `<h2 style="text-transform:capitalize">${esc(g.c)}</h2>
      <div class=grid>${g.list.map(templateCard).join('')}</div>`).join('')}`;
  return pageShell('Templates — Generative AI', body, { canonical: `${BASE_URL}/templates` });
}

export function templateDetailView(id) {
  const t = getTemplate(id);
  if (!t) {
    return pageShell('Template not found — Generative AI', `<h1>Template not found</h1>
      <p class=muted><a href="/templates">← all templates</a></p>
      <div class=card><p class=empty>No template “${esc(id)}”. Browse the <a href="/templates">gallery</a>.</p></div>`,
      { canonical: `${BASE_URL}/templates`, robots: 'noindex,follow' });
  }
  const fields = t.slots.map((s) => `<label class=fld for="slot_${esc(s.key)}">${esc(s.label)}
      <span class=ex>(e.g. ${esc(s.example)})</span></label>
    <input class=q id="slot_${esc(s.key)}" name="slot_${esc(s.key)}" placeholder="${esc(s.placeholder)}" autocomplete=off>`).join('');
  const body = `<h1>${esc(t.title)} <span class="badge cat">${esc(t.category)}</span></h1>
    <p class=muted><a href="/templates">← all templates</a></p>
    <div class=card><p class=muted style="font-size:13px">Example prompt this builds:</p>
      <p style="font-style:italic">${esc(exampleFor(t.id))}</p></div>
    <form class=gform method=post action="/api/generate"><input type=hidden name=template value="${esc(t.id)}">
      <div class=card>${fields}
        <div class=row style="margin-top:14px">${sizeSelect(t.defaultSize)}
          <input class=q style="flex:1 1 140px;width:auto" name=seed type=number min=0 placeholder="seed (optional)">
          <button type=submit>Generate</button></div>
      </div></form>`;
  return pageShell(`${t.title} — Generative AI`, body, { canonical: `${BASE_URL}/templates/${t.id}` });
}

function galleryCard(m) {
  const eng = m.note || m.provider || 'unknown engine';
  return `<div class=gcard>
    <img src="/img/${esc(m.file)}" alt="${esc(String(m.prompt || '').slice(0, 120))}" loading=lazy>
    <div class=meta><b>${esc(String(m.prompt || '').slice(0, 90))}</b><br>
      made by ${esc(eng)} · ${esc(m.size || '')}</div></div>`;
}

export function galleryView() {
  const items = recentGenerations(60);
  const body = `<h1>Gallery</h1>
    <p class=muted>Recent generations, newest first. Each is labelled with the engine that made it.</p>
    ${items.length ? `<div class=gallery>${items.map(galleryCard).join('')}</div>`
      : '<div class=card><p class=empty>No generations yet. <a href="/">Make the first one →</a></p></div>'}`;
  return pageShell('Gallery — Generative AI', body, { canonical: `${BASE_URL}/gallery` });
}

// ── the generate result page ──────────────────────────────────────────────────────────────────────
function resultPage(meta) {
  const body = `<h1>Your image</h1>
    <div class=card>
      <img src="/img/${esc(meta.file)}" alt="${esc(String(meta.prompt || '').slice(0, 120))}" style="max-width:100%;border-radius:8px;border:1px solid var(--line2)">
      <p class=muted style="margin-top:12px"><b>Prompt:</b> ${esc(meta.prompt)}</p>
      <p class=muted><b>Made by:</b> ${esc(meta.note || meta.provider)} · ${esc(meta.size || '')}${meta.seed != null ? ` · seed ${esc(meta.seed)}` : ''}</p>
      <div class=row style="margin-top:8px"><a class=pill href="/">← make another</a>
        <a class=pill href="/gallery">see the gallery</a>
        <a class=pill href="/img/${esc(meta.file)}" download>download</a></div>
    </div>`;
  return pageShell('Your image — Generative AI', body, { canonical: `${BASE_URL}/gallery`, robots: 'noindex,follow' });
}

// ── POST body parse (urlencoded, bounded) ─────────────────────────────────────────────────────────
function readBody(req) {
  return new Promise((resolve) => {
    let data = '';
    let tooBig = false;
    req.on('data', (chunk) => { data += chunk; if (data.length > 16384) { tooBig = true; data = data.slice(0, 16384); } });
    req.on('end', () => { if (tooBig) return resolve(new URLSearchParams()); try { resolve(new URLSearchParams(data)); } catch { resolve(new URLSearchParams()); } });
    req.on('error', () => resolve(new URLSearchParams()));
  });
}

// derive the final prompt from a POST: either an explicit `prompt`, or a `template` + slot_* fields.
export function promptFromParams(params) {
  const tid = params.get('template');
  if (tid && getTemplate(tid)) {
    const t = getTemplate(tid);
    const slots = {};
    for (const s of t.slots) { const v = params.get('slot_' + s.key); if (v != null) slots[s.key] = v; }
    return { prompt: fillTemplate(tid, slots), size: params.get('size') || t.defaultSize, seed: params.get('seed') };
  }
  return { prompt: params.get('prompt') || '', size: params.get('size') || '1024x1024', seed: params.get('seed') };
}

// ── /api/generate — the hot path. Rate-limit → adapter → store → result page. ──────────────────────
export async function handleGenerate(req, res) {
  const ip = clientIp(req);
  if (!rateOk(ip)) {
    return sendHtml(res, pageShell('Slow down — Generative AI',
      `<h1>Easy there</h1><div class=card><p class=empty>You've hit the limit of ${esc(RATE_PER_HOUR)} images per hour.
        Try again later, or browse the <a href="/gallery">gallery</a>.</p></div>`,
      { robots: 'noindex,follow' }), 429);
  }
  const params = await readBody(req);
  const { prompt, size, seed } = promptFromParams(params);
  const cleaned = String(prompt || '').trim();
  if (!cleaned) {
    return sendHtml(res, homePage({ note: 'Please enter a prompt (or pick a template) before generating.' }), 400);
  }
  let result;
  try { result = await _generate({ prompt: cleaned, size, seed: seed != null ? +seed : null }); }
  catch { result = { ok: false, error: 'generation failed' }; }

  if (!result || !result.ok) {
    return sendHtml(res, homePage({ note: 'No engine could make that image right now — please try again.' }), 502);
  }
  const meta = saveGeneration({
    base64: result.base64, mime: result.mime, prompt: cleaned,
    provider: result.provider, note: result.note, size: result.size || size, seed: result.seed,
  });
  if (!meta) {
    return sendHtml(res, homePage({ note: 'The image was made but could not be saved — please try again.' }), 500);
  }
  return sendHtml(res, resultPage(meta));
}

// ── /img/:file — serve a stored image. Path-sanitised; only files inside DATA_DIR. ────────────────
function serveImage(res, fileParam) {
  const file = basename(String(fileParam || '')); // strip any path components — no traversal
  if (!/^[\w.-]+\.(png|jpg|jpeg|webp)$/i.test(file)) { res.writeHead(404); return res.end('not found'); }
  const full = join(DATA_DIR, file);
  try {
    if (!existsSync(full) || !statSync(full).isFile()) { res.writeHead(404); return res.end('not found'); }
    const buf = readFileSync(full);
    const ext = file.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=86400' });
    return res.end(buf);
  } catch { res.writeHead(404); return res.end('not found'); }
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}

const SITEMAP_PATHS = ['/', '/templates', '/gallery', '/directory', ...TEMPLATES.map((t) => `/templates/${t.id}`)];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (path === '/health') {
      const tpl = validateTemplates();
      const provs = providersMod.providerStatus();
      const ok = tpl.ok;
      res.writeHead(ok ? 200 : 500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        ok, templates: TEMPLATES.length, templateErrors: tpl.errors,
        providers: provs, rateLimitPerHour: RATE_PER_HOUR,
      }));
    }
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end(robotsTxt(BASE_URL)); }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.6' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') { res.writeHead(200, { 'content-type': 'application/xml' }); return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10))); }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: 'Generative AI', baseUrl: BASE_URL,
        summary: 'Make AI images now — free-first, no login. Prompt box, CapCut-style templates, and a gallery. Powered by Cloudflare Workers AI, Google Gemini, and Pollinations.ai (keyless fallback).',
        links: [
          { label: 'Templates', path: '/templates' },
          { label: 'Gallery', path: '/gallery' },
        ],
      }));
    }

    if (path === '/api/generate') {
      if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }); return res.end('POST only'); }
      return handleGenerate(req, res);
    }

    if (path.startsWith('/img/')) {
      const f = decodeURIComponent(path.slice('/img/'.length));
      return serveImage(res, f);
    }

    if (path === '/') return sendHtml(res, homePage());
    if (path === '/templates') return sendHtml(res, templatesIndexView());
    if (path.startsWith('/templates/')) {
      const id = decodeURIComponent(path.slice('/templates/'.length).replace(/\/+$/, ''));
      return sendHtml(res, templateDetailView(id), getTemplate(id) ? 200 : 404);
    }
    if (path === '/gallery') return sendHtml(res, galleryView());
    if (path === '/directory') return sendHtml(res, directoryView());

    res.writeHead(302, { location: '/' });
    return res.end();
  } catch (e) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

if (process.argv[1] && process.argv[1].endsWith('server.mjs') && /site\/genai\//.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`Generative AI on ${BASE_URL} (bound ${HOST}:${PORT}) — data ${DATA_DIR}`);
  });
}
