// site/imagehost/server.mjs — imghost.melek.salon: an imgbb / 420Magazine-style public image uploader.
//
// This is the UI + share-link layer ON TOP OF the existing `melek-imagehoster` backend (which stores +
// serves the bytes). We add: a drag-and-drop uploader page, copy-ready embed codes (Direct / HTML <img> /
// BBCode [img] / Markdown), a thumbnail, and a per-viewer "my uploads" list (localStorage, client-only).
// See .local/IMAGE_HOSTING_DESIGN.md for the full rationale + the content-addressed on-chain roadmap.
//
// ── THE melek-imagehoster BACKEND API (recon 2026-08-23, read-only from melek-oracle:/opt/melek-imagehoster) ──
//   Service: melek-imagehoster.service, node server.mjs, IMGHOST_PORT=8145 (localhost), User=ubuntu.
//   UPLOAD:  POST {base}/<username>/<sig>
//              body = multipart/form-data — either a `file` part (drag/drop) OR `filename`+`filebase64`
//              fields (paste). v1 does NOT verify the posting-key sig; username/sig are cosmetic.
//            -> 200 {"url":"https://img.melek.salon/<hash40>.<ext>"}  on success
//            -> 200 {"error":"..."}                                    on refusal (bad type / too big)
//   SERVE:   GET  {serveBase}/<hash40>.<ext>  -> the stored image (immutable, 1-year cache)
//            Public serve URL is https://melek.salon/img/<hash40>.<ext> (Caddy) — IMGHOST_BASE_URL.
//   LIMITS:  images only (jpg/png/gif/webp/bmp, magic-byte sniff), 12 MB cap, sha256(bytes)[:40] filename
//            (content-addressed => dedup). Zero external deps.
//
// THE HASH SEAM (design doc §"the seam for later"): we compute + always carry a full sha256 of the bytes
// with every upload. That single field is what later lets us pin the same bytes to IPFS/Arweave and anchor
// the hash on PRANA / MELEK / the Ashurbanipal storage chain — WITHOUT re-touching any user. We do NOT build
// the chain part here; we only always carry the hash.
//
// House style: ESM, esc() all interpolation, safeHref() http(s)-allowlist, injectable fetch (__setFetch),
// soft-fail-never-throw, handler(req,res) exported for tests, CLI guarded by process.argv[1].
//
//   PORT=8174 IMAGEHOST_UPLOAD_URL=http://127.0.0.1:8145/imagehost/anon \
//   IMAGEHOST_SERVE_BASE=https://melek.salon/img node site/imagehost/server.mjs
//   import { handler } from './server.mjs'   // tests

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const PORT = +(process.env.PORT || 8174);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || '';

// Where we forward the bytes. The melek-imagehoster upload endpoint POST {base}/<username>/<sig>;
// v1 ignores username/sig so any path segment works. Default to the loopback service on its own box.
const IMAGEHOST_UPLOAD_URL = process.env.IMAGEHOST_UPLOAD_URL || 'http://127.0.0.1:8145/imagehost/anon';
// If set, we rewrite the returned URL onto this public serve base (backend returns img.melek.salon;
// the Caddy-fronted public path is melek.salon/img). Empty => pass the backend URL through unchanged.
const IMAGEHOST_SERVE_BASE = (process.env.IMAGEHOST_SERVE_BASE || '').replace(/\/+$/, '');

const MAX_BYTES = +(process.env.IMAGEHOST_MAX_BYTES || 10 * 1024 * 1024); // 10 MB cap (page + server)

// Injectable fetch so tests never touch the network / real backend.
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── helpers ───────────────────────────────────────────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// Only http(s) URLs may be used as hrefs/embeds — esc() does NOT neutralize javascript:/data: URIs.
export function safeHref(u) {
  const raw = String(u == null ? '' : u).trim();
  return /^https?:\/\//i.test(raw) ? raw : '';
}

