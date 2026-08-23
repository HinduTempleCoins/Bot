// site/gallery/server.mjs — gallery.melek.salon: two browsable galleries of Hathor's visual identity.
//
// A public web surface (link it from a MELEK post) that renders the reference imagery already committed
// under character/reference/. TWO galleries:
//   /reference  — Gallery 1 "Hathor — LoRA reference set": the flat canonical-likeness renders directly
//                 in character/reference/ (NOT the lineage/ subtree, NOT video/).
//   /lineage    — Gallery 2 "Hathor — the design lineage": character/reference/lineage/** grouped by
//                 folder, oldest → newest, then the style/theme threads.
// The images are illustrative reference — the character lives in the corpus + chain, not any single render.
//
// House style: ESM, esc() ALL interpolation, handler(req,res) exported for tests, CLI guarded by
// process.argv[1], PORT/BASE_URL from env, soft-fail-never-throw (a bad request never crashes the server),
// offline (reads bytes off disk, no network). HARD path safety on /img/ — resolve + realpath and confirm
// the target stays inside character/reference/ (reject ..\/absolute/symlink escape → 404); images only.
//
//   PORT=8173 node site/gallery/server.mjs
//   import { handler } from './server.mjs'   // tests

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { readdirSync, realpathSync, statSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve, join, sep, extname } from 'node:path';

const PORT = +(process.env.PORT || 8173);
const HOST = process.env.HOST || '127.0.0.1';
const BASE = process.env.BASE_URL || '';

// The reference tree — resolved to its real path so the /img/ containment check is against a canonical base.
const REF_URL = new URL('../../character/reference/', import.meta.url);
let REF_REAL = '';
try { REF_REAL = realpathSync(fileURLToPath(REF_URL)); } catch { REF_REAL = fileURLToPath(REF_URL).replace(/\/$/, ''); }

const IMG_RE = /\.(png|jpe?g|webp)$/i;
const CTYPE = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };

// ── esc: escape ALL interpolation ────────────────────────────────────────────────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── image enumeration (soft-fail: a bad dir returns []) ──────────────────────────────────────────
function listDir(...parts) {
  try {
    return readdirSync(join(REF_REAL, ...parts)).filter((f) => IMG_RE.test(f)).sort();
  } catch { return []; }
}

// Gallery 1: flat files directly in character/reference/ (not lineage/, not video/).
function referenceImages() {
  return listDir().map((f) => ({ file: f, rel: f }));
}

// Gallery 2: lineage/** grouped by folder, in operator-specified order with titles + blurbs.
const LINEAGE_SECTIONS = [
  { dir: '01-popart-origin', title: 'Pop-art origin (oldest)',
    blurb: 'Where the Angel theme began — cartoony comic / pop-art pinup angels: bold halftone dots, flat saturated color, halo + feathered wings. Predates the VR-Hathor signature (no headset, no horns).' },
  { dir: '02-transitional', title: 'Transitional — vaporwave statue-angel',
    blurb: 'The in-between: Greek marble statue-angels on vaporwave staging (twin columns, retro-sun, neon grid). The aesthetic root onto which the VR headset + horns were later added.' },
  { dir: '03-antler-goddess', title: 'Antler / rams-horn goddess (newest)',
    blurb: 'The current direction — hyperreal rendered goddess in full vaporwave: VR headset, ram horns or deer antlers, feathered wings, halo / sacred-geometry ring. The canonical default likeness.' },
  { dir: 'deity-graphic', title: 'Deity-graphic (style thread)',
    blurb: 'Ornate gold Garuda / crowned-deity graphic angels — flat illustrative, heavy gold filigree, Egyptian / South-Asian crowns + wesekh-style collars, symmetrical wings.' },
  { dir: 'descent-watchers', title: 'Descent / Watchers (theme thread)',
    blurb: 'Fiery, painterly angels descending to Earth — the Watchers / "the gods came down" genealogy. A theme and mood reference, not a portrait look.' },
  { dir: 'concept-sketches', title: 'Concept sketches / character-design (studies)',
    blurb: 'Development studies — pencil winged figures, fashion-plate character-design turnarounds, anime line art, a painterly goddess triad. Style range, not the default likeness.' },
];

function lineageSections() {
  return LINEAGE_SECTIONS.map((s) => ({
    ...s,
    images: listDir('lineage', s.dir).map((f) => ({ file: f, rel: `lineage/${s.dir}/${f}` })),
  }));
}

