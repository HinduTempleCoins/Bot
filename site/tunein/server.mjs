// site/tunein/server.mjs — "Tune In": a Netflix / Tubi-shaped browse + watch surface that AGGREGATES
// MELEK's existing video/media readers into rows ("channels") and plays each in a full-screen /watch
// stage. See .local/STREAMING_TUNE_IN_DESIGN.md §e "Group 1 — ships now, no PRANA dependency".
//
// DESIGN PRINCIPLE (from the doc): build NO new player stack and NO new source. This is pure assembly —
//   • one browse/watch shell  = the cams tile-grid → /watch/:id stage pattern (site/cams/server.mjs)
//   • one aggregator          = the pentecaust/media.mjs tab composition (reuses the readers below)
//   • one ranking             = integrations/soapbox/recommend.mjs (rank())
//   • one rule                = integrations/license-router.mjs (tagAsset gates the watch embed)
//
// Sources aggregated (import, never rehost):
//   • Films (public domain) — integrations/soapbox/video-discovery.mjs  discover()   (IA player embed)
//   • Radio · Dallas first  — integrations/soapbox/radio.mjs            dallasStations()
//   • Podcasts              — integrations/soapbox/podcasts.mjs         searchPodcasts()
//   • Live cams             — integrations/camera-directory.mjs         listCams()
//   • On MELEK (ScotTube)   — the engine/api /dtube feed logic, read server-side via scottubeFeed()
//   • Live now (Hathor.Live)— a live-channel tile → /watch/live/hathor
//
// POSTURE (license-router): every embed on the /watch stage is gated — we only frame an owner-sanctioned
// player (IA / whitelisted host); everything else POINTs at the owner's own surface. We never rehost.
//
// House style: ESM, esc() all interpolation, safeHref/allowedEmbed every href/iframe, keyless + soft-fail
// (a dead source degrades a row, never breaks the page), handler(req,res) exported for tests, CLI guarded.
//
//   PORT=8175 BASE_URL=https://watch.melek.salon node site/tunein/server.mjs
//   import { handler, __setFetch } from './server.mjs'   // tests

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import * as video from '../../integrations/soapbox/video-discovery.mjs';
import * as radio from '../../integrations/soapbox/radio.mjs';
import * as podcasts from '../../integrations/soapbox/podcasts.mjs';
import { listCams, safeHref } from '../../integrations/camera-directory.mjs';
import { allowedEmbed } from '../../integrations/soapbox/embed-whitelist.mjs';
import { rank } from '../../integrations/soapbox/recommend.mjs';
import { tagAsset } from '../../integrations/license-router.mjs';

const PORT = +(process.env.PORT || 8175);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// Public product endpoints (env-overridable; the same public defaults the /dtube client already uses).
const RPC_URL = (process.env.MELEK_RPC_URL || 'https://alpha.melek.salon/rpc').replace(/\/$/, '');
const ENGINE_URL = (process.env.MELEK_ENGINE_URL || 'https://alpha.melek.salon/engine').replace(/\/$/, '');
const HATHOR_LIVE_URL = (process.env.HATHOR_LIVE_URL || 'https://hathor.live').replace(/\/$/, '');
// A default browse term so the Podcasts row has something to show on the cold home page.
const BROWSE_POD_TERM = process.env.TUNEIN_POD_TERM || 'history';
const YEAR = 2026; // injected into license-router (never read from the wall clock)

// ── injectable fetch — one mock fans out to every reader + the ScotTube RPC reader ──────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) {
  _fetch = fn || ((...a) => globalThis.fetch(...a));
  video.__setFetch(_fetch);
  radio.__setFetch(_fetch);
  podcasts.__setFetch(_fetch);
}

// ── house-style esc (escapes the single quote too, so attribute interpolation is always safe) ────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Every source call is wrapped: on ANY failure (empty / network / throw) we degrade to [] — a dead
// source empties its row, it never breaks the page.
async function safe(fn) {
  try { const v = await fn(); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

// ── ScotTube (On MELEK) — the engine /dtube feed, read server-side ──────────────────────────────────
// Mirrors engine/api/server.mjs DTUBE_HTML's client load(): chain posts tagged `reel` whose json_metadata
// carries a playable video URL, joined with the tribe's SCOT payouts. Read-only, injectable fetch, → [].

/** Resolve a post's playable video URL from its json_metadata (same rule as the /dtube client). */
export function videoUrlOf(meta) {
  if (!meta) return null;
  if (typeof meta.video === 'string') return meta.video;
  if (meta.video && typeof meta.video.url === 'string') return meta.video.url;
  if (Array.isArray(meta.links)) return meta.links.find((l) => /\.(mp4|webm|ogg)$/i.test(l)) || null;
  return null;
}

async function rpc(method, params) {
  try {
    const r = await _fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
    });
    if (!r || !r.ok) return null;
    const j = await r.json();
    return j && j.result;
  } catch { return null; }
}

