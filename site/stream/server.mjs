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
import * as horror from '../../integrations/soapbox/horror-taxonomy.mjs';
import { watchSafelyBody } from './watch-safely.mjs';
import * as classics from '../../integrations/soapbox/classic-films.mjs';
import * as pdMore from '../../integrations/soapbox/pd-films-more.mjs';
import * as world from '../../integrations/soapbox/world-cinema.mjs';
import { allFreeFilms } from '../../integrations/soapbox/free-film-registry.mjs';
import * as speeches from '../../integrations/soapbox/speeches.mjs';
import * as narco from '../../integrations/soapbox/narco-cinema.mjs';
import { transcriptsRoute, trackTag, transcriptLink } from './transcripts-pages.mjs';
import { horrorMapRoute, HORROR_MAP_PATHS, loadStills } from './horror-pages.mjs';
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
  horror.__setFetch(_fetch);
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
  const nav = [...CATEGORIES.map((c) => `<a href="/c/${esc(c.id)}">${esc(c.title)}</a>`), '<a href="/classics">🎞️ Classics</a>', '<a href="/free">🆓 Free films</a>', '<a href="/world">🌍 World cinema</a>', '<a href="/speeches">🎙️ Speeches &amp; debates</a>', '<a href="/narco">🌵 Narco cinema</a>', '<a href="/horror">🩸 Horror</a>', '<a href="/films">🎬 Films &amp; reviews</a>', '<a href="/watch-free-safely">🛡️ Watch free, safely</a>'].join('');
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>${esc(title)}</title>
${head}${STYLE}${impactUtt()}</head><body>
<header><a class=brand href="/"><b>SoapBox</b> Stream</a>
  <form class=search action="/search" method=get><input name=q placeholder="Search films, shows, channels…" aria-label=Search><button>Search</button></form>
</header>
<nav class=nav>${nav}</nav>
<div class=wrap>${inner}</div>
<footer>Free &amp; legally-clear content only — public domain, Creative Commons, or free-to-air. Every title shows its license and source. We embed each owner's official player or play a directly-served open stream — we never rehost, and never link a piracy source.<br>Films &amp; shows: Internet Archive · Live TV: iptv-org · Radio: Radio Browser · Podcasts: Apple/iTunes · On-chain video: MELEK/ScotTube.</footer>
</body></html>`;
}

function classicsRow() {
  const picks = ['his_girl_friday', 'metropolis-1927-english-titles', 'The_General_Buster_Keaton', 'AStarIsBorn', 'Detour', 'meet_john_doe', 'FairbanksRobinHood1922', 'TheStranger_0', 'road-to-bali', 'angel_and_the_badman', 'gullivers_travels1939', 'd.-o.-a.-1950']
    .map((id) => classics.PD_CLASSICS.find((f) => f.id === id)).filter(Boolean).map(classics.classicTile);
  return `<section class=row><h2><a href="/classics">Classics · free</a> <span class="badge lic">public domain</span><span class=see>All ${classics.PD_CLASSICS.length} →</span></h2><div class=grid>${picks.map(tile).join('')}</div></section>`;
}

// Narco cinema: Mexican narcocine and the world's narco films as where-to-watch leads (copyrighted — linked, never played),
// plus the public-domain anti-drug / DEA / pre-1931 films that DO play. See integrations/soapbox/narco-cinema.mjs.
function narcoPage() {
  const lead = (t) => {
    const free = (t.where || []).map((w) => `<a href="${esc(safeHref(w.url))}" target=_blank rel="noopener noreferrer">${esc(w.service)} ↗</a>`).join(' · ');
    return `<li><a href="${esc(narco.filmsHref(t))}"><b>${esc(t.t)}</b></a>${t.y ? ` (${esc(t.y)})` : ''}${t.country ? ` · ${esc(t.country)}` : ''}${t.d ? ` · dir. ${esc(t.d)}` : ''}${t.stars ? ` · ${esc(t.stars)}` : ''}${t.note ? `<br><span class=meta>${esc(t.note)}</span>` : ''}${free ? `<br><span class="badge lic">free</span> ${free}` : ''}</li>`;
  };
  const shelves = narco.titlesByShelf().map((s) => `<section class=row><h2>${esc(s.name)}</h2><p class=lead style="font-size:13px">${esc(s.blurb)}</p><ul class=narco>${s.items.map(lead).join('')}</ul></section>`).join('');
  const pd = `<section class=row><h2>Play free here: the public-domain drug-war films</h2><p class=lead style="font-size:13px">Opium burned in 1914 San Francisco, the silent <i>The Pace That Kills</i> (1928), the 1950s–70s anti-drug films, and the DEA's and the US Army's own films from Bolivia, Colombia and Vietnam — US government works and Prelinger Archives films, free for everyone.</p><div class=grid>${narco.NARCO_PD.map((f) => tile(narco.narcoTile(f))).join('')}</div></section>`;
  const inner = `<style>ul.narco{columns:2 360px;column-gap:28px;padding-left:18px}ul.narco li{break-inside:avoid;margin:0 0 9px}</style>
    <p class=lead>Narco cinema — <i>narcocine</i> — began with Mexican films of 1970s corridos about smugglers and grew into a whole straight-to-video industry. These films are copyrighted, so we don't play them: every title links to <a href="/films">SoapBox Films</a> to rate and review it, and to the free service that carries it now (${narco.freeNow().length} are free on Tubi, The Roku Channel or ViX, checked 29 Sep 2026). The public-domain drug-war films at the bottom play right here.</p>
    ${shelves}${pd}
    <p class=lead style="font-size:12px">Not played, on purpose: ${narco.EXCLUDED.map((x) => `${esc(x.title)} (${esc(x.why)})`).join('; ')}.</p>`;
  return pageShell(`Narco cinema · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/narco`, description: `Narco cinema: Mexican narcocine from Contrabando y traición and La banda del carro rojo to the Almada brothers, every El Coyote film, and the world's narco films — where to watch them free — plus ${narco.NARCO_PD.length} public-domain drug-war films that play here.` });
}