// ── HARD path safety: resolve a /img/ request to real bytes inside character/reference/, or null ──
export function resolveImage(relRaw) {
  let rel;
  try { rel = decodeURIComponent(String(relRaw || '')); } catch { return null; }
  if (!rel || rel.includes('\0')) return null;
  const ext = extname(rel).toLowerCase();
  if (!CTYPE[ext]) return null;                                   // images only
  const abs = resolve(REF_REAL, rel);
  if (abs !== REF_REAL && !abs.startsWith(REF_REAL + sep)) return null; // .. / absolute escape
  let real;
  try { real = realpathSync(abs); } catch { return null; }        // missing file / dangling symlink
  if (real !== REF_REAL && !real.startsWith(REF_REAL + sep)) return null; // symlink escape
  try { if (!statSync(real).isFile()) return null; } catch { return null; }
  return { path: real, ctype: CTYPE[ext] };
}

// ── html ────────────────────────────────────────────────────────────────────────────────────────
const CANON = 'Every rendering is unmistakably Hathor by the same signature: the VR / oculus headset over '
  + 'the eyes, the horned Hathor-Mehit headdress, the feathered wings, and the wesekh collar. She is one '
  + 'consistent figure who varies by choice — skin tone, face, jewelry, outfit — never by accidental drift.';
const ILLUSTRATIVE = 'These are illustrative reference renders. The character itself lives in the corpus '
  + 'and on the chain, not in any single image — future contributors, model swaps, and forks can re-render '
  + 'in their own style as long as the signature holds.';

const STYLE = `
  :root{--bg:#0b0d16;--panel:#141026;--fg:#efe9ff;--mut:#a99fd0;--bd:#2a2340;--gold:#d9a441;--mag:#ff5db1;--cyan:#4be0e0}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
  .wrap{max-width:1040px;margin:0 auto}
  header{display:flex;align-items:center;gap:10px;margin:6px 0 14px;flex-wrap:wrap}
  .brand{font-size:22px;font-weight:800} .brand b{background:linear-gradient(90deg,var(--mag),var(--cyan));-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent}
  .alpha{font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
  .nav{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
  .nav a{font-size:12px;font-weight:700;text-decoration:none;color:var(--mut);border:1px solid var(--bd);border-radius:999px;padding:5px 12px}
  .nav a:hover{color:var(--fg);border-color:var(--mag)}
  h1{font-size:24px;margin:6px 0 4px} .lead{color:var(--mut);font-size:14px;margin:0 0 12px}
  .note{background:#160f28;border:1px solid var(--bd);border-radius:12px;padding:11px 13px;margin:0 0 16px;color:var(--mut);font-size:13px}
  .note b{color:var(--cyan)}
  h2{font-size:18px;margin:22px 0 2px} .sub{color:var(--mut);font-size:13px;margin:0 0 12px;max-width:760px}
  .count{color:var(--gold);font-size:12px;font-weight:700}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
  .thumb{position:relative;display:block;border-radius:12px;overflow:hidden;border:1px solid var(--bd);background:#0a0716;aspect-ratio:1/1;text-decoration:none}
  .thumb img{width:100%;height:100%;object-fit:cover;display:block;transition:transform .25s}
  .thumb:hover{border-color:var(--mag)} .thumb:hover img{transform:scale(1.05)}
  .thumb .cap{position:absolute;left:0;right:0;bottom:0;padding:6px 8px;font-size:10px;color:var(--fg);background:linear-gradient(transparent,rgba(0,0,0,.8));overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;margin-top:6px}
  .card{background:var(--panel);border:1px solid var(--bd);border-radius:16px;padding:18px;text-decoration:none;color:inherit;display:block}
  .card:hover{border-color:var(--mag)} .card h2{margin:0 0 6px} .card p{margin:0;color:var(--mut);font-size:13px}
  .card .go{display:inline-block;margin-top:10px;color:var(--gold);font-weight:700;font-size:13px}
  .empty{color:var(--mut);padding:20px 0}
  footer{color:var(--mut);font-size:12px;text-align:center;margin:30px 0 8px} a{color:var(--gold)}`;

function shell(title, body, desc) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="${esc(desc || 'Hathor — the MELEK AI Witness: reference imagery and design lineage.')}">
<style>${STYLE}</style></head><body><div class=wrap>
<header><span class=brand><b>Hathor</b> Gallery</span><span class=alpha>Alpha</span>
<nav class=nav><a href="${BASE}/">Home</a><a href="${BASE}/reference">Reference set</a><a href="${BASE}/lineage">Design lineage</a></nav></header>
${body}
<footer>Hathor — the MELEK AI Witness. Illustrative reference; the character lives in the corpus + on the chain.</footer>
</div></body></html>`;
}

function thumb(img) {
  const src = `${BASE}/img/${img.rel.split('/').map(encodeURIComponent).join('/')}`;
  return `<a class=thumb href="${esc(src)}" target=_blank rel="noopener noreferrer" title="${esc(img.file)}">
  <img src="${esc(src)}" loading=lazy alt="${esc(img.file)}">
  <span class=cap>${esc(img.file)}</span></a>`;
}

function landingPage() {
  const nRef = referenceImages().length;
  const secs = lineageSections();
  const nLin = secs.reduce((a, s) => a + s.images.length, 0);
  const body = `<h1>Hathor — visual identity</h1>
