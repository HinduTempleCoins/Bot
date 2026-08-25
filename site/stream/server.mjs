// site/stream/server.mjs — "SoapBox Stream": a REAL streaming service (catalog + player) sourcing ONLY
// free / legally-clear video: public-domain & CC films/shows (Internet Archive), free-to-air live TV
// (iptv-org), plus radio, podcasts, and on-chain MELEK/ScotTube video as additional rows.
//
// This EXTENDS the "Tune In" shell (site/tunein/server.mjs) into a full streaming surface. What it
// reuses vs. adds:
//   REUSE  · integrations/soapbox/embed-whitelist.mjs  allowedEmbed()  — the Samy-worm player gate.
//   REUSE  · integrations/license-router.mjs           tagAsset()      — only stream license-clear content.
//   REUSE  · integrations/soapbox/radio.mjs / podcasts.mjs             — Radio + Podcasts rows.
//   REUSE  · site/tunein/server.mjs                    scottubeFeed()  — the On-MELEK (ScotTube) row.
//   REUSE  · integrations/soapbox/crawlers.mjs + seo.mjs + impact-utt.mjs — robots/sitemap/llms + SEO/UTT.
//   NEW    · integrations/soapbox/archive-video.mjs    — public-domain VOD (the core catalog source).
//   NEW    · integrations/soapbox/iptv-channels.mjs    — free-to-air live TV channels.
//   NEW    · this surface: rows + search + a /watch player that ONLY embeds a whitelisted official
//            player or plays a license-cleared direct stream (gateWatch); every tile shows license+source.
//
// House style: ESM, esc() all interpolation, keyless + soft-fail (a dead source empties its row, never
// breaks the page), handler(req,res) exported for tests, CLI guarded by process.argv[1].
//
//   PORT=8199 BASE_URL=https://stream.soapbox.community node site/stream/server.mjs
//   import { handler, __setFetch, gateWatch, buildRows } from './server.mjs'   // tests

import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

import * as archiveVideo from '../../integrations/soapbox/archive-video.mjs';
import * as iptv from '../../integrations/soapbox/iptv-channels.mjs';
import * as radio from '../../integrations/soapbox/radio.mjs';
import * as podcasts from '../../integrations/soapbox/podcasts.mjs';
import { scottubeFeed, __setFetch as tuneinSetFetch } from '../tunein/server.mjs';
import { allowedEmbed } from '../../integrations/soapbox/embed-whitelist.mjs';
import { tagAsset, ROUTES } from '../../integrations/license-router.mjs';
import { robotsTxt, sitemapXml, publicSitemapIndexXml, llmsTxt } from '../../integrations/soapbox/crawlers.mjs';
import { headTags } from '../../integrations/soapbox/seo.mjs';
import { impactUtt } from '../../integrations/impact-utt.mjs';

const PORT = +(process.env.PORT || 8199);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');
const SITE_NAME = 'SoapBox Stream';
const YEAR = 2026; // injected into license-router (never read from the wall clock)
const BROWSE_POD_TERM = process.env.STREAM_POD_TERM || 'documentary';

// ── injectable fetch — one mock fans out to every adapter + the ScotTube reader ─────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) {
  _fetch = fn || ((...a) => globalThis.fetch(...a));
  archiveVideo.__setFetch(_fetch);
  iptv.__setFetch(_fetch);
  radio.__setFetch(_fetch);
  podcasts.__setFetch(_fetch);
  tuneinSetFetch(_fetch); // fans out to the ScotTube RPC reader inside tunein
}

// ── house-style esc (escapes the single quote too) ──────────────────────────────────────────────────
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

/** http(s)-only href allowlist (never javascript:/data:/file:). */
export function safeHref(u) {
  if (!u || typeof u !== 'string') return '';
  try { const x = new URL(u); return (x.protocol === 'https:' || x.protocol === 'http:') ? x.href : ''; }
  catch { return ''; }
}

// Every source call is wrapped: on ANY failure (empty / network / throw) we degrade to [] — a dead
// source empties its row, it never breaks the page.
async function safe(fn) {
  try { const v = await fn(); return Array.isArray(v) ? v : []; }
  catch { return []; }
}

function hostOf(u) { try { return new URL(u).hostname.toLowerCase(); } catch { return ''; } }

