// media.mjs — the PENTECAUST MEDIA HUB. The one unified surface where ALL of MELEK's media lives
// ("Pentecaust is going to be where all of our Media stuff is"). A tabbed, Pentecaust-branded page —
// Radio · Podcasts · Music · Art · Library · Watch — that REUSES the media readers we already shipped
// and invents no new source of its own:
//   • Radio    — integrations/soapbox/radio.mjs         (dallasStations / searchStations / renderList)
//   • Podcasts — integrations/soapbox/podcasts.mjs      (searchPodcasts / renderList)
//   • Music    — integrations/soapbox/music-catalog.mjs (search / renderList — PD / CC-open, attribution)
//   • Art      — integrations/soapbox/art-open-access.mjs(search / renderGallery — PD / CC0 art, "ArtCast")
//   • Library  — integrations/soapbox/books-open.mjs    (search / renderList — Project Gutenberg + IA)
//   • Watch    — integrations/soapbox/video-discovery.mjs(discover / renderList — PD films / link-outs)
//
//   PORT=8158 BASE_URL=https://pentecaust.com node pentecaust/media.mjs
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────
//   /  or /media          the hub home — the tab nav + a default welcome panel.
//   /media/radio?q=       Dallas-first stations (dallasStations when no q, searchStations when q).
//   /media/podcasts?q=    searchPodcasts → renderList.
//   /media/music?q=       search → renderList (attribution travels on CC-BY rows).
//   /media/art?q=         search → renderGallery (public-domain art / ArtCast).
//   /media/library?q=     search → renderList (Gutenberg PD + IA reader + Open Library).
//   /media/watch?q=       discover → renderList (Internet Archive films / official link-outs).
//   /health               liveness probe.
//
// ── DISCIPLINE (inherited from the readers) ───────────────────────────────────────────────────────
//   POINT posture throughout: every tab points at the source's OWN stream / embed / feed / reader —
//   we NEVER rehost or re-encode audio or video. Each tab SOFT-FAILS: the panel renders even when its
//   reader returns [] or throws (bad query, network down, empty result) — it never throws to the route.
//   esc() on every interpolated HTML value. This is a standalone handler(req,res): it does NOT edit
//   pentecaust/server.mjs or any reader; the main server routes to it later. All network flows through
//   the readers' injectable fetch — __setFetch() here fans a single fake out to every reader so the
//   offline tests can mock the whole hub in one call.

import { createServer } from 'node:http';

import * as radio from '../integrations/soapbox/radio.mjs';
import * as podcasts from '../integrations/soapbox/podcasts.mjs';
import * as music from '../integrations/soapbox/music-catalog.mjs';
import * as art from '../integrations/soapbox/art-open-access.mjs';
import * as books from '../integrations/soapbox/books-open.mjs';
import * as video from '../integrations/soapbox/video-discovery.mjs';

const PORT = +(process.env.PORT || 8158);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// Cross-link back to the Pentecaust dashboard (Messages / Friends / Email). Overridable by env.
const PENTECAUST_SITE = (process.env.PENTECAUST_SITE || 'https://pentecaust.com').replace(/\/$/, '');

// ── house-style helpers ───────────────────────────────────────────────────────────────────────────
// esc() escapes the single quote too (matches the readers) so attribute interpolation is always safe.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const str = (v) => (v == null ? '' : String(v)).trim();

// Fan a single injectable fetch out to every reader — one call mocks the whole hub in the test suite.
export function __setFetch(fn) {
  radio.__setFetch(fn);
  podcasts.__setFetch(fn);
  music.__setFetch(fn);
  art.__setFetch(fn);
  books.__setFetch(fn);
  video.__setFetch(fn);
}