function speechesPage() {
  const shelves = speeches.speechesByKind().map((k) => `<section class=row><h2>${esc(k.name)}</h2><div class=grid>${k.items.map((x) => tile(speeches.speechTile(x))).join('')}</div></section>`).join('');
  const leads = speeches.LEADS.map((l) => `<li><b>${esc(l.title)}</b> (${esc(l.year)}) — ${esc(l.why)}. Watch it at <a href="${esc(safeHref(l.href))}" target=_blank rel="noopener noreferrer">${esc(l.where)} ↗</a></li>`).join('');
  const inner = `<p class=lead>Famous speeches, inaugurations, addresses to the nation, debates, trials and the Moon landing, free and in the public domain: films made by the US government, and Universal Newsreel, which Universal gave to the American people in 1976. Where an official transcript exists, each page links it.</p>
    ${shelves}
    <section class=row><h2>Where to watch the rest</h2><p class=lead style="font-size:13px">These are famous, but we could not document a public-domain copy, so we point you to them instead of playing them.</p><ul>${leads}</ul>
    <p class=lead style="font-size:12px">Not here on purpose: ${speeches.EXCLUDED.map((x) => `${esc(x.title)} (${esc(x.why)})`).join('; ')}.</p></section>`;
  return pageShell(`Speeches & debates · free · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/speeches`, description: `${speeches.SPEECHES.length} famous speeches, inaugurations, debates, trials and Moon broadcasts to watch free: Roosevelt, Truman, Eisenhower, Kennedy, Johnson, Nixon, Nuremberg and Apollo 11, with official transcripts.` });
}

function classicsPage() {
  const shelves = classics.classicsByGenre().map((g) => `<section class=row><h2>${esc(g.name)}</h2><div class=grid>${g.films.map((f) => tile(classics.classicTile(f))).join('')}</div></section>`).join('');
  const inner = `<p class=lead>Big old movies that are free for everyone: public domain in the US, either because they were published in 1930 or earlier, or because their copyright was never renewed. Each one plays here, and each one links to <a href="/films">SoapBox Films</a> to rate and review it.</p>${shelves}
    <p class=lead style="margin-top:18px;font-size:12px">Not here on purpose: ${classics.EXCLUDED.map((x) => `${esc(x.title)} (${esc(x.why)})`).join('; ')}.</p>`;
  return pageShell(`Classics · free · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/classics`, description: `${classics.PD_CLASSICS.length} public-domain classic films to watch free: His Girl Friday, Metropolis, The General, A Star Is Born, Detour, Meet John Doe, Robin Hood and more.` });
}