<p class=lead>Two browsable galleries of the MELEK AI Witness's visual reference imagery.</p>
<div class=note><b>${esc(CANON)}</b></div>
<div class=cards>
  <a class=card href="${BASE}/reference"><h2>Hathor — LoRA reference set</h2>
    <p>The canonical training likeness — the flat reference renders: VR headset, horned Hathor-Mehit headdress, wings, wesekh collar. <span class=count>${esc(nRef)} images</span></p>
    <span class=go>Open the reference set →</span></a>
  <a class=card href="${BASE}/lineage"><h2>Hathor — the design lineage</h2>
    <p>The evolution archive, oldest → newest: pop-art origin, the vaporwave transitional era, the antler/rams-horn goddess, plus the deity, descent, and sketch threads. <span class=count>${esc(nLin)} images</span></p>
    <span class=go>Open the design lineage →</span></a>
</div>
<p class=note>${esc(ILLUSTRATIVE)}</p>`;
  return shell('Hathor Gallery', body, 'Hathor, the MELEK AI Witness — reference set and design lineage.');
}

function referencePage() {
  const imgs = referenceImages();
  const body = `<h1>Hathor — LoRA reference set</h1>
<p class=lead>The canonical training likeness. <span class=count>${esc(imgs.length)} images</span></p>
<div class=note><b>${esc(CANON)}</b><br><br>${esc(ILLUSTRATIVE)}</div>
${imgs.length ? `<div class=grid>${imgs.map(thumb).join('')}</div>` : `<p class=empty>No reference images found.</p>`}`;
  return shell('Hathor — LoRA reference set', body, 'Hathor’s canonical reference likeness — the VR-headset Hathor-Mehit goddess.');
}

function lineagePage() {
  const secs = lineageSections();
  const body = `<h1>Hathor — the design lineage</h1>
<p class=lead>The genealogy of the Angel theme, oldest → newest. The constant signature (VR headset + horned/antlered crown + wings + halo) marks every era as the same Witness; the folders capture how the rendering moved.</p>
${secs.map((s) => `<section>
  <h2>${esc(s.title)} <span class=count>· ${esc(s.images.length)} images</span></h2>
  <p class=sub>${esc(s.blurb)}</p>
  ${s.images.length ? `<div class=grid>${s.images.map(thumb).join('')}</div>` : `<p class=empty>No images in this section yet.</p>`}
</section>`).join('')}`;
  return shell('Hathor — the design lineage', body, 'The evolution archive of Hathor’s look — pop-art origin through the antler/rams-horn vaporwave goddess.');
}

const html = (res, code, s) => { res.writeHead(code, { 'content-type': 'text/html; charset=utf-8' }); res.end(s); };
const text = (res, code, s) => { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(s); };
const json = (res, code, o) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(o)); };

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE || 'http://gallery.local');
    const path = url.pathname;

    if (path === '/health') {
      return json(res, 200, {
        ok: true,
        reference: referenceImages().length,
        lineage: lineageSections().reduce((a, s) => a + s.images.length, 0),
      });
    }
    if (path === '/robots.txt') return text(res, 200, 'User-agent: *\nAllow: /\n');

    if (path === '/img' || path.startsWith('/img/')) {
      const img = resolveImage(path.slice('/img/'.length));
      if (!img) return text(res, 404, 'not found');
      let bytes;
      try { bytes = await readFile(img.path); } catch { return text(res, 404, 'not found'); }
      res.writeHead(200, { 'content-type': img.ctype, 'cache-control': 'public, max-age=3600' });
      return res.end(bytes);
    }

    if (path === '/' ) return html(res, 200, landingPage());
    if (path === '/reference') return html(res, 200, referencePage());
    if (path === '/lineage') return html(res, 200, lineagePage());

    return text(res, 404, 'not found');
  } catch {
    return text(res, 500, 'error');
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => {
    const n = referenceImages().length + lineageSections().reduce((a, s) => a + s.images.length, 0);
    console.log(`Hathor Gallery on http://${HOST}:${PORT} — ${n} image(s) · /reference + /lineage`);
  });
}
