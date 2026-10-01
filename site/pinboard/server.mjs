// site/pinboard/server.mjs — MELEK PINBOARD at pin.melek.salon: the picture side of MELEK.
//
// BiFrost is the video side; this is pictures. Post a photo or a small album, or SAVE one you found —
// in a MELEK blog post or anywhere on the web — and it all lands in one wall of thumbnails, the way
// Pinterest and Instagram show things, instead of one-at-a-time down a column like Steemit or Reddit.
//
// Both directions are one click:
//   • a MELEK blog post's pictures → the pinboard   (/save?post=@author/permlink, or the bookmarklet)
//   • a pin → markdown for a MELEK blog post        (shown on every pin page)
//
// The model, the credit rule and the HTML live in integrations/melek-pinboard.mjs. This file is storage
// (one JSON file, injectable fs, same discipline as the other stores) plus routes. It holds NO keys and
// makes NO chain writes: publishing a pin as an on-chain comment goes through MELEK-Signer elsewhere.
//
//   PORT=8201 BASE_URL=https://pin.melek.salon node site/pinboard/server.mjs

import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makePin, validatePin, pinsFromPost, gridHtml, markdownFor, isImageUrl, safeUrl, hostOf, PINBOARD_CSS, MAX_ALBUM } from '../../integrations/melek-pinboard.mjs';

const PORT = +(process.env.PORT || 8201);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://pin.melek.salon').replace(/\/$/, '');
const MELEK = (process.env.MELEK_SITE || 'https://melek.salon').replace(/\/$/, '');
let DATA = process.env.PINBOARD_DATA || join(process.cwd(), 'data', 'pins.json');
export function __setData(p) { DATA = p; }

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// ── store ───────────────────────────────────────────────────────────────────────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch { /* exists */ } writeFileSync(p, s); },
};
let _fs = realFs;
export function __setIO(io) { _fs = io || realFs; }

export function loadPins() {
  const raw = _fs.read(DATA);
  if (!raw) return [];
  try { const o = JSON.parse(raw); return Array.isArray(o.pins) ? o.pins : []; } catch { return []; }
}
function savePins(pins) {
  try { _fs.write(DATA, JSON.stringify({ pins: pins.slice(-5000) }, null, 1)); return true; } catch { return false; }
}
export function addPin(pin) {
  const v = validatePin(pin);
  if (!v.valid) return { ok: false, reason: v.errors[0] };
  const pins = loadPins();
  pins.push(pin);
  if (!savePins(pins)) return { ok: false, reason: 'could not save' };
  return { ok: true, pin };
}

// ── pages ───────────────────────────────────────────────────────────────────────────────────────────
const STYLE = `<style>
:root{--bg:#0f1117;--panel:#171a23;--bd:#2a2f3d;--fg:#e8e6e1;--mut:#9aa0ad;--acc:#d9a441}
@media (prefers-color-scheme:light){:root{--bg:#f6f4ef;--panel:#fff;--bd:#ddd6c8;--fg:#1d1b17;--mut:#6b665c;--acc:#8a6a12}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.55 system-ui,sans-serif}
header{display:flex;gap:14px;align-items:center;flex-wrap:wrap;padding:12px 16px;border-bottom:1px solid var(--bd)}
header a{color:var(--mut);text-decoration:none}.brand{color:var(--fg)!important;font-size:18px;font-weight:700}
.wrap{max-width:1300px;margin:0 auto;padding:16px}a{color:var(--acc)}h1{font-size:22px;margin:4px 0 10px}
.lead{color:var(--mut)}form.add{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 18px}
input,button,textarea{font:inherit;color:inherit;background:transparent;border:1px solid var(--bd);border-radius:9px;padding:7px 10px}
input{min-width:220px;flex:1}button{cursor:pointer;background:var(--acc);color:#111;border:0;font-weight:700}
button.ghost{background:transparent;color:var(--fg);border:1px solid var(--bd);font-weight:400}
.single img{max-width:100%;border-radius:12px;margin-bottom:10px}
code{font-size:12px;word-break:break-all;background:var(--panel);padding:2px 5px;border-radius:5px}
.alpha{border:1px solid var(--acc);border-radius:10px;padding:10px 12px;margin:10px 0;background:var(--panel)}
</style>`;