/** The ScotTube feed: `reel`-tagged video posts + per-post SCOT earnings. Soft-fails to []. */
export async function scottubeFeed({ tag = 'reel', symbol = 'REEL', limit = 12 } = {}) {
  try {
    const posts = await rpc('condenser_api.get_discussions_by_created', [{ tag, limit }]);
    const list = Array.isArray(posts) ? posts : [];
    let pays = [];
    try {
      const pr = await _fetch(`${ENGINE_URL}/api/payouts?symbol=${encodeURIComponent(symbol)}`, { headers: { accept: 'application/json' } });
      if (pr && pr.ok) { const pj = await pr.json(); if (Array.isArray(pj)) pays = pj; }
    } catch { pays = []; }
    const earnByPost = {};
    for (const p of pays) if (p && p.postKey) earnByPost[p.postKey] = p;
    const out = [];
    for (const p of list) {
      let meta = {};
      try { meta = JSON.parse(p.json_metadata || '{}'); } catch { meta = {}; }
      const vurl = videoUrlOf(meta);
      if (!vurl) continue;
      const e = earnByPost[`${p.author}/${p.permlink}`];
      out.push({
        author: p.author, permlink: p.permlink,
        title: p.title || '(untitled)',
        videoUrl: vurl,
        symbol,
        created: p.created || '',
        earn: e ? `${e.emitted || 'pending'} ${symbol}${e.paid ? '' : ' (pending)'}` : '',
      });
    }
    return out;
  } catch { return []; }
}

// ── tiles — a common display shape every source maps into ──────────────────────────────────────────
// { key, kind, title, meta, poster, live, posture, watch, href, earn, + recommend ranking hints }

function filmTile(v) {
  const embed = v.embed || '';
  return {
    key: `ia:${v.id}`, kind: 'film', title: v.title || 'Untitled',
    meta: [v.year, v.creator || v.source].filter(Boolean).join(' · '),
    poster: v.poster || '', live: false, posture: embed ? 'window' : 'point',
    watch: embed ? `/watch/ia/${encodeURIComponent(v.id)}` : '',
    href: embed ? '' : (v.url || ''),
    earn: '',
    releaseDate: v.year ? `${v.year}-01-01` : '', // freshness hint for recommend.rank()
  };
}

function camTile(c) {
  const win = c.posture === 'window' && c.embed;
  return {
    key: `cam:${c.id}`, kind: 'cam', title: c.name,
    meta: c.region || c.category, poster: '', live: true, posture: c.posture,
    watch: win ? `/watch/cam/${encodeURIComponent(c.id)}` : '',
    href: win ? '' : (c.source || ''), earn: '',
    popularity: 60, // curated live prior for recommend.rank()
  };
}

function radioTile(s) {
  return {
    key: `radio:${s.id}`, kind: 'radio', title: s.name,
    meta: [s.state || s.country, s.tags && s.tags[0], s.bitrate ? `${s.bitrate}k` : ''].filter(Boolean).join(' · '),
    poster: s.favicon || '', live: true, posture: 'point',
    watch: '', href: s.homepage || s.stream || '', earn: '',
    clickCount: s.clickCount || 0, votes: s.votes || 0, bitrate: s.bitrate || 0, lastCheckOk: true,
  };
}

function podTile(s) {
  return {
    key: `pod:${s.id}`, kind: 'podcast', title: s.title,
    meta: [s.author, s.genre, s.episodeCount ? `${s.episodeCount} eps` : ''].filter(Boolean).join(' · '),
    poster: s.artwork || '', live: false, posture: 'point',
    watch: '', href: s.homepage || '', earn: '',
    feedUrl: s.feedUrl || '', episodeCount: s.episodeCount || 0,
  };
}

function scotTile(v) {
  return {
    key: `scot:${v.author}/${v.permlink}`, kind: 'scot',
    title: v.title, meta: `@${v.author}`, poster: '', live: false, posture: 'host',
    watch: '', href: safeHref(v.videoUrl) || '', earn: v.earn || '',
    releaseDate: v.created || '',
  };
}

function liveTile() {
  return {
    key: 'live:hathor', kind: 'cam', title: 'Hathor.Live',
    meta: 'Always-on channel', poster: '', live: true, posture: 'window',
    watch: '/watch/live/hathor', href: '', earn: '',
    popularity: 90, live_channel: true,
  };
}