// Trusted hosts a ScotTube (our own) video may be served from — env-overridable. A scot stream that is
// neither a whitelisted official embed NOR on one of these is refused (see resolveItem 'scot').
const SCOT_TRUSTED_HOSTS = (process.env.STREAM_SCOT_HOSTS
  || 'soapbox.community,melek.salon,3speak.tv,ipfs.io,cloudflare-ipfs.com,gateway.pinata.cloud,archive.org')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
function scotHostAllowed(url) {
  const h = hostOf(url);
  if (!h) return false;
  return SCOT_TRUSTED_HOSTS.some((d) => h === d || h.endsWith('.' + d));
}

// ── THE WATCH GATE (pure, testable) ─────────────────────────────────────────────────────────────────
// The single chokepoint that decides whether an item may be shown on the /watch player. Two legal ways
// to play, nothing else:
//   1. embed  — the item's URL is an OFFICIAL first-party player on the embed-whitelist (allowedEmbed).
//   2. stream — a DIRECT http(s) stream (mp4/HLS) whose LICENSE is cleared as free (public-domain / CC /
//               free-to-air / us-gov), confirmed through license-router. Copyrighted/unknown ⇒ refused.
// Anything else (unparseable, non-http scheme, scraper host, unlicensed copyrighted stream) ⇒ refused.
const CLEARED_LICENSE_RE = /(public-?domain|free-?to-?air|cc0|cc-?by|cc-?pdm|us-?gov|prelinger|open)/i;