// ── /free — the wider public-domain shelf (integrations/soapbox/pd-films-more.mjs), by genre ─────────────────────
// ── /world — foreign films by COUNTRY, then by type (never mixed into one pile) ─────────────────────────
let _freeById = null;
const freeById = () => (_freeById ||= new Map(allFreeFilms().map((f) => [String(f.id), f])));
function worldIndexPage() {
  const cs = world.countryCounts((id) => freeById().get(id));
  const cards = cs.map((c) => `<a class=tile href="/world/${esc(c.id)}" style="text-decoration:none"><div class=body><h3>${esc(c.name)}</h3><div class=meta>${c.count} free film${c.count === 1 ? '' : 's'}${c.leads ? ` · ${c.leads} free-elsewhere lead${c.leads === 1 ? '' : 's'}` : ''}</div></div></a>`).join('');
  const total = cs.reduce((n, c) => n + c.count, 0);
  const inner = `<p class=lead>Films from around the world, one country at a time. Everything that plays here is public domain in the US — in practice, films published in 1930 or earlier. Later foreign films are still protected in the US (a 1996 treaty restored their copyright), so for those we point you to the studios and archives that stream them free themselves. Every title links to <a href="/films">SoapBox Films</a> to rate and review it.</p>
    <section class=row><h2>Choose a country <span class=see>${total} films</span></h2><div class=grid>${cards}</div></section>`;
  return pageShell(`World cinema · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/world`, description: `${total} free, public-domain films from France, Germany, Russia, Scandinavia, Britain, Italy, Japan, China, India and more — organised by country, then by type.` });
}
function worldCountryPage(id) {
  const c = world.COUNTRIES.find((x) => x.id === id);
  if (!c) return null;
  const shelves = world.countryShelves(id, (fid) => freeById().get(fid));
  const leads = world.WORLD_LEADS.filter((l) => l.country === id);
  if (!shelves.length && !leads.length) return null;
  const tabs = shelves.map((s) => `<a class=btn href="#${esc(s.id)}">${esc(s.name)} (${s.films.length})</a>`).join(' ');
  const rows = shelves.map((s) => `<section class=row id="${esc(s.id)}"><h2>${esc(s.name)} <span class=see>${s.films.length}</span></h2><div class=grid>${s.films.map((f) => tile(world.worldTile(f))).join('')}</div></section>`).join('');
  const leadRows = leads.length ? `<section class=row><h2>Free elsewhere, from the rights holders <span class=see>where to watch</span></h2><p class=lead>Newer ${esc(c.name)} films are still in copyright in the US. These studios and archives stream them free themselves:</p><ul>${leads.map((l) => `<li><b>${esc(l.title)}</b>${l.year ? ` (${l.year})` : ''} — <a href="${esc(l.url)}" target=_blank rel="noopener noreferrer">${esc(l.service)} ↗</a>${l.year ? ` · <a href="/films?q=${encodeURIComponent(`${l.title} ${l.year}`)}">reviews</a>` : ''}</li>`).join('')}</ul><p class=meta>Checked ${esc(leads[0].seen)}.</p></section>` : '';
  const inner = `<p><a class=btn href="/world">← All countries</a></p><h1>${esc(c.name)}</h1>${tabs ? `<p>${tabs}</p>` : ''}${rows}${leadRows}`;
  return pageShell(`${c.name} · World cinema · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/world/${id}`, description: `Free, public-domain ${c.name} films on SoapBox Stream, by type — plus where the studios stream newer ones free.` });
}

function freeRow() {
  const picks = pdMore.PD_MORE.filter((f) => f.pick).slice(0, 12).map(pdMore.moreTile);
  return picks.length ? `<section class=row><h2><a href="/free">More free films</a> <span class="badge lic">public domain</span><span class=see>All ${pdMore.ALL_MORE.length} →</span></h2><div class=grid>${picks.map(tile).join('')}</div></section>` : '';
}