// ── the tabs ────────────────────────────────────────────────────────────────────────────────────
// One row per media surface: its id (route suffix), label, icon, search-box placeholder, and a one-line
// blurb for the home grid. The render/fetch wiring for each lives in tabResults() below.
export const TABS = [
  { id: 'radio', label: 'Radio', icon: '📻', ph: 'Search stations — or leave blank for Dallas', blurb: 'Live internet radio, Dallas-first. Points at each station’s own stream.' },
  { id: 'podcasts', label: 'Podcasts', icon: '🎙️', ph: 'Search podcasts — e.g. history, theology', blurb: 'Shows from the open Apple/iTunes catalog; audio streams from each show’s own feed.' },
  { id: 'music', label: 'Music', icon: '🎵', ph: 'Search free & open music — e.g. piano', blurb: 'Public-domain & Creative-Commons tracks (NC excluded). Attribution travels on CC-BY rows.' },
  { id: 'art', label: 'Art', icon: '🖼️', ph: 'Search public-domain art — e.g. sunflowers', blurb: 'Open-access museum art (The Met + Art Institute) for ArtCast displays and frames.' },
  { id: 'library', label: 'Library', icon: '📚', ph: 'Search books — e.g. frankenstein', blurb: 'Project Gutenberg (read now) + Internet Archive reader + Open Library metadata.' },
  { id: 'watch', label: 'Watch', icon: '🎬', ph: 'Search films — e.g. moon', blurb: 'Public-domain films via the Internet Archive’s own player; official link-outs otherwise.' },
];
const TAB_BY_ID = new Map(TABS.map((t) => [t.id, t]));
export const isTab = (id) => TAB_BY_ID.has(id);

// ── the data core — REUSES the readers, always soft-fails to their own empty render ──────────────────
/**
 * tabResults(id, q) → the reader's rendered HTML for tab `id` at query `q`.
 * Each reader call is wrapped: on any failure (empty / network / throw) we render the reader's own
 * graceful empty state — this function NEVER throws to the route.
 */
export async function tabResults(id, q) {
  const query = str(q);
  try {
    switch (id) {
      case 'radio': {
        const stations = query ? await radio.searchStations({ name: query }) : await radio.dallasStations();
        return radio.renderList(Array.isArray(stations) ? stations : []);
      }
      case 'podcasts': {
        const shows = query ? await podcasts.searchPodcasts({ term: query }) : [];
        return podcasts.renderList(Array.isArray(shows) ? shows : []);
      }
      case 'music': {
        const tracks = query ? await music.search({ query }) : [];
        return music.renderList(Array.isArray(tracks) ? tracks : []);
      }
      case 'art': {
        const works = query ? await art.search({ query }) : [];
        return art.renderGallery(Array.isArray(works) ? works : []);
      }
      case 'library': {
        const bks = query ? await books.search({ query }) : [];
        return books.renderList(Array.isArray(bks) ? bks : []);
      }
      case 'watch': {
        const vids = query ? await video.discover({ q: query }) : [];
        return video.renderList(Array.isArray(vids) ? vids : []);
      }
      default:
        return '';
    }
  } catch {
    // soft-fail: hand the reader an empty list so its own friendly empty state renders (never throw).
    return emptyRender(id);
  }
}

// The reader's own empty render for a tab (used only when a reader unexpectedly throws).
function emptyRender(id) {
  try {
    switch (id) {
      case 'radio': return radio.renderList([]);
      case 'podcasts': return podcasts.renderList([]);
      case 'music': return music.renderList([]);
      case 'art': return art.renderGallery([]);
      case 'library': return books.renderList([]);
      case 'watch': return video.renderList([]);
      default: return '';
    }
  } catch {
    return '<p class="empty">Nothing to show right now — try another search.</p>';
  }
}