function shell(title, inner, { canonical = `${BASE_URL}/`, description } = {}) {
  const d = description || 'MELEK Pinboard — a MELEK front end for pictures: post photos and small albums, or save pictures from MELEK blog posts and anywhere on the web. Everything shows as one wall of thumbnails.';
  return `<!doctype html><html lang=en><head><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name=description content="${esc(d)}"><link rel=canonical href="${esc(canonical)}">
${STYLE}${PINBOARD_CSS}</head><body>
<header><a class=brand href="/">MELEK Pinboard</a><a href="${esc(MELEK)}">MELEK</a>
<a href="https://stream.soapbox.community/music">🎵 Music</a><a href="https://pentecaust.com/metatron">✍️ Make a picture</a>
<a href="/boards">Boards</a><a href="/how">How to save</a></header>
<div class=wrap>${inner}</div>
<script>
(function(){
 // 📌 Save — a pin's own save button copies it onto your board (kept in this browser until you sign in).
 document.addEventListener('click',function(e){var b=e.target.closest&&e.target.closest('.pb-save');if(!b)return;
  try{var k='pinboard.saved',s=JSON.parse(localStorage.getItem(k)||'[]');if(s.indexOf(b.dataset.pin)<0)s.push(b.dataset.pin);
   localStorage.setItem(k,JSON.stringify(s.slice(-500)));b.textContent='📌 Saved'}catch(err){}});
})();
</script></body></html>`;
}

function homePage(pins) {
  const inner = `<h1>The picture side of MELEK</h1>
<div class=alpha><b>Alpha. A MELEK front end.</b> Post a photo or a small album, or save a picture you found — in a MELEK blog post or anywhere on the web. A pin is kept on the MELEK chain as a small record — not a blog post, so pinning a hundred pictures never drowns your blog. Write a post about them when you want to; that is a separate thing. A saved picture always keeps a link back to where it came from.</div>
<p class=lead>Pins live on the MELEK chain as their own small records, so they stay yours and travel with your account — without filling anyone's blog. <a href="https://pact.pentecaust.com">Groups and clubs</a> get their own walls next.</p>
<form class=add method=post action="/pin">
 <input name=url placeholder="Paste a picture's address (or a MELEK post to save all of its pictures)" aria-label="Picture or post address">
 <input name=title placeholder="Title (optional)" aria-label=Title>
 <input name=author placeholder="your MELEK name" aria-label="your name" style="max-width:170px">
 <button>Pin it</button>
</form>
<p class=lead>You can also drag the <a href="/how">Save to MELEK</a> button to your bookmarks bar and save a picture from any page you are reading.</p>
${gridHtml(pins.slice().reverse().slice(0, 120))}`;
  return shell('MELEK Pinboard — photos, albums and saved pictures', inner);
}

function pinPage(p) {
  const md = markdownFor(p, { baseUrl: BASE_URL });
  const from = p.kind === 'saved' && p.sourceUrl
    ? `<p class=lead>Saved from ${p.sourceAuthor ? `@${esc(p.sourceAuthor)} — ` : ''}<a href="${esc(p.sourceUrl)}" target=_blank rel="noopener noreferrer">${esc(hostOf(p.sourceUrl) || p.sourceUrl)}</a></p>`
    : `<p class=lead>Posted by @${esc(p.author)}</p>`;
  const inner = `<p><a href="/">← The wall</a></p><h1>${esc(p.title || 'A picture')}</h1>${from}
<div class=single>${p.images.map((i) => `<img src="${esc(i.url)}" alt="${esc(i.alt || p.title)}">`).join('')}</div>
${p.note ? `<p>${esc(p.note)}</p>` : ''}
<h2 style="font-size:16px">Put it in a MELEK blog post</h2>
<p class=lead>Copy this into your post:</p><p><code id=md>${esc(md)}</code> <button class=ghost onclick="navigator.clipboard&&navigator.clipboard.writeText(document.getElementById('md').textContent)">Copy</button></p>`;
  return shell(`${p.title || 'A picture'} · MELEK Pinboard`, inner, { canonical: `${BASE_URL}/p/${encodeURIComponent(p.id)}` });
}