function freePage(genreId = '') {
  const groups = pdMore.moreByGenre().filter((g) => !genreId || g.id === genreId);
  if (genreId && !groups.length) return null;
  const tabs = pdMore.moreByGenre().map((g) => `<a class=btn href="/free/${esc(g.id)}"${g.id === genreId ? ' style="border-color:var(--acc)"' : ''}>${esc(g.name)} (${g.films.length})</a>`).join(' ');
  const shelves = groups.map((g) => `<section class=row><h2>${esc(g.name)} <span class=see>${g.films.length}</span></h2><div class=grid>${(genreId ? g.films : g.films.slice(0, 18)).map((f) => tile(pdMore.moreTile(f))).join('')}</div>${!genreId && g.films.length > 18 ? `<p><a class=btn href="/free/${esc(g.id)}">All ${g.films.length} ${esc(g.name.toLowerCase())} →</a></p>` : ''}</section>`).join('');
  const name = genreId ? groups[0].name : 'Free films';
  const inner = `<p class=lead>${pdMore.ALL_MORE.length} more films and shorts that are free for everyone: public domain in the US because they were published in 1930 or earlier, their copyright was never renewed or carried no notice, or they are works of the US government. Every one plays here and links to <a href="/films">SoapBox Films</a> to rate and review it. See also <a href="/classics">Classics</a> and <a href="/horror">Horror</a>.</p>
    <p>${tabs}</p>${shelves}`;
  return pageShell(`${name} · free · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/free${genreId ? `/${genreId}` : ''}`, description: `${genreId ? `${groups[0].films.length} ${name.toLowerCase()}` : `${pdMore.ALL_MORE.length} films and shorts`} in the public domain, free to watch: silent comedy, cartoons, westerns, war documentaries, noir and more.` });
}

function homePage(rows) {
  const inner = `<p class=lead>A free, legal streaming catalog. Public-domain films &amp; classic TV, free-to-air live channels, radio, podcasts, and on-chain MELEK creator video — every title labelled with its license and source.</p>
    ${classicsRow()}${freeRow()}${rows.map(rowSection).join('')}`;
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

// ── HORROR — organized by the operator's taxonomy (A Map of Horror + Girl Has to Kill Everyone) ──────
// PD horror streams in-app (curated + live IA); modern/copyrighted branches render as where-to-watch
// leads (link-outs), never streamed. `q` narrows the live search.
export async function horrorGenreTiles(genreId, { q = '', limit = 24 } = {}) {
  const curated = horror.curatedTiles(genreId, { limit });
  const live = await safe(() => horror.horrorFilms({ genre: genreId, q, limit }));
  const seen = new Set(curated.map((t) => t.id));
  const merged = curated.slice();
  for (const t of live) { if (t && t.id && !seen.has(t.id)) { seen.add(t.id); merged.push(t); } }
  return merged;
}

// A reference "where to watch" card for a (typically copyrighted) title we do NOT stream.
function leadCard(x) {
  const meta = [x.y, x.note].filter(Boolean).join(' · ');
  return `<article class=tile>
    <span class=thumb><span class=ph>🎞️</span></span>
    <div class=body>
      <h3>${esc(x.t)}</h3>
      ${meta ? `<div class=meta>${esc(String(meta))}</div>` : ''}
      <div class=meta><span class="badge">Where to watch — lead</span></div>
      <div class=cta>Reference only · not streamed here</div>
    </div>
  </article>`;
}

function horrorLandingPage() {
  const genres = horror.HORROR_GENRES.map((g) => {
    const n = horror.pdFilmsFor(g.id).length;
    return `<a class=tile href="/horror/${esc(g.id)}" style="text-decoration:none">
      <div class=body>
        <h3>${esc(g.title)}</h3>
        <div class=meta>${esc(g.organizedAround)}</div>
        <div class=meta><span class="badge lic">${n} PD in-app</span> <span class=badge>${esc(g.subgenres.join(' · '))}</span></div>
      </div></a>`;
  }).join('');
  const wing = horror.SURVIVAL_WING.map((s) => {
    const tag = s.emphasis === 'lead' ? '<span class="badge lic">LEAD</span>'
      : s.emphasis === 'deemphasized' ? '<span class=badge>secondary</span>' : '';
    return `<a class=tile href="/horror/${esc(s.id)}" style="text-decoration:none">
      <div class=body>
        <h3>${esc(s.title)} ${tag}</h3>
        <div class=meta>${esc(s.thesis)}</div>
      </div></a>`;
  }).join('');
  const stills = loadStills().slice(0, 4);
  const october = `<section class=row><h2>October · getting ready for Halloween</h2>
    <p class=lead>Read <a href="/horror/map"><b>A Map of Horror</b></a> — why horror is a family of genres, every shelf and its titles — and <a href="/horror/girl-has-to-kill-everyone"><b>Girl Has to Kill Everyone</b></a>, the genre mapped on its own. Every title links to where to watch it in <a href="/films">SoapBox Films</a>, where you can rate and review it.</p>
    ${stills.length ? `<div class=grid>${stills.map((x) => `<a href="/horror/stills" class=tile style="text-decoration:none"><img src="/horror/img/${esc(x.file)}" alt="${esc(x.caption)}" loading=lazy style="width:100%;display:block"><div class=body><div class=meta>${esc(x.caption)}</div></div></a>`).join('')}</div>` : ''}</section>`;
  const byId = new Map(horror.PD_HORROR_FILMS.map((f) => [f.id, f]));
  const picks = horror.HALLOWEEN_PICKS.map((id) => byId.get(id)).filter(Boolean).map(horror.toTile).filter(Boolean);
  const halloween = picks.length ? `<section class=row><h2>🎃 Free for Halloween · <span class=see>public-domain horror you can watch right here</span></h2><div class=grid>${picks.map(tile).join('')}</div></section>` : '';
  const inner = october + `<p class=lead>Horror organized by the map, not one word. Eight standalone genres — each with more internal grammar than the whole "thriller" category — plus the <b>Girl Has to Kill Everyone</b> survival wing. Public-domain titles play in-app; modern branches are where-to-watch leads.</p>
    <section class=row><h2>The eight genres · <span class=see>A Map of Horror</span></h2><div class=grid>${genres}</div></section>
    ${halloween}
    <section class=row><h2>Girl Has to Kill Everyone · <span class=see>survival wing — led by the trafficking network</span></h2><div class=grid>${wing}</div></section>
    <section class=row><h2>Near the genre, not in it</h2><div class=grid><a class=tile href="/horror/${esc(horror.ROOTS_SHELF.id)}" style="text-decoration:none"><div class=body><h3>${esc(horror.ROOTS_SHELF.title)} <span class=badge>free · public domain</span></h3><div class=meta>${esc(horror.ROOTS_SHELF.thesis)}</div></div></a></div></section>
    <p class=lead style="margin-top:20px">${esc(horror.dataNote())}</p>`;
  return pageShell(`Horror · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/horror`,
    description: 'Horror on SoapBox Stream, organized by the operator\'s taxonomy: eight standalone genres (A Map of Horror) and the Girl Has to Kill Everyone survival wing led by the sex-trafficking / network category. Public-domain horror streams in-app; other branches are where-to-watch leads.' });
}