// image magic-byte sniff -> { ext, type } (mirrors the backend's allowlist; images only).
export function sniffImage(buf) {
  if (!buf || buf.length < 12) return null;
  const b = buf;
  try {
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return { ext: 'jpg', type: 'image/jpeg' };
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return { ext: 'png', type: 'image/png' };
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return { ext: 'gif', type: 'image/gif' };
    if (b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return { ext: 'webp', type: 'image/webp' };
    if (b[0] === 0x42 && b[1] === 0x4d) return { ext: 'bmp', type: 'image/bmp' };
  } catch { /* soft-fail: a bad sniff never breaks the upload */ }
  return null;
}

const json = (res, code, obj) => {
  const body = JSON.stringify(obj);
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
    'access-control-allow-methods': 'GET, POST, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body);
};

function readBody(req, limit) {
  return new Promise((resolve) => {
    const chunks = [];
    let size = 0;
    let done = false;
    const finish = (buf) => { if (!done) { done = true; resolve(buf); } };
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { finish(null); try { req.destroy(); } catch { /* already gone */ } return; }
      chunks.push(c);
    });
    req.on('end', () => finish(Buffer.concat(chunks)));
    req.on('error', () => finish(null));
  });
}

// Pull raw image bytes out of an upload request. We accept a small JSON envelope (what a plain browser
// fetch sends most easily): { filename, data } where `data` is base64 (optionally a data: URL prefix).
export function decodeUpload(bodyText) {
  let parsed;
  try { parsed = JSON.parse(bodyText); } catch { return { error: 'expected JSON { filename, data(base64) }' }; }
  if (!parsed || typeof parsed !== 'object') return { error: 'expected JSON body' };
  let data = parsed.data || parsed.filebase64 || parsed.base64 || '';
  if (typeof data !== 'string' || !data) return { error: 'no image data' };
  const comma = data.indexOf(',');
  if (data.slice(0, 5) === 'data:' && comma !== -1) data = data.slice(comma + 1); // strip data:...;base64,
  let bytes;
  try { bytes = Buffer.from(data, 'base64'); } catch { return { error: 'bad base64' }; }
  if (!bytes || !bytes.length) return { error: 'no image data' };
  return { bytes, filename: String(parsed.filename || '') };
}

// Forward the validated bytes to the melek-imagehoster backend as multipart with a `file` part.
async function forwardToBackend(bytes, kind, filename) {
  const fd = new FormData();
  const safeName = (filename || `upload.${kind.ext}`).replace(/[^\w.\-]/g, '_').slice(0, 80) || `upload.${kind.ext}`;
  fd.append('file', new Blob([bytes], { type: kind.type }), safeName);
  const resp = await _fetch(IMAGEHOST_UPLOAD_URL, { method: 'POST', body: fd });
  const out = await resp.json();
  return out; // { url } | { error }
}

// Rewrite a backend URL (https://img.melek.salon/<name>) onto the public serve base if one is configured.
function publicUrl(backendUrl) {
  const safe = safeHref(backendUrl);
  if (!safe) return '';
  if (!IMAGEHOST_SERVE_BASE) return safe;
  try {
    const name = new URL(safe).pathname.split('/').filter(Boolean).pop() || '';
    return `${IMAGEHOST_SERVE_BASE}/${name}`;
  } catch { return safe; }
}

async function handleUpload(req, res) {
  const raw = await readBody(req, MAX_BYTES + 64 * 1024); // room for the base64 envelope (~1.37x)
  if (!raw) return json(res, 200, { ok: false, error: `image too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB)` });

  const dec = decodeUpload(raw.toString('utf8'));
  if (dec.error) return json(res, 200, { ok: false, error: dec.error });
  const { bytes, filename } = dec;
  if (bytes.length > MAX_BYTES) return json(res, 200, { ok: false, error: `image too large (max ${Math.floor(MAX_BYTES / 1024 / 1024)} MB)` });

  const kind = sniffImage(bytes);
  if (!kind) return json(res, 200, { ok: false, error: 'unsupported file type (images only: jpg/png/gif/webp/bmp)' });

  // THE HASH SEAM: full sha256 of the bytes, carried with every upload from day one.
  const hash = crypto.createHash('sha256').update(bytes).digest('hex');

  let backend;
  try {
    backend = await forwardToBackend(bytes, kind, filename);
  } catch {
    return json(res, 200, { ok: false, error: 'upload backend unreachable' });
  }
  if (!backend || backend.error) return json(res, 200, { ok: false, error: String((backend && backend.error) || 'backend refused the upload') });

  const url = publicUrl(backend.url);
  if (!url) return json(res, 200, { ok: false, error: 'backend returned no usable url' });

  return json(res, 200, { ok: true, url, hash, bytes: bytes.length, type: kind.type });
}