// ── styling (Pentecaust dark theme — tongues-of-fire gold/ember on the MELEK panel palette) ─────────
const STYLE = `<style>
  :root{--bg:#0d1117;--panel:#161b22;--line:#21262d;--line2:#30363d;--fg:#e6edf3;--mut:#8b949e;--blue:#58a6ff;--gold:#d29922;--ember:#f0883e}
  *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
  a{color:var(--blue);text-decoration:none} a:hover{text-decoration:underline}
  header.topbar{position:sticky;top:0;z-index:600;background:var(--panel);border-bottom:1px solid var(--line2);padding:9px 20px;display:flex;align-items:center;gap:14px}
  .brand{font-weight:800;font-size:18px;color:var(--fg);position:relative;padding-left:8px} .brand span{color:var(--mut);font-weight:400;font-size:13px}
  .alpha{position:absolute;top:6px;left:8px;font-size:10px;font-weight:700;letter-spacing:.06em;color:var(--gold);border:1px solid var(--gold);border-radius:6px;padding:0 5px;text-transform:uppercase}
  .topbar-r{margin-left:auto;display:flex;gap:10px;flex-wrap:wrap}
  .topbar-r a{color:var(--fg);font-weight:700;font-size:14px;border:1px solid var(--line2);border-radius:8px;padding:6px 13px;white-space:nowrap}
  .topbar-r a:hover{border-color:var(--ember);color:var(--ember);text-decoration:none}
  .wrap{max-width:1000px;margin:0 auto;padding:22px}
  h1{margin:0 0 6px;font-size:26px} h2{font-size:17px;margin:0 0 10px}
  .muted,.mut{color:var(--mut)}
  .card{background:var(--panel);border:1px solid var(--line2);border-radius:10px;padding:18px 20px;margin:14px 0}
  nav.tabs{display:flex;flex-wrap:wrap;gap:8px;margin:16px 0}
  nav.tabs a{border:1px solid var(--line2);border-radius:999px;padding:8px 16px;color:var(--fg);font-weight:700;font-size:14px;background:var(--panel)}
  nav.tabs a:hover{border-color:var(--ember);color:var(--ember);text-decoration:none}
  nav.tabs a.active{border-color:var(--ember);color:#0d1117;background:var(--ember)}
  form.msearch{margin:0 0 14px} .row{display:flex;flex-wrap:wrap;gap:10px;align-items:center}
  input.q{background:#0b0f14;border:1px solid var(--line2);border-radius:8px;color:var(--fg);padding:11px 14px;font-size:15px;flex:1 1 260px;min-width:180px;max-width:520px}
  input.q:focus{border-color:var(--ember);outline:none}
  button{cursor:pointer;background:var(--panel);border:1px solid var(--line2);border-radius:8px;color:var(--fg);font-weight:600;padding:11px 20px;font-size:15px}
  button:hover{border-color:var(--ember)}
  .empty,.music-empty,.art-empty,.books-empty,.video-empty{color:var(--mut);padding:14px 0}
  .station,.podcast{padding:10px 0;border-bottom:1px solid var(--line);display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}
  .sname,.pname{font-weight:600} .smeta,.pmeta{color:var(--mut);font-size:13px}
  .play,.listen{margin-left:auto}
  ul.music-list,ul.books-list,ul.video-list{list-style:none;margin:8px 0 0;padding:0}
  ul.music-list li,ul.books-list li,ul.video-list li{padding:9px 0;border-bottom:1px solid var(--line)}
  .attribution,.lic,.src,.posture{color:var(--mut);font-size:12px}
  .playable{color:var(--ember);font-size:12px} .linkout{color:var(--mut);font-size:12px}
  .data-note{color:var(--mut);font-size:12px;margin-top:12px}
  .art-gallery{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-top:10px}
  .art-item{margin:0;background:#0b0f14;border:1px solid var(--line);border-radius:10px;overflow:hidden}
  .art-item img{width:100%;height:auto;display:block} .art-item figcaption{padding:8px 10px;font-size:12px;color:var(--mut)}
  .art-noimg{height:140px;background:var(--line)}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:12px;margin-top:10px}
  .grid a{display:block;border:1px solid var(--line2);border-radius:10px;padding:14px 16px;background:var(--panel)}
  .grid a:hover{border-color:var(--ember);text-decoration:none} .grid .t{font-weight:700;color:var(--fg)} .grid .d{color:var(--mut);font-size:13px;margin-top:4px}
  footer{color:var(--mut);font-size:12px;text-align:center;padding:26px 22px;margin-top:24px;border-top:1px solid var(--line);line-height:1.7}
  footer a{color:var(--blue)}
</style>`;

const FOOTER = `<footer>
  <b>Pentecaust Media</b> — the descent of tongues, gathered as media. Every tab points at the source’s own
  stream, feed, embed, or reader — we never rehost or re-encode. Public-domain &amp; open-licensed first.
  <div style="margin-top:8px"><a href="/media">Hub</a> · <a href="${esc(PENTECAUST_SITE)}">✉ Messages</a></div>
</footer>`;