export function gateWatch(item = {}, { year = YEAR } = {}) {
  const url = String(item.streamUrl || item.url || '');
  if (!url) return { ok: false, reason: 'no stream url' };

  // 1) Official first-party player on the allowlist → embed.
  const emb = allowedEmbed(url);
  if (emb.ok) {
    const tag = tagAsset({
      kind: item.kind || 'film', source: item.source, embedHost: hostOf(url),
      license: item.licenseToken || item.license || 'copyrighted',
      publishedYear: item.year ? Number(item.year) : undefined,
    }, { year });
    if (tag.route === ROUTES.REFUSE) return { ok: false, reason: 'embed host refused by license-router' };
    return { ok: true, mode: 'embed', embed: emb.embed, provider: emb.provider, license: item.license || '', posture: tag.posture };
  }

  // 2) Direct stream — must be http(s) AND license-cleared as free.
  let u;
  try { u = new URL(url); } catch { return { ok: false, reason: 'unparseable stream url' }; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { ok: false, reason: `refused scheme ${u.protocol}` };

  const licStr = `${item.licenseToken || ''} ${item.license || ''}`;
  const tag = tagAsset({
    kind: item.kind || 'film', source: item.source,
    license: item.licenseToken || item.license || 'copyrighted',
    publishedYear: item.year ? Number(item.year) : undefined,
  }, { year });
  if (tag.route === ROUTES.REFUSE) return { ok: false, reason: 'refused by license-router' };

  const cleared = CLEARED_LICENSE_RE.test(licStr) || tag.posture === 'host';
  if (!cleared) return { ok: false, reason: 'not license-cleared for direct streaming' };

  const mime = /\.m3u8(\?|$)/i.test(url) ? 'application/x-mpegURL' : (/\.webm(\?|$)/i.test(url) ? 'video/webm' : 'video/mp4');
  return { ok: true, mode: 'stream', stream: url, mime, license: item.license || '', posture: tag.posture };
}

// ── row assembly ────────────────────────────────────────────────────────────────────────────────────
// Categories are the rows. Each is a source function → tiles; all soft-fail to [] independently.
export const CATEGORIES = [
  { id: 'live', title: 'Live TV', kind: 'live' },
  { id: 'films', title: 'Films · public domain', kind: 'film' },
  { id: 'shows', title: 'Shows · classic TV', kind: 'show' },
  { id: 'radio', title: 'Radio', kind: 'radio' },
  { id: 'podcasts', title: 'Podcasts', kind: 'podcast' },
  { id: 'onmelek', title: 'On MELEK · ScotTube', kind: 'scot' },
];

function radioTile(s) {
  return {
    id: `radio:${s.id}`, title: s.name, kind: 'radio',
    year: '', creator: s.state || s.country || '',
    thumb: safeHref(s.favicon) || '', streamUrl: safeHref(s.stream) || '',
    license: 'Broadcaster stream (free listen)', licenseToken: 'free-to-air',
    source: 'Radio Browser', attribution: s.homepage || s.name, posture: 'point',
    href: safeHref(s.homepage) || safeHref(s.stream) || '',
  };
}

function podTile(s) {
  return {
    id: `pod:${s.id}`, title: s.title, kind: 'podcast',
    year: '', creator: s.author || '',
    thumb: safeHref(s.artwork) || '', streamUrl: '', // podcasts POINT to their feed, not streamed here
    license: 'Podcast RSS (free listen)', licenseToken: 'free-to-air',
    source: 'Apple/iTunes', attribution: s.author || s.title, posture: 'point',
    href: safeHref(s.homepage) || '',
  };
}

function scotTile(v) {
  return {
    id: `scot:${v.author}/${v.permlink}`, title: v.title, kind: 'scot',
    year: (v.created || '').slice(0, 4), creator: `@${v.author}`,
    thumb: '', streamUrl: safeHref(v.videoUrl) || '',
    license: 'MELEK creator (on-chain, owner-posted)', licenseToken: 'user-original',
    source: 'MELEK/ScotTube', attribution: `@${v.author}`, posture: 'host',
    href: safeHref(v.videoUrl) || '', earn: v.earn || '',
  };
}

/** Fetch tiles for one category. Soft-fails to []. `q` narrows the archive/iptv/podcast sources. */
export async function tilesFor(catId, { q = '', limit = 18 } = {}) {
  if (catId === 'live') {
    const chans = await safe(() => iptv.fetchChannels({ category: 'news', limit }));
    return chans; // already shared-tile shaped by the adapter
  }
  if (catId === 'films') return safe(() => archiveVideo.films({ q, rows: limit }));
  if (catId === 'shows') return safe(() => archiveVideo.shows({ q, rows: limit }));
  if (catId === 'radio') return (await safe(() => radio.dallasStations(limit))).map(radioTile);
  if (catId === 'podcasts') return (await safe(() => podcasts.searchPodcasts({ term: q || BROWSE_POD_TERM, limit }))).map(podTile);
  if (catId === 'onmelek') return (await safe(() => scottubeFeed({ limit }))).map(scotTile);
  return [];
}

/** Build every catalog row. Each source is independent + soft-failed. */
export async function buildRows({ q = '' } = {}) {
  const rows = await Promise.all(CATEGORIES.map(async (c) => ({
    ...c, tiles: await tilesFor(c.id, { q }),
  })));
  return rows;
}

// ── rendering ────────────────────────────────────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#0b0d12;--panel:#12161e;--fg:#e9eef5;--mut:#93a1b3;--bd:#222b38;--gold:#d9a441;--green:#36c08a;--red:#e08b8b;--blue:#4c8dff}
  *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 -apple-system,Segoe UI,Roboto,Arial,sans-serif}
  a{color:var(--gold);text-decoration:none} a:hover{text-decoration:underline}
  header{display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--bd);flex-wrap:wrap}
  .brand{font-size:22px;font-weight:800} .brand b{color:var(--gold)}
  .alpha-badge{position:fixed;top:8px;left:8px;z-index:20;font-size:10px;font-weight:700;letter-spacing:.5px;color:var(--gold);border:1px solid var(--gold);border-radius:999px;padding:2px 8px;background:rgba(11,13,18,.85)}
  form.search{margin-left:auto;display:flex;gap:6px}
  form.search input{background:#0e131b;border:1px solid var(--bd);color:var(--fg);border-radius:10px;padding:8px 12px;min-width:200px}
  form.search button{background:var(--gold);color:#111;border:0;border-radius:10px;padding:8px 14px;font-weight:700;cursor:pointer}
  .nav{display:flex;gap:8px;flex-wrap:wrap;padding:10px 18px;border-bottom:1px solid var(--bd)}
  .nav a{font-size:13px;border:1px solid var(--bd);border-radius:999px;padding:4px 12px;color:var(--mut)}
  .wrap{max-width:1200px;margin:0 auto;padding:16px 18px 48px}
  .lead{color:var(--mut);font-size:14px;margin:2px 0 18px}
  .row{margin:20px 0} .row h2{font-size:16px;margin:0 0 10px;display:flex;align-items:center;gap:8px}
  .row h2 a{color:var(--fg)} .see{font-size:12px;color:var(--mut);font-weight:400}
  .rail{display:flex;gap:12px;overflow-x:auto;padding-bottom:10px;scroll-snap-type:x mandatory}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:12px}
  .tile{min-width:200px;max-width:220px;scroll-snap-align:start;background:var(--panel);border:1px solid var(--bd);border-radius:14px;overflow:hidden;display:flex;flex-direction:column}
  .grid .tile{max-width:none}
  .tile .thumb{position:relative;display:block;height:120px;background:#0a0e15 radial-gradient(circle at 50% 40%,#16202e,#0a0e15);border-bottom:1px solid var(--bd)}
  .tile .thumb img{width:100%;height:100%;object-fit:cover;display:block}
  .tile .thumb .ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:34px;opacity:.5}
  .tile .body{padding:10px 12px;display:flex;flex-direction:column;gap:5px;flex:1}
  .tile h3{font-size:13px;margin:0;line-height:1.35;max-height:2.7em;overflow:hidden}
  .tile .meta{color:var(--mut);font-size:11px}
  .badge{font-size:9px;font-weight:700;padding:2px 7px;border-radius:999px;border:1px solid var(--bd);color:var(--mut);white-space:nowrap;display:inline-block}
  .badge.live{color:#fff;border-color:var(--red)} .badge.live::before{content:'';display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--red);margin-right:5px;vertical-align:middle}
  .badge.lic{color:var(--green);border-color:var(--green)} .badge.src{color:var(--blue);border-color:var(--blue)}
  .toplabel{position:absolute;top:8px;left:8px}
  .cta{margin-top:auto;font-size:12px;font-weight:700}
  .empty{color:var(--mut);font-size:13px;padding:12px 2px}
  footer{color:var(--mut);font-size:12px;text-align:center;margin:30px 0 8px;line-height:1.7}
  /* watch stage */
  .stage{position:relative;width:100%;max-width:1100px;margin:0 auto;aspect-ratio:16/9;background:#0a0e15 radial-gradient(circle at 50% 38%,#16202e,#0a0e15)}
  .stage iframe,.stage video{width:100%;height:100%;border:0;display:block;background:#000}
  .stage .none{position:absolute;inset:0;display:flex;flex-direction:column;gap:10px;align-items:center;justify-content:center;color:var(--mut);text-align:center;padding:20px}
  .stage .none b{color:var(--fg);font-size:18px}
  .info{max-width:1000px;margin:0 auto;padding:16px}
  .btn{font-weight:700;border-radius:10px;border:1px solid var(--bd);background:#0e131b;color:var(--fg);padding:8px 14px;display:inline-block}
  .licbox{border:1px solid var(--bd);border-radius:10px;color:var(--mut);font-size:12px;padding:10px 12px;margin:0 0 12px}
  .licbox b{color:var(--fg)}
</style>`;

function tileKindEmoji(k) {
  return k === 'live' ? '📡' : k === 'radio' ? '📻' : k === 'podcast' ? '🎙️' : k === 'scot' ? '🎬' : k === 'show' ? '📺' : '🎞️';
}

function watchHref(t) {
  const src = String(t.source || '').toLowerCase().includes('archive') ? 'ia'
    : t.kind === 'live' ? 'tv'
    : t.kind === 'scot' ? 'scot'
    : t.kind === 'radio' ? 'radio'
    : t.kind === 'podcast' ? 'pod' : 'ia';
  const id = encodeURIComponent(String(t.id).replace(/^[a-z]+:/, ''));
  return `/watch?src=${src}&id=${id}`;
}

function tile(t) {
  const live = t.kind === 'live' || t.kind === 'radio';
  const img = t.thumb
    ? `<img src="${esc(safeHref(t.thumb))}" alt="" loading=lazy referrerpolicy=no-referrer>`
    : `<span class=ph>${tileKindEmoji(t.kind)}</span>`;
  const label = live ? '<span class="badge live toplabel">LIVE</span>' : '';
  // Playable in-app when the watch gate would allow it; else a POINT link to the owner's surface.
  const g = gateWatch(t);
  const dest = g.ok ? watchHref(t) : safeHref(t.href || t.details || '');
  const isWatch = g.ok;
  const openAttrs = isWatch ? '' : ' target=_blank rel="noopener noreferrer"';
  const cta = isWatch ? '▶ Watch' : (t.kind === 'podcast' ? '↗ Feed' : t.kind === 'radio' ? '▶ Listen ↗' : '↗ Open');
  const head = dest
    ? `<a class=thumb href="${esc(dest)}"${openAttrs} title="${esc(t.title)}">${img}${label}</a>`
    : `<span class=thumb>${img}${label}</span>`;
  const meta = [t.year, t.creator].filter(Boolean).join(' · ');
  return `<article class=tile>
    ${head}
    <div class=body>
      <h3>${esc(t.title || 'Untitled')}</h3>
      ${meta ? `<div class=meta>${esc(meta)}</div>` : ''}
      <div class=meta><span class="badge lic">${esc(t.license || 'license unknown')}</span> <span class="badge src">${esc(t.source || '')}</span></div>
      <div class=cta>${dest ? `<a href="${esc(dest)}"${openAttrs}>${esc(cta)}</a>` : esc(cta)}</div>
    </div>
  </article>`;
}

function rowSection(row) {
  const body = row.tiles && row.tiles.length
    ? `<div class=rail>${row.tiles.map(tile).join('')}</div>`
    : '<p class=empty>Nothing on this channel right now — check back soon.</p>';
  const live = row.id === 'live' || row.id === 'radio';
  const badge = live ? '<span class="badge live">LIVE</span>' : '';
  return `<section class=row><h2><a href="/c/${esc(row.id)}">${esc(row.title)}</a> ${badge}<span class=see>See all →</span></h2>${body}</section>`;
}

function pageShell(title, inner, { description, canonical } = {}) {
  const desc = description || 'SoapBox Stream — a free, legal streaming catalog: public-domain films & classic TV (Internet Archive), free-to-air live TV (iptv-org), radio, podcasts, and on-chain MELEK creator video. Every title shows its license and source; we only stream public-domain, Creative-Commons, or free-to-air content.';
  const head = headTags({
    title, description: desc, canonical: canonical || `${BASE_URL}/`, siteName: SITE_NAME,
    robots: 'index,follow,max-image-preview:large', site: { url: BASE_URL, name: SITE_NAME },
  });
  const nav = CATEGORIES.map((c) => `<a href="/c/${esc(c.id)}">${esc(c.title)}</a>`).join('');
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<div class="alpha-badge">Alpha</div>
<header><a class=brand href="/"><b>SoapBox</b> Stream</a>
  <form class=search action="/search" method=get><input name=q placeholder="Search films, shows, channels…" aria-label=Search><button>Search</button></form>
</header>
<nav class=nav>${nav}</nav>
<div class=wrap>${inner}</div>
<footer>Free &amp; legally-clear content only — public domain, Creative Commons, or free-to-air. Every title shows its license and source. We embed each owner's official player or play a directly-served open stream — we never rehost, and never link a piracy source.<br>Films &amp; shows: Internet Archive · Live TV: iptv-org · Radio: Radio Browser · Podcasts: Apple/iTunes · On-chain video: MELEK/ScotTube.</footer>
</body></html>`;
}

function homePage(rows) {
  const inner = `<p class=lead>A free, legal streaming catalog. Public-domain films &amp; classic TV, free-to-air live channels, radio, podcasts, and on-chain MELEK creator video — every title labelled with its license and source.</p>
    ${rows.map(rowSection).join('')}`;
  return pageShell(`${SITE_NAME} — free, legal streaming`, inner);
}

function categoryPage(cat, tiles) {
  const inner = `<section class=row><h2>${esc(cat.title)}</h2>
    ${tiles.length ? `<div class=grid>${tiles.map(tile).join('')}</div>` : '<p class=empty>Nothing on this channel right now — check back soon.</p>'}
  </section>`;
  return pageShell(`${cat.title} · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/c/${cat.id}` });
}

function searchPage(q, tiles) {
  const inner = `<section class=row><h2>Search: “${esc(q)}”</h2>
    ${tiles.length ? `<div class=grid>${tiles.map(tile).join('')}</div>` : `<p class=empty>No free/legal titles matched “${esc(q)}”. Try another search.</p>`}
  </section>`;
  return pageShell(`Search “${q}” · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/search` });
}

// ── /watch player — gateWatch decides embed vs. stream vs. refuse ───────────────────────────────────
function stageFor(item) {
  const g = gateWatch(item);
  if (!g.ok) {
    const link = safeHref(item.href || item.details || '');
    return `<div class=none><b>↗ We can't stream this here</b>
      <span>${esc(g.reason)} — only public-domain, Creative-Commons, or free-to-air titles play in-app.</span>
      ${link ? `<a class=btn href="${esc(link)}" target=_blank rel="noopener noreferrer">Open the owner's surface ↗</a>` : ''}</div>`;
  }
  if (g.mode === 'embed') {
    return `<iframe src="${esc(g.embed)}" title="${esc(item.title)}" allowfullscreen referrerpolicy=no-referrer sandbox="allow-scripts allow-same-origin allow-presentation"></iframe>`;
  }
  // direct stream (mp4 / HLS) — the owner's own license-cleared stream, played natively.
  return `<video controls playsinline preload=metadata poster="${esc(safeHref(item.thumb) || '')}">
    <source src="${esc(g.stream)}" type="${esc(g.mime)}">
    Your browser can't play this stream directly — <a href="${esc(g.stream)}" target=_blank rel="noopener noreferrer">open it ↗</a>.
  </video>`;
}

function watchShell(item) {
  const g = gateWatch(item);
  const stage = stageFor(item);
  const meta = [item.year, item.creator].filter(Boolean).join(' · ');
  const licbox = `<div class=licbox><b>License:</b> ${esc(item.license || 'unknown')} &nbsp;·&nbsp; <b>Source:</b> ${esc(item.source || '')} &nbsp;·&nbsp; <b>Attribution:</b> ${esc(item.attribution || item.source || '')}${g.ok ? ` &nbsp;·&nbsp; <b>Play mode:</b> ${esc(g.mode)}` : ''}<br>We ${g.ok && g.mode === 'embed' ? 'embed the owner\'s official player' : g.ok ? 'play the owner\'s own license-cleared stream' : 'link out to the owner\'s surface'} — we never rehost.</div>`;
  const inner = `<div class=stage>${stage}</div>
    <div class=info>${licbox}
      <h1 style="font-size:20px;margin:.2em 0">${esc(item.title || 'Untitled')}</h1>
      ${meta ? `<p class=meta style="color:var(--mut)">${esc(meta)}</p>` : ''}
      <p><a class=btn href="/">← Back to Stream</a> ${item.href ? `<a class=btn href="${esc(safeHref(item.href))}" target=_blank rel="noopener noreferrer">Source ↗</a>` : ''}</p>
    </div>`;
  return pageShell(`${item.title || 'Watch'} · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/watch` });
}

/** Resolve a /watch item by (src,id). Async for the IA metadata / feed lookups. Soft-null → 404. */
async function resolveItem(src, id) {
  const rawId = String(id || '');
  if (!rawId) return null;
  if (src === 'ia') {
    const m = await archiveVideo.archiveMetadata(rawId);
    if (m) return m;
    // fall back to a minimal IA item (official player) even if metadata fails.
    return {
      id: rawId, title: rawId, kind: 'film', year: '', creator: '',
      thumb: `https://archive.org/services/img/${rawId}`,
      streamUrl: `https://archive.org/details/${rawId}`,
      license: 'Public domain (Internet Archive — see item page)', licenseToken: 'public-domain',
      source: 'Internet Archive', attribution: `Internet Archive — ${rawId}`, posture: 'window',
      href: `https://archive.org/details/${rawId}`,
    };
  }
  if (src === 'tv') {
    // Live-TV items carry their stream URL in the id (URL-encoded). SECURITY: never trust a raw request
    // URL — only play it if it is provably a listed iptv-org free-to-air channel (else it could be an
    // attacker URL the hard-coded 'free-to-air' license would wrongly clear). Not listed → 404.
    const url = safeHref(decodeURIComponent(rawId));
    if (!url) return null;
    if (!(await iptv.isListedFreeStream(url))) return null;
    return {
      id: rawId, title: 'Live TV channel', kind: 'live', year: '', creator: '',
      thumb: '', streamUrl: url, license: 'Free-to-air', licenseToken: 'free-to-air',
      source: 'iptv-org', attribution: 'iptv-org (free-to-air listing)', posture: 'point', href: url,
    };
  }
  if (src === 'scot') {
    // SECURITY: an arbitrary request URL must NOT inherit the 'host'/user-original clearance and get
    // auto-played in our player. We only PLAY a scot video when it's a whitelisted official player OR on
    // a trusted host; anything else is downgraded to a link-out (streamUrl '' → gateWatch refuses → the
    // page shows a "Source ↗" the user must click), so an attacker URL can never auto-embed/stream here.
    const url = safeHref(decodeURIComponent(rawId));
    if (!url) return null;
    const playable = allowedEmbed(url).ok || scotHostAllowed(url);
    return {
      id: rawId, title: 'MELEK creator video', kind: 'scot', year: '', creator: '',
      thumb: '', streamUrl: playable ? url : '', license: 'MELEK creator (on-chain, owner-posted)', licenseToken: 'user-original',
      source: 'MELEK/ScotTube', attribution: 'MELEK creator', posture: 'host', href: url,
    };
  }
  return null;
}

// ── routing ─────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'public, max-age=180' });
  res.end(html);
}

