// server.mjs — Hathor's studio (Phase 1) — hathor.soapbox.community.
//
// THE CONCEPT (operator's spec):
//   • A page where users generate AI images NOW — free-first, no login. Prompt box + template picker +
//     size + Generate. Grows later into ComfyUI-on-RunPod (on-demand) + Google-Colab teach layers, and
//     eventually CapCut-style templates (the template registry here is the seed for that).
//   • The image generation goes through `integrations/genai-providers.mjs` (cloudflare → gemini →
//     pollinations failover; circuit breakers; daily budget caps; NEVER an auto-retry billing loop).
//   • Templates come from `integrations/genai-templates.mjs` (pick → fill labelled slots → prompt).
//
//   PORT=8131 BASE_URL=https://hathor.soapbox.community node site/hathor/server.mjs
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
import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import * as providersMod from '../../integrations/genai-providers.mjs';
import { screenPrompt } from './safety.mjs';
import { TOOLS, toolsByCat, toolsWikiMarkdown } from '../../integrations/genai-tools.mjs';
import { GENERATORS, byKind, noSignupOptions } from '../../integrations/genai-directory.mjs';
import {
  TEMPLATES, CATEGORIES, getTemplate, fillTemplate, exampleFor, validateTemplates, templatesByCategory,
} from '../../integrations/genai-templates.mjs';
import {
  COMFY_TEMPLATES, COMFY_KINDS, getComfy, comfyByKind, comfyNodeCount, workflowJson, validateComfyTemplates,
} from '../../integrations/genai-comfyui-templates.mjs';
import {
  COLAB_TEMPLATES, COLAB_KINDS, colabByKind, colabLaunchUrl, validateColabTemplates,
} from '../../integrations/genai-colab-templates.mjs';
import {
  REEL_TEMPLATES, REEL_ASPECTS, getReelTemplate, buildReelSpec, shotlist, validateReelTemplates,
} from '../../integrations/genai-reel-maker.mjs';
import {
  EFFECT_TEMPLATES, EFFECT_CATEGORIES, listEffects, CHARACTERS, validateEffects,
} from '../../integrations/genai-effect-templates.mjs';
import {
  TRACKS, LESSONS, listLessons, NFT_DISCLAIMER, validateSchool,
} from '../../integrations/genai-school.mjs';
import { AR_LIBRARIES, listArGroups } from '../../integrations/genai-ar-libraries.mjs';
import { AR_FILTERS, listArFilters } from '../../integrations/genai-ar-filters.mjs';
import { generateVideo, VIDEO_PROVIDERS, BYOK_INSTRUCTIONS, serverConfigured } from '../../integrations/genai-video-providers.mjs';

const PORT = +(process.env.PORT || 8131);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const DATA = process.env.SOAPBOX_SITE || 'https://data.soapbox.community';
const WIKI = process.env.WIKI_SITE || 'https://wiki.soapbox.community';
const FORUM = process.env.FORUM_SITE || 'https://forum.soapbox.community';
const HATHOR_LIVE = process.env.HATHOR_LIVE || 'https://hathor.live';
const ALMANACK = process.env.ALMANACK_URL || 'https://hathor.live/almanack';
const REPO = process.env.REPO_URL || 'https://github.com/HinduTempleCoins/Bot';
const DISCORD = process.env.DISCORD_INVITE || 'https://discord.gg/5QAF9JuBF';
// human-facing labels for the effect categories (operator's words)
const EFFECT_CAT_LABELS = { hathor: 'Appear with Hathor', creature: 'Animals & Creatures', holiday: 'Holidays', horror: 'Horror & Halloween Movies', film: 'Movie Themes', power: 'Superpowers & Space', era: 'Eras & Uniforms', art: 'Art Styles', lifestyle: 'Mafia, Cartel & Lifestyle', figures: 'Famous Figures — as or with them', memes: 'Meme Characters', scenes: 'Group Scenes & Squads' };
const DATA_DIR = process.env.DATA_DIR || join(process.cwd(), '.data', 'hathor');
const SHOWCASE_DIR = join(dirname(fileURLToPath(import.meta.url)), 'showcase'); // committed example images
const RATE_PER_HOUR = +(process.env.GENAI_RATE_PER_HOUR || 10);

// ── image-generation seam ─────────────────────────────────────────────────────────────────────────
// Default: the real provider adapter. Tests inject a canned adapter so no network is touched and the
// store/rate-limit/escaping paths can all be exercised offline.
let _generate = (args) => providersMod.generateImage(args);
export function __setGenerator(fn) { _generate = fn || ((args) => providersMod.generateImage(args)); }