function page(title, body) {
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
<meta name=description content="Pentecaust Media Hub — radio, podcasts, music, public-domain art, an open library, and film, all in one place. We point at each source’s own stream; we never rehost.">
<meta name=robots content="index,follow,max-image-preview:large">${STYLE}</head><body>
<header class=topbar><a class=brand href="/media"><span class=alpha>Alpha</span>🔥 PENTECAUST <span>media</span></a>
  <div class=topbar-r><a href="${esc(PENTECAUST_SITE)}">✉ Messages</a></div></header>
<main class=wrap>${body}</main>
${FOOTER}</body></html>`;
}

// The pill tab-nav, marking the active tab (activeId = '' on the hub home).
function tabNav(activeId) {
  const links = TABS.map((t) =>
    `<a href="/media/${esc(t.id)}"${t.id === activeId ? ' class=active' : ''}>${esc(t.icon)} ${esc(t.label)}</a>`).join('');
  return `<nav class=tabs>${links}</nav>`;
}

// A tab's search form (GET ?q= to the tab's own route).
function searchForm(tab, q) {
  return `<form class=msearch method=get action="/media/${esc(tab.id)}"><div class=row>
    <input class=q name=q value="${esc(q)}" placeholder="${esc(tab.ph)}" autocomplete=off aria-label="Search ${esc(tab.label)}">
    <button type=submit>Search</button>
  </div></form>`;
}

// ── the pages ──────────────────────────────────────────────────────────────────────────────────────
/** The hub home — tab nav + a default welcome panel (a grid of the six surfaces). No network call. */
export function homePage() {
  const cards = TABS.map((t) =>
    `<a href="/media/${esc(t.id)}"><div class=t>${esc(t.icon)} ${esc(t.label)} →</div><div class=d>${esc(t.blurb)}</div></a>`).join('');
  const body = `<h1>Pentecaust Media <span class=muted style="font-size:14px">· all of MELEK’s media, one place</span></h1>
    <p class=muted>Radio, podcasts, music, public-domain art, an open library, and film — gathered here.
      Every surface points at the source’s own stream, feed, or player; we never rehost. Public-domain and
      open-licensed material comes first.</p>
    ${tabNav('')}
    <div class=card><h2>Choose a surface</h2><div class=grid>${cards}</div></div>`;
  return page('Pentecaust Media Hub', body);
}

/** A single tab page — tab nav (active) + a search box + the reader's rendered results. */
export async function tabPage(id, q) {
  const tab = TAB_BY_ID.get(id);
  if (!tab) return null;
  const query = str(q);
  const results = await tabResults(id, query); // already soft-failed to a graceful empty render
  const body = `<h1>${esc(tab.icon)} ${esc(tab.label)} <span class=muted style="font-size:14px">· Pentecaust Media</span></h1>
    ${tabNav(id)}
    ${searchForm(tab, query)}
    <div class=card>${results}</div>`;
  return page(`${tab.label} — Pentecaust Media`, body);
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=120' });
  res.end(html);
}

function notFound(res) {
  const body = `<h1>Not found</h1><p class=muted>That page isn’t part of the media hub.</p>${tabNav('')}`;
  sendHtml(res, page('Not found — Pentecaust Media', body), 404);
}

// The request handler — exported so offline tests drive routes through a mock req/res (no port bound).
export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const q = url.searchParams.get('q') || '';

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

    if (path === '/' || path === '/media') return sendHtml(res, homePage());

    const m = path.match(/^\/media\/([a-z]+)$/);
    if (m && isTab(m[1])) {
      const html = await tabPage(m[1], q);
      if (html) return sendHtml(res, html);
    }

    return notFound(res);
  } catch (e) {
    // last-ditch soft-fail: never leak a stack, never crash the process.
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error: ' + (e && e.message ? e.message : 'unknown'));
  }
}

// Only bind the port when run directly, not when imported by tests.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`Pentecaust Media Hub on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
