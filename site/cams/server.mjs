// site/cams/server.mjs — cams.soapbox.community: the live-view / camera app (Phase 1, Public cams).
//
// Grown from site/servers/server.mjs: the same "watch a live thing" skeleton (a grid of TILES → a
// full-screen /watch/:id STAGE), with the source generalized from one Minecraft POV to any consensual
// public camera. See .local/CAMERA_LIVEVIEW_APP_DESIGN.md.
//
// THE HARD ETHICS BOUNDARY (stated on the page): PUBLIC, CONSENSUAL CAMERAS ONLY — official DOT/511
// traffic cams, tourism / wildlife / institution live streams, and (with a key) the Windy Webcams API.
// We POINT at / WINDOW (embed) the owner's own stream with attribution; we NEVER rehost, and NEVER
// scrape/index/probe strangers' private cameras. The directory reader enforces this; the page states it.
//
// House style: ESM, esc() all interpolation, every href/embed http(s)-allowlisted (safeHref), keyless +
// soft-fail (the reader never throws), handler(req,res) exported for tests, CLI guarded by process.argv[1].
//
//   PORT=8172 node site/cams/server.mjs
//   import { handler } from './server.mjs'   // tests

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { listCams, searchCams, allCams, esc, safeHref, dataNote } from '../../integrations/camera-directory.mjs';

const PORT = +(process.env.PORT || 8172);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = process.env.BASE_URL || '';

const BOUNDARY = 'Public, consensual cameras only.';
const BOUNDARY_LONG = 'We point at / embed cameras whose owners publish them for public viewing — '
  + 'official DOT & 511 traffic cams, tourism / wildlife / institution live streams, and the Windy '
  + 'Webcams API. We never rehost, and we never scrape, index, or probe anyone’s private cameras.';

function camById(id) {
  const want = String(id || '').toLowerCase();
  return listCams().find((c) => c.id === want) || null;
}

// ── html ────────────────────────────────────────────────────────────────────────────────────────
const CATEGORIES = ['all', 'traffic', 'nature', 'city', 'weather'];

function tile(c) {
  const window = c.posture === 'window' && c.embed;
  const src = safeHref(c.embed);
  return `<div class=card data-id="${esc(c.id)}">
  <div class=top>
    <div><h2>${esc(c.name)}</h2><div class=meta>${esc(c.region || c.category)}</div></div>
    <span class="badge posture" data-p="${esc(c.posture)}">${esc(c.posture === 'window' ? 'WINDOW · embed' : 'POINT · link')}</span>
  </div>
  <a class=preview href="/watch/${esc(c.id)}" title="Open the full screen">
    ${window && src
      ? `<iframe class=pv src="${esc(src)}" loading=lazy scrolling=no tabindex=-1 title="${esc(c.name)} live camera" referrerpolicy=no-referrer></iframe><span class="plabel live">📹 LIVE · click to watch full screen</span>`
      : `<span class=pvph>📡</span><span class=plabel>Open the live view →</span>`}
  </a>
  <div class=attr>Source: ${esc(c.attribution)}</div>
  <div class=row>
    <a class=btn href="/watch/${esc(c.id)}">${window ? '📹 Watch full screen' : '↗ Open the owner’s stream'}</a>
    <a class="btn ghost" href="${esc(safeHref(c.source))}" target=_blank rel="noopener noreferrer">Source ↗</a>
  </div>
  <div class=tags><span>${esc(c.category)}</span></div>
</div>`;
}