function horrorGenrePage(g, tiles) {
  const sub = g.subgenres ? `<p class=lead>${esc(g.organizedAround)} · <b>Absorbs:</b> ${esc(g.subgenres.join(', '))}</p>` : '';
  const inner = `<p><a class=btn href="/horror">← All horror</a></p>
    <section class=row><h2>${esc(g.title)}</h2>${sub}
      ${tiles.length ? `<div class=grid>${tiles.map(tile).join('')}</div>` : '<p class=empty>No public-domain titles on this shelf yet — check back soon.</p>'}
    </section>`;
  return pageShell(`${g.title} · Horror · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/horror/${g.id}` });
}

function horrorSurvivalPage(s, tiles) {
  const emph = s.emphasis === 'lead' ? '<span class="badge lic">LEAD CATEGORY</span>' : s.emphasis === 'deemphasized' ? '<span class=badge>secondary</span>' : '';
  const leads = (s.titles || []).map(leadCard).join('');
  const watch = s.watchLeads ? `<p class=lead><b>Where to watch:</b> ${esc(s.watchLeads)}</p>` : '';
  const streamable = tiles.length
    ? `<section class=row><h2>Streamable now · public domain</h2><div class=grid>${tiles.map(tile).join('')}</div></section>`
    : '';
  const inner = `<p><a class=btn href="/horror">← All horror</a></p>
    <section class=row><h2>${esc(s.title)} ${emph}</h2>
      <p class=lead>${esc(s.thesis)}</p>
      <p class=lead style="font-size:12px">${s.wing === 'roots' ? 'Near the genre, not in it: these are rescue and exposé narratives, the history behind the trafficking premise.' : `Test: ${esc(s.wing === 'martyrs' ? 'If she stops killing, does she die?' : 'Is the film watching her be the monster?')}`}</p>
    </section>
    ${streamable}
    <section class=row><h2>Key titles · where-to-watch leads</h2>
      <p class=lead style="font-size:12px">These are (mostly) modern copyrighted films — we don't stream them, we point you to them.</p>
      <div class=grid>${leads}</div>
    </section>
    ${watch}`;
  return pageShell(`${s.title} · Horror · ${SITE_NAME}`, inner, { canonical: `${BASE_URL}/horror/${s.id}` });
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
  const tracks = item.source === 'Internet Archive' && item.id ? trackTag('ia', String(item.id)) : '';
  return `<video controls playsinline preload=metadata poster="${esc(safeHref(item.thumb) || '')}">
    <source src="${esc(g.stream)}" type="${esc(g.mime)}">${tracks}
    Your browser can't play this stream directly — <a href="${esc(g.stream)}" target=_blank rel="noopener noreferrer">open it ↗</a>.
  </video>`;
}