function howPage() {
  // A bookmarklet: on any page, grab the biggest picture and bring it here to pin, with the page as its source.
  const bm = `javascript:(function(){var i=[].slice.call(document.images).sort(function(a,b){return b.naturalWidth*b.naturalHeight-a.naturalWidth*a.naturalHeight})[0];if(!i){alert('No picture found on this page');return}window.open('${BASE_URL}/save?url='+encodeURIComponent(i.src)+'&source='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(document.title),'_blank')})()`;
  const inner = `<p><a href="/">← The wall</a></p><h1>Saving pictures</h1>
<h2 style="font-size:16px">From any website</h2>
<p class=lead>Drag this button to your bookmarks bar. On any page, click it and the biggest picture comes here to pin, with a link back to that page.</p>
<p><a class=ghost style="display:inline-block;padding:8px 14px;border:1px solid var(--bd);border-radius:9px;text-decoration:none" href="${esc(bm)}">📌 Save to MELEK</a></p>
<h2 style="font-size:16px">From a MELEK blog post</h2>
<p class=lead>Paste the post's address on the wall, or open <code>${esc(BASE_URL)}/save?post=@author/permlink</code> — every picture in the post becomes a pin that links back to it and keeps the author's name.</p>
<h2 style="font-size:16px">Back into a blog post</h2>
<p class=lead>Every pin page gives you the markdown to paste into a MELEK post, with the credit line already written — for when you do want to write about your pictures.</p>`;
  return shell('How to save pictures · MELEK Pinboard', inner, { canonical: `${BASE_URL}/how` });
}

function boardsPage(pins) {
  const names = [...new Set(pins.map((p) => p.board).filter(Boolean))].sort();
  const inner = `<p><a href="/">← The wall</a></p><h1>Boards</h1>`
    + (names.length ? `<ul>${names.map((b) => `<li><a href="/b/${esc(b)}">${esc(b)}</a> — ${pins.filter((p) => p.board === b).length} pins</li>`).join('')}</ul>`
      : '<p class=lead>No boards yet. Give a pin a board name and it shows up here.</p>');
  return shell('Boards · MELEK Pinboard', inner, { canonical: `${BASE_URL}/boards` });
}

function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=60' });
  res.end(html);
}
function readBody(req, max = 20000) {
  return new Promise((resolve) => {
    if (!req.on) return resolve('');
    let d = ''; req.on('data', (c) => { d += c; if (d.length > max) { d = d.slice(0, max); req.destroy(); } });
    req.on('end', () => resolve(d)); req.on('error', () => resolve(''));
  });
}