const STYLE = `
  :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--red:#e08b8b;--blue:#4c8dff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif;padding:14px}
  .wrap{max-width:960px;margin:0 auto}
  header{display:flex;align-items:center;gap:10px;margin:6px 0 12px}
  .brand{font-size:22px;font-weight:800} .brand b{color:var(--gold)}
  .alpha{font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
  .boundary{background:#101a14;border:1px solid var(--green);border-radius:12px;padding:10px 12px;margin:0 0 14px}
  .boundary b{color:var(--green)} .boundary p{margin:4px 0 0;color:var(--mut);font-size:13px}
  .lead{color:var(--mut);font-size:14px;margin:0 0 12px}
  .filters{display:flex;gap:8px;flex-wrap:wrap;margin:0 0 14px}
  .filters a{font-size:12px;font-weight:700;text-decoration:none;color:var(--mut);border:1px solid var(--bd);border-radius:999px;padding:5px 12px}
  .filters a.on{color:var(--gold);border-color:var(--gold)}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}
  .card{background:var(--panel);border:1px solid var(--bd);border-radius:16px;padding:16px}
  .top{display:flex;align-items:flex-start;gap:10px} .top>div:first-child{flex:1}
  h2{font-size:17px;margin:0} .meta{color:var(--mut);font-size:12px;margin-top:2px}
  .badge{font-size:10px;font-weight:700;padding:3px 9px;border-radius:999px;border:1px solid var(--bd);color:var(--mut);white-space:nowrap}
  .badge.posture[data-p=window]{color:var(--green);border-color:var(--green)} .badge.posture[data-p=point]{color:var(--blue);border-color:var(--blue)}
  .preview{position:relative;display:block;height:170px;border-radius:12px;overflow:hidden;border:1px solid var(--bd);background:#0a0e15 radial-gradient(circle at 50% 40%,#16202e,#0a0e15);margin:10px 0;text-decoration:none}
  .preview .pv{width:100%;height:100%;border:0;pointer-events:none;background:#0a0e15}
  .preview .pvph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:40px;opacity:.5}
  .preview .plabel{position:absolute;left:0;right:0;bottom:0;padding:7px 10px;font-size:12px;font-weight:700;color:var(--fg);background:linear-gradient(transparent,rgba(0,0,0,.75))}
  .preview .plabel.live{color:#fff} .preview .plabel.live::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--red);margin-right:6px;vertical-align:middle;animation:lp 1.6s infinite}
  @keyframes lp{0%{box-shadow:0 0 0 0 rgba(224,139,139,.6)}70%{box-shadow:0 0 0 7px rgba(224,139,139,0)}100%{box-shadow:0 0 0 0 rgba(224,139,139,0)}}
  .preview:hover{border-color:var(--gold)}
  .attr{font-size:11px;color:var(--mut);margin:2px 0 10px}
  button,.btn{font:inherit;font-weight:700;border-radius:10px;cursor:pointer;border:1px solid var(--bd);background:#0e131b;color:var(--fg);padding:8px 12px;text-decoration:none;display:inline-block}
  .row{display:flex;gap:8px;flex-wrap:wrap} .btn{flex:1;text-align:center;min-width:130px} .btn.ghost{color:var(--mut);flex:0}
  .tags{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px} .tags span{font-size:10px;color:var(--mut);border:1px solid var(--bd);border-radius:6px;padding:2px 7px}
  footer{color:var(--mut);font-size:12px;text-align:center;margin:24px 0 8px} a{color:var(--gold)}
  .empty{color:var(--mut);text-align:center;padding:40px}`;