// Watch ⇄ review: the film's SoapBox Films score and review link, beside the player.
// Speeches: the official transcript beside the player (Pentecaust attaches timed subtitles later).
function speechPanel(item) {
  const sp = speeches.speechById(item && item.id);
  if (!sp) return '';
  return `<div class=licbox style="margin-top:10px"><b>${esc(sp.speaker || 'Speech')}</b>, ${esc(sp.year)} · ${esc(sp.why)}${sp.transcript ? `<br><a class=btn href="${esc(safeHref(sp.transcript))}" target=_blank rel="noopener noreferrer">📜 Official transcript ↗</a>` : ''} <a class=btn href="/speeches">All speeches &amp; debates</a></div>`;
}

function reviewPanel(item, film) {
  if (film) {
    return `<div class=licbox style="margin-top:10px"><b>SoapBox Films:</b> ${film.badge} &nbsp; <a class=btn href="${esc(film.reviewHref)}">★ Rate &amp; review</a> <a class=btn href="${esc(film.href)}">Reviews &amp; where else to watch</a></div>`;
  }
  const q = `${item.title || ''}${item.year ? ` ${item.year}` : ''}`.trim();
  return q ? `<div class=licbox style="margin-top:10px"><a class=btn href="/films?q=${encodeURIComponent(q)}">★ Find it on SoapBox Films to rate &amp; review</a></div>` : '';
}

const txClientIp = (req) => String((req.headers && (req.headers['x-forwarded-for'] || req.headers['x-real-ip'])) || '').split(',')[0].trim() || (req.socket && req.socket.remoteAddress) || 'unknown';