// ── reading a MELEK post, so its pictures can be saved ──────────────────────────────────────────────
// Standard Graphene: condenser_api.get_content. Read-only, no keys. Soft-fails to null (the saver then
// says it could not read the post) and is injectable so the offline suite never touches the network.
const CHAIN_RPC = process.env.CHAIN_RPC || 'https://melek.salon/rpc';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function readPostFromChain(author, permlink) {
  try {
    const r = await _fetch(CHAIN_RPC, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_content', params: [author, permlink], id: 1 }),
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    const c = j && j.result;
    if (!c || !c.author || !c.body) return null;
    return { author: c.author, permlink: c.permlink, title: c.title || '', body: c.body, url: `${MELEK}/@${c.author}/${c.permlink}` };
  } catch { return null; }
}

let _readPost = readPostFromChain;
export function __setPostReader(fn) { _readPost = fn || readPostFromChain; }

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL || 'http://pin.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const pins = loadPins();

    if (path === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify({ ok: true, surface: 'pinboard', pins: pins.length })); }
    if (path === '/how') return sendHtml(res, howPage());
    if (path === '/boards') return sendHtml(res, boardsPage(pins));
    if (path === '/pins.json') {
      res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ pins: pins.slice(-300).reverse() }));
    }
    const bm = path.match(/^\/b\/([a-z0-9-]+)$/);
    if (bm) return sendHtml(res, shell(`${bm[1]} · MELEK Pinboard`, `<p><a href="/boards">← Boards</a></p><h1>${esc(bm[1])}</h1>${gridHtml(pins.filter((p) => p.board === bm[1]).reverse())}`));
    const pm = path.match(/^\/p\/(.+)$/);
    if (pm) {
      const p = pins.find((x) => x.id === decodeURIComponent(pm[1]));
      return p ? sendHtml(res, pinPage(p)) : sendHtml(res, shell('Not found · MELEK Pinboard', '<p>No such pin. <a href="/">The wall</a></p>'), 404);
    }

    // the bookmarklet and the blog-post saver both land here
    if (path === '/save') {
      const post = url.searchParams.get('post');
      if (post) {
        const m = String(post).match(/@?([a-z0-9.-]+)\/([\w-]+)/i);
        const got = m ? await _readPost(m[1], m[2]) : null;
        if (!got) return sendHtml(res, shell('Nothing to save · MELEK Pinboard', '<p>Could not read that post. <a href="/">The wall</a></p>'), 404);
        const made = pinsFromPost(got, { saver: url.searchParams.get('as') || got.author, one: url.searchParams.get('album') === '1', baseUrl: MELEK });
        let n = 0; for (const p of made) if (addPin(p).ok) n++;
        return sendHtml(res, shell('Saved · MELEK Pinboard', `<h1>Saved ${n} picture${n === 1 ? '' : 's'}</h1><p class=lead>From <a href="${esc(safeUrl(got.url) || '#')}">${esc(got.title || post)}</a>, with a link back on every one.</p>${gridHtml(made)}<p><a href="/">← The wall</a></p>`));
      }
      const pic = safeUrl(url.searchParams.get('url'));
      if (!isImageUrl(pic)) return sendHtml(res, shell('Nothing to save · MELEK Pinboard', '<p>That is not a picture address. <a href="/how">How to save</a></p>'), 400);
      const pin = makePin({
        author: url.searchParams.get('as') || 'anon', kind: 'saved', title: url.searchParams.get('title') || '',
        images: [{ url: pic }], sourceUrl: url.searchParams.get('source') || pic, board: url.searchParams.get('board') || '',
      });
      const r = addPin(pin);
      return r.ok
        ? sendHtml(res, shell('Saved · MELEK Pinboard', `<h1>Saved</h1>${gridHtml([pin])}<p><a href="/">← The wall</a> · <a href="/p/${encodeURIComponent(pin.id)}">open it</a></p>`))
        : sendHtml(res, shell('Not saved · MELEK Pinboard', `<p>${esc(r.reason)}</p>`), 400);
    }

    if (path === '/pin' && (req.method || 'GET') === 'POST') {
      const body = new URLSearchParams(await readBody(req));
      const raw = String(body.get('url') || '').trim();
      const postRef = raw.match(/@([a-z0-9.-]+)\/([\w-]+)/i);
      if (postRef && !isImageUrl(raw)) {
        res.writeHead(302, { location: `/save?post=@${postRef[1]}/${postRef[2]}&as=${encodeURIComponent(body.get('author') || '')}` });
        return res.end();
      }
      const pin = makePin({ author: body.get('author') || 'anon', title: body.get('title') || '', images: [{ url: raw }], board: body.get('board') || '' });
      const r = addPin(pin);
      if (!r.ok) return sendHtml(res, shell('Not pinned · MELEK Pinboard', `<p>${esc(r.reason)} <a href="/">Back</a></p>`), 400);
      res.writeHead(302, { location: `/p/${encodeURIComponent(pin.id)}` });
      return res.end();
    }

    if (path === '/') return sendHtml(res, homePage(pins));
    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' });
    return res.end('error');
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK Pinboard on http://${HOST}:${PORT}`));
}