// ── page ──────────────────────────────────────────────────────────────────────────────────────────
const STYLE = `
  :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--red:#e08b8b;--blue:#4c8dff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
  .wrap{max-width:820px;margin:0 auto}
  header{display:flex;align-items:center;gap:10px;margin:6px 0 12px}
  .brand{font-size:22px;font-weight:800} .brand b{color:var(--gold)}
  .alpha{font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
  .lead{color:var(--mut);font-size:14px;margin:0 0 12px}
  .note{background:#101a14;border:1px solid var(--green);border-radius:12px;padding:10px 12px;margin:0 0 14px;font-size:13px}
  .note b{color:var(--green)} .note span{color:var(--mut)}
  #drop{border:2px dashed var(--bd);border-radius:16px;padding:40px 20px;text-align:center;background:var(--panel);cursor:pointer;transition:border-color .15s,background .15s}
  #drop.drag{border-color:var(--gold);background:#171b24} #drop h2{margin:0 0 6px;font-size:18px} #drop p{margin:4px 0;color:var(--mut);font-size:13px}
  #pick{display:none}
  .btn{font:inherit;font-weight:700;border-radius:10px;cursor:pointer;border:1px solid var(--bd);background:#0e131b;color:var(--fg);padding:8px 12px;text-decoration:none;display:inline-block}
  .btn.gold{border-color:var(--gold);color:var(--gold)}
  #status{margin:12px 0;color:var(--mut);font-size:14px;min-height:1.2em}
  .result{background:var(--panel);border:1px solid var(--bd);border-radius:16px;padding:16px;margin:14px 0}
  .result .rtop{display:flex;gap:14px;align-items:flex-start}
  .result img.thumb{width:120px;height:120px;object-fit:cover;border-radius:12px;border:1px solid var(--bd);background:#0a0e15}
  .result .meta{font-size:12px;color:var(--mut);flex:1;min-width:0;word-break:break-all}
  .embed{margin:10px 0 0} .embed label{display:block;font-size:11px;font-weight:700;color:var(--mut);margin:8px 0 3px;letter-spacing:.4px}
  .embed .row{display:flex;gap:8px} .embed input{flex:1;min-width:0;font:13px monospace;background:#0a0e15;border:1px solid var(--bd);border-radius:8px;color:var(--fg);padding:7px 9px}
  .embed button{white-space:nowrap}
  h3{font-size:15px;margin:22px 0 8px} .gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:8px}
  .gallery a{display:block;border:1px solid var(--bd);border-radius:8px;overflow:hidden;background:#0a0e15} .gallery img{width:100%;height:90px;object-fit:cover;display:block}
  .gallery .empty{grid-column:1/-1;color:var(--mut);font-size:13px}
  footer{color:var(--mut);font-size:12px;text-align:center;margin:24px 0 8px} a{color:var(--gold)}`;