function watchShell(item, film = null) {
  const g = gateWatch(item);
  const stage = stageFor(item);
  const meta = [item.year, item.creator].filter(Boolean).join(' · ');
  const licbox = `<div class=licbox><b>License:</b> ${esc(item.license || 'unknown')} &nbsp;·&nbsp; <b>Source:</b> ${esc(item.source || '')} &nbsp;·&nbsp; <b>Attribution:</b> ${esc(item.attribution || item.source || '')}${g.ok ? ` &nbsp;·&nbsp; <b>Play mode:</b> ${esc(g.mode)}` : ''}<br>We ${g.ok && g.mode === 'embed' ? 'embed the owner\'s official player' : g.ok ? 'play the owner\'s own license-cleared stream' : 'link out to the owner\'s surface'} — we never rehost.</div>`;
  const inner = `<div class=stage>${stage}</div>
    <div class=info>${licbox}
      <h1 style="font-size:20px;margin:.2em 0">${esc(item.title || 'Untitled')}</h1>
      ${meta ? `<p class=meta style="color:var(--mut)">${esc(meta)}</p>` : ''}
      ${speechPanel(item)}
      ${reviewPanel(item, film)}
      ${item.source === 'Internet Archive' && item.id ? (transcriptLink('ia', String(item.id)) ? `<p style="margin-top:8px">${transcriptLink('ia', String(item.id))}</p>` : '') : ''}
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
    // Our hand-verified public-domain list (horror-taxonomy) is cleared even when IA's item lacks a licenseurl.
    const curated = horror.PD_HORROR_FILMS.find((x) => x.id === rawId);
    if (m) return m;
    // fall back to a minimal IA item (official player) even if metadata fails.
    return {
      id: rawId, title: rawId, kind: 'film', year: '', creator: '',
      thumb: `https://archive.org/services/img/${rawId}`,
      streamUrl: `https://archive.org/details/${rawId}`,
      license: curated ? 'Public domain (curated by SoapBox Stream)' : 'License not verified — see the Internet Archive page', licenseToken: curated ? 'public-domain' : 'unverified',
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

export const SITEMAP_PATHS = ['/', '/classics', '/speeches', '/narco', '/free', '/world', ...world.countryCounts((id) => freeById().get(id)).map((c) => `/world/${c.id}`), ...pdMore.moreByGenre().map((g) => `/free/${g.id}`), ...CATEGORIES.map((c) => `/c/${c.id}`),
  '/horror', ...HORROR_MAP_PATHS(), '/watch-free-safely', '/films', '/films/reviews', '/films/genres', '/films/originals',
  ...horror.HORROR_GENRES.map((g) => `/horror/${g.id}`),
  ...horror.SURVIVAL_WING.map((s) => `/horror/${s.id}`),
  `/horror/${horror.ROOTS_SHELF.id}`,
];

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

    // /films/* — SoapBox Films (film database, where-to-watch, audience reviews) lives in site/films.
    if (path === '/films' || path.startsWith('/films/')) {
      const films = await import('../films/server.mjs');
      return films.handler(req, res);
    }

    // Pentecaust transcripts: /transcripts/<src>/<id>.vtt, /watch/<src>/<id>/transcript, POST /api/transcripts/suggest
    if (path.startsWith('/transcripts/') || /\/transcript$/.test(path) || path === '/api/transcripts/suggest') {
      if (await transcriptsRoute(req, res, path, { shell: pageShell, send: sendHtml, clientIp: txClientIp })) return;
    }

    // /watch?src=&id=   OR   /watch/:src/:id
    const watchM = path.match(/^\/watch\/([a-z]+)\/(.+)$/);
    if (path === '/watch' || watchM) {
      const src = watchM ? watchM[1] : (url.searchParams.get('src') || '');
      const id = watchM ? watchM[2] : (url.searchParams.get('id') || '');
      const item = await resolveItem(src, id);
      if (!item) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('unknown title'); }
      const films = await import('../films/server.mjs');
      const film = films.filmForStream({ ia: src === 'ia' ? String(id) : '', title: item.title, year: item.year });
      return sendHtml(res, watchShell(item, film));
    }

    // /horror  (landing)  and  /horror/:id  (a top-level genre OR a survival-wing category)
    if (path === '/watch-free-safely' || path === '/about') return sendHtml(res, pageShell(`Watch free films safely · ${SITE_NAME}`, watchSafelyBody(), { canonical: `${BASE_URL}/watch-free-safely`, description: 'Where to watch free films legally and safely, the real risks of unofficial streaming sites and how to spot them, what to do if you clicked something, and why everything on SoapBox Stream is free to use.' }));
    if (path === '/horror') return sendHtml(res, horrorLandingPage());
    if (horrorMapRoute(path, res, { shell: pageShell, send: sendHtml, base: BASE_URL })) return;
    const horrorM = path.match(/^\/horror\/([a-z-]+)$/);
    if (horrorM) {
      const id = horrorM[1];
      const g = horror.genreById(id);
      if (g) {
        const tiles = await horrorGenreTiles(id, { limit: 40 });
        return sendHtml(res, horrorGenrePage(g, tiles));
      }
      const s = horror.survivalById(id);
      if (s) {
        // survival categories: stream the curated PD stock (via its pdTitles), lead-list the rest.
        const pdTiles = (s.pdTitles || []).map((fid) => {
          const f = horror.PD_HORROR_FILMS.find((x) => x.id === fid);
          return f ? horror.toTile(f) : null;
        }).filter(Boolean);
        return sendHtml(res, horrorSurvivalPage(s, pdTiles));
      }
      res.writeHead(404, { 'content-type': 'text/plain' });
      return res.end('unknown horror category');
    }

    if (path === '/classics') return sendHtml(res, classicsPage());
    if (path === '/speeches') return sendHtml(res, speechesPage());
    if (path === '/narco') return sendHtml(res, narcoPage());
    if (path === '/world') return sendHtml(res, worldIndexPage());
    const worldM = path.match(/^\/world\/([a-z-]+)$/);
    if (worldM) { const html = worldCountryPage(worldM[1]); if (!html) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('unknown country'); } return sendHtml(res, html); }
    if (path === '/free') return sendHtml(res, freePage());
    const freeM = path.match(/^\/free\/([a-z]+)$/);
    if (freeM) { const html = freePage(freeM[1]); if (!html) { res.writeHead(404, { 'content-type': 'text/plain' }); return res.end('unknown genre'); } return sendHtml(res, html); }
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