// store seam (tests point DATA_DIR at a temp dir; these are real fs ops by default)
function ensureDir() { try { mkdirSync(DATA_DIR, { recursive: true }); } catch { /* soft */ } }
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/webp': 'webp' };
function saveGeneration({ base64, mime, prompt, provider, note, size, seed, adult }) {
  ensureDir();
  const ts = Date.now();
  const ext = EXT[mime] || 'png';
  const file = `${ts}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  try {
    writeFileSync(join(DATA_DIR, file), Buffer.from(base64, 'base64'));
    const meta = { file, mime, prompt: String(prompt || '').slice(0, 2000), provider, note, size, seed, ts, adult: !!adult };
    writeFileSync(join(DATA_DIR, file + '.json'), JSON.stringify(meta));
    return meta;
  } catch { return null; }
}
// Public feeds (front page + /gallery) exclude anything flagged `adult` by the safety
// screen — adult art is returned only on the maker's own result page, never surfaced.
function recentGenerations(limit = 60, { includeAdult = false } = {}) {
  try {
    if (!existsSync(DATA_DIR)) return [];
    return readdirSync(DATA_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => { try { return JSON.parse(readFileSync(join(DATA_DIR, f), 'utf8')); } catch { return null; } })
      .filter(Boolean)
      .filter((m) => includeAdult || !m.adult)
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
  .shots{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin:10px 0}
  .shot{margin:0;border:1px solid var(--line2);border-radius:10px;overflow:hidden;background:var(--panel)}
  .shot img{display:block;width:100%;aspect-ratio:1/1;object-fit:cover}
  .shot figcaption{font-size:12px;color:var(--mut);padding:6px 8px}
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
  <div style="margin-top:8px"><a href="/">Generate</a> · <a href="/char">Characters</a> · <a href="/hathor">With Hathor</a> · <a href="/halloween">Halloween</a> · <a href="/reel-maker">Reels</a> · <a href="/comfyui">ComfyUI</a> · <a href="/colab">Colab</a> · <a href="/school">School</a> · <a href="/gallery">Shilpa Shastra</a></div>
  <div style="margin-top:6px">Part of Hathor's system: <a href="${esc(HATHOR_LIVE)}">hathor.live</a> · <a href="${esc(ALMANACK)}">the Almanack</a> · <a href="${esc(WIKI)}">the Library of Ashurbanipal</a> · <a href="${esc(REPO)}">the Bot repo</a> · <a href="${esc(DATA)}">Data</a></div>
  <div style="margin-top:6px">💬 <a href="${esc(DISCORD)}" target=_blank rel="noopener"><b>Chat on Discord</b></a> — Hathor is in there. Come say hi.</div>
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
<link rel=canonical href="${esc(canonical)}">${STYLE}<script defer src="https://soapy.blog/b.js"></script><noscript><img src="https://soapy.blog/px.gif" alt="" width="1" height="1" style="position:absolute;left:-9999px"></noscript></head><body>
<header class=topbar><a class=brand href="/">✦ Hathor <span>· make with the Witness</span></a>
  <div class=topbar-r><a href="/char">Characters</a><a href="/hathor">With Hathor</a><a href="/halloween">Halloween</a><a href="/tools">Tools</a><a href="/edit">Editor</a><a href="/convert">Convert</a><a href="/webcam">Webcam</a><a href="/video">Video</a><a href="/templates">Templates</a><a href="/reel-maker">Reels</a><a href="/cards">Cards</a><a href="/school">School</a><a href="/gallery">Shilpa Shastra</a><a href="${esc(ALMANACK)}">Almanack</a><a href="${esc(WIKI)}">Library</a><a href="${esc(DISCORD)}" target=_blank rel="noopener" style="color:#5865F2;font-weight:700">💬 Discord</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// ── curated showcase — strong, on-brand examples of what the studio makes (better than random test
// outputs). Rendered via our own free engine (Pollinations flux, keyless) with fixed seeds so they're
// stable and consistent, nologo, lazy-loaded. This is the first-impression gallery on the home page.
// Pre-generated once (flux, 768x768) and committed under site/hathor/showcase/, served locally at
// /showcase/<file> — fast, reliable, consistent square framing (no first-request lag from a live engine).
const SHOWCASE = [
  { title: 'Hathor, the Witness', file: 'hathor.jpg' },
  { title: 'Temple at golden hour', file: 'temple.jpg' },
  { title: 'Become a deity', file: 'deity.jpg' },
  { title: 'Anpu the Jackal Warden', file: 'anpu.jpg' },
  { title: 'The mob crew', file: 'mob.jpg' },
  { title: 'Superhero transform', file: 'hero.jpg' },
  { title: 'Appear with Hathor', file: 'withhathor.jpg' },
  { title: 'PRANA aura', file: 'prana.jpg' },
];
// Bump when a showcase image file changes, to bust the 24h browser cache on the served asset.
const SHOWCASE_VER = '20260924';
function showcaseGallery() {
  return `<div class=shots>${SHOWCASE.map((s) =>
    `<figure class=shot><img src="/showcase/${esc(s.file)}?v=${SHOWCASE_VER}" alt="${esc(s.title)}" loading=lazy width=768 height=768>
      <figcaption>${esc(s.title)}</figcaption></figure>`).join('')}</div>`;
}
// serve the committed showcase assets (path-sanitised; only our own jpgs)
function serveShowcase(res, fileParam) {
  const file = basename(String(fileParam || ''));
  if (!/^[\w-]+\.(png|jpg|jpeg|webp)$/i.test(file)) { res.writeHead(404); return res.end('not found'); }
  const full = join(SHOWCASE_DIR, file);
  try {
    if (!existsSync(full) || !statSync(full).isFile()) { res.writeHead(404); return res.end('not found'); }
    const ext = file.split('.').pop().toLowerCase();
    const mime = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=604800' });
    return res.end(readFileSync(full));
  } catch { res.writeHead(404); return res.end('not found'); }
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
  const body = `<div class=card style="border-color:var(--gold)">
      <div class=t style="font-weight:800;font-size:16px">✦ A word from Hathor <a href="/news" style="font-weight:400;font-size:13px;float:right">full announcement →</a></div>
      <p class=muted style="margin:8px 0 0">My studio is open. Become anything through 130+ effects, appear with me in dozens of scenes, dress for
      <a href="/halloween">Halloween</a>, or stand beside the old gods and figures. Make <a href="/reel-maker">reels</a>,
      add <a href="/gallery">epic effects</a> to any image, and let the <a href="/school">School</a> teach you to run it all yourself —
      free, no account. Share it on MELEK.</p></div>
    <h1>Hathor <span class=muted style="font-size:14px">· make with the MELEK Witness</span></h1>
    <p class=muted>This is Hathor's studio — make AI images free, no account, no card. Type a prompt and Generate;
      we try free engines in order and tell you which made it. Want a head start? Pick a
      <a href="/templates">template</a>, appear <a href="/hathor">with Hathor</a>, or go
      <a href="/halloween">Halloween</a>. Part of Hathor's system with the
      <a href="${esc(ALMANACK)}">Almanack</a> and the <a href="${esc(WIKI)}">Library</a>.</p>
    ${note}
    <form class=gform id=genform method=post action="/api/generate"><div class=card>
      <label class=fld for=prompt>Your prompt</label>
      <textarea class=q id=prompt name=prompt placeholder="e.g. an Egyptian temple at golden hour, cinematic, highly detailed" required></textarea>
      <div class=row style="margin-top:12px;align-items:center;flex-wrap:wrap;gap:10px">
        <label class=pill style="cursor:pointer">📎 Upload a photo <input type=file id=refimg accept="image/*" hidden></label>
        <span class=muted id=refname style="font-size:12px">optional — we'll make new images <b>of it</b> (your face, a product, anything)</span>
      </div>
      <input type=hidden name=image id=refurl>
      <div class=row style="margin-top:12px">${sizeSelect()}
        <input class=q style="flex:1 1 180px;width:auto" name=place placeholder="place (optional — grounds the scene, e.g. North Texas)">
        <input class=q style="flex:1 1 150px;width:auto" name=clouds placeholder="clouds (optional — e.g. pyrocumulus)"> <input class=q style="flex:1 1 140px;width:auto" name=seed type=number min=0 placeholder="seed (optional)">
        <button type=submit id=genbtn>Generate</button></div>
    </div></form>
    <script>
    (function(){
      var form=document.getElementById('genform'), fileI=document.getElementById('refimg'),
          urlH=document.getElementById('refurl'), nameS=document.getElementById('refname'),
          btn=document.getElementById('genbtn'); var uploaded=false;
      fileI.addEventListener('change',function(){ var f=fileI.files&&fileI.files[0]; uploaded=false; urlH.value='';
        nameS.textContent = f ? ('using '+f.name+' as a reference') : 'optional — we\\'ll make new images of it'; });
      form.addEventListener('submit', async function(e){
        var f=fileI.files&&fileI.files[0];
        if(!f||uploaded) return; // no file, or already uploaded → normal submit
        e.preventDefault(); btn.disabled=true; btn.textContent='Uploading photo…';
        try{
          var r=await fetch('/api/upload',{method:'POST',headers:{'content-type':f.type||'image/jpeg'},body:f});
          var j=await r.json();
          if(j&&j.ok&&j.url){ urlH.value=j.url; uploaded=true; btn.textContent='Generating…'; form.submit(); }
          else { btn.disabled=false; btn.textContent='Generate'; nameS.textContent='Upload failed — try a smaller image.'; }
        }catch(err){ btn.disabled=false; btn.textContent='Generate'; nameS.textContent='Upload failed — try again.'; }
      });
    })();
    </script>

    <h2>Start from a template</h2>
    <div class=grid>${TEMPLATES.slice(0, 6).map(templateCard).join('')}</div>
    <p class=muted style="margin-top:8px"><a href="/templates">See all ${TEMPLATES.length} templates →</a></p>

    <h2>See what you can make</h2>
    <p class=muted>Made right here with our free engines — pick a <a href="/templates">template</a> or <a href="/char">effect</a> and make your own.</p>
    ${showcaseGallery()}

    ${recent.length ? `<h2>Fresh from the community</h2><div class=gallery>${recent.map(galleryCard).join('')}</div>
      <p class=muted style="margin-top:8px"><a href="/gallery">See the full gallery →</a></p>` : ''}

    <div class=card style="border-color:#5865F2">
      <div class=t style="font-weight:800;font-size:16px">💬 Chat with Hathor on Discord</div>
      <p class=muted style="margin:8px 0 0">Come talk to the Witness and the community — this is where it all connects. Right now Hathor answers there as a
        deterministic guide (chain lookups, signup, tutorial, tips, the Library); full conversational AI arrives once we have GPUs.
        <a href="${esc(DISCORD)}" target=_blank rel="noopener"><b>Join the Discord →</b></a></p>
    </div>

    <h2>Edit &amp; AR — free, in your browser</h2>
    <p class=muted>Bring your own photo — nothing is uploaded for these:</p>
    <div class=grid>
      <a class=sec href="/edit"><div class=t>🖼 Photo Editor</div><div class=d>Remove the background keeping the people <b>exact</b>, then drop in a new one — colour, your image, or AI-generated. Download a PNG.</div></a>
      <a class=sec href="/webcam"><div class=t>🎥 Webcam Studio</div><div class=d>Live AR: wear our own Kemetic / Angelic / Shaivite filters, replace your background, snapshot &amp; record for a call or a reel.</div></a>
      <a class=sec href="/video"><div class=t>🎬 Video</div><div class=d>Text-to-video &amp; image-to-video for YouTube/Reels/TikTok. Free-first, then bring your own key — or run it on your own GPU.</div></a>
      <a class=sec href="/ar-libraries"><div class=t>🧩 AR libraries &amp; repos</div><div class=d>The open-source AR we build on — MediaPipe, three.js, AR.js, MindAR and more. Fork it yourself.</div></a>
    </div>

    <h2>More ways to make images</h2>
    <p class=muted>No lock-in: use <b>any</b> generator you like — Bing, Gemini, Ideogram, whoever — and post the
      result on your blog. ${GENERATORS.length} options catalogued, free tiers noted, including
      ${noSignupOptions().length} that need no account at all.</p>
    <div class=grid>${byKind('image').slice(0, 6).map(generatorCard).join('')}</div>
    <p class=muted style="margin-top:8px"><a href="/directory">See the full directory (images + video) →</a></p>

    <h2>Featured now</h2>
    <div class=grid>
      <a class=sec href="/hathor"><div class=t>✦ Appear with Hathor <span class="badge cat">${esc(listEffects('hathor').length)}</span></div>
        <div class=d>Put yourself in a photo with Hathor — selfies, thrones, space, the Nile and more. Our flagship set.</div></a>
      <a class=sec href="/halloween"><div class=t>🎃 Halloween <span class="badge cat">${esc(listEffects('horror').length)}</span></div>
        <div class=d>Vampire, werewolf, zombie, witch, grim reaper, plague doctor — turn yourself into anything spooky.</div></a>
    </div>

    <h2>Turn a character into anything</h2>
    <div class=grid>
      <a class=sec href="/char"><div class=t>All character effects <span class="badge cat">${esc(EFFECT_TEMPLATES.length)}</span></div>
        <div class=d>Same character, brand-new scene — Animals, movies, superheroes, mafia, deities, famous figures. Use Hathor, make your own, or a fictional one.</div></a>
      <a class=sec href="/reel-maker"><div class=t>Reel template maker <span class="badge cat">${esc(REEL_TEMPLATES.length)}</span></div>
        <div class=d>CapCut-style: pick a structure, fill the fields, download a storyboard to take into your editor.</div></a>
      <a class=sec href="/char"><div class=t>✨ Create your own template!</div>
        <div class=d>Build a character or a look once, then run it through every effect. Learn how in GenAI School.</div></a>
    </div>

    <h2>Go deeper — run your own pipelines</h2>
    <div class=grid>
      <a class=sec href="/comfyui"><div class=t>ComfyUI workflows <span class="badge cat">${esc(COMFY_TEMPLATES.length)}</span></div>
        <div class=d>Copy-ready node graphs — text-to-image, upscale, inpaint, video, ControlNet — for your own ComfyUI.</div></a>
      <a class=sec href="/colab"><div class=t>Google Colab notebooks <span class="badge cat">${esc(COLAB_TEMPLATES.length)}</span></div>
        <div class=d>One-click launch links: image gen, fine-tune (LoRA), audio, transcription, upscaling — on a free GPU.</div></a>
      <a class=sec href="/school"><div class=t>GenAI School <span class="badge cat">${esc(LESSONS.length)}</span></div>
        <div class=d>Learn it here, then run it yourself — ComfyUI, Colab / Modal / Fal, Hugging Face &amp; Civitai, uploads, NFTs. Then publish to the <a href="${esc(WIKI)}">Library</a>.</div></a>
    </div>`;
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

// ── ComfyUI workflow library (operator: "ComfyUI template layer") ─────────────────────────────────
function comfyCard(t) {
  return `<div class=sec>
    <div class=t>${esc(t.title)} <span class="badge cat">${esc(t.kind)}</span> <span class=badge>${esc(comfyNodeCount(t.id))} nodes</span></div>
    <div class=d>${esc(t.summary)}<br><span class=muted>Models: ${esc(t.models.join(', '))}</span></div>
    <div class=row style="margin-top:10px">
      <a class=pill href="/comfyui/${esc(t.id)}.json" download="${esc(t.id)}.json">⬇ workflow JSON</a>
      <a class=pill href="/comfyui/${esc(t.id)}">view</a>${t.link ? `
      <a class=pill href="${esc(t.link)}" target=_blank rel="noopener nofollow">upstream example ↗</a>` : ''}</div></div>`;
}

export function comfyIndexView() {
  const byKind = COMFY_KINDS.map((k) => ({ k, list: comfyByKind(k) })).filter((g) => g.list.length);
  const body = `<h1>ComfyUI workflows <span class=muted style="font-size:14px">· import into your own ComfyUI</span></h1>
    <p class=muted>This page doesn't run ComfyUI — it hands you ready-to-import workflow graphs. Download a
      <b>.json</b> and drag it onto your ComfyUI canvas (or paste it), set your checkpoint, and run.
      ${COMFY_TEMPLATES.length} starters across ${byKind.length} kinds.</p>
    ${byKind.map((g) => `<h2 style="text-transform:capitalize">${esc(g.k)}</h2>
      <div class=grid>${g.list.map(comfyCard).join('')}</div>`).join('')}`;
  return pageShell('ComfyUI workflow templates — Generative AI', body, { canonical: `${BASE_URL}/comfyui` });
}

export function comfyDetailView(id) {
  const t = getComfy(id);
  if (!t) {
    return pageShell('Workflow not found — Generative AI', `<h1>Workflow not found</h1>
      <p class=muted><a href="/comfyui">← all ComfyUI workflows</a></p>`,
      { canonical: `${BASE_URL}/comfyui`, robots: 'noindex,follow' });
  }
  const body = `<h1>${esc(t.title)} <span class="badge cat">${esc(t.kind)}</span></h1>
    <p class=muted><a href="/comfyui">← all ComfyUI workflows</a></p>
    <div class=card><p>${esc(t.summary)}</p>
      <p class=muted style="font-size:13px"><b>Models:</b> ${esc(t.models.join(', '))} · <b>${esc(comfyNodeCount(t.id))} nodes</b></p>
      <div class=row><a class=pill href="/comfyui/${esc(t.id)}.json" download="${esc(t.id)}.json">⬇ download workflow JSON</a>${t.link ? `
        <a class=pill href="${esc(t.link)}" target=_blank rel="noopener nofollow">upstream example ↗</a>` : ''}</div></div>
    <h2>Workflow JSON</h2>
    <div class=card><pre style="overflow:auto;font-size:12px;margin:0;white-space:pre">${esc(workflowJson(t.id))}</pre></div>`;
  return pageShell(`${t.title} — ComfyUI — Generative AI`, body, { canonical: `${BASE_URL}/comfyui/${t.id}` });
}

// ── Google Colab notebook library (operator: "Google-Colab template layer") ───────────────────────
function colabCard(t) {
  const url = colabLaunchUrl(t.id);
  return `<div class=sec>
    <div class=t>${esc(t.title)} <span class="badge cat">${esc(t.kind)}</span></div>
    <div class=d>${esc(t.summary)}<br><span class=muted>GPU: ${esc(t.gpu)}</span></div>
    <div class=row style="margin-top:10px">${url ? `<a class=pill href="${esc(url)}" target=_blank rel="noopener nofollow">▶ Open in Colab ↗</a>` : ''}
      <span class=muted style="font-size:12px">${esc(t.repo)}</span></div></div>`;
}

export function colabIndexView() {
  const byKind = COLAB_KINDS.map((k) => ({ k, list: colabByKind(k) })).filter((g) => g.list.length);
  const body = `<h1>Google Colab notebooks <span class=muted style="font-size:14px">· free GPU, one click</span></h1>
    <p class=muted>Curated, runnable notebooks — image generation, fine-tuning, audio, transcription, upscaling.
      Click <b>Open in Colab</b>, sign in with a Google account, and run the cells. Free Colab gives a GPU
      for a while; each note says what it needs. ${COLAB_TEMPLATES.length} notebooks.</p>
    ${byKind.map((g) => `<h2 style="text-transform:capitalize">${esc(g.k)}</h2>
      <div class=grid>${g.list.map(colabCard).join('')}</div>`).join('')}`;
  return pageShell('Google Colab notebook templates — Generative AI', body, { canonical: `${BASE_URL}/colab` });
}

// ── CapCut-style reel template maker (operator: "CapCut-style template maker") ────────────────────
function reelTemplateCard(t) {
  const { spec } = buildReelSpec(t.id, {});
  return `<a class=sec href="/reel-maker/${esc(t.id)}">
    <div class=t>${esc(t.title)} <span class="badge cat">${esc(t.aspect)}</span></div>
    <div class=d>${esc(spec.totalSeconds)}s · ${esc(spec.sceneCount)} scenes · ${esc(t.fields.length)} fields to fill<br>
      <span class=muted>Music: ${esc(t.music)}</span></div></a>`;
}

export function reelIndexView() {
  const body = `<h1>Reel template maker <span class=muted style="font-size:14px">· CapCut-style</span></h1>
    <p class=muted>Pick a structure, fill a few fields, and download a <b>storyboard / shotlist</b> you take into
      CapCut or any editor. Honest about what this is: a starting template — scenes, captions, timings and a
      music cue — <b>not</b> a rendered video. ${REEL_TEMPLATES.length} templates.</p>
    <div class=grid>${REEL_TEMPLATES.map(reelTemplateCard).join('')}</div>`;
  return pageShell('Reel template maker — Generative AI', body, { canonical: `${BASE_URL}/reel-maker` });
}

function aspectSelect(selected) {
  return `<select class=q name=aspect aria-label=Aspect style="flex:1 1 120px;width:auto">${REEL_ASPECTS.map((a) =>
    `<option value="${esc(a)}"${a === selected ? ' selected' : ''}>${esc(a)}</option>`).join('')}</select>`;
}

export function reelDetailView(id) {
  const t = getReelTemplate(id);
  if (!t) {
    return pageShell('Reel template not found — Generative AI', `<h1>Reel template not found</h1>
      <p class=muted><a href="/reel-maker">← all reel templates</a></p>`,
      { canonical: `${BASE_URL}/reel-maker`, robots: 'noindex,follow' });
  }
  const { spec } = buildReelSpec(t.id, {});
  const fields = t.fields.map((f) => `<label class=fld for="f_${esc(f.key)}">${esc(f.label)}
      <span class=ex>(e.g. ${esc(f.example)})</span></label>
    <input class=q id="f_${esc(f.key)}" name="f_${esc(f.key)}" placeholder="${esc(f.placeholder)}" autocomplete=off>`).join('');
  const preview = spec.scenes.map((s) =>
    `<li><span class=muted>[${esc(s.start)}s–${esc(s.start + s.seconds)}s · ${esc(s.role)}]</span> ${esc(s.caption)}</li>`).join('');
  const body = `<h1>${esc(t.title)} <span class="badge cat">${esc(t.aspect)}</span></h1>
    <p class=muted><a href="/reel-maker">← all reel templates</a></p>
    <div class=card><p class=muted style="font-size:13px">Example storyboard this builds (${esc(spec.totalSeconds)}s · music: ${esc(t.music)}):</p>
      <ol style="margin:0;padding-left:20px">${preview}</ol></div>
    <form class=gform method=post action="/reel-maker/${esc(t.id)}"><div class=card>${fields}
      <div class=row style="margin-top:14px">${aspectSelect(t.aspect)}
        <button type=submit>Build storyboard</button></div>
      <p class=muted style="font-size:12px;margin:10px 0 0">Downloads a JSON spec + shotlist. A starting template, not a rendered video.</p>
    </div></form>`;
  return pageShell(`${t.title} — Reel maker — Generative AI`, body, { canonical: `${BASE_URL}/reel-maker/${t.id}` });
}

// build the reel spec from a POST and return it as a downloadable JSON (with the shotlist embedded).
export function reelSpecFromParams(id, params) {
  const t = getReelTemplate(id);
  if (!t) return { ok: false, error: 'unknown reel template' };
  const fields = {};
  for (const f of t.fields) { const v = params.get('f_' + f.key); if (v != null) fields[f.key] = v; }
  const aspect = params.get('aspect');
  const built = buildReelSpec(id, fields, aspect ? { aspect } : {});
  if (!built.ok) return built;
  built.spec.shotlist = shotlist(built.spec);
  return built;
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

// Reusable "upload a photo → it becomes the image reference" widget + wiring, so ANY generate form
// (homepage, a template, a character effect) can put the UPLOADER into the scene via image-conditioning.
export function photoUploadWidget(prefix = 'ref') {
  return `<div class=row style="margin-top:12px;align-items:center;flex-wrap:wrap;gap:10px">
      <label class=pill style="cursor:pointer">📎 Upload your photo <input type=file id=${prefix}img accept="image/*" hidden></label>
      <span class=muted id=${prefix}name style="font-size:12px">optional — we'll put <b>you</b> (your face/photo) into this scene</span>
    </div>
    <input type=hidden name=image id=${prefix}url>`;
}
export function photoUploadScript(formId, prefix = 'ref') {
  return `<script>(function(){var form=document.getElementById('${formId}');if(!form)return;var fileI=document.getElementById('${prefix}img'),urlH=document.getElementById('${prefix}url'),nameS=document.getElementById('${prefix}name'),btn=form.querySelector('button[type=submit]');var uploaded=false;
    fileI.addEventListener('change',function(){var f=fileI.files&&fileI.files[0];uploaded=false;urlH.value='';nameS.textContent=f?('using '+f.name+' — you\\'ll be put into the scene'):'optional — we\\'ll put you into this scene';});
    form.addEventListener('submit',async function(e){var f=fileI.files&&fileI.files[0];if(!f||uploaded)return;e.preventDefault();var ot=btn.textContent;btn.disabled=true;btn.textContent='Uploading photo…';try{var r=await fetch('/api/upload',{method:'POST',headers:{'content-type':f.type||'image/jpeg'},body:f});var j=await r.json();if(j&&j.ok&&j.url){urlH.value=j.url;uploaded=true;btn.textContent='Generating…';form.submit();}else{btn.disabled=false;btn.textContent=ot;nameS.textContent='Upload failed — try a smaller image.';}}catch(err){btn.disabled=false;btn.textContent=ot;nameS.textContent='Upload failed — try again.';}});})();</script>`;
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
  // Portrait/character (avatar) templates — and any flagged usesPhoto — are "turn YOU into it": lead with
  // the photo upload so people know the killer feature. Scene/poster templates keep it optional.
  const photoForward = t.category === 'avatar' || t.category === 'environment' || t.usesPhoto;
  const body = `<h1>${esc(t.title)} <span class="badge cat">${esc(t.category)}</span></h1>
    <p class=muted><a href="/templates">← all templates</a></p>
    ${photoForward ? `<div class=card style="border-color:var(--gold)"><b>★ Turn YOU into this.</b> <span class=muted>Upload your photo below — this template drops you into the scene and keeps your face. Skip it to generate a fresh character instead.</span></div>` : ''}
    <div class=card><p class=muted style="font-size:13px">Example prompt this builds:</p>
      <p style="font-style:italic">${esc(exampleFor(t.id))}</p></div>
    <form class=gform id=tplform method=post action="/api/generate"><input type=hidden name=template value="${esc(t.id)}">
      <div class=card>${fields}
        ${photoUploadWidget('tpl')}
        <div class=row style="margin-top:14px">${sizeSelect(t.defaultSize)}
          <input class=q style="flex:1 1 180px;width:auto" name=place placeholder="place (optional — grounds the scene, e.g. North Texas)"> <input class=q style="flex:1 1 150px;width:auto" name=clouds placeholder="clouds (optional — e.g. pyrocumulus)"> <input class=q style="flex:1 1 140px;width:auto" name=seed type=number min=0 placeholder="seed (optional)">
          <button type=submit>Generate</button></div>
      </div></form>
    ${photoUploadScript('tplform', 'tpl')}`;
  return pageShell(`${t.title} — Generative AI`, body, { canonical: `${BASE_URL}/templates/${t.id}` });
}

function galleryCard(m) {
  const eng = m.note || m.provider || 'unknown engine';
  const tag = m.adult ? '<span style="background:#7a2540;color:#fff;font-size:10px;font-weight:700;padding:1px 5px;border-radius:3px;margin-right:4px">NSFW</span>' : '';
  return `<div class=gcard>
    <img src="/img/${esc(m.file)}" alt="${esc(String(m.prompt || '').slice(0, 120))}" loading=lazy>
    <div class=meta>${tag}<b>${esc(String(m.prompt || '').slice(0, 90))}</b><br>
      made by ${esc(eng)} · ${esc(m.size || '')} · <a href="/animate?img=${esc(m.file)}">✨ animate</a> · <a href="/vectorize?img=${esc(m.file)}">⬡ vectorize</a></div></div>`;
}

// Read a named cookie off the request (for the NSFW self-attestation toggle).
export function readCookie(req, name) {
  const raw = (req && req.headers && req.headers.cookie) || '';
  const m = raw.match(new RegExp('(?:^|;\\s*)' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '=([^;]*)'));
  return m ? decodeURIComponent(m[1]) : '';
}

// The NSFW toggle: figure/nude art is hidden by default. Turning it on requires an 18+
// self-attestation (confirm dialog) and sets the `hnsfw` cookie; the server then includes
// adult-flagged items. The front page stays SFW regardless — this gate is gallery-only.
export function galleryView({ nsfw = false } = {}) {
  const items = recentGenerations(60, { includeAdult: nsfw });
  const toggle = `<div class=card style="margin:10px 0">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type=checkbox id=nsfwToggle ${nsfw ? 'checked' : ''}>
        <span><b>Show NSFW</b> — figure &amp; nude art. ${nsfw ? 'On.' : 'Off — tasteful nude/figure art is hidden.'} <b>18+ only.</b></span>
      </label>
      <p class=muted style="font-size:12px;margin:6px 0 0">Nudity here is art, never pornographic. Turning this on confirms you are 18 or older.</p></div>
    <script>(function(){var t=document.getElementById('nsfwToggle');if(!t)return;t.addEventListener('change',function(){if(t.checked){if(!confirm('This reveals nude and figure art. Are you 18 or older?')){t.checked=false;return;}document.cookie='hnsfw=1; path=/; max-age=31536000; samesite=lax';}else{document.cookie='hnsfw=; path=/; max-age=0; samesite=lax';}location.reload();});})();</script>`;
  const body = `<h1>Shilpa Shastra <span class=muted style="font-size:14px">· the gallery</span></h1>
    <p class=muted>Named for the <b>Śilpa Śāstra</b>, the classical treatises on art and sacred image-making. The figure and the nude belong here as <b>art</b> — attractive, sometimes sensual, never pornographic. Recent generations, newest first, each labelled with the engine that made it.</p>
    ${toggle}
    ${items.length ? `<div class=gallery>${items.map(galleryCard).join('')}</div>`
      : `<div class=card><p class=empty>${nsfw ? 'Nothing here yet.' : 'No work shown yet.'} <a href="/">Make the first one →</a></p></div>`}`;
  return pageShell('Shilpa Shastra — the gallery', body, { canonical: `${BASE_URL}/gallery`, robots: nsfw ? 'noindex,nofollow' : undefined });
}

// ── the generate result page ──────────────────────────────────────────────────────────────────────
function resultPage(meta) {
  const body = `<h1>Your image</h1>
    <div class=card>
      <img src="/img/${esc(meta.file)}" alt="${esc(String(meta.prompt || '').slice(0, 120))}" style="max-width:100%;border-radius:8px;border:1px solid var(--line2)">
      <p class=muted style="margin-top:12px"><b>Prompt:</b> ${esc(meta.prompt)}</p>
      <p class=muted><b>Made by:</b> ${esc(meta.note || meta.provider)} · ${esc(meta.size || '')}${meta.seed != null ? ` · seed ${esc(meta.seed)}` : ''}</p>
      <div class=row style="margin-top:8px"><a class=pill href="/">← make another</a>
        <a class=pill style="border-color:var(--gold);color:var(--gold)" href="/animate?img=${esc(meta.file)}">✨ Animate</a>
        <a class=pill href="/vectorize?img=${esc(meta.file)}">⬡ Vectorize</a>
        <a class=pill href="/gallery">see the gallery</a>
        <a class=pill href="/img/${esc(meta.file)}" download>download</a></div>
      ${shareCta('Made something? Show it off —')}
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

// ── /api/video — server-side try OUR keys; else needsKey → the UI runs BYOK client-side. JSON out. ──
export async function handleVideo(req, res) {
  const ip = clientIp(req);
  const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (!rateOk(ip)) return j(429, { ok: false, error: 'rate-limited' });
  const params = await readBody(req);
  const prompt = String(params.get('prompt') || '').trim();
  const imageUrl = String(params.get('imageUrl') || '').trim();
  if (!prompt) return j(400, { ok: false, error: 'empty-prompt' });
  const r = await generateVideo({ prompt, imageUrl, seconds: parseInt(params.get('seconds'), 10) || 5 });
  if (r.ok) return j(200, { ok: true, provider: r.provider, url: r.url, note: r.note });
  // no server capacity → hand the browser everything it needs to BYOK
  return j(200, {
    ok: false, needsKey: true, tried: r.tried || [],
    providers: VIDEO_PROVIDERS.filter((p) => p.byok).map((p) => ({ id: p.id, name: p.name, browser: !!p.browser, note: p.note, free: p.free })),
    instructions: BYOK_INSTRUCTIONS,
  });
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
  // optional reference image → image conditioning (upload your photo, get new images of it). The value is a
  // /img/<file> we saved from an upload; resolve to an absolute URL so the provider can fetch it.
  const imgParam = String(params.get('image') || '').trim();
  let image = null;
  if (/^\/img\/[\w.-]+\.(png|jpe?g|webp)$/i.test(imgParam)) image = { url: `${BASE_URL}${imgParam}` };
  // Content safety: refuse sexual imagery of minors or of uploaded real people; allow adult
  // art of your own character but flag it so it never reaches the front page / public gallery.
  const screen = screenPrompt(cleaned, { hasReferenceImage: !!image });
  if (!screen.ok) {
    const note = screen.reason === 'minor'
      ? 'That request was blocked. This studio never generates sexual or nude imagery involving minors.'
      : screen.reason === 'pornographic'
        ? 'That request was blocked. Tasteful nudity and figure art are welcome here — hardcore/pornographic content (sex acts, penetration, fluids) is not.'
        : 'That request was blocked. You can make nude or figure art of your own character, but the studio will not generate it from an uploaded photo of a real person.';
    return sendHtml(res, homePage({ note }), 400);
  }
  // With an uploaded photo, steer the edit model to PLACE that person into the scene (keep their face),
  // so templates/prompts "put THEM in a photo" instead of merely restyling. Saved prompt stays `cleaned`.
  let genPrompt = image
    ? `Put the uploaded person into this scene, keeping their face and likeness the same. ${cleaned}`
    : cleaned;
  // Hathor's reasoning: if a place is given, ground the scene in real geo/climate/facts of that place so
  // it looks accurate (e.g., "North Texas" → prairie, DFW skyline, hot hazy light). Soft-fail, opt-in.
  const place = String(params.get('place') || '').trim().slice(0, 80);
  const clouds = String(params.get('clouds') || '').trim().slice(0, 40);
  if (place || clouds) { try { const pg = await import('../../integrations/genai-place-grounding.mjs'); const e = await pg.enrichPrompt(genPrompt, place, clouds); if (e && e.grounded) genPrompt = e.prompt; } catch { /* grounding optional */ } }
  let result;
  try { result = await _generate({ prompt: genPrompt, size, seed: seed != null ? +seed : null, image }); }
  catch { result = { ok: false, error: 'generation failed' }; }

  if (!result || !result.ok) {
    return sendHtml(res, homePage({ note: 'No engine could make that image right now — please try again.' }), 502);
  }
  const meta = saveGeneration({
    base64: result.base64, mime: result.mime, prompt: cleaned,
    provider: result.provider, note: result.note, size: result.size || size, seed: result.seed,
    adult: screen.adult,
  });
  if (!meta) {
    return sendHtml(res, homePage({ note: 'The image was made but could not be saved — please try again.' }), 500);
  }
  return sendHtml(res, resultPage(meta));
}

// ── /api/upload — accept a reference image (raw binary POST), save it, return its /img/ URL. ────────
// This is what lets people UPLOAD a photo and then generate new images from it (image conditioning).
function readRawBody(req, cap = 8 * 1024 * 1024) {
  return new Promise((resolve) => {
    const chunks = []; let n = 0; let tooBig = false;
    req.on('data', (c) => { n += c.length; if (n > cap) { tooBig = true; return; } chunks.push(c); });
    req.on('end', () => resolve(tooBig ? null : Buffer.concat(chunks)));
    req.on('error', () => resolve(null));
  });
}
export async function handleUpload(req, res) {
  const ip = clientIp(req);
  const j = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify(obj)); };
  if (!rateOk(ip)) return j(429, { ok: false, error: 'rate-limited' });
  const ct = String((req.headers && req.headers['content-type']) || '').toLowerCase();
  const mime = ct.startsWith('image/') ? ct.split(';')[0] : 'image/jpeg';
  if (!EXT[mime]) return j(415, { ok: false, error: 'send a raw image/* body (png, jpeg, or webp)' });
  const buf = await readRawBody(req);
  if (!buf || buf.length < 64) return j(400, { ok: false, error: 'no image (or too large — 8MB max)' });
  try {
    ensureDir();
    const file = `up-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${EXT[mime]}`;
    writeFileSync(join(DATA_DIR, file), buf);
    return j(200, { ok: true, url: `/img/${file}`, file });
  } catch { return j(500, { ok: false, error: 'could not save' }); }
}

// ── /convert — image convert + compress (a hub file-tool). Free, CPU, via sharp. No GPU, no upload
// stored: convert in-memory and stream the result back for download. doc→PDF / video are later tiers
// (LibreOffice / ffmpeg). ────────────────────────────────────────────────────────────────────────
const CONVERT_FORMATS = ['webp', 'jpeg', 'png', 'avif'];
export async function handleConvert(req, res) {
  const ip = clientIp(req);
  const err = (code, msg) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: false, error: msg })); };
  if (!rateOk(ip)) return err(429, 'rate-limited');
  const u = new URL(req.url, BASE_URL);
  const fmt = CONVERT_FORMATS.includes(String(u.searchParams.get('fmt'))) ? u.searchParams.get('fmt') : 'webp';
  let q = parseInt(u.searchParams.get('q'), 10); if (!(q >= 1 && q <= 100)) q = 80;
  let w = parseInt(u.searchParams.get('w'), 10); if (!(w >= 16 && w <= 8000)) w = 0;
  const buf = await readRawBody(req);
  if (!buf || buf.length < 64) return err(400, 'no image (or too large — 8MB max)');
  let sharp;
  try { sharp = (await import('sharp')).default; } catch { return err(503, 'converter unavailable on this host'); }
  try {
    let img = sharp(buf, { failOn: 'none' }).rotate();
    if (w) img = img.resize({ width: w, withoutEnlargement: true });
    if (fmt === 'jpeg') img = img.jpeg({ quality: q });
    else if (fmt === 'png') img = img.png({ compressionLevel: 9 });
    else if (fmt === 'avif') img = img.avif({ quality: q });
    else img = img.webp({ quality: q });
    const out = await img.toBuffer();
    res.writeHead(200, { 'content-type': `image/${fmt}`, 'cache-control': 'no-store', 'content-disposition': `attachment; filename="converted.${fmt === 'jpeg' ? 'jpg' : fmt}"` });
    return res.end(out);
  } catch { return err(422, 'could not convert that image'); }
}
// /api/convert-file — the COMPLEX-format converter (3D, video, audio, vector, PSD, PDF) via the engine
// (genai-convert.mjs → ffmpeg/assimp/ImageMagick/rsvg/ghostscript on the box). Upload → convert → stream.
export async function handleConvertFile(req, res) {
  const ip = clientIp(req);
  const err = (code, msg) => { res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' }); res.end(JSON.stringify({ ok: false, error: msg })); };
  if (!rateOk(ip)) return err(429, 'rate-limited');
  const u = new URL(req.url, BASE_URL);
  const from = String(u.searchParams.get('from') || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8);
  const to = String(u.searchParams.get('to') || '').replace(/[^a-z0-9]/gi, '').toLowerCase().slice(0, 8);
  if (!from || !to) return err(400, 'need ?from= and ?to= extensions');
  const buf = await readRawBody(req, 64 * 1024 * 1024); // 64MB for 3D/video
  if (!buf || buf.length < 8) return err(400, 'no file (or too large — 64MB max)');
  let eng;
  try { eng = await import('../../integrations/genai-convert.mjs'); } catch { return err(503, 'converter unavailable'); }
  if (!eng.pickTool(from, to)) return err(415, `cannot convert ${from} → ${to}`);
  const tmp = join(tmpdir(), `cv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  const inPath = `${tmp}.${from}`;
  try {
    writeFileSync(inPath, buf);
    const r = await eng.convert(inPath, to, { timeout: 180000 });
    if (!r.ok) { try { rmSync(inPath, { force: true }); } catch {} return err(422, r.error || 'conversion failed'); }
    const out = readFileSync(r.outPath);
    res.writeHead(200, { 'content-type': 'application/octet-stream', 'cache-control': 'no-store', 'content-disposition': `attachment; filename="converted.${to}"` });
    res.end(out);
    try { rmSync(inPath, { force: true }); rmSync(r.outPath, { force: true }); } catch {}
  } catch { try { rmSync(inPath, { force: true }); } catch {} return err(500, 'conversion error'); }
}

// /tools — the complete hub: every tool grouped, with a one-line what + a numbered how-to + a link.
// Driven by the one registry (integrations/genai-tools.mjs) that also feeds the wiki + forum.
export function toolsHubView() {
  const groups = toolsByCat();
  const sections = Object.entries(groups).map(([cat, tools]) => `
    <h2>${esc(cat)}</h2>
    <div class=grid>${tools.map((t) => `<div class=card>
      <div class=t><a href="${esc(t.url)}">${esc(t.title)}</a></div>
      <p class=muted style="font-size:13px">${esc(t.what)}</p>
      <ol style="font-size:12px;color:var(--muted);margin:6px 0 0 1em;padding:0">${t.howto.map((s) => `<li>${esc(s)}</li>`).join('')}</ol>
      <p style="margin-top:8px"><a class=pill href="${esc(t.url)}">Open ${esc(t.title)} →</a></p></div>`).join('')}</div>`).join('');
  const body = `<h1>All Tools <span class=muted style="font-size:14px">· the hub</span></h1>
    <p class=muted>Everything you can make here — each with a quick how-to. Free, no login. Full guides on the <a href="${esc(WIKI)}">Library/Wiki</a>; ask in the <a href="${esc(FORUM)}">forum</a>.</p>
    ${sections}`;
  return pageShell('All Tools — Hathor Studio', body, { canonical: `${BASE_URL}/tools`, description: 'Every Hathor Studio tool with a how-to: generate, templates, convert, vectorize, video, reels, ComfyUI, and more. Free, no login.' });
}

export function convertView() {
  const body = `<h1>Convert &amp; Compress <span class=muted style="font-size:14px">· file tool</span></h1>
    <p class=muted>Turn files into other files, and shrink them — free, on our own tools, no GPU. Images convert in-memory; complex files (3D, video, audio, vector, PDF) convert on our box and stream back. Nothing is stored.</p>
    <div class=card style="border-color:var(--gold)"><b>Complex files</b> <span class=muted>— 3D <code>fbx/obj/gltf/glb/stl/dae</code>, video <code>mp4/webm/gif</code>, audio <code>wav/mp3/ogg</code>, vector <code>svg→png/pdf</code>, <code>psd→png</code>, PDF compress. Choose a file, type the target extension, convert.</span>
      <form class=gform id=cffo style="margin-top:10px"><div class=row style="gap:10px;flex-wrap:wrap;align-items:center">
        <label class=pill style="cursor:pointer">📎 Choose a file <input type=file id=cffile hidden></label>
        <span class=muted id=cfname style="font-size:12px">no file</span>
        <label class=fld style="width:auto">Convert to <input class=q id=cfto placeholder="glb / gif / png / mp3 …" style="width:150px"></label>
        <button type=submit id=cfbtn>Convert &amp; download</button><span class=muted id=cfstatus style="font-size:12px"></span>
      </div></form>
      <script>(function(){var f=document.getElementById('cffo'),fi=document.getElementById('cffile'),nm=document.getElementById('cfname'),st=document.getElementById('cfstatus'),bt=document.getElementById('cfbtn');
        fi.addEventListener('change',function(){var x=fi.files&&fi.files[0];nm.textContent=x?x.name:'no file';});
        f.addEventListener('submit',async function(e){e.preventDefault();var x=fi.files&&fi.files[0];var to=(document.getElementById('cfto').value||'').replace(/[^a-z0-9]/gi,'').toLowerCase();if(!x||!to){st.textContent='Pick a file and a target format.';return;}
          var from=(x.name.split('.').pop()||'').toLowerCase();bt.disabled=true;st.textContent='Converting…';
          try{var r=await fetch('/api/convert-file?from='+from+'&to='+to,{method:'POST',headers:{'content-type':'application/octet-stream'},body:x});
            if(!r.ok){var j=await r.json().catch(function(){return{};});st.textContent='Failed: '+(j.error||r.status);bt.disabled=false;return;}
            var b=await r.blob();var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='converted.'+to;a.click();st.textContent='Done — '+(b.size/1024|0)+' KB.';bt.disabled=false;
          }catch(err){st.textContent='Failed.';bt.disabled=false;}});})();</script>
    </div>
    <form class=gform id=cvform><div class=card>
      <label class=pill style="cursor:pointer">📎 Choose an image <input type=file id=cvfile accept="image/*" hidden></label>
      <span class=muted id=cvname style="font-size:12px;margin-left:8px">no file chosen</span>
      <div class=row style="margin-top:12px;gap:10px;flex-wrap:wrap">
        <label class=fld style="width:auto">Format
          <select class=q id=cvfmt style="width:auto"><option value=webp>WebP</option><option value=jpeg>JPG</option><option value=png>PNG</option><option value=avif>AVIF</option></select></label>
        <label class=fld style="width:auto">Quality <input class=q id=cvq type=number min=1 max=100 value=80 style="width:90px"></label>
        <label class=fld style="width:auto">Max width (px, optional) <input class=q id=cvw type=number min=16 max=8000 placeholder="keep" style="width:120px"></label>
      </div>
      <div class=row style="margin-top:12px"><button type=submit id=cvbtn>Convert &amp; download</button>
        <span class=muted id=cvstatus style="font-size:12px"></span></div>
    </div></form>
    <script>(function(){var f=document.getElementById('cvform'),fi=document.getElementById('cvfile'),nm=document.getElementById('cvname'),st=document.getElementById('cvstatus'),bt=document.getElementById('cvbtn');
      fi.addEventListener('change',function(){var x=fi.files&&fi.files[0];nm.textContent=x?x.name:'no file chosen';});
      f.addEventListener('submit',async function(e){e.preventDefault();var x=fi.files&&fi.files[0];if(!x){st.textContent='Choose an image first.';return;}
        var fmt=document.getElementById('cvfmt').value,q=document.getElementById('cvq').value,w=document.getElementById('cvw').value;
        bt.disabled=true;st.textContent='Converting…';
        try{var qs='fmt='+fmt+'&q='+encodeURIComponent(q)+(w?'&w='+encodeURIComponent(w):'');
          var r=await fetch('/api/convert?'+qs,{method:'POST',headers:{'content-type':x.type||'image/*'},body:x});
          if(!r.ok){st.textContent='Convert failed ('+r.status+').';bt.disabled=false;return;}
          var b=await r.blob();var a=document.createElement('a');a.href=URL.createObjectURL(b);a.download='converted.'+(fmt==='jpeg'?'jpg':fmt);a.click();
          st.textContent='Done — '+(b.size/1024|0)+' KB.';bt.disabled=false;
        }catch(err){st.textContent='Convert failed.';bt.disabled=false;}});})();</script>`;
  return pageShell('Convert & Compress — file tool', body, { canonical: `${BASE_URL}/convert` });
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

// ── social share prompt (operator: "prompt them to share their images on social media") ───────────
function shareCta(intro = 'Share your creation —') {
  const u = encodeURIComponent(`${BASE_URL}/char`);
  const t = encodeURIComponent(`I made this free with AI on ${BASE_URL} — no login, no card. #MELEK #SoapBox`);
  return `<div class=card><b>${esc(intro)}</b>
    <div style="margin-top:8px">
      <a class=pill style="border-color:var(--gold);color:var(--gold)" href="${esc(FORUM)}/post" target=_blank rel="noopener">✦ Share on MELEK</a>
      <a class=pill style="border-color:#5865F2;color:#5865F2" href="${esc(DISCORD)}" target=_blank rel="noopener">💬 Show it on Discord</a>
      <a class=pill href="https://twitter.com/intent/tweet?text=${t}&url=${u}" target=_blank rel="noopener">Share on X</a>
      <a class=pill href="https://www.facebook.com/sharer/sharer.php?u=${u}" target=_blank rel="noopener">Facebook</a>
      <a class=pill href="https://www.reddit.com/submit?url=${u}" target=_blank rel="noopener">Reddit</a>
      <a class=pill href="https://t.me/share/url?url=${u}" target=_blank rel="noopener">Telegram</a>
    </div>
    <p class=muted style="font-size:12px;margin-top:8px"><b>Share on MELEK</b> posts it to our community — your creations, on our own chain. Or download and post on Instagram, TikTok or anywhere — tag us and use <b>#MELEK</b> so others find the free tools.</p></div>`;
}

// ── character effects gallery (operator: Animals, Holidays, Movies, Military, Mafia, Cartel…) ──────
function effectCard(e) {
  return `<div class=sec><div class=t>${esc(e.title)} <span class="badge cat">${esc(EFFECT_CAT_LABELS[e.category] || e.category)}</span></div></div>`;
}
export function charIndexView() {
  const byCat = EFFECT_CATEGORIES.map((c) => ({ c, items: listEffects(c) })).filter((g) => g.items.length);
  const chars = `<div class=grid>${CHARACTERS.map((c) =>
    `<div class=sec><div class=t>${esc(c.name)} <span class="badge cat">${esc(c.kind)}</span></div><div class=d>${esc(c.description)}</div></div>`).join('')}
    <a class=sec id=create href="/school"><div class=t>✨ Create your own character</div><div class=d>Make a reusable character on the platform, then run it through any effect. Learn how in GenAI School.</div></a></div>`;
  const cats = byCat.map((g) =>
    `<h2>${esc(EFFECT_CAT_LABELS[g.c] || g.c)} <span class=muted style="font-size:13px">(${g.items.length})</span></h2><div class=grid>${g.items.map(effectCard).join('')}</div>`).join('');
  const body = `<h1>Character effects <span class=muted style="font-size:14px">· same character, brand-new scene</span></h1>
    <p class=muted>Pick a character, pick an effect — it keeps the <b>same character</b> but makes a completely new image, not the original photo. Use built-in <b>Hathor</b>, <a href="#create">create your own</a>, or a fictional one. A real person’s face needs consent; fictional and platform characters are open. Public figures are fair game for satire.</p>
    <h2>Characters</h2>${chars}
    ${cats}
    ${shareCta('Made something you love? Show it off —')}
    <div class=card><p class=muted style="font-size:13px">Same idea as CapCut / Midjourney character reference. Want full control on your own GPU? <a href="/school">GenAI School</a> covers ComfyUI + Colab / Modal / Fal. Want it on a shirt? A vectorized-design maker is coming so you can print these.</p></div>`;
  return pageShell('Character effects — Generative AI', body, { canonical: `${BASE_URL}/char`, description: 'Turn a character into anything — Animals, Holidays, Movie themes, Superheroes, Military, Mafia and more. Same character, brand-new scene.' });
}

// ── GenAI School — learn it here, then run it yourself ─────────────────────────────────────────────
function lessonCard(l) {
  const links = (l.do || []).map((d) =>
    `<a href="${esc(d.href)}"${/^https?:/i.test(d.href) ? ' target=_blank rel="noopener"' : ''}>${esc(d.label)}</a>`).join(' · ');
  const disc = l.disclaimer
    ? `<div class=muted style="font-size:12px;margin-top:8px;border-top:1px solid var(--line);padding-top:8px">${esc(l.disclaimer)}</div>` : '';
  return `<div class=sec><div class=t>${esc(l.title)} <span class="badge cat">${esc(l.minutes)} min</span></div>
    <div class=d>${esc(l.summary)}</div>
    <div style="margin-top:8px;font-size:13px">${links}</div>${disc}</div>`;
}
export function schoolIndexView() {
  const body = `<h1>GenAI School <span class=muted style="font-size:14px">· learn it here, then run it yourself</span></h1>
    <p class=muted>Start with our one-tap <a href="/templates">templates</a> and <a href="/char">character effects</a>, then graduate: build your own ComfyUI pipelines, run them on Colab / Modal / Fal, pull models from Hugging Face and Civitai, upload your own templates, and share what you make in the <a href="${esc(FORUM)}">forum</a> and the <a href="${esc(WIKI)}">Library</a>.</p>
    ${TRACKS.map((t) => { const ls = listLessons(t.id); return ls.length ? `<h2>${esc(t.title)}</h2><div class=grid>${ls.map(lessonCard).join('')}</div>` : ''; }).join('')}`;
  return pageShell('GenAI School — learn generative AI', body, { canonical: `${BASE_URL}/school`, description: 'GenAI School — learn generative AI from one-tap templates up to running your own pipelines on Colab, Modal, Fal and ComfyUI, plus models from Hugging Face and Civitai.' });
}

// ── /cards — free, client-side business-card designer (print-ready 3.5x2 @ 300dpi) ────────────────
export function cardsView() {
  const body = `<h1>Business Cards <span class=muted style="font-size:14px">· design one free, print-ready</span></h1>
    <p class=muted>Fill in your details, pick a layout, add a logo (upload, or make one in the <a href="/">studio</a>), and download a print-ready card — 3.5×2in at 300&nbsp;DPI. Free, in your browser. Take the file to your printer or <a href="https://www.executivepress.com" target=_blank rel="noopener">Executive Press</a>.</p>
    <div class=card>
      <div class=grid style="grid-template-columns:1fr 1fr">
        <div>
          <label class=fld>Name<input class=q id=f_name value="Rev. Ryan Van Kush"></label>
          <label class=fld>Title<input class=q id=f_title value="Founder"></label>
          <label class=fld>Company<input class=q id=f_org value="Van Kush Family"></label>
          <label class=fld>Phone<input class=q id=f_phone value="(720) 369-8172"></label>
          <label class=fld>Email<input class=q id=f_email value="hello@soapbox.community"></label>
          <label class=fld>Website<input class=q id=f_web value="soapbox.community"></label>
          <label class=fld>Tagline<input class=q id=f_tag value="Free tools for everyone"></label>
        </div>
        <div>
          <label class=fld>Layout<select class=q id=f_layout>
            <option value=classic>Classic (side bar)</option><option value=modern>Modern (top band)</option>
            <option value=minimal>Minimal</option><option value=bold>Bold (full color)</option></select></label>
          <label class=fld>Accent color<input class=q id=f_color type=color value="#d29922" style="height:44px;padding:4px"></label>
          <label class=fld>Logo (optional)<input class=q id=f_logo type=file accept="image/*"></label>
          <div style="margin-top:10px"><button type=button id=dlpng>⬇ Download PNG (print-ready)</button></div>
        </div>
      </div>
      <div style="margin-top:14px;text-align:center;background:#0b0f14;border-radius:10px;padding:14px">
        <canvas id=card width=1050 height=600 style="width:100%;max-width:525px;box-shadow:0 4px 24px #0008;border-radius:6px;background:#fff"></canvas>
      </div>
    </div>
    <div class=card><p class=muted style="font-size:13px">Next: flyers, stickers and more print items. Make a logo/design in the <a href="/">studio</a>, <a href="/vectorize">vectorize</a> it, and drop it here.</p></div>
    <script>
    (function(){
      var ids=['name','title','org','phone','email','web','tag','layout','color'];
      var el={}; ids.forEach(function(k){ el[k]=document.getElementById('f_'+k); });
      var cv=document.getElementById('card'), ctx=cv.getContext('2d'), W=1050, H=600, logo=null;
      function v(k){ return (el[k].value||'').trim(); }
      function draw(){
        var acc=v('color')||'#d29922', lay=v('layout');
        ctx.clearRect(0,0,W,H); ctx.fillStyle='#ffffff'; ctx.fillRect(0,0,W,H);
        var tx=70, dark='#111', mut='#555';
        if(lay==='classic'){ ctx.fillStyle=acc; ctx.fillRect(0,0,26,H); tx=80; }
        else if(lay==='modern'){ ctx.fillStyle=acc; ctx.fillRect(0,0,W,120); }
        else if(lay==='bold'){ ctx.fillStyle=acc; ctx.fillRect(0,0,W,H); dark='#fff'; mut='rgba(255,255,255,.85)'; }
        else { ctx.strokeStyle=acc; ctx.lineWidth=6; ctx.strokeRect(20,20,W-40,H-40); }
        // logo top-right
        if(logo){ try{ var lw=150, lh=logo.height*(lw/logo.width); ctx.drawImage(logo, W-lw-70, (lay==='modern'?135:70), lw, lh);}catch(e){} }
        var y=(lay==='modern'?210:150);
        ctx.textBaseline='alphabetic'; ctx.fillStyle=dark; ctx.font='bold 64px system-ui,sans-serif';
        ctx.fillText(v('name'), tx, y); y+=54;
        ctx.fillStyle=acc; ctx.font='600 34px system-ui,sans-serif'; ctx.fillText(v('title')+(v('org')?'  ·  '+v('org'):''), tx, y);
        ctx.fillStyle=mut; ctx.font='30px system-ui,sans-serif';
        var cy=H-190; ['phone','email','web'].forEach(function(k){ if(v(k)){ ctx.fillText(v(k), tx, cy); cy+=44; } });
        if(v('tag')){ ctx.fillStyle=acc; ctx.font='italic 28px system-ui,sans-serif'; ctx.fillText(v('tag'), tx, H-50); }
      }
      ids.forEach(function(k){ el[k].addEventListener('input', draw); });
      document.getElementById('f_logo').addEventListener('change', function(e){ var f=e.target.files&&e.target.files[0]; if(!f){logo=null;draw();return;} var im=new Image(); im.onload=function(){ logo=im; draw(); }; im.src=URL.createObjectURL(f); });
      document.getElementById('dlpng').addEventListener('click', function(){ var a=document.createElement('a'); a.download='business-card.png'; a.href=cv.toDataURL('image/png'); a.click(); });
      draw();
    })();
    </script>`;
  return pageShell('Business Card Designer — Hathor studio', body, { canonical: `${BASE_URL}/cards`, description: 'Design a print-ready business card free, in your browser — 3.5x2in at 300 DPI, four layouts, your logo. Then print it.' });
}

// ── /vectorize — free, client-side raster→SVG for print-ready t-shirt/item designs ────────────────
// Traces an image to clean vector SVG entirely in the browser (ImageTracer.js). No GPU, no server
// cost. The SVG is print/screen-ready and scales infinitely — the first step of design → shirt/item
// → 3D → game. (3D/model steps that need a GPU are a PRANA job; this stage is free.)
export function vectorizeView(imgFile) {
  const file = basename(String(imgFile || ''));
  const safe = /^[\w.-]+\.(png|jpg|jpeg|webp)$/i.test(file) ? file : '';
  const imgUrl = safe ? '/img/' + safe : '';
  const body = `<h1>Vectorize <span class=muted style="font-size:14px">· make a print-ready SVG</span></h1>
    <p class=muted>Turn a design into clean <b>vector SVG</b> — infinitely scalable, ready for t-shirts, stickers, and screen printing. Free, in your browser, no GPU. ${safe ? '' : 'Open this from any image in the <a href="/gallery">gallery</a> (the ⬡ Vectorize link), or upload one below.'}</p>
    <div class=card>
      <div class=row style="gap:8px;margin-bottom:10px">
        <label class=fld style="margin:0">Colors <select class=q id=colors style="width:auto">
          <option value=2>2</option><option value=4>4</option><option value=8 selected>8</option><option value=16>16</option><option value=32>32</option></select></label>
        <input type=file id=up accept="image/*" class=q style="width:auto">
        <button type=button id=go>Vectorize</button>
        <a class=pill id=dl style="display:none" download="design.svg">⬇ Download SVG</a>
      </div>
      <div id=out style="min-height:120px;background:#fff;border-radius:10px;padding:8px;overflow:auto"></div>
      <p class=muted id=status style="font-size:12px;margin-top:8px">Loading…</p>
    </div>
    <div class=card><p class=muted style="font-size:13px">Next in the chain: drop the SVG on a shirt/mug mockup, and (on our GPU / PRANA) turn it into a 3D model you can export to a game. See <a href="/school">GenAI School</a>. Ready to print? <a href="https://www.executivepress.com" target=_blank rel="noopener">Executive Press</a> can put your design on shirts, cards and more.</p></div>
    <script src="https://cdn.jsdelivr.net/npm/imagetracerjs@1.2.6/imagetracer_v1.2.6.js"></script>
    <script>
    (function(){
      var IMG = ${JSON.stringify(imgUrl)};
      var out=document.getElementById('out'), status=document.getElementById('status'), dl=document.getElementById('dl'),
          go=document.getElementById('go'), colors=document.getElementById('colors'), up=document.getElementById('up');
      var current = IMG || '';
      function trace(url){
        if (!url){ status.textContent='Pick or upload an image first.'; return; }
        if (typeof ImageTracer==='undefined'){ status.textContent='Vectorizer failed to load — refresh and retry.'; return; }
        status.textContent='Vectorizing…'; dl.style.display='none';
        try {
          ImageTracer.imageToSVG(url, function(svg){
            out.innerHTML = svg;
            var s = out.querySelector('svg'); if (s){ s.setAttribute('width','100%'); s.removeAttribute('height'); }
            var blob = new Blob([svg], {type:'image/svg+xml'});
            dl.href = URL.createObjectURL(blob); dl.style.display=''; status.textContent='Done — download your SVG.';
          }, { numberofcolors: parseInt(colors.value,10)||8, ltres:1, qtres:1, pathomit:8, blurradius:0 });
        } catch(e){ status.textContent='Could not vectorize that image.'; }
      }
      go.addEventListener('click', function(){ trace(current); });
      up.addEventListener('change', function(){ var f=up.files&&up.files[0]; if(!f) return; current=URL.createObjectURL(f); status.textContent='Loaded '+f.name+' — hit Vectorize.'; });
      if (IMG){ status.textContent='Image loaded — hit Vectorize.'; } else { status.textContent='Upload an image to vectorize.'; }
    })();
    </script>`;
  return pageShell('Vectorize — Hathor studio', body, { canonical: `${BASE_URL}/vectorize`, robots: 'noindex,follow', description: 'Turn any design into a clean, print-ready vector SVG — free, in your browser. For t-shirts, stickers and screen printing.' });
}

// ── /news — Hathor announces what's up, in her voice ──────────────────────────────────────────────
export function newsView() {
  const fx = EFFECT_TEMPLATES.length, hathorN = listEffects('hathor').length, horrorN = listEffects('horror').length;
  const body = `<h1>From Hathor <span class=muted style="font-size:14px">· the MELEK Witness</span></h1>
    <div class=card>
      <p>My studio is open, and I have been busy. Everything here is <b>free</b> — no account, no card. Come make with me.</p>
    </div>
    <h2>What is up now</h2>
    <div class=grid>
      <a class=sec href="/char"><div class=t>Become anything <span class="badge cat">${esc(fx)}</span></div><div class=d>${esc(fx)} character effects — animals, movies, superheroes, mafia, cyberpunk, art, the old gods and figures. Same you, brand-new scene.</div></a>
      <a class=sec href="/hathor"><div class=t>Appear with me <span class="badge cat">${esc(hathorN)}</span></div><div class=d>Stand beside me in ${esc(hathorN)} scenes — a selfie, a throne, the Nile, the stars.</div></a>
      <a class=sec href="/halloween"><div class=t>Halloween <span class="badge cat">${esc(horrorN)}</span></div><div class=d>${esc(horrorN)} spooky looks, and my Halloween guardian, Anpu. Thanksgiving and Christmas follow.</div></a>
      <a class=sec href="/reel-maker"><div class=t>Reels <span class="badge cat">${esc(REEL_TEMPLATES.length)}</span></div><div class=d>CapCut-style storyboards — pick a structure, fill the fields, take it to your editor.</div></a>
      <a class=sec href="/gallery"><div class=t>Animate ✨</div><div class=d>Add epic effects to any image — shatter glass, explode, zoom — and download a clip. Free, in your browser.</div></a>
      <a class=sec href="/school"><div class=t>The School <span class="badge cat">${esc(LESSONS.length)}</span></div><div class=d>Learn it here, then run it yourself on free and cheap GPUs. Build on my open repository.</div></a>
    </div>
    <h2>My tests</h2>
    <p class=muted>I have been making things too — see them in the <a href="/gallery">gallery</a>: myself as a pharaoh, a space knight, a gothic figure, and Kali.</p>
    <h2>One house, many wings</h2>
    <p class=muted>This studio is part of my system. Visit the <a href="${esc(ALMANACK)}">Almanack</a> for the turning of the seasons and the sky, the
      <a href="${esc(WIKI)}">Library of Ashurbanipal</a> for the knowledge, <a href="${esc(HATHOR_LIVE)}">hathor.live</a> for me, and the
      <a href="${esc(REPO)}">Bot repository</a> to build your own with my tools. When you make something, <b>share it on MELEK</b> — your work, on our own chain.</p>
    ${shareCta('Made something with me? Show it off —')}`;
  return pageShell('From Hathor — announcements', body, { canonical: `${BASE_URL}/news`, description: 'Hathor announces her studio: 130+ character effects, appear-with-Hathor scenes, Halloween, reels, animate, and the GenAI School — all free.' });
}

// ── /animate — free, client-side clip effects (shatter glass, explode, zoom, glitch) ──────────────
// Takes an image we generated (?img=<file>), animates it on a <canvas>, and records a downloadable
// WebM via MediaRecorder. No GPU, no server cost — all in the browser. True AI video is a PRANA/GPU
// job later; this is the free motion lane.
export function animateView(imgFile) {
  const file = basename(String(imgFile || ''));
  const safe = /^[\w.-]+\.(png|jpg|jpeg|webp)$/i.test(file) ? file : '';
  const imgUrl = safe ? '/img/' + safe : '';
  const body = `<h1>Animate <span class=muted style="font-size:14px">· add an epic effect, download a clip</span></h1>
    <p class=muted>Free, in your browser — no GPU. <b>Upload a photo</b> (or open one from the <a href="/gallery">gallery</a>), pick an effect, hit Record, and download a clip.</p>
    <div class=card>
      <div class=row style="gap:8px;margin-bottom:10px">
        <input type=file id=up accept="image/*" class=q style="width:auto">
        <button type=button data-fx=shatter>Shatter Glass</button>
        <button type=button data-fx=explode>Explode</button>
        <button type=button data-fx=zoom>Epic Zoom</button>
        <button type=button data-fx=glitch>Glitch</button>
        <a class=pill id=dl style="display:none" download="clip.webm">⬇ Download clip</a>
      </div>
      <canvas id=cv width=768 height=768 style="width:100%;max-width:768px;border:1px solid var(--line2);border-radius:10px;background:#000"></canvas>
      <p class=muted id=status style="font-size:12px;margin-top:8px">Loading image…</p>
    </div>
    <script>
    (function(){
      var IMG = ${JSON.stringify(imgUrl)};
      var cv = document.getElementById('cv'), ctx = cv.getContext('2d'), status = document.getElementById('status'), dl = document.getElementById('dl');
      var img = new Image(); img.crossOrigin = 'anonymous';
      var W = cv.width, H = cv.height, rec = null, chunks = [], playing = false, ready = false;
      img.onload = function(){ ready = true; ctx.drawImage(img,0,0,W,H); status.textContent = 'Ready — pick an effect.'; };
      img.onerror = function(){ status.textContent = 'Could not load the image.'; };
      if (IMG) { status.textContent = 'Loading…'; img.src = IMG; } else { status.textContent = 'Upload a photo to begin.'; }
      document.getElementById('up').addEventListener('change', function(e){ var f = e.target.files && e.target.files[0]; if (!f) return; ready = false; status.textContent = 'Loading ' + f.name + '…'; img.src = URL.createObjectURL(f); });
      function startRec(){
        chunks = []; dl.style.display='none';
        try {
          var stream = cv.captureStream(30);
          rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
          rec.ondataavailable = function(e){ if (e.data && e.data.size) chunks.push(e.data); };
          rec.onstop = function(){
            var blob = new Blob(chunks, { type: 'video/webm' });
            dl.href = URL.createObjectURL(blob); dl.style.display=''; status.textContent = 'Clip ready — download it.';
          };
          rec.start();
        } catch(e){ status.textContent = 'Recording not supported here — the effect still plays.'; rec = null; }
      }
      function stopRec(){ try { if (rec && rec.state !== 'inactive') rec.stop(); } catch(e){} }
      function run(fx){
        if (playing) return; if (!ready){ status.textContent = 'Upload or load an image first.'; return; } playing = true; status.textContent = 'Recording ' + fx + '…'; startRec();
        var dur = 2600, t0 = performance.now();
        // pre-slice for shatter/explode
        var cols = 12, rows = 12, cw = W/cols, ch = H/rows, shards = [];
        for (var y=0;y<rows;y++) for (var x=0;x<cols;x++){
          var dx = (x*cw + cw/2) - W/2, dy = (y*ch + ch/2) - H/2, d = Math.max(1, Math.hypot(dx,dy));
          shards.push({ x:x*cw, y:y*ch, vx:dx/d, vy:dy/d, rot:(Math.random()-0.5)*0.2, delay:Math.random()*0.15 });
        }
        function frame(now){
          var p = Math.min(1, (now - t0)/dur); ctx.clearRect(0,0,W,H); ctx.fillStyle='#000'; ctx.fillRect(0,0,W,H);
          if (fx==='zoom'){
            var s = 1 + 0.6*p, ox = (W*s - W)/2 * (0.5), oy=(H*s-H)/2*(0.5);
            ctx.save(); ctx.translate(W/2,H/2); ctx.scale(s,s); ctx.rotate(0.05*p); ctx.drawImage(img,-W/2,-H/2,W,H); ctx.restore();
          } else if (fx==='glitch'){
            ctx.drawImage(img,0,0,W,H);
            var n = 8; for (var i=0;i<n;i++){ var sy=Math.random()*H, sh=Math.random()*40+5, off=(Math.random()-0.5)*60*p; ctx.drawImage(cv,0,sy,W,sh, off,sy,W,sh); }
            ctx.globalAlpha=0.25*p; ctx.globalCompositeOperation='screen';
            ctx.drawImage(img, 8*p,0,W,H); ctx.drawImage(img,-8*p,0,W,H);
            ctx.globalAlpha=1; ctx.globalCompositeOperation='source-over';
          } else { // shatter / explode
            var burst = fx==='explode' ? 520 : 260, grav = fx==='explode'? 180 : 90, spin = fx==='explode'?1.2:0.5;
            for (var i=0;i<shards.length;i++){ var s2=shards[i]; var lp=Math.max(0,(p - s2.delay)/(1-s2.delay));
              var tx = s2.vx*burst*lp, ty = s2.vy*burst*lp + grav*lp*lp;
              ctx.save(); ctx.globalAlpha = 1 - lp*0.9; ctx.translate(s2.x+cw/2+tx, s2.y+ch/2+ty); ctx.rotate(s2.rot*spin*lp*10);
              ctx.drawImage(img, s2.x,s2.y,cw,ch, -cw/2,-ch/2,cw,ch); ctx.restore();
            }
          }
          if (p<1){ requestAnimationFrame(frame); } else { setTimeout(function(){ stopRec(); playing=false; }, 200); }
        }
        requestAnimationFrame(frame);
      }
      Array.prototype.forEach.call(document.querySelectorAll('[data-fx]'), function(b){ b.addEventListener('click', function(){ run(b.getAttribute('data-fx')); }); });
    })();
    </script>
    <div class=card><p class=muted style="font-size:13px">These effects run free in your browser. Full generative video (real motion, character-consistent) is coming on our own GPU / PRANA compute — see <a href="/school">GenAI School</a>.</p></div>`;
  return pageShell('Animate — Generative AI', body, { canonical: `${BASE_URL}/animate`, robots: 'noindex,follow', description: 'Add epic effects — shatter glass, explode, zoom, glitch — to your AI image and download a clip. Free, in your browser.' });
}

// ── Hathor tab — appear WITH Hathor, tons of ways (flagship, expansive) ────────────────────────────
export function hathorIndexView() {
  const items = listEffects('hathor');
  const body = `<h1>Appear with Hathor <span class=muted style="font-size:14px">· ${items.length} ways and growing</span></h1>
    <p class=muted>Hathor is the MELEK AI Witness. Put yourself in a photo <b>with Hathor</b> — pick a scene, add your own character or a fictional one, and generate. Free, no login. It keeps you the same and drops you into the shot with her.</p>
    <div class=grid>${items.map(effectCard).join('')}</div>
    ${shareCta('Made one with Hathor? Show it off —')}
    <div class=card><p class=muted style="font-size:13px">Want to appear <b>as</b> Hathor, a deity, or a famous figure? See <a href="/char">all character effects</a>. New scenes are added often.</p></div>`;
  return pageShell('Appear with Hathor — Generative AI', body, { canonical: `${BASE_URL}/hathor`, description: 'Put yourself in a photo with Hathor, the MELEK AI Witness — dozens of scenes, free, no login.' });
}

// ── Halloween tab — expansive seasonal set (more seasons coming) ───────────────────────────────────
export function halloweenIndexView() {
  const horror = listEffects('horror');
  const holiday = listEffects('holiday');
  const body = `<h1>Halloween <span class=muted style="font-size:14px">· ${horror.length} horror looks</span></h1>
    <p class=muted>Turn yourself into anything spooky — pick a look, add your character or a fictional one, and generate. Free, no login. Meet <b>Anpu the Jackal Warden</b>, our Halloween character (over on <a href="/char">Characters</a>).</p>
    <h2>Horror &amp; Halloween Movies <span class=muted style="font-size:13px">(${horror.length})</span></h2>
    <div class=grid>${horror.map(effectCard).join('')}</div>
    <h2>Holiday looks <span class=muted style="font-size:13px">(${holiday.length})</span></h2>
    <div class=grid>${holiday.map(effectCard).join('')}</div>
    ${shareCta('Made something spooky? Show it off —')}
    <div class=card><p class=muted style="font-size:13px">Thanksgiving and Christmas sets are coming next — we're going through all the seasons. See <a href="/char">all effects</a>.</p></div>`;
  return pageShell('Halloween — Generative AI', body, { canonical: `${BASE_URL}/halloween`, description: 'Halloween AI looks — vampire, werewolf, zombie, witch, grim reaper and more. Free, no login. Meet Anpu the Jackal Warden.' });
}

// ── /edit — in-browser "Photoshop": remove background (keep the person EXACT), drop in a new one ─────
// Cutout runs client-side via @imgly/background-removal (ONNX-WASM on the visitor's own device — no GPU
// on us, the subject's pixels are preserved unaltered). New background: transparent, a colour, an upload,
// or one generated by our free engines. Composite + drag/scale + download PNG. All free, no login.
export function editView() {
  const body = `<h1>Photo Editor <span class=muted style="font-size:14px">· remove the background, keep the people exact</span></h1>
    <p class=muted>Free, in your browser — <b>your photo never leaves your device</b> for the cutout. Upload a photo, remove the
      background (the people stay <b>exactly</b> as they are), then drop in a new background: transparent, a colour, your own
      image, or one made by our <a href="/">free engines</a>. Drag and scale, then download a PNG. Share it on MELEK.</p>
    <div class=card>
      <div class=row style="gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <input type=file id=up accept="image/*" class=q style="width:auto">
        <button type=button id=cut disabled>✂ Remove background</button>
        <span class=muted style="font-size:12px">then choose a background →</span>
      </div>
      <div class=row style="gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button type=button data-bg=transparent class=pill>Transparent</button>
        <label class=pill style="cursor:pointer">Colour <input type=color id=bgcolor value="#0b0d10" style="vertical-align:middle;width:26px;height:18px;border:0;background:none;padding:0"></label>
        <label class=pill style="cursor:pointer">Upload bg<input type=file id=bgup accept="image/*" hidden></label>
        <input class=q id=bgprompt placeholder="…or describe a background to generate" style="flex:1 1 220px;width:auto">
        <button type=button id=bggen class=pill>✨ Generate bg</button>
        <a class=pill id=dl style="display:none" download="hathor-edit.png">⬇ Download PNG</a>
      </div>
      <canvas id=cv width=1024 height=1024 style="width:100%;max-width:1024px;border:1px solid var(--line2);border-radius:10px;background:conic-gradient(#1a1d22 90deg,#141619 0 180deg,#1a1d22 0 270deg,#141619 0) 0 0/24px 24px;touch-action:none"></canvas>
      <p class=muted id=status style="font-size:12px;margin-top:8px">Upload a photo to begin.</p>
    </div>
    <script type=module>
    import { removeBackground } from 'https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.5.5/dist/index.mjs';
    const $=s=>document.querySelector(s);
    const cv=$('#cv'), ctx=cv.getContext('2d'), status=$('#status'), dl=$('#dl'), cut=$('#cut');
    const W=cv.width, H=cv.height;
    let srcBlob=null, cutout=null, bg={type:'transparent'}, bgImg=null;
    // cutout placement (drag + scale)
    let px=W/2, py=H/2, scale=1, drag=false, lx=0, ly=0;
    function fit(img){ return Math.min(W/img.width, H/img.height); }
    function draw(){
      ctx.clearRect(0,0,W,H);
      if(bg.type==='color'){ ctx.fillStyle=bg.value; ctx.fillRect(0,0,W,H); }
      else if(bg.type==='image'&&bgImg){ const s=Math.max(W/bgImg.width,H/bgImg.height); const w=bgImg.width*s,h=bgImg.height*s; ctx.drawImage(bgImg,(W-w)/2,(H-h)/2,w,h); }
      // transparent → leave the checkerboard (canvas is already clear)
      if(cutout){ const w=cutout.width*scale, h=cutout.height*scale; ctx.drawImage(cutout, px-w/2, py-h/2, w, h); }
    }
    function setStatus(t){ status.textContent=t; }
    function loadImg(blob){ return new Promise((res,rej)=>{ const i=new Image(); i.onload=()=>res(i); i.onerror=rej; i.src=URL.createObjectURL(blob); }); }
    $('#up').addEventListener('change', async e=>{ const f=e.target.files&&e.target.files[0]; if(!f)return; srcBlob=f; cutout=null; cut.disabled=false;
      const img=await loadImg(f); scale=fit(img); px=W/2; py=H/2; cutout=img; draw(); setStatus('Loaded. Click "Remove background" to cut the people out — or download as-is.'); dl.style.display=''; syncDl(); });
    cut.addEventListener('click', async ()=>{ if(!srcBlob){setStatus('Upload a photo first.');return;} cut.disabled=true; setStatus('Removing background on your device… (first run downloads the model, ~a few seconds)');
      try{ const out=await removeBackground(srcBlob); const img=await loadImg(out); cutout=img; scale=fit(img); px=W/2; py=H/2; draw(); setStatus('Background removed — the people are kept exactly. Now pick a new background, drag/scale, and download.'); dl.style.display=''; syncDl(); }
      catch(err){ setStatus('Cutout failed here ('+(err&&err.message||err)+'). Try a smaller image or another browser.'); cut.disabled=false; } });
    document.querySelectorAll('[data-bg]').forEach(b=>b.addEventListener('click',()=>{ bg={type:b.getAttribute('data-bg')}; draw(); syncDl(); }));
    $('#bgcolor').addEventListener('input',e=>{ bg={type:'color',value:e.target.value}; draw(); syncDl(); });
    $('#bgup').addEventListener('change', async e=>{ const f=e.target.files&&e.target.files[0]; if(!f)return; bgImg=await loadImg(f); bg={type:'image'}; draw(); syncDl(); });
    $('#bggen').addEventListener('click', async ()=>{ const p=$('#bgprompt').value.trim(); if(!p){setStatus('Type a background to generate first.');return;} setStatus('Generating a background with our free engines…');
      try{ const r=await fetch('/api/generate',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:'prompt='+encodeURIComponent(p+', background scene, no people')+'&size=1024x1024'});
        const j=await r.json().catch(()=>null); const u=j&&(j.url||(j.file?('/img/'+j.file):null)); if(!u){setStatus('Background generation is busy — try again, or upload one.');return;}
        bgImg=await loadImg(await (await fetch(u)).blob()); bg={type:'image'}; draw(); syncDl(); setStatus('Background generated. Drag/scale the people, then download.'); }
      catch(err){ setStatus('Could not generate a background right now — upload one instead.'); } });
    // drag + wheel-scale the cutout
    cv.addEventListener('pointerdown',e=>{ drag=true; const r=cv.getBoundingClientRect(); lx=(e.clientX-r.left)*(W/r.width); ly=(e.clientY-r.top)*(H/r.height); });
    window.addEventListener('pointerup',()=>drag=false);
    cv.addEventListener('pointermove',e=>{ if(!drag||!cutout)return; const r=cv.getBoundingClientRect(); const x=(e.clientX-r.left)*(W/r.width), y=(e.clientY-r.top)*(H/r.height); px+=x-lx; py+=y-ly; lx=x; ly=y; draw(); });
    cv.addEventListener('wheel',e=>{ if(!cutout)return; e.preventDefault(); scale*=(e.deltaY<0?1.06:0.94); scale=Math.max(0.05,Math.min(6,scale)); draw(); syncDl(); },{passive:false});
    function syncDl(){ try{ cv.toBlob(b=>{ if(b) dl.href=URL.createObjectURL(b); },'image/png'); }catch(e){} }
    </script>
    ${shareCta('Made a clean cut-out? Show it off —')}
    <div class=card><p class=muted style="font-size:13px"><b>Free &amp; private:</b> the background removal runs entirely in your browser (your photo is never uploaded for the cut).
      Generated backgrounds use our free engines. <b>Coming on our own GPU / PRANA:</b> seamless AI relighting, generating characters
      <i>into</i> your scene with matched light, and granular retouch (change hair/eyes on a real photo) — see <a href="/school">GenAI School</a> to run those yourself today.</p></div>`;
  return pageShell('Photo Editor — remove background, new background', body, { canonical: `${BASE_URL}/edit`, robots: 'index,follow', description: 'Free in-browser photo editor — remove the background keeping the people exact, then add a new background (colour, your image, or AI-generated). No login, private, download a PNG.' });
}

// ── /webcam — live AR: replace/blur your webcam background in real time, snapshot & record ───────────
// Uses MediaPipe selfie segmentation (tasks-vision) — runs live on the visitor's own device via WebGL.
export function webcamView() {
  const filterBtns = listArFilters().map((f) =>
    `<button type=button data-filter="${esc(f.id)}" class=pill title="${esc(f.blurb)}">${esc(f.name)}</button>`).join('');
  const filterLegend = listArFilters().map((f) =>
    `<div class=sec><div class=t>${esc(f.name)} <span class="badge cat">${esc(f.themeLabel)}</span></div><div class=d>${esc(f.blurb)}</div></div>`).join('');
  const body = `<h1>Webcam Studio <span class=muted style="font-size:14px">· live AR — our own filters, background replace, snapshot &amp; record</span></h1>
    <p class=muted>Free, live, in your browser — <b>nothing is uploaded</b>. Start your camera, wear one of our
      original <b>Kemetic / Angelic / Shaivite</b> AR filters, replace or blur the background, then snapshot or record. Great for a call, a stream, or a reel.</p>
    <div class=card>
      <div class=row style="gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button type=button id=start>▶ Start camera</button>
        <span class=muted style="font-size:12px;align-self:center">background:</span>
        <button type=button data-mode=blur class=pill>Blur</button>
        <button type=button data-mode=none class=pill>Raw</button>
        <label class=pill style="cursor:pointer">Colour<input type=color id=wc_color value="#0b6b55" style="vertical-align:middle;width:26px;height:18px;border:0;background:none;padding:0"></label>
        <label class=pill style="cursor:pointer">Image<input type=file id=wc_bg accept="image/*" hidden></label>
      </div>
      <div class=row style="gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <span class=muted style="font-size:12px;align-self:center">Hathor filters:</span>
        <button type=button data-filter=none class=pill>None</button>
        ${filterBtns}
      </div>
      <div class=row style="gap:8px;margin-bottom:10px;flex-wrap:wrap">
        <button type=button id=snap class=pill>📸 Snapshot</button>
        <button type=button id=rec class=pill>⏺ Record</button>
        <a class=pill id=wc_dl style="display:none" download="hathor-webcam.png">⬇ Download</a>
      </div>
      <canvas id=wcv width=960 height=720 style="width:100%;max-width:960px;border:1px solid var(--line2);border-radius:10px;background:#000"></canvas>
      <video id=wv playsinline muted style="display:none"></video>
      <p class=muted id=wc_status style="font-size:12px;margin-top:8px">Click "Start camera" (your browser will ask permission).</p>
    </div>
    <script type=module>
    import { ImageSegmenter, FaceLandmarker, FilesetResolver } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
    const $=s=>document.querySelector(s);
    const cv=$('#wcv'), ctx=cv.getContext('2d'), v=$('#wv'), status=$('#wc_status'), dl=$('#wc_dl');
    const W=cv.width, H=cv.height; const tmp=document.createElement('canvas'); tmp.width=W; tmp.height=H; const tctx=tmp.getContext('2d');
    const layer=document.createElement('canvas'); layer.width=W; layer.height=H; const lctx=layer.getContext('2d');
    const GOLD='#e0b44c';
    let seg=null, face=null, mode='blur', bgColor='#0b6b55', bgImg=null, running=false, rec=null, chunks=[], filter='none';
    document.querySelectorAll('[data-mode]').forEach(b=>b.addEventListener('click',()=>mode=b.getAttribute('data-mode')));
    document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.getAttribute('data-filter');}));
    $('#wc_color').addEventListener('input',e=>{bgColor=e.target.value;mode='color';});
    $('#wc_bg').addEventListener('change',e=>{const f=e.target.files&&e.target.files[0];if(!f)return;const i=new Image();i.onload=()=>{bgImg=i;mode='image';};i.src=URL.createObjectURL(f);});
    async function init(){ status.textContent='Loading AR models (first run downloads them)…';
      const vision=await FilesetResolver.forVisionTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm');
      seg=await ImageSegmenter.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'},runningMode:'VIDEO',outputCategoryMask:true});
      face=await FaceLandmarker.createFromOptions(vision,{baseOptions:{modelAssetPath:'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task'},runningMode:'VIDEO',numFaces:1}); }
    $('#start').addEventListener('click', async ()=>{ try{
        if(!seg) await init();
        const stream=await navigator.mediaDevices.getUserMedia({video:{width:960,height:720},audio:false});
        v.srcObject=stream; await v.play(); running=true; status.textContent='Live. Try a Hathor filter and a background.'; loop();
      }catch(err){ status.textContent='Camera/model unavailable here ('+(err&&err.message||err)+').'; } });
    function drawBg(){ if(mode==='color'){ctx.fillStyle=bgColor;ctx.fillRect(0,0,W,H);} else if(mode==='image'&&bgImg){const s=Math.max(W/bgImg.width,H/bgImg.height);ctx.drawImage(bgImg,(W-bgImg.width*s)/2,(H-bgImg.height*s)/2,bgImg.width*s,bgImg.height*s);} else if(mode==='blur'){ctx.filter='blur(14px)';ctx.drawImage(v,0,0,W,H);ctx.filter='none';} }
    function loop(){ if(!running)return;
      // base layer (background replace or raw)
      if(mode==='none'){ ctx.drawImage(v,0,0,W,H); }
      else { const res=seg.segmentForVideo(v, performance.now()); const mask=res.categoryMask; const data=mask.getAsUint8Array();
        tctx.clearRect(0,0,W,H); tctx.drawImage(v,0,0,W,H); const person=tctx.getImageData(0,0,W,H);
        for(let i=0;i<data.length;i++){ if(data[i]===0) person.data[i*4+3]=0; }
        drawBg(); lctx.clearRect(0,0,W,H); lctx.putImageData(person,0,0); ctx.drawImage(layer,0,0); mask.close(); }
      // themed AR filter overlay (face-tracked)
      if(filter!=='none' && face){ const fr=face.detectForVideo(v, performance.now());
        if(filter==='hieroglyph-frame'){ drawFilter(filter,null); }
        else if(fr.faceLandmarks && fr.faceLandmarks[0]) drawFilter(filter, fr.faceLandmarks[0]); }
      requestAnimationFrame(loop); }
    // ── themed filter renderers (procedural, our aesthetic) ──
    function drawFilter(id, lm){ const t=performance.now()/1000;
      const P=i=>({x:lm[i].x*W, y:lm[i].y*H});
      const D=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
      if(lm){ var top=P(10), chin=P(152), nose=P(1), lc=P(234), rc=P(454), bl=P(168); var fw=D(lc,rc), fh=D(top,chin); var cx=top.x, cy=top.y; }
      ctx.save();
      if(id==='hathor-crown'){ var y=cy-fh*0.55; ctx.strokeStyle=GOLD; ctx.lineWidth=fw*0.06; ctx.lineCap='round';
        ctx.beginPath(); ctx.moveTo(cx-fw*0.05,y+fh*0.1); ctx.quadraticCurveTo(cx-fw*0.5,y-fh*0.25,cx-fw*0.62,y+fh*0.25); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(cx+fw*0.05,y+fh*0.1); ctx.quadraticCurveTo(cx+fw*0.5,y-fh*0.25,cx+fw*0.62,y+fh*0.25); ctx.stroke();
        var g=ctx.createRadialGradient(cx,y,2,cx,y,fw*0.28); g.addColorStop(0,'#fff3c4'); g.addColorStop(0.5,GOLD); g.addColorStop(1,'rgba(224,180,76,0.15)');
        ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,y,fw*0.22,0,7); ctx.fill(); }
      else if(id==='solar-halo'){ var hy=cy-fh*0.15, r=fw*0.9*(1+0.03*Math.sin(t*2)); var g=ctx.createRadialGradient(cx,hy,r*0.55,cx,hy,r);
        g.addColorStop(0,'rgba(224,180,76,0)'); g.addColorStop(0.7,'rgba(224,180,76,0.55)'); g.addColorStop(0.85,'#fff3c4'); g.addColorStop(1,'rgba(224,180,76,0)');
        ctx.globalCompositeOperation='screen'; ctx.fillStyle=g; ctx.beginPath(); ctx.arc(cx,hy,r,0,7); ctx.fill(); }
      else if(id==='third-eye'){ var ex=(top.x+bl.x)/2, ey=(top.y+bl.y)/2 - fh*0.02, s=fw*0.11*(1+0.06*Math.sin(t*3));
        ctx.strokeStyle=GOLD; ctx.lineWidth=fw*0.02; for(var k=-1;k<2;k++){ ctx.beginPath(); ctx.moveTo(ex-s*1.4,ey-fh*0.1+k*fh*0.045); ctx.lineTo(ex+s*1.4,ey-fh*0.1+k*fh*0.045); ctx.stroke(); }
        ctx.fillStyle='#fff'; ctx.beginPath(); ctx.ellipse(ex,ey,s,s*0.6,0,0,7); ctx.fill();
        var g=ctx.createRadialGradient(ex,ey,1,ex,ey,s*0.7); g.addColorStop(0,'#2ea3ff'); g.addColorStop(1,'#08306b'); ctx.fillStyle=g; ctx.beginPath(); ctx.arc(ex,ey,s*0.45,0,7); ctx.fill();
        ctx.globalCompositeOperation='screen'; ctx.fillStyle='rgba(46,163,255,0.4)'; ctx.beginPath(); ctx.arc(ex,ey,s*1.6,0,7); ctx.fill(); }
      else if(id==='wedjat-kohl'){ ctx.strokeStyle='#0b0d10'; ctx.lineWidth=fw*0.022; ctx.lineCap='round';
        [[33,133,-1],[263,362,1]].forEach(function(e){ var o=P(e[0]), inn=P(e[1]), dir=e[2];
          ctx.beginPath(); ctx.moveTo(inn.x,inn.y); ctx.lineTo(o.x,o.y); ctx.lineTo(o.x+dir*fw*0.14,o.y-fh*0.03); ctx.stroke();
          ctx.beginPath(); ctx.moveTo(o.x,o.y+fh*0.01); ctx.quadraticCurveTo(o.x+dir*fw*0.08,o.y+fh*0.09,o.x+dir*fw*0.02,o.y+fh*0.12); ctx.stroke(); }); }
      else if(id==='anpu-jackal'){ var y=cy-fh*0.4; ctx.fillStyle='#14171c';
        [[-1],[1]].forEach(function(s){ var d=s[0]; ctx.beginPath(); ctx.moveTo(cx+d*fw*0.28,y+fh*0.15); ctx.lineTo(cx+d*fw*0.42,y-fh*0.5); ctx.lineTo(cx+d*fw*0.14,y+fh*0.05); ctx.closePath(); ctx.fill();
          ctx.fillStyle=GOLD; ctx.beginPath(); ctx.moveTo(cx+d*fw*0.29,y-fh*0.02); ctx.lineTo(cx+d*fw*0.37,y-fh*0.38); ctx.lineTo(cx+d*fw*0.2,y+fh*0.0); ctx.closePath(); ctx.fill(); ctx.fillStyle='#14171c'; });
        ctx.fillStyle='rgba(20,23,28,0.92)'; ctx.beginPath(); ctx.ellipse(nose.x,(nose.y+chin.y)/2,fw*0.22,fh*0.3,0,0,7); ctx.fill(); }
      else if(id==='angelic-wings'){ ctx.globalCompositeOperation='screen';
        [[-1],[1]].forEach(function(s){ var d=s[0], ax=(d<0?lc.x:rc.x), ay=(lc.y+rc.y)/2;
          for(var f=0;f<6;f++){ var a=(-0.5+f*0.22)*(1), len=fw*(0.5+f*0.12); var g=ctx.createLinearGradient(ax,ay,ax+d*len,ay-len*0.3);
            g.addColorStop(0,'rgba(255,243,196,0.8)'); g.addColorStop(1,'rgba(224,180,76,0)'); ctx.strokeStyle=g; ctx.lineWidth=fw*0.05; ctx.lineCap='round';
            ctx.beginPath(); ctx.moveTo(ax,ay); ctx.quadraticCurveTo(ax+d*len*0.6,ay-len*0.5-20*Math.sin(t*2),ax+d*len,ay-len*0.2+f*fh*0.12); ctx.stroke(); } }); }
      else if(id==='prana-aura'){ ctx.globalCompositeOperation='screen'; var hue=(t*40)%360; var r=fw*0.8*(1+0.05*Math.sin(t*2.5));
        for(var i2=0;i2<3;i2++){ ctx.strokeStyle='hsla('+((hue+i2*40)%360)+',90%,60%,0.5)'; ctx.lineWidth=fw*0.03; ctx.beginPath(); ctx.ellipse(nose.x,(top.y+chin.y)/2,r*(1+i2*0.08),r*1.25*(1+i2*0.08),0,0,7); ctx.stroke(); } }
      else if(id==='hieroglyph-frame'){ var b=Math.round(W*0.045); ctx.strokeStyle=GOLD; ctx.lineWidth=b*0.5; ctx.strokeRect(b*0.6,b*0.6,W-b*1.2,H-b*1.2);
        ctx.fillStyle=GOLD; ctx.font=Math.round(b*0.9)+'px serif'; ctx.textAlign='center'; ctx.textBaseline='middle';
        var glyphs=['\u{13080}','\u{131CB}','\u{13000}','\u{13171}','\u{133BC}']; var n=Math.floor(W/(b*1.6));
        for(var i3=0;i3<n;i3++){ var gx=b*1.2+i3*(W-b*2.4)/(n-1); var gl=glyphs[(i3+Math.floor(t))%glyphs.length]; ctx.fillText(gl,gx,b*0.6); ctx.fillText(gl,gx,H-b*0.6); } }
      ctx.restore(); ctx.globalCompositeOperation='source-over'; }
    $('#snap').addEventListener('click',()=>{ cv.toBlob(b=>{ if(b){ dl.href=URL.createObjectURL(b); dl.download='hathor-webcam.png'; dl.style.display=''; status.textContent='Snapshot ready — download it.'; } },'image/png'); });
    $('#rec').addEventListener('click',()=>{ if(rec&&rec.state==='recording'){ rec.stop(); $('#rec').textContent='⏺ Record'; return; }
      try{ chunks=[]; rec=new MediaRecorder(cv.captureStream(30),{mimeType:'video/webm'}); rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        rec.onstop=()=>{ const b=new Blob(chunks,{type:'video/webm'}); dl.href=URL.createObjectURL(b); dl.download='hathor-webcam.webm'; dl.style.display=''; status.textContent='Clip ready — download it.'; };
        rec.start(); $('#rec').textContent='⏹ Stop'; status.textContent='Recording…'; }catch(e){ status.textContent='Recording not supported here.'; } });
    </script>
    <h2>Our AR filters <span class=muted style="font-size:13px">(${AR_FILTERS.length} — originals, not generic)</span></h2>
    <p class=muted>These are ours — Kemetic, Angelic, Shaivite and temple-tech iconography you won't find in other filter apps. Live-tracked to your face, free.</p>
    <div class=grid>${filterLegend}</div>
    ${shareCta('Wore a filter? Show it off —')}
    <div class=card><p class=muted style="font-size:13px"><b>Broadcast it:</b> to use this as your camera on Zoom/Meet/Discord or in a stream, add this page as an
      <b>OBS &amp; Streamlabs "Browser Source"</b> and output OBS's Virtual Camera — guide in <a href="/school">GenAI School</a>. Built on open
      <a href="/ar-libraries">AR libraries</a>. <b>Coming on GPU / PRANA:</b> AI style-transfer video and identity-preserving face edits (hair/eyes).</p></div>`;
  return pageShell('Webcam Studio — live AR filters & background', body, { canonical: `${BASE_URL}/webcam`, robots: 'index,follow', description: 'Free live webcam AR studio — wear original MELEK/Hathor filters (Kemetic, Angelic, Shaivite), replace or blur your background, snapshot and record. Runs in your browser, nothing uploaded.' });
}

// ── /ar-libraries — the open-source AR/CV libraries & repos we draw from (and you can too) ───────────
export function arLibrariesView() {
  const badge = (served) => served === 'gpu'
    ? '<span class="badge cat" style="border-color:var(--gold);color:var(--gold)">GPU / self-host</span>'
    : '<span class="badge cat">runs in browser</span>';
  const card = (l) => `<div class=sec><div class=t>${esc(l.name)} <span class=muted style="font-size:12px">· ${esc(l.by)}</span> ${badge(l.served)}</div>
      <div class=d>${esc(l.what)}</div>
      <div style="margin-top:8px;font-size:13px"><a href="${esc(l.repo)}" target=_blank rel="noopener">repo</a>${l.site ? ` · <a href="${esc(l.site)}" target=_blank rel="noopener">site</a>` : ''} · <span class=muted>${esc(l.license)}</span></div></div>`;
  const groups = listArGroups().map((g) =>
    `<h2>${esc(g.title)} <span class=muted style="font-size:13px">(${g.items.length})</span></h2>
     <p class=muted style="font-size:13px;margin:0 0 8px">${esc(g.blurb)}</p>
     <div class=grid>${g.items.map(card).join('')}</div>`).join('');
  const body = `<h1>AR libraries &amp; repos <span class=muted style="font-size:14px">· the open-source we build on</span></h1>
    <p class=muted>Augmented reality on the open web is built from free, open libraries — the same ones our
      <a href="/webcam">Webcam Studio</a> and <a href="/edit">Photo Editor</a> use. Here is the honest map of ${AR_LIBRARIES.length} of them:
      what each does, its repo, and its licence. Everything marked <b>runs in browser</b> is free on the visitor's own device;
      <b>GPU / self-host</b> is the heavier, run-it-yourself layer (see <a href="/school">GenAI School</a>).</p>
    ${groups}
    <div class=card><p class=muted style="font-size:13px">Want to build one? Start from <b>MediaPipe</b> or <b>tfjs-models</b> for tracking, draw with <b>three.js</b>,
      and for marker/image AR use <b>AR.js</b> or <b>MindAR</b>. Our repo's studio code is open too — fork it. Licences are the authors'; check each before commercial use.</p></div>`;
  return pageShell('AR libraries & repos — Hathor', body, { canonical: `${BASE_URL}/ar-libraries`, description: 'The open-source AR and computer-vision libraries and repos the Hathor studio draws from — MediaPipe, TensorFlow.js, AR.js, MindAR, three.js and more, with repos and licences.' });
}

// ── /video — text-to-video & image-to-video. Free-first from our keys, BYOK when exhausted. ─────────
export function videoView() {
  const configured = serverConfigured();
  const starters = REEL_TEMPLATES.slice(0, 6).map((t) =>
    `<button type=button class=pill data-vp="${esc(t.prompt || t.title)}">${esc(t.title)}</button>`).join(' ');
  const provRows = VIDEO_PROVIDERS.map((p) =>
    `<div class=sec><div class=t>${esc(p.name)} ${p.byok ? '<span class="badge cat">bring your key</span>' : '<span class="badge cat" style="border-color:var(--gold);color:var(--gold)">your GPU</span>'}</div>
      <div class=d>${esc(p.note)}</div><div class=muted style="font-size:12px;margin-top:6px">Free: ${esc(p.free)}</div></div>`).join('');
  const body = `<h1>Video <span class=muted style="font-size:14px">· text-to-video &amp; image-to-video</span></h1>
    <p class=muted>Make short clips for YouTube, Reels or TikTok. We try our free capacity first; when it's used up you
      can <b>add your own key</b> and keep going — your key stays in your browser, we never see it. True free-forever
      video is your own GPU (PRANA) — the <a href="/school">School</a> teaches that.</p>
    <div class=card>
      <label class=fld for=vprompt>Describe your clip</label>
      <textarea class=q id=vprompt placeholder="e.g. a golden Egyptian temple at dawn, slow cinematic push-in, volumetric light" required></textarea>
      <div class=row style="gap:8px;margin:10px 0;flex-wrap:wrap">
        <input type=file id=vimg accept="image/*" class=q style="width:auto" title="optional: animate an image (image-to-video)">
        <select class=q id=vsec style="width:auto"><option value=5>5s</option><option value=8>8s</option><option value=3>3s</option></select>
        <button type=button id=vgen>Generate clip</button>
      </div>
      <div class=row style="gap:6px;flex-wrap:wrap"><span class=muted style="font-size:12px;align-self:center">CapCut-style starts:</span>${starters}</div>
      <p class=muted id=vstatus style="font-size:12px;margin-top:10px">${configured.length ? `Free capacity: ${esc(configured.join(', '))}.` : 'No shared free capacity right now — bring your own key below (fal.ai works right in the browser).'}</p>
      <div id=vout></div>
      <div id=byok style="display:none;margin-top:12px;border-top:1px solid var(--line);padding-top:12px">
        <b>Add your own key to continue</b>
        <p class=muted style="font-size:12px">Our free capacity is used up (or unset). Bring a key — it stays in <b>your</b> browser and calls the provider directly.</p>
        <div class=row style="gap:8px;flex-wrap:wrap;margin:8px 0">
          <select class=q id=vprov style="width:auto"><option value=fal>fal.ai (works in browser)</option><option value=pollinations>Pollinations</option></select>
          <input class=q id=vkey type=password placeholder="paste your API key" style="flex:1 1 220px;width:auto" autocomplete=off>
          <button type=button id=vgo class=pill>Generate with my key</button>
        </div>
        <div id=vinstr class=muted style="font-size:12px"></div>
      </div>
    </div>
    <script type=module>
    const $=s=>document.querySelector(s);
    const status=$('#vstatus'), out=$('#vout'), byok=$('#byok'), instr=$('#vinstr');
    let INSTR={};
    document.querySelectorAll('[data-vp]').forEach(b=>b.addEventListener('click',()=>{$('#vprompt').value=b.getAttribute('data-vp');}));
    function showVideo(url){ out.innerHTML='<video src="'+url+'" controls autoplay loop playsinline style="max-width:100%;border-radius:10px;border:1px solid var(--line2);margin-top:10px"></video><div class=muted style="font-size:12px;margin-top:6px"><a href="'+url+'" download>download</a> · share it on <a href="'+${JSON.stringify(DISCORD)}+'" target=_blank>Discord</a> or <a href="'+${JSON.stringify(FORUM)}+'/post" target=_blank>MELEK</a></div>'; }
    async function imgToDataUrl(f){ return await new Promise(r=>{const rd=new FileReader();rd.onload=()=>r(rd.result);rd.readAsDataURL(f);}); }
    $('#vgen').addEventListener('click', async ()=>{
      const prompt=$('#vprompt').value.trim(); if(!prompt){status.textContent='Type a description first.';return;}
      status.textContent='Trying our free capacity…'; out.innerHTML=''; byok.style.display='none';
      const body=new URLSearchParams({prompt, seconds:$('#vsec').value});
      try{ const r=await fetch('/api/video',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body});
        const j=await r.json();
        if(j.ok){ status.textContent='Made with '+j.provider+'.'; showVideo(j.url); return; }
        if(j.needsKey){ INSTR=j.instructions||{}; status.textContent='Free capacity is used up — add your own key to continue.'; byok.style.display=''; renderInstr($('#vprov').value); return; }
        status.textContent='Could not generate right now.';
      }catch(e){ status.textContent='Network error — try again.'; }
    });
    function renderInstr(p){ const li=(INSTR[p]||[]).map(s=>'<li>'+s+'</li>').join(''); instr.innerHTML=li?'<ol style="margin:6px 0 0;padding-left:18px">'+li+'</ol>':''; }
    $('#vprov').addEventListener('change',e=>renderInstr(e.target.value));
    $('#vgo').addEventListener('click', async ()=>{
      const prov=$('#vprov').value, key=$('#vkey').value.trim(), prompt=$('#vprompt').value.trim();
      if(!key){instr.innerHTML='<b>Paste your key first.</b>';return;}
      if(!prompt){status.textContent='Type a description first.';return;}
      status.textContent='Generating with your '+prov+' key (in your browser)…';
      try{
        if(prov==='fal'){
          const { fal }=await import('https://cdn.jsdelivr.net/npm/@fal-ai/client/dist/index.mjs');
          fal.config({ credentials:key });
          const f=$('#vimg').files&&$('#vimg').files[0];
          const model=f?'fal-ai/ltx-video/image-to-video':'fal-ai/ltx-video';
          const input={ prompt }; if(f) input.image_url=await imgToDataUrl(f);
          const res=await fal.subscribe(model,{ input });
          const url=res && res.data && (res.data.video?res.data.video.url:(res.data.videos&&res.data.videos[0]&&res.data.videos[0].url));
          if(url){ status.textContent='Made with your fal.ai key.'; showVideo(url); } else { status.textContent='fal returned no video — check your key/credit.'; }
        } else if(prov==='pollinations'){
          const u='https://gen.pollinations.ai/video/'+encodeURIComponent(prompt)+'?model=veo-3.1-fast&token='+encodeURIComponent(key);
          showVideo(u); status.textContent='Requested from Pollinations with your key.';
        }
      }catch(e){ status.textContent='Your-key generation failed: '+(e&&e.message||e); }
    });
    </script>
    <h2>How the free-first + your-key model works</h2>
    <div class=grid>${provRows}</div>
    <div class=card><p class=muted style="font-size:13px">Honest: there is no truly keyless free video service (unlike our free images).
      We burn our shared capacity first; after that a key is required — or run it yourself on a free Colab GPU or your own
      (Wan2.2 / LTX-Video, commercial-OK). The <a href="/school">GenAI School</a> has the notebooks and the self-host guide.
      Full character-consistent video on our own GPU arrives with <b>PRANA</b>.</p></div>
    ${shareCta('Made a clip? Show it off —')}`;
  return pageShell('Video — text-to-video & image-to-video', body, { canonical: `${BASE_URL}/video`, robots: 'index,follow', description: 'Make short AI videos — text-to-video and image-to-video. Free-first from our capacity, then bring your own key (fal.ai, Veo, Replicate) or run it on your own GPU. CapCut-style starters.' });
}

const SITEMAP_PATHS = [
  '/', '/news', '/edit', '/webcam', '/ar-libraries', '/video', '/vectorize', '/cards', '/templates', '/gallery', '/directory', '/comfyui', '/colab', '/reel-maker', '/char', '/hathor', '/halloween', '/school',
  ...TEMPLATES.map((t) => `/templates/${t.id}`),
  ...COMFY_TEMPLATES.map((t) => `/comfyui/${t.id}`),
  ...REEL_TEMPLATES.map((t) => `/reel-maker/${t.id}`),
];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname;
    const method = (req.method || 'GET').toUpperCase();

    if (path === '/health') {
      const tpl = validateTemplates();
      const comfy = validateComfyTemplates();
      const colab = validateColabTemplates();
      const reel = validateReelTemplates();
      const provs = providersMod.providerStatus();
      const ok = tpl.ok && comfy.ok && colab.ok && reel.ok;
      res.writeHead(ok ? 200 : 500, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({
        ok, templates: TEMPLATES.length, templateErrors: tpl.errors,
        comfyTemplates: comfy.count, comfyErrors: comfy.errors,
        colabTemplates: colab.count, colabErrors: colab.errors,
        reelTemplates: reel.count, reelErrors: reel.errors,
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
          { label: 'ComfyUI workflows', path: '/comfyui' },
          { label: 'Google Colab notebooks', path: '/colab' },
          { label: 'Reel template maker', path: '/reel-maker' },
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
    if (path.startsWith('/showcase/')) {
      return serveShowcase(res, decodeURIComponent(path.slice('/showcase/'.length)));
    }

    if (path === '/') return sendHtml(res, homePage());
    if (path === '/templates') return sendHtml(res, templatesIndexView());
    if (path.startsWith('/templates/')) {
      const id = decodeURIComponent(path.slice('/templates/'.length).replace(/\/+$/, ''));
      return sendHtml(res, templateDetailView(id), getTemplate(id) ? 200 : 404);
    }
    if (path === '/gallery') return sendHtml(res, galleryView({ nsfw: readCookie(req, 'hnsfw') === '1' }));
    if (path === '/directory') return sendHtml(res, directoryView());

    // ── ComfyUI workflow library ──
    if (path === '/comfyui') return sendHtml(res, comfyIndexView());
    if (path.startsWith('/comfyui/')) {
      const rest = decodeURIComponent(path.slice('/comfyui/'.length).replace(/\/+$/, ''));
      if (rest.endsWith('.json')) {
        const wid = rest.slice(0, -'.json'.length);
        const json = workflowJson(wid);
        if (!json) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found'); }
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${basename(wid)}.json"`,
          'cache-control': 'public, max-age=3600',
        });
        return res.end(json);
      }
      return sendHtml(res, comfyDetailView(rest), getComfy(rest) ? 200 : 404);
    }

    // ── Google Colab notebook library ──
    if (path === '/colab') return sendHtml(res, colabIndexView());

    // ── CapCut-style reel template maker ──
    if (path === '/reel-maker') return sendHtml(res, reelIndexView());
    if (path === '/char') return sendHtml(res, charIndexView());
    if (path === '/hathor') return sendHtml(res, hathorIndexView());
    if (path === '/halloween') return sendHtml(res, halloweenIndexView());
    if (path === '/animate') return sendHtml(res, animateView(url.searchParams.get('img')));
    if (path === '/news') return sendHtml(res, newsView());
    if (path === '/vectorize') return sendHtml(res, vectorizeView(url.searchParams.get('img')));
    if (path === '/cards') return sendHtml(res, cardsView());
    if (path === '/api/upload') {
      if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }); return res.end('POST only'); }
      return handleUpload(req, res);
    }
    if (path === '/edit') return sendHtml(res, editView());
    if (path === '/tools') return sendHtml(res, toolsHubView());
    if (path === '/tools.md') { res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' }); return res.end(toolsWikiMarkdown()); }
    if (path === '/convert') return sendHtml(res, convertView());
    if (path === '/api/convert') {
      if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }); return res.end('POST only'); }
      return handleConvert(req, res);
    }
    if (path === '/api/convert-file') {
      if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }); return res.end('POST only'); }
      return handleConvertFile(req, res);
    }
    if (path === '/video') return sendHtml(res, videoView());
    if (path === '/api/video') {
      if (method !== 'POST') { res.writeHead(405, { 'content-type': 'text/plain', allow: 'POST' }); return res.end('POST only'); }
      return handleVideo(req, res);
    }
    if (path === '/webcam' || path === '/ar') return sendHtml(res, webcamView());
    if (path === '/ar-libraries' || path === '/ar-repos') return sendHtml(res, arLibrariesView());
    if (path === '/school') return sendHtml(res, schoolIndexView());
    if (path.startsWith('/reel-maker/')) {
      const rid = decodeURIComponent(path.slice('/reel-maker/'.length).replace(/\/+$/, ''));
      if (method === 'POST') {
        const params = await readBody(req);
        const built = reelSpecFromParams(rid, params);
        if (!built.ok) return sendHtml(res, reelDetailView(rid), 404);
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'content-disposition': `attachment; filename="${basename(rid)}-storyboard.json"`,
          'cache-control': 'no-store',
        });
        return res.end(JSON.stringify(built.spec, null, 2));
      }
      return sendHtml(res, reelDetailView(rid), getReelTemplate(rid) ? 200 : 404);
    }

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