function page() {
  const cap = Math.floor(MAX_BYTES / 1024 / 1024);
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Image Host · MELEK</title>
<meta name=description content="A simple public image uploader — drag, drop, and get direct / HTML / BBCode / Markdown embed codes.">
<style>${STYLE}</style></head><body><div class=wrap>
<header><span class=brand><b>MELEK</b> Image Host</span><span class=alpha>Alpha</span></header>
<p class=lead>Drag an image in (or pick a file) and get copy-ready share links — Direct, HTML, BBCode, Markdown.</p>
<div class=note><b>🌐 Public host.</b> <span>Uploads are public and content-addressed. Images only (jpg / png / gif / webp / bmp), up to ${esc(cap)} MB. Don't upload anything private.</span></div>
<div id=drop tabindex=0 role=button aria-label="Upload an image">
  <h2>📤 Drop an image here</h2>
  <p>or <span style="color:var(--gold);font-weight:700">click to choose a file</span></p>
  <p>Images only · up to ${esc(cap)} MB</p>
</div>
<input id=pick type=file accept="image/*">
<div id=status></div>
<div id=out></div>
<h3>Your recent uploads</h3>
<div class=gallery id=gallery><span class=empty>Uploads you make here appear on this device only.</span></div>
<footer>MELEK Image Host — bytes stored by melek-imagehoster; every upload carries a sha256 content hash for future permanent (IPFS / on-chain) pinning.</footer>
</div>
<script>
const MAX = ${MAX_BYTES};
const drop = document.getElementById('drop'), pick = document.getElementById('pick');
const statusEl = document.getElementById('status'), out = document.getElementById('out'), gallery = document.getElementById('gallery');
const OK_TYPES = ['image/jpeg','image/png','image/gif','image/webp','image/bmp'];

function loadMine(){ try { return JSON.parse(localStorage.getItem('melek_imghost_uploads')||'[]'); } catch { return []; } }
function saveMine(list){ try { localStorage.setItem('melek_imghost_uploads', JSON.stringify(list.slice(0,60))); } catch {} }
function renderGallery(){
  const mine = loadMine();
  if(!mine.length){ gallery.innerHTML = '<span class=empty>Uploads you make here appear on this device only.</span>'; return; }
  gallery.innerHTML = mine.map(function(u){
    return '<a href="'+encodeURI(u.url)+'" target=_blank rel="noopener noreferrer" title="'+(u.hash||'')+'"><img loading=lazy src="'+encodeURI(u.url)+'" alt="upload"></a>';
  }).join('');
}
function field(label, value){
  return '<div class=embed><label>'+label+'</label><div class=row>'
    + '<input readonly value="'+String(value).replace(/"/g,'&quot;')+'">'
    + '<button class=btn onclick="(function(b){navigator.clipboard&&navigator.clipboard.writeText(b.previousElementSibling.value);b.textContent=\\'Copied\\';setTimeout(function(){b.textContent=\\'Copy\\'},1200)})(this)">Copy</button>'
    + '</div></div>';
}
function showResult(r){
  const direct = r.url;
  const html = '<img src="'+direct+'" alt="">';
  const bb = '[img]'+direct+'[/img]';
  const md = '!['+']('+direct+')';
  out.innerHTML = '<div class=result><div class=rtop>'
    + '<img class=thumb src="'+encodeURI(direct)+'" alt="uploaded image">'
    + '<div class=meta><b style="color:var(--green)">✓ Uploaded</b><br>'+ (r.bytes? (Math.round(r.bytes/102.4)/10)+' KB · ' : '') + (r.type||'') +'<br>sha256: '+ (r.hash||'') +'</div>'
    + '</div>'
    + field('Direct link', direct)
    + field('HTML', html)
    + field('BBCode', bb)
    + field('Markdown', md)
    + '</div>';
}
async function upload(file){
  if(!file){ return; }
  if(OK_TYPES.indexOf(file.type) === -1){ statusEl.textContent = '✗ Images only (jpg / png / gif / webp / bmp).'; return; }
  if(file.size > MAX){ statusEl.textContent = '✗ Too large — max '+Math.floor(MAX/1024/1024)+' MB.'; return; }
  statusEl.textContent = '⏳ Uploading '+file.name+'…';
  let dataUrl;
  try { dataUrl = await new Promise(function(res,rej){ const fr=new FileReader(); fr.onload=function(){res(fr.result)}; fr.onerror=rej; fr.readAsDataURL(file); }); }
  catch { statusEl.textContent = '✗ Could not read the file.'; return; }
  try {
    const resp = await fetch('/upload', { method:'POST', headers:{'content-type':'application/json'}, body: JSON.stringify({ filename:file.name, data:dataUrl }) });
    const r = await resp.json();
    if(!r || !r.ok){ statusEl.textContent = '✗ '+((r&&r.error)||'upload failed'); return; }
    statusEl.textContent = '';
    showResult(r);
    const mine = loadMine(); mine.unshift({ url:r.url, hash:r.hash, at:Date.now() }); saveMine(mine); renderGallery();
  } catch { statusEl.textContent = '✗ Network error — try again.'; }
}
drop.addEventListener('click', function(){ pick.click(); });
drop.addEventListener('keydown', function(e){ if(e.key==='Enter'||e.key===' '){ e.preventDefault(); pick.click(); } });
pick.addEventListener('change', function(){ if(pick.files && pick.files[0]) upload(pick.files[0]); });
['dragenter','dragover'].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.add('drag'); }); });
['dragleave','drop'].forEach(function(ev){ drop.addEventListener(ev, function(e){ e.preventDefault(); drop.classList.remove('drag'); }); });
drop.addEventListener('drop', function(e){ const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]; if(f) upload(f); });
renderGallery();
</script>
</body></html>`;
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL || 'http://imagehost.local');
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      return res.end();
    }
    if (path === '/health') return json(res, 200, { ok: true, service: 'melek-imagehost-ui', max_bytes: MAX_BYTES });
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\nDisallow: /upload\n'); }
    if (req.method === 'POST' && path === '/upload') return await handleUpload(req, res);
    if (path === '/') { res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page()); }

    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch {
    // soft-fail: never throw out of the handler
    try { return json(res, 500, { ok: false, error: 'internal error' }); } catch { /* res already gone */ }
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK Image Host on http://${HOST}:${PORT} — backend ${IMAGEHOST_UPLOAD_URL}`));
}