export const SITEMAP_PATHS = ['/', ...CATEGORIES.map((c) => `/c/${c.id}`)];

export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL || 'http://stream.local');
    const path = url.pathname.replace(/\/+$/, '') || '/';

    if (path === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, surface: 'stream', categories: CATEGORIES.map((c) => c.id) }));
    }
    if (path === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      return res.end(robotsTxt(BASE_URL));
    }
    if (path === '/sitemap.xml') {
      const today = new Date().toISOString().slice(0, 10);
      const entries = SITEMAP_PATHS.map((u) => ({ path: u, lastmod: today, changefreq: u === '/' ? 'daily' : 'weekly', priority: u === '/' ? '1.0' : '0.7' }));
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(sitemapXml(BASE_URL, entries));
    }
    if (path === '/sitemap-index.xml') {
      res.writeHead(200, { 'content-type': 'application/xml' });
      return res.end(publicSitemapIndexXml(new Date().toISOString().slice(0, 10)));
    }
    if (path === '/llms.txt') {
      res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
      return res.end(llmsTxt({
        name: SITE_NAME, baseUrl: BASE_URL,
        summary: 'A free, legal streaming catalog: public-domain films & classic TV (Internet Archive), free-to-air live TV (iptv-org), radio, podcasts, and on-chain MELEK creator video. Only public-domain, Creative-Commons, or free-to-air content is streamed; every title is labelled with its license and source.',
        links: [{ label: 'Home', path: '/' }, ...CATEGORIES.map((c) => ({ label: c.title, path: `/c/${c.id}` }))],
      }));
    }

    // /watch?src=&id=   OR   /watch/:src/:id
    const watchM = path.match(/^\/watch\/([a-z]+)\/(.+)$/);
    if (path === '/watch' || watchM) {
      const src = watchM ? watchM[1] : (url.searchParams.get('src') || '');
      const id = watchM ? watchM[2] : (url.searchParams.get('id') || '');
      const item = await resolveItem(src, id);
      if (!item) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('unknown title'); }
      return sendHtml(res, watchShell(item));
    }

    const catM = path.match(/^\/c\/([a-z]+)$/);
    if (catM) {
      const cat = CATEGORIES.find((c) => c.id === catM[1]);
      if (!cat) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('unknown category'); }
      const tiles = await tilesFor(cat.id, { limit: 40 });
      return sendHtml(res, categoryPage(cat, tiles));
    }

    if (path === '/search') {
      const q = (url.searchParams.get('q') || '').slice(0, 120).trim();
      let tiles = [];
      if (q) {
        const [films, shows, pods] = await Promise.all([
          safe(() => archiveVideo.films({ q, rows: 24 })),
          safe(() => archiveVideo.shows({ q, rows: 12 })),
          (async () => (await safe(() => podcasts.searchPodcasts({ term: q, limit: 12 }))).map(podTile))(),
        ]);
        tiles = [...films, ...shows, ...pods];
      }
      return sendHtml(res, searchPage(q, tiles));
    }

    if (path === '/') {
      const rows = await buildRows();
      return sendHtml(res, homePage(rows));
    }

    res.writeHead(404, { 'content-type': 'text/plain' });
    return res.end('not found');
  } catch {
    // last-ditch soft-fail: never leak a stack, never crash the process.
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end('error');
  }
}

if (process.argv[1] && /site\/stream\/server\.mjs$/.test(process.argv[1]) && process.argv[1] === fileURLToPath(import.meta.url)) {
  createServer(handler).listen(PORT, HOST, () => console.log(`${SITE_NAME} on http://${HOST}:${PORT} — free, legal streaming (${BASE_URL})`));
}