// ── row assembly ────────────────────────────────────────────────────────────────────────────────────
/** Build every row by fanning out to the readers, mapping to tiles, and ordering each with recommend. */
export async function buildRows() {
  const [films, dallas, pods, scots] = await Promise.all([
    safe(() => video.discover({ q: '', rows: 12 })),
    safe(() => radio.dallasStations(12)),
    safe(() => podcasts.searchPodcasts({ term: BROWSE_POD_TERM, limit: 12 })),
    safe(() => scottubeFeed({ limit: 12 })),
  ]);
  let cams = [];
  try { cams = listCams(); } catch { cams = []; } // synchronous curated seed — no network

  const filmTiles = films.map(filmTile);
  const radioTiles = dallas.map(radioTile);
  const podTiles = pods.map(podTile);
  const scotTiles = scots.map(scotTile);
  const camTiles = cams.map(camTile);

  // "Live now" = live cams + the Hathor.Live channel + Dallas radio, ranked together.
  const liveNow = rank([liveTile(), ...camTiles, ...radioTiles]);

  const rows = [
    { id: 'live', title: 'Live now', live: true, tiles: liveNow },
    { id: 'onmelek', title: 'On MELEK (ScotTube)', live: false, tiles: rank(scotTiles) },
    { id: 'films', title: 'Films · public domain', live: false, tiles: rank(filmTiles) },
    { id: 'radio', title: 'Radio · Dallas first', live: true, tiles: rank(radioTiles) },
    { id: 'podcasts', title: 'Podcasts', live: false, tiles: rank(podTiles) },
  ];

  // Cross-source "Recommended now" hero rail: merge a slice of every source, rank, take the top.
  const hero = rank([...liveNow, ...scotTiles, ...filmTiles]).slice(0, 8);

  return { hero, rows };
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────
const STYLE = `
  :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--red:#e08b8b;--blue:#4c8dff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  a{color:var(--gold);text-decoration:none} a:hover{text-decoration:underline}
  header{display:flex;align-items:center;gap:10px;padding:14px 18px;border-bottom:1px solid var(--bd)}
  .brand{font-size:22px;font-weight:800} .brand b{color:var(--gold)}
  .alpha{font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 7px}
  .wrap{max-width:1180px;margin:0 auto;padding:16px 18px 40px}
  .lead{color:var(--mut);font-size:14px;margin:2px 0 18px}
  .hero{display:flex;gap:12px;overflow-x:auto;padding:2px 2px 14px;scroll-snap-type:x mandatory}
  .hero .htile{min-width:280px;max-width:280px;scroll-snap-align:start;background:var(--panel);border:1px solid var(--bd);border-radius:16px;padding:16px;position:relative}
  .hero .htile h3{margin:0 0 4px;font-size:16px}
  .row{margin:18px 0} .row h2{font-size:16px;margin:0 0 8px;display:flex;align-items:center;gap:8px}
  .rail{display:flex;gap:12px;overflow-x:auto;padding-bottom:10px;scroll-snap-type:x mandatory}
  .tile{min-width:200px;max-width:200px;scroll-snap-align:start;background:var(--panel);border:1px solid var(--bd);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
  .tile .thumb{position:relative;display:block;height:118px;background:#0a0e15 radial-gradient(circle at 50% 40%,#16202e,#0a0e15);border-bottom:1px solid var(--bd)}
  .tile .thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .tile .thumb .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;opacity:.5}
  .tile .body{padding:10px 12px;display:flex;flex-direction:column;gap:4px;flex:1}
  .tile h3{font-size:13px;margin:0;line-height:1.35;max-height:2.7em;overflow:hidden}
  .tile .meta{color:var(--mut);font-size:11px}
  .tile .cta{margin-top:auto;font-size:12px;font-weight:700}
  .badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;border:1px solid var(--bd);color:var(--mut);white-space:nowrap}
  .badge.live{color:#fff;border-color:var(--red)} .badge.live::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin-right:5px;vertical-align:middle}
  .badge.earn{color:var(--gold);border-color:var(--gold)}
  .badge.post[data-p=window]{color:var(--green);border-color:var(--green)} .badge.post[data-p=host]{color:var(--blue);border-color:var(--blue)}
  .toplabel{position:absolute;top:8px;left:8px} .scorepill{position:absolute;top:8px;right:8px;font-size:9px;color:var(--mut);background:rgba(0,0,0,.5);border-radius:999px;padding:2px 7px}
  .empty{color:var(--mut);font-size:13px;padding:14px 2px}
  footer{color:var(--mut);font-size:12px;text-align:center;margin:26px 0 8px}
  /* watch stage */
  .stage{position:relative;width:100%;height:64vh;min-height:340px;background:#0a0e15 radial-gradient(circle at 50% 38%,#16202e,#0a0e15);border-bottom:1px solid var(--bd)}
  .stage iframe{width:100%;height:100%;border:0;display:block}
  .stage .none{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;color:var(--mut);text-align:center;padding:20px}
  .stage .none b{color:var(--fg);font-size:18px}
  .info{max-width:920px;margin:0 auto;padding:16px}
  .btn{font-weight:700;border-radius:10px;border:1px solid var(--bd);background:#0e131b;color:var(--fg);padding:8px 14px;display:inline-block}
  .adslot{border:1px dashed var(--bd);border-radius:10px;color:var(--mut);font-size:12px;padding:8px 12px;margin:0 0 10px}`;

function thumb(t) {
  const inner = t.poster
    ? `<img src="${esc(safeHref(t.poster) || '')}" alt="" loading=lazy referrerpolicy=no-referrer>`
    : `<span class=ph>${t.live ? '📡' : t.kind === 'scot' ? '🎬' : t.kind === 'radio' ? '📻' : t.kind === 'podcast' ? '🎙️' : '🎞️'}</span>`;
  const label = t.live ? '<span class="badge live toplabel">LIVE</span>' : '';
  const score = Number.isFinite(t.score) ? `<span class=scorepill>${esc(String(t.score))}</span>` : '';
  return `${inner}${label}${score}`;
}

function tile(t) {
  // Destination: an in-app /watch stage where we have an owner-sanctioned embed, else a POINT link-out.
  const toWatch = !!t.watch;
  const dest = toWatch ? t.watch : safeHref(t.href);
  const openAttrs = toWatch ? '' : ' target=_blank rel="noopener noreferrer"';
  const cta = toWatch ? '▶ Watch' : (t.kind === 'radio' ? '▶ Listen ↗' : '↗ Open');
  const post = t.posture === 'window' || t.posture === 'host'
    ? `<span class="badge post" data-p="${esc(t.posture)}">${esc(t.posture)}</span>` : '';
  const earn = t.earn ? `<span class="badge earn">💰 ${esc(t.earn)}</span>` : '';
  const head = dest
    ? `<a class=thumb href="${esc(dest)}"${openAttrs} title="${esc(t.title)}">${thumb(t)}</a>`
    : `<span class=thumb>${thumb(t)}</span>`;
  return `<article class=tile>
    ${head}
    <div class=body>
      <h3>${esc(t.title)}</h3>
      <div class=meta>${esc(t.meta || '')}</div>
      <div class=meta>${post} ${earn}</div>
      <div class=cta>${dest ? `<a href="${esc(dest)}"${openAttrs}>${esc(cta)}</a>` : esc(cta)}</div>
    </div>
  </article>`;
}

function railRow(row) {
  const body = row.tiles && row.tiles.length
    ? `<div class=rail>${row.tiles.map(tile).join('')}</div>`
    : `<p class=empty>Nothing on this channel right now — check back soon.</p>`;
  const badge = row.live ? '<span class="badge live">LIVE</span>' : '';
  return `<section class=row><h2>${esc(row.title)} ${badge}</h2>${body}</section>`;
}

function heroCard(t) {
  const dest = t.watch || safeHref(t.href);
  const openAttrs = t.watch ? '' : ' target=_blank rel="noopener noreferrer"';
  const badge = t.live ? '<span class="badge live">LIVE</span>' : '';
  return `<div class=htile>${badge}
    <h3>${esc(t.title)}</h3>
    <div class="meta" style="color:var(--mut);font-size:12px">${esc(t.meta || '')}</div>
    <div style="margin-top:10px">${dest ? `<a class=btn href="${esc(dest)}"${openAttrs}>▶ Tune in</a>` : ''}</div>
  </div>`;
}

function page(hero, rows) {
  const heroRail = hero.length
    ? `<div class=hero>${hero.map(heroCard).join('')}</div>`
    : '';
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Tune In · MELEK</title>
<meta name=description content="Tune In — browse and watch across MELEK: on-chain creator video, public-domain films, live cams, Dallas radio, and podcasts. We point at each source's own player; we never rehost.">
<style>${STYLE}</style></head><body>
<header><span class=brand><b>MELEK</b> Tune In</span><span class=alpha>Alpha</span></header>
<div class=wrap>
  <p class=lead>Browse and watch across MELEK — on-chain creator video, public-domain films, live cams, radio, and podcasts. Ranked by what's fresh and reliable; every player is the source's own.</p>
  ${heroRail}
  ${rows.map(railRow).join('')}
  <footer>Sources point at / embed each owner's own stream, feed, or player — we never rehost. Public-domain &amp; open-licensed first. Rankings are earned, never bought.</footer>
</div></body></html>`;
}

// ── /watch stage — license-router gates the embed; otherwise we POINT at the owner's surface ─────────
function watchShell(title, stageInner, infoInner) {
  // AD PRE-ROLL / TOKEN TIE-IN STUB — Group 1 step 3 + Group 2 (PRANA-gated). Intentionally inert here:
  // the pre-roll creative (site/herald ad-maker / hathor-video) served via the /go click rail and the
  // SCOT→KULA watch-to-earn payout both layer on later. Rendered as a labelled, empty slot for now.
  const AD_PREROLL_STUB = ''; // TODO(group1-step3): serve creative → /go/{code}; wire analytics.track
  const TOKEN_TIEIN_STUB = ''; // TODO(group2/PRANA): SCOT→KULA watch-to-earn (needs PRANA mainnet + pairs)
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)} · MELEK Tune In</title>
<style>${STYLE}
  header{padding:12px 16px}
  h1{font-size:18px;margin:0;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}</style></head><body>
<header><a class=btn href="/">← Tune In</a><h1>${esc(title)}</h1></header>
${AD_PREROLL_STUB}
<div class=stage>${stageInner}</div>
<div class=info>${TOKEN_TIEIN_STUB}${infoInner}</div>
</body></html>`;
}

function embedStage(embed, title) {
  return `<iframe src="${esc(embed)}" title="${esc(title)}" allowfullscreen referrerpolicy=no-referrer sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`;
}

function pointStage(href, msg) {
  const link = href ? `<a class=btn href="${esc(href)}" target=_blank rel="noopener noreferrer">Open the owner's surface ↗</a>` : '';
  return `<div class=none><b>↗ ${esc(msg)}</b><span>This source is POINT posture — we link to the owner's official surface rather than embedding it.</span>${link}</div>`;
}

/** Resolve one /watch/:source/:id. Deterministic offline for ia / cam / live. */
function watchPage(source, id) {
  if (source === 'ia') {
    // license-router gate: an Internet Archive film is window-posture on a whitelisted owner surface.
    const tag = tagAsset({ kind: 'film', source: 'archive.org', embedHost: 'archive.org', license: 'copyrighted' }, { year: YEAR });
    const gate = allowedEmbed(`https://archive.org/details/${id}`);
    if (tag.route === 'window' && gate.ok && gate.embed) {
      return watchShell(id, embedStage(gate.embed, id),
        `<div class=adslot>Public-domain / open film via the Internet Archive's own player. We embed the official player and never rehost.</div>`);
    }
    return watchShell(id, pointStage(`https://archive.org/details/${esc(id)}`, 'This film opens on the Internet Archive'), '');
  }
  if (source === 'cam') {
    let c = null;
    try { c = listCams().find((x) => x.id === String(id).toLowerCase()) || null; } catch { c = null; }
    if (!c) return null;
    const win = c.posture === 'window' && c.embed;
    const embed = safeHref(c.embed);
    return watchShell(c.name,
      win && embed ? embedStage(embed, c.name) : pointStage(safeHref(c.source), 'This camera opens on its owner’s site'),
      `<div class=adslot>Source: ${esc(c.attribution)} — ${esc(c.region || c.category)}. Public, consensual camera; we point/embed the owner's own stream and never rehost.</div>`);
  }
  if (source === 'live' && id === 'hathor') {
    return watchShell('Hathor.Live', embedStage(HATHOR_LIVE_URL, 'Hathor.Live'),
      `<div class=adslot>Hathor's always-on public channel. <a href="${esc(HATHOR_LIVE_URL)}" target=_blank rel="noopener noreferrer">Open Hathor.Live ↗</a></div>`);
  }
  return null;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL || 'http://tunein.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, surface: 'tunein' }));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end('User-agent: *\nAllow: /\nDisallow: /api/\n');
    }

    const watch = path.match(/^\/watch\/([a-z]+)\/([a-zA-Z0-9._-]{1,120})$/);
    if (watch) {
      const html = watchPage(watch[1], watch[2]);
      if (!html) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('unknown channel'); }
      return sendHtml(res, html);
    }

    if (path === '/') {
      const { hero, rows } = await buildRows(); // already soft-failed per source
      return sendHtml(res, page(hero, rows));
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  } catch {
    // last-ditch soft-fail: never leak a stack, never crash the process.
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
}

if (process.argv[1] && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`MELEK Tune In on http://${HOST}:${PORT} — browse+watch across all sources`));
}