function page(category = 'all') {
  const cams = category && category !== 'all' ? searchCams({ category, limit: 200 }) : listCams();
  const filters = CATEGORIES.map((c) =>
    `<a class="${c === category ? 'on' : ''}" href="${c === 'all' ? '/' : '/?category=' + encodeURIComponent(c)}">${esc(c)}</a>`).join('');
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Cams · SoapBox Community</title>
<meta name=description content="Live public cameras — official traffic, wildlife, and city streams. Consensual, official sources only.">
<style>${STYLE}</style></head><body><div class=wrap>
<header><span class=brand><b>SoapBox</b> Cams</span><span class=alpha>Alpha</span></header>
<div class=boundary><b>🔒 ${esc(BOUNDARY)}</b><p>${esc(BOUNDARY_LONG)}</p></div>
<p class=lead>Live public cameras that their owners publish for everyone. Pick one and watch it full screen.</p>
<div class=filters>${filters}</div>
${cams.length ? `<div class=grid>${cams.map(tile).join('')}</div>` : `<p class=empty>No cameras in this category right now.</p>`}
<footer>${esc(dataNote())}</footer>
</div></body></html>`;
}

function watchPage(c) {
  const window = c.posture === 'window' && c.embed;
  const embed = safeHref(c.embed);
  const source = safeHref(c.source);
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(c.name)} · SoapBox Cams</title>
<style>${STYLE}
  header{display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--bd);margin:0}
  body{padding:0} .back{color:var(--gold);text-decoration:none;font-weight:700;white-space:nowrap}
  h1{font-size:18px;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .stage{position:relative;width:100%;height:64vh;min-height:340px;background:#0a0e15 radial-gradient(circle at 50% 38%,#16202e,#0a0e15);border-bottom:1px solid var(--bd)}
  .stage iframe{width:100%;height:100%;border:0;display:block}
  .stage .none{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;color:var(--mut);text-align:center;padding:20px}
  .stage .none b{color:var(--fg);font-size:18px}
  .info{max-width:920px;margin:0 auto;padding:16px}</style></head><body>
<header><a class=back href="/">← Cams</a><h1>${esc(c.name)}</h1><span class="badge posture" data-p="${esc(c.posture)}">${esc(c.posture === 'window' ? 'WINDOW · embed' : 'POINT · link')}</span></header>
<div class=stage>${window && embed
    ? `<iframe src="${esc(embed)}" title="${esc(c.name)} live camera" allowfullscreen referrerpolicy=no-referrer></iframe>`
    : `<div class=none><b>↗ This camera opens on its owner’s site</b>
        <span>This source is POINT posture — we link to the owner’s official stream rather than embedding it. Some feeds (RTSP) also need the My-Cams gateway to play in a browser.</span>
        ${source ? `<a class=btn href="${esc(source)}" target=_blank rel="noopener noreferrer">Open the owner’s stream ↗</a>` : ''}</div>`}</div>
<div class=info>
  <div class=boundary><b>🔒 ${esc(BOUNDARY)}</b><p>Region: ${esc(c.region || '—')} · Category: ${esc(c.category)}</p></div>
  <div class=attr>Source: ${esc(c.attribution)} — ${source ? `<a href="${esc(source)}" target=_blank rel="noopener noreferrer">official page ↗</a>` : 'official source'}. We point/embed the owner’s own stream and never rehost it.</div>
</div></body></html>`;
}

const json = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL || 'http://cams.local');
    const path = url.pathname;

    if (path === '/health') return json(res, 200, { ok: true, cams: listCams().length, boundary: BOUNDARY });
    if (path === '/robots.txt') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('User-agent: *\nAllow: /\nDisallow: /api/\n'); }

    // Public directory JSON (curated seed + Windy when a key is set). No arbitrary host → no open proxy.
    if (path === '/api/cams') {
      const cams = await allCams({
        q: url.searchParams.get('q') || '',
        region: url.searchParams.get('region') || '',
        category: url.searchParams.get('category') || '',
        limit: url.searchParams.get('limit') || 80,
      });
      return json(res, 200, { ok: true, count: cams.length, boundary: BOUNDARY, cams });
    }

    // Full-screen view of ONE curated camera. By id only (no arbitrary URL → no SSRF/open embed proxy).
    const watch = path.match(/^\/watch\/([a-z0-9._-]{1,64})$/i);
    if (watch) {
      const c = camById(watch[1]);
      if (!c) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('unknown camera'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(watchPage(c));
    }

    if (path === '/') {
      const cat = String(url.searchParams.get('category') || 'all').toLowerCase().replace(/[^a-z]/g, '') || 'all';
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); return res.end(page(cat));
    }
    res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('not found');
  } catch {
    res.writeHead(500, { 'content-type': 'text/plain' }); res.end('error');
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`SoapBox Cams on http://${HOST}:${PORT} — ${listCams().length} public cam(s) · ${BOUNDARY}`));
}
