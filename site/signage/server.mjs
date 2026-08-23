// server.mjs — data.SoapBox TV MODE. A full-screen, hands-free DIGITAL SIGNAGE surface: put it on a
// lobby TV / cast it to a screen and it loops through content on its own. A "kiosk" carousel of
// full-bleed SLIDES — public-domain art ("ArtCast"), a live-radio "Now Tuned" panel, an upcoming
// events / welcome panel, and a MELEK / SoapBox branding card — rotating every N seconds.
//
//   PORT=8168 BASE_URL=https://data.soapbox.community node site/signage/server.mjs
//
// ── REUSES the media readers we already shipped; invents no source of its own ────────────────────────
//   • Art    — integrations/soapbox/art-open-access.mjs (search / renderGallery — PD/CC0 "ArtCast")
//   • Radio  — integrations/soapbox/radio.mjs           (dallasStations / searchStations — Now Tuned)
//   • Music  — integrations/soapbox/music-catalog.mjs   (search — PD/CC-open now-playing ticker)
//   • Events — integrations/calendar.mjs                (feature-detected; may not exist → static welcome)
//
// ── Routes ──────────────────────────────────────────────────────────────────────────────────────────
//   /                the full-screen signage display. A rotating carousel: the FIRST slide is server-side
//                    rendered (so it shows with JS off / while the deck loads), then client JS auto-advances
//                    every N seconds (N via ?rotate=) and periodically refreshes the deck from /api/slides.
//                    Query: ?topic=  ?types=art,radio,events,brand  ?rotate=<seconds>
//   /api/slides      JSON array of slide objects {type,title,imageUrl?,items?,...}. Soft-fails to a safe
//                    default deck (brand + welcome) when the readers are empty or throw.
//   /config          a tiny setup page: pick slide types + rotation speed + a topic, producing a
//                    shareable "/" URL a venue can bookmark / cast.
//   /health          liveness probe.
//
// ── DISCIPLINE ───────────────────────────────────────────────────────────────────────────────────────
//   POINT/HOST posture inherited from the readers (art is PD/CC0 host; radio points at each station's own
//   stream). SOFT-FAIL: each slide type renders or is skipped — a dead reader never breaks the loop, and an
//   empty deck falls back to the default deck. esc() on every interpolated value; the embedded deck JSON is
//   `<`-escaped so a hostile title/topic can never break out of the <script> block. Standalone
//   handler(req,res) — this file EDITS nothing else. All network flows through the readers' injectable
//   fetch; __setFetch() fans one fake out to every reader for offline tests.
//
//   Kiosk note: an HTML page cannot by itself keep a TV awake. The client attempts the Screen Wake Lock
//   API (navigator.wakeLock) as a best effort; for a true always-on board, disable screen sleep on the
//   display / casting device. The page itself is pure display: no chrome, no input, auto-advancing.

import { createServer } from 'node:http';

import * as art from '../../integrations/soapbox/art-open-access.mjs';
import * as radio from '../../integrations/soapbox/radio.mjs';
import * as music from '../../integrations/soapbox/music-catalog.mjs';
import * as safety from '../../integrations/soapbox/public-safety.mjs';

const PORT = +(process.env.PORT || 8168);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || `http://localhost:${PORT}`).replace(/\/$/, '');

// ── house-style helpers ───────────────────────────────────────────────────────────────────────────
// esc() escapes the single quote too (matches the readers) so attribute interpolation is always safe.
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));
const str = (v) => (v == null ? '' : String(v)).trim();

// Escape a JSON string for safe embedding inside a <script> block (only `<` needs neutralizing so a
// value like "</script>" or "<!--" can't terminate the block or open a comment).
const jsonForScript = (obj) => JSON.stringify(obj).replace(/</g, '\\u003c');

// ── the fetch seam — one fake fans out to every reader for the offline tests ────────────────────────
let _currentFetch = null;
export function __setFetch(fn) {
  _currentFetch = fn || null;
  art.__setFetch(fn);
  radio.__setFetch(fn);
  music.__setFetch(fn);
  safety.__setFetch(fn);
  if (_cal && typeof _cal.__setFetch === 'function') _cal.__setFetch(fn);
}

// integrations/calendar.mjs may not exist yet — feature-detect it once, defensively.
let _cal;
let _calTried = false;
async function loadCalendar() {
  if (_calTried) return _cal || null;
  _calTried = true;
  try {
    _cal = await import('../../integrations/calendar.mjs');
    if (_cal && typeof _cal.__setFetch === 'function' && _currentFetch) _cal.__setFetch(_currentFetch);
  } catch { _cal = null; }
  return _cal || null;
}

// ── slide types ─────────────────────────────────────────────────────────────────────────────────────
export const SLIDE_TYPES = [
  { id: 'art', label: 'Public-domain art', blurb: 'Open-access museum art (The Met + Art Institute) — ArtCast.' },
  { id: 'events', label: 'Events / Welcome', blurb: 'Upcoming events when a calendar is wired; a welcome panel otherwise.' },
  { id: 'radio', label: 'Now Tuned (radio)', blurb: 'Live internet radio, Dallas-first — points at each station’s own stream.' },
  { id: 'safety', label: 'Public Safety', blurb: 'Live weather/quake alerts + scanner — situational awareness, not official.' },
  { id: 'brand', label: 'MELEK / SoapBox', blurb: 'A branding card for the network.' },
];
const KNOWN_TYPES = new Set(SLIDE_TYPES.map((t) => t.id));
export const DEFAULT_TYPES = ['art', 'events', 'radio', 'brand'];

// Parse a ?types= selection: accepts repeated params AND comma lists; keeps known ids, deduped, in the
// order requested. Empty / all-unknown → the default deck order.
export function parseTypes(values) {
  const raw = [];
  const arr = Array.isArray(values) ? values : (values == null ? [] : [values]);
  for (const v of arr) for (const part of String(v).split(',')) raw.push(part.trim().toLowerCase());
  const seen = new Set();
  const out = [];
  for (const id of raw) {
    if (KNOWN_TYPES.has(id) && !seen.has(id)) { seen.add(id); out.push(id); }
  }
  return out.length ? out : DEFAULT_TYPES.slice();
}

// Clamp the rotation interval (seconds). Default 12s; 3s floor so a screen is readable, 600s ceiling.
export function clampRotate(v, def = 12) {
  const n = Math.round(Number(v));
  if (!Number.isFinite(n)) return def;
  return Math.max(3, Math.min(600, n));
}

// ── the deck builders — each REUSES a reader, each soft-fails to [] (never throws to buildDeck) ───────
async function artSlides(topic, limit = 6) {
  const works = await art.search({ query: topic || 'landscape', limit });
  const list = Array.isArray(works) ? works : [];
  return list
    .filter((w) => w && (w.imageUrl || w.thumbUrl))
    .slice(0, limit)
    .map((w) => ({
      type: 'art',
      title: str(w.title) || 'Untitled',
      artist: str(w.artist),
      date: str(w.date),
      imageUrl: w.imageUrl || w.thumbUrl,
      attribution: str(w.attribution),
      source: str(w.source),
    }));
}

async function radioSlides(topic, limit = 8) {
  const stations = topic
    ? await radio.searchStations({ name: topic, limit })
    : await radio.dallasStations(limit);
  const list = (Array.isArray(stations) ? stations : []).slice(0, limit);
  if (!list.length) return [];
  return [{
    type: 'radio',
    title: topic ? `Now Tuned — “${topic}”` : 'Now Tuned',
    items: list.map((s) => ({
      name: str(s.name),
      meta: [str(s.state) || str(s.country), s.tags && s.tags[0], s.bitrate ? `${s.bitrate}k` : '']
        .filter(Boolean).join(' · '),
    })),
  }];
}

// ── PUBLIC-SAFETY slides — each REUSES the public-safety reader, each soft-fails to [] (see §3a) ───────
// A drop-in for the normal carousel: an alerts panel, a quakes panel, and a scanner panel. Every safety
// slide carries the permanent DISCLAIMER in its footer (renderSlideHtml + the client append it).
async function alertSlides(state, limit = 8) {
  const alerts = await safety.nwsAlerts({ state, limit }).catch(() => []);
  const list = Array.isArray(alerts) ? alerts : [];
  if (!list.length) return [];
  return [{
    type: 'safety', title: 'Active Alerts — NWS',
    items: list.map((a) => ({ name: str(a.title), meta: [str(a.severity), str(a.area)].filter(Boolean).join(' · ') })),
    disclaimer: safety.DISCLAIMER,
  }];
}

async function quakeSlides(state, limit = 6) {
  const quakes = await safety.usgsQuakes({ limit }).catch(() => []);
  const list = Array.isArray(quakes) ? quakes : [];
  if (!list.length) return [];
  return [{
    type: 'safety', title: 'Recent Quakes — USGS',
    items: list.map((q) => ({ name: str(q.title), meta: [str(q.severity), str(q.time).slice(0, 16).replace('T', ' ')].filter(Boolean).join(' · ') })),
    disclaimer: safety.DISCLAIMER,
  }];
}

async function scannerSlides(state, limit = 8) {
  const stations = await safety.scannerStations({ state, limit }).catch(() => []);
  const list = (Array.isArray(stations) ? stations : []).slice(0, limit);
  if (!list.length) return [];
  return [{
    type: 'safety', title: 'Scanner — Public Safety',
    community: true,
    items: list.map((s) => ({ name: str(s.name), meta: [str(s.state) || str(s.country), s.bitrate ? `${s.bitrate}k` : ''].filter(Boolean).join(' · ') })),
    disclaimer: safety.DISCLAIMER,
  }];
}

async function safetySlides(state) {
  const out = [];
  out.push(...await alertSlides(state));
  out.push(...await quakeSlides(state));
  out.push(...await scannerSlides(state));
  return out;
}

async function musicSlides(topic, limit = 6) {
  const tracks = await music.search({ query: topic || '', limit });
  const list = (Array.isArray(tracks) ? tracks : []).slice(0, limit);
  if (!list.length) return [];
  return [{
    type: 'music',
    title: 'On the Air',
    items: list.map((t) => ({ name: str(t.title) || 'Untitled', meta: str(t.artist) })),
  }];
}

async function eventsSlides(topic) {
  const cal = await loadCalendar();
  if (cal) {
    try {
      const fn = cal.upcomingEvents || cal.listEvents || cal.getEvents || cal.search;
      if (typeof fn === 'function') {
        const evs = await fn.call(cal, { topic, limit: 6 });
        const list = Array.isArray(evs) ? evs : (evs && Array.isArray(evs.items) ? evs.items : []);
        const items = list.map((e) => ({
          name: str(e && (e.title || e.name || e.summary)) || 'Event',
          meta: str(e && (e.when || e.date || e.start || e.location)),
        })).filter((i) => i.name);
        if (items.length) return [{ type: 'events', title: 'Upcoming', items }];
      }
    } catch { /* fall through to the static welcome */ }
  }
  // No calendar wired (or it returned nothing) → a static welcome panel (no network).
  return [welcomeSlide()];
}

function brandSlide(topic) {
  return {
    type: 'brand',
    title: 'MELEK',
    subtitle: topic
      ? `data.SoapBox — ${topic}`
      : 'data.SoapBox — the Angelic AI Witness network',
  };
}

function welcomeSlide() {
  return {
    type: 'events',
    title: 'Welcome',
    items: [
      { name: 'MELEK — the Angelic AI Witness network', meta: '' },
      { name: 'Public-domain art · live radio · community media', meta: '' },
      { name: 'soapbox.community', meta: '' },
    ],
  };
}

// A safe, fully-offline fallback deck: never empty, never touches the network.
function defaultDeck(topic) {
  return [brandSlide(topic), welcomeSlide()];
}

/**
 * buildDeck — assemble the slide deck for a topic + selected types. Each slide-type generator is wrapped
 * so a failure skips just that type (never breaks the loop). An empty result falls back to defaultDeck().
 * @param {{topic?:string, types?:string|string[]}} opts
 * @returns {Promise<Array<object>>}
 */
export async function buildDeck({ topic = '', types = DEFAULT_TYPES, state = 'TX' } = {}) {
  const t = str(topic);
  const st = str(state) || 'TX';
  const want = parseTypes(types);
  const slides = [];
  for (const type of want) {
    try {
      if (type === 'art') slides.push(...await artSlides(t));
      else if (type === 'radio') slides.push(...await radioSlides(t));
      else if (type === 'safety') slides.push(...await safetySlides(st));
      else if (type === 'music') slides.push(...await musicSlides(t));
      else if (type === 'events') slides.push(...await eventsSlides(t));
      else if (type === 'brand') slides.push(brandSlide(t));
    } catch { /* skip this slide type — a dead reader never breaks the deck */ }
  }
  const cleaned = slides.filter((s) => s && typeof s === 'object' && s.type);
  return cleaned.length ? cleaned : defaultDeck(t);
}

// ── styling (dark, big-type, kiosk — no chrome) ──────────────────────────────────────────────────────
const STYLE = `<style>
  :root{--bg:#08090c;--panel:#0d1117;--line:#21262d;--fg:#e6edf3;--mut:#9aa4b2;--gold:#d29922;--ember:#f0883e;--blue:#58a6ff}
  *{box-sizing:border-box;margin:0;padding:0}
  html,body{height:100%}
  body{background:var(--bg);color:var(--fg);font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;overflow:hidden;cursor:none}
  #stage{position:fixed;inset:0;overflow:hidden}
  .slide{position:absolute;inset:0;display:flex;flex-direction:column;justify-content:center;padding:6vmin 8vmin;animation:fade .9s ease}
  @keyframes fade{from{opacity:0}to{opacity:1}}
  /* ART — full-bleed image with a slow Ken-Burns drift + caption overlay */
  .slide-art{padding:0;justify-content:flex-end}
  .slide-art .bg{position:absolute;inset:0;background-size:cover;background-position:center;animation:kb 24s ease-in-out infinite alternate;filter:brightness(.92)}
  @keyframes kb{from{transform:scale(1.04)}to{transform:scale(1.15)}}
  .slide-art .scrim{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.82),rgba(0,0,0,0) 55%)}
  .slide-art .cap{position:relative;padding:6vmin 8vmin;max-width:70ch}
  .slide-art .cap h2{font-size:5vmin;font-weight:800;line-height:1.1}
  .slide-art .cap p{font-size:2.4vmin;color:#d7deea;margin-top:1vmin}
  .slide-art .cap .attr{font-size:1.8vmin;color:var(--mut);margin-top:1.4vmin}
  /* list panels (radio / events / music) */
  .panel h2{font-size:6vmin;font-weight:800;color:#fff}
  .panel .kicker{font-size:2.2vmin;letter-spacing:.28em;text-transform:uppercase;color:var(--gold);margin-bottom:2vmin;font-weight:700}
  .panel ul{list-style:none;margin-top:3vmin;max-width:80ch}
  .panel li{padding:1.6vmin 0;border-bottom:1px solid var(--line);display:flex;gap:2vmin;align-items:baseline;flex-wrap:wrap}
  .panel li .nm{font-size:3.4vmin;font-weight:600}
  .panel li .mt{font-size:2.2vmin;color:var(--mut);margin-left:auto}
  /* brand */
  .slide-brand{align-items:center;text-align:center}
  .slide-brand .mark{font-size:14vmin;font-weight:900;letter-spacing:.04em;background:linear-gradient(120deg,var(--gold),var(--ember));-webkit-background-clip:text;background-clip:text;color:transparent}
  .slide-brand .sub{font-size:3.2vmin;color:var(--mut);margin-top:2vmin;max-width:60ch}
  /* fixed overlays */
  .alpha{position:fixed;top:2.4vmin;left:2.6vmin;z-index:9;font-size:1.7vmin;font-weight:800;letter-spacing:.12em;color:var(--gold);border:1px solid var(--gold);border-radius:8px;padding:.4vmin 1.2vmin;text-transform:uppercase;background:rgba(0,0,0,.35)}
  .dots{position:fixed;bottom:2.6vmin;left:50%;transform:translateX(-50%);z-index:9;display:flex;gap:1.2vmin}
  .dots i{width:1.3vmin;height:1.3vmin;border-radius:50%;background:#3a4351;transition:background .3s}
  .dots i.on{background:var(--ember)}
  .noscript{padding:8vmin}
  /* per-slide disclaimer footer (safety slides in the rotating carousel) */
  .slide-disclaim{margin-top:2.4vmin;font-size:2vmin;font-weight:700;color:var(--ember)}
  /* ── the dedicated /safety board (non-rotating "fire-alarm display") ── */
  body.board{overflow:auto;cursor:auto}
  .board{position:fixed;inset:0;display:flex;flex-direction:column;padding:2.4vmin 3vmin 8vmin;gap:2vmin;overflow:auto}
  .board .bhead{display:flex;align-items:baseline;gap:2vmin;flex-wrap:wrap;border-bottom:1px solid var(--line);padding-bottom:1.4vmin}
  .board .bhead h1{font-size:4vmin;font-weight:900;letter-spacing:.02em}
  .board .bhead .loc{color:var(--gold);font-weight:700}
  .board .bhead .clock{margin-left:auto;font-size:3.4vmin;font-weight:800;font-variant-numeric:tabular-nums;color:var(--fg)}
  .board .grid{display:grid;grid-template-columns:1fr 1fr;gap:2vmin}
  @media (max-width:900px){.board .grid{grid-template-columns:1fr}}
  .sec{background:var(--panel);border:1px solid var(--line);border-radius:14px;padding:1.8vmin 2vmin;min-height:0}
  .sec.wide{grid-column:1 / -1}
  .sec h2{font-size:2.4vmin;font-weight:800;display:flex;align-items:center;gap:1vmin}
  .sec .tag{font-size:1.5vmin;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:.3vmin 1vmin;border-radius:6px;border:1px solid var(--line);color:var(--mut)}
  .sec .tag.official{color:var(--blue);border-color:var(--blue)}
  .sec .tag.community{color:var(--gold);border-color:var(--gold)}
  .tiles{list-style:none;margin-top:1.4vmin;display:grid;gap:1.2vmin}
  .tile{border-left:5px solid var(--mut);background:#0b0f14;border-radius:8px;padding:1.2vmin 1.6vmin}
  .tile .tt{font-size:2.2vmin;font-weight:700}
  .tile .tm{font-size:1.7vmin;color:var(--mut);margin-top:.4vmin}
  .tile.sev-extreme,.tile.sev-severe{border-left-color:#f85149}
  .tile.sev-moderate{border-left-color:var(--ember)}
  .tile.sev-minor{border-left-color:var(--gold)}
  .tile.calm{border-left-color:#2ea043;color:var(--mut)}
  .scanner{display:flex;flex-direction:column;gap:1.2vmin}
  .scanner .row{display:flex;gap:1.4vmin;align-items:center;flex-wrap:wrap}
  .scanner select{background:#0b0f14;border:1px solid var(--line);color:var(--fg);border-radius:8px;padding:1vmin 1.2vmin;font-size:1.9vmin;max-width:100%}
  .scanner audio{width:100%;max-width:52ch}
  .scanner button{cursor:pointer;background:var(--ember);border:0;border-radius:8px;color:#0d1117;font-weight:800;padding:1vmin 2vmin;font-size:1.9vmin}
  .disclaimer{position:fixed;left:0;right:0;bottom:0;z-index:20;background:#3d0d0d;border-top:2px solid #f85149;color:#ffd7d5;font-size:2.1vmin;font-weight:800;text-align:center;padding:1.4vmin 2vmin}
</style>`;

// ── server-side render of one slide (esc'd) — powers the SSR first slide (works with JS off) ─────────
export function renderSlideHtml(s) {
  if (!s || typeof s !== 'object') return '';
  const type = s.type;
  if (type === 'art') {
    const bg = s.imageUrl
      ? `<div class="bg" style="background-image:url('${esc(String(s.imageUrl).replace(/'/g, ''))}')"></div><div class="scrim"></div>`
      : '';
    const artist = s.artist ? `<p>${esc(s.artist)}${s.date ? esc(`, ${s.date}`) : ''}</p>` : '';
    const attr = s.attribution ? `<p class="attr">${esc(s.attribution)}</p>` : '';
    return `<div class="slide slide-art">${bg}<div class="cap"><h2>${esc(s.title || 'Untitled')}</h2>${artist}${attr}</div></div>`;
  }
  if (type === 'brand') {
    return `<div class="slide slide-brand"><div class="mark">${esc(s.title || 'MELEK')}</div><div class="sub">${esc(s.subtitle || '')}</div></div>`;
  }
  // radio / events / music / safety → a list panel
  const items = Array.isArray(s.items) ? s.items : [];
  const lis = items.map((it) =>
    `<li><span class="nm">${esc(it && it.name)}</span>${it && it.meta ? `<span class="mt">${esc(it.meta)}</span>` : ''}</li>`).join('');
  const kick = type === 'radio' ? 'Live radio'
    : (type === 'music' ? 'Now playing'
      : (type === 'safety' ? (s.community ? 'Public safety · community feed' : 'Public safety · official') : 'On the board'));
  const disc = s.disclaimer ? `<p class="slide-disclaim">⚠ ${esc(s.disclaimer)}</p>` : '';
  return `<div class="slide panel slide-${esc(type || 'events')}"><div class="kicker">${esc(kick)}</div><h2>${esc(s.title || '')}</h2><ul>${lis || '<li><span class="nm">Nothing scheduled right now.</span></li>'}</ul>${disc}</div>`;
}

// ── the display page ─────────────────────────────────────────────────────────────────────────────────
/**
 * displayPage — the kiosk carousel. SSR-renders the first slide, embeds the whole deck as JSON, and ships
 * a small client script that fades between slides every `rotateSec` seconds and re-pulls /api/slides.
 */
export function displayPage(deck, { rotateSec = 12, query = '' } = {}) {
  const slides = Array.isArray(deck) && deck.length ? deck : defaultDeck('');
  const first = renderSlideHtml(slides[0]);
  const deckJson = jsonForScript(slides);
  const rot = clampRotate(rotateSec);
  const apiQ = query ? `?${query}` : '';
  const client = `
(function(){
  var deck = ${deckJson};
  var ROT = ${rot} * 1000;
  var stage = document.getElementById('stage');
  var dots = document.getElementById('dots');
  var i = 0, timer = null;
  function el(tag, cls){ var e = document.createElement(tag); if(cls) e.className = cls; return e; }
  function render(s){
    stage.innerHTML = '';
    if(!s || typeof s !== 'object'){ return; }
    var panel;
    if(s.type === 'art'){
      panel = el('div','slide slide-art');
      if(s.imageUrl){
        var bg = el('div','bg');
        bg.style.backgroundImage = "url('" + String(s.imageUrl).replace(/'/g,'') + "')";
        panel.appendChild(bg);
        panel.appendChild(el('div','scrim'));
      }
      var cap = el('div','cap');
      var h = el('h2'); h.textContent = s.title || 'Untitled'; cap.appendChild(h);
      if(s.artist){ var p = el('p'); p.textContent = s.artist + (s.date ? ', ' + s.date : ''); cap.appendChild(p); }
      if(s.attribution){ var a = el('p','attr'); a.textContent = s.attribution; cap.appendChild(a); }
      panel.appendChild(cap);
    } else if(s.type === 'brand'){
      panel = el('div','slide slide-brand');
      var m = el('div','mark'); m.textContent = s.title || 'MELEK'; panel.appendChild(m);
      var sub = el('div','sub'); sub.textContent = s.subtitle || ''; panel.appendChild(sub);
    } else {
      panel = el('div','slide panel slide-' + (s.type || 'events'));
      var kt = s.type === 'radio' ? 'Live radio' : (s.type === 'music' ? 'Now playing' : (s.type === 'safety' ? (s.community ? 'Public safety · community feed' : 'Public safety · official') : 'On the board'));
      var k = el('div','kicker'); k.textContent = kt; panel.appendChild(k);
      var t = el('h2'); t.textContent = s.title || ''; panel.appendChild(t);
      var ul = el('ul');
      var items = Array.isArray(s.items) ? s.items : [];
      if(!items.length){ var li0 = el('li'); var n0 = el('span','nm'); n0.textContent = 'Nothing scheduled right now.'; li0.appendChild(n0); ul.appendChild(li0); }
      items.forEach(function(it){
        var li = el('li');
        var nm = el('span','nm'); nm.textContent = (it && it.name) || ''; li.appendChild(nm);
        if(it && it.meta){ var mt = el('span','mt'); mt.textContent = it.meta; li.appendChild(mt); }
        ul.appendChild(li);
      });
      panel.appendChild(ul);
      if(s.disclaimer){ var dz = el('p','slide-disclaim'); dz.textContent = '⚠ ' + s.disclaimer; panel.appendChild(dz); }
    }
    stage.appendChild(panel);
    renderDots();
  }
  function renderDots(){
    if(!dots) return;
    dots.innerHTML = '';
    for(var d=0; d<deck.length; d++){ var dot = el('i'); if(d === i) dot.className = 'on'; dots.appendChild(dot); }
  }
  function next(){ if(!deck.length) return; i = (i + 1) % deck.length; render(deck[i]); }
  function start(){ if(timer) clearInterval(timer); timer = setInterval(next, ROT); }
  function refresh(){
    fetch('/api/slides${apiQ}', { headers: { accept: 'application/json' } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(Array.isArray(j) && j.length){ deck = j; if(i >= deck.length) i = 0; renderDots(); } })
      .catch(function(){ /* keep showing the current deck */ });
  }
  render(deck[0]); start();
  setInterval(refresh, Math.max(ROT * deck.length, 60000));
  if('wakeLock' in navigator){ navigator.wakeLock.request('screen').catch(function(){});
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible'){ navigator.wakeLock.request('screen').catch(function(){}); } });
  }
})();`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>MELEK Signage — data.SoapBox TV</title>
<meta name=description content="data.SoapBox TV mode — a full-screen, auto-rotating signage board of public-domain art, live radio, and events for a lobby screen or cast display.">
<meta name=robots content="noindex,follow">${STYLE}</head><body>
<div class="alpha">Alpha</div>
<div id="stage" data-slide-count="${esc(slides.length)}" data-rotate="${esc(rot)}">${first}</div>
<div class="dots" id="dots"></div>
<noscript><div class="noscript">${first}</div></noscript>
<script>${client}</script>
</body></html>`;
}

// ── /safety — the dedicated, NON-ROTATING incident board (the "fire-alarm display", §3b) ──────────────
// Shares STYLE / esc / jsonForScript / the wake-lock+alpha-badge idiom with displayPage. Shows everything
// at once (never cycles): alert + quake tiles, an optional official-incident row, a community scanner audio
// element, and a FIXED, always-visible disclaimer bar. Soft-fails to a calm board (never a blank hole).
const SEV_CLASS = { extreme: 'sev-extreme', severe: 'sev-severe', moderate: 'sev-moderate', minor: 'sev-minor' };
function sevClass(sev) { return SEV_CLASS[String(sev || '').toLowerCase()] || ''; }

function boardTiles(items, { emptyText = 'None reported right now.' } = {}) {
  const list = Array.isArray(items) ? items : [];
  if (!list.length) return `<li class="tile calm"><div class="tt">${esc(emptyText)}</div></li>`;
  return list.map((it) => {
    const title = str(it && (it.title || it.name)) || 'Incident';
    const meta = [str(it && it.severity), str(it && (it.area || it.meta)), str(it && it.time).slice(0, 16).replace('T', ' ')]
      .filter(Boolean).join(' · ');
    return `<li class="tile ${esc(sevClass(it && it.severity))}"><div class="tt">${esc(title)}</div>${meta ? `<div class="tm">${esc(meta)}</div>` : ''}</li>`;
  }).join('');
}

/**
 * buildSafetyBoard — assemble the /safety + /api/safety payload. Wraps safety.safetyBoard() (NWS + USGS +
 * scanner, always with the DISCLAIMER) and OPTIONALLY augments it with official municipal-CAD incident tiles
 * from the public-safety reader's own city open-data (incidents({city})) when a ?city= is given and known.
 * Soft-fails to a safe, non-empty board (never throws).
 */
export async function buildSafetyBoard({ state = 'TX', city = '' } = {}) {
  let board;
  try { board = await safety.safetyBoard({ state }); }
  catch { board = { alerts: [], quakes: [], scanners: [], disclaimer: safety.DISCLAIMER }; }
  let incidents = [];
  const wantCity = str(city);
  if (wantCity && safety.CITY_PORTALS && safety.CITY_PORTALS[wantCity]) {
    try {
      const rows = await safety.incidents({ city: wantCity, limit: 12 });
      incidents = (Array.isArray(rows) ? rows : []).map((r) => ({
        title: str(r.type) || str(r.description) || 'Incident',
        severity: 'Unknown',
        area: str(r.address),
        time: str(r.when),
      }));
    } catch { incidents = []; }
  }
  return {
    alerts: Array.isArray(board.alerts) ? board.alerts : [],
    quakes: Array.isArray(board.quakes) ? board.quakes : [],
    incidents,
    scanners: Array.isArray(board.scanners) ? board.scanners : [],
    disclaimer: str(board.disclaimer) || safety.DISCLAIMER,
  };
}

/**
 * safetyBoardPage — the hands-free incident board. `data` is a safety.safetyBoard() payload
 * ({alerts,quakes,incidents,scanners,disclaimer}); everything is SSR'd (works with JS off) and the client
 * only ticks the clock, wires the scanner audio, keeps the screen awake, and re-pulls /api/safety.
 */
export function safetyBoardPage(data, { state = 'TX', query = '' } = {}) {
  const d = data && typeof data === 'object' ? data : {};
  const alerts = Array.isArray(d.alerts) ? d.alerts : [];
  const quakes = Array.isArray(d.quakes) ? d.quakes : [];
  const incidents = Array.isArray(d.incidents) ? d.incidents : [];
  const scanners = Array.isArray(d.scanners) ? d.scanners : [];
  const disclaimer = str(d.disclaimer) || safety.DISCLAIMER;
  const st = (str(state) || 'TX').toUpperCase();
  const apiQ = query ? `?${query}` : '';

  const scannerHtml = scanners.length
    ? `<div class="scanner">
        <div class="row">
          <select id="scanpick" aria-label="Scanner feed">${scanners.map((s, ix) =>
            `<option value="${esc(s.stream)}"${ix === 0 ? ' selected' : ''}>${esc(str(s.name))}${s.state ? ' — ' + esc(str(s.state)) : ''}</option>`).join('')}</select>
          <button id="scanon" type="button">▶ Enable audio</button>
        </div>
        <audio id="scanaudio" controls muted preload="none" src="${esc(scanners[0].stream)}"></audio>
        <div class="tm">Community feed — point-only, we never rehost. Autoplay is muted; tap “Enable audio”.</div>
      </div>`
    : `<div class="tm">No community scanner feed found right now.</div>`;

  const incidentsSection = `<section class="sec wide"><h2>Incidents <span class="tag official">official city feed</span></h2>
      <ul class="tiles">${boardTiles(incidents, { emptyText: 'No official open-data incidents configured / reported.' })}</ul></section>`;

  const dataJson = jsonForScript({ alerts, quakes, incidents, scanners, disclaimer });
  const client = `
(function(){
  var api = ${JSON.stringify(apiQ)};
  var clock = document.getElementById('clock');
  function tick(){ if(clock){ try{ clock.textContent = new Date().toLocaleTimeString(); }catch(e){} } }
  tick(); setInterval(tick, 1000);
  var audio = document.getElementById('scanaudio');
  var pick = document.getElementById('scanpick');
  var on = document.getElementById('scanon');
  if(pick && audio){ pick.addEventListener('change', function(){ audio.src = pick.value; audio.muted = false; audio.play().catch(function(){}); }); }
  if(on && audio){ on.addEventListener('click', function(){ audio.muted = false; audio.play().catch(function(){}); }); }
  function refresh(){
    fetch('/api/safety' + api, { headers: { accept: 'application/json' } })
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(j){ if(j){ /* a full re-render would replace tiles; kept minimal — reload keeps SSR the source of truth */ } })
      .catch(function(){});
  }
  setInterval(function(){ location.reload(); }, 90000);
  if('wakeLock' in navigator){ navigator.wakeLock.request('screen').catch(function(){});
    document.addEventListener('visibilitychange', function(){ if(document.visibilityState === 'visible'){ navigator.wakeLock.request('screen').catch(function(){}); } });
  }
  void refresh;
})();`;

  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Public Safety Board — data.SoapBox</title>
<meta name=description content="A data.SoapBox situational-awareness board: live NWS weather alerts, USGS quakes, and a community scanner feed. Not an official emergency source — in an emergency, call 911.">
<meta name=robots content="noindex,follow">${STYLE}</head><body class="board">
<div class="alpha">Alpha</div>
<main class="board">
  <div class="bhead">
    <h1>PUBLIC SAFETY BOARD — <span class="loc">${esc(st)}</span></h1>
    <div class="clock" id="clock">—:—:—</div>
  </div>
  <div class="grid">
    <section class="sec"><h2>Active Alerts <span class="tag official">NWS</span></h2>
      <ul class="tiles">${boardTiles(alerts, { emptyText: 'No active weather alerts.' })}</ul></section>
    <section class="sec"><h2>Recent Quakes <span class="tag official">USGS</span></h2>
      <ul class="tiles">${boardTiles(quakes, { emptyText: 'No recent quakes above threshold.' })}</ul></section>
    ${incidentsSection}
    <section class="sec wide"><h2>📻 Scanner <span class="tag community">community feed</span></h2>
      ${scannerHtml}</section>
  </div>
</main>
<div class="disclaimer">⚠ ${esc(disclaimer)}</div>
<script id="safety-data" type="application/json">${dataJson}</script>
<script>${client}</script>
</body></html>`;
}

// ── /config — the venue setup page (picker → shareable "/" URL) ───────────────────────────────────────
export function configPage({ topic = '', types = DEFAULT_TYPES, rotate = 12 } = {}) {
  const sel = new Set(parseTypes(types));
  const rot = clampRotate(rotate);
  const checks = SLIDE_TYPES.map((t) => `
    <label class="opt"><input type="checkbox" name="types" value="${esc(t.id)}"${sel.has(t.id) ? ' checked' : ''}>
      <span><b>${esc(t.label)}</b><br><span class="mut">${esc(t.blurb)}</span></span></label>`).join('');
  const cfgStyle = `<style>
    :root{--bg:#0d1117;--panel:#161b22;--line:#30363d;--fg:#e6edf3;--mut:#8b949e;--ember:#f0883e;--blue:#58a6ff}
    *{box-sizing:border-box} body{font:15px/1.6 system-ui,sans-serif;margin:0;background:var(--bg);color:var(--fg)}
    .wrap{max-width:760px;margin:0 auto;padding:28px}
    h1{font-size:26px;margin:0 0 6px} .lead{color:var(--mut);margin:0 0 18px}
    .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px 22px;margin:16px 0}
    label.opt{display:flex;gap:12px;align-items:flex-start;padding:10px 0;border-bottom:1px solid #21262d}
    label.opt:last-child{border-bottom:0} label.opt input{margin-top:4px;width:18px;height:18px}
    .mut{color:var(--mut);font-size:13px}
    .row{display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin-top:8px}
    input.txt,input.num{background:#0b0f14;border:1px solid var(--line);border-radius:8px;color:var(--fg);padding:10px 13px;font-size:15px}
    input.txt{flex:1 1 260px;min-width:180px} input.num{width:110px}
    button{cursor:pointer;background:var(--ember);border:0;border-radius:8px;color:#0d1117;font-weight:800;padding:12px 22px;font-size:15px}
    a{color:var(--blue)} .out{margin-top:14px} code{background:#0b0f14;border:1px solid var(--line);border-radius:6px;padding:8px 10px;display:block;word-break:break-all}
    .alpha{display:inline-block;font-size:10px;font-weight:800;letter-spacing:.08em;color:var(--ember);border:1px solid var(--ember);border-radius:6px;padding:1px 6px;text-transform:uppercase;vertical-align:middle;margin-right:8px}
  </style>`;
  const client = `
(function(){
  var f = document.getElementById('cfg');
  var out = document.getElementById('url');
  function build(){
    var p = new URLSearchParams();
    var topic = f.topic.value.trim(); if(topic) p.set('topic', topic);
    var types = Array.prototype.slice.call(f.querySelectorAll('input[name=types]:checked')).map(function(c){return c.value;});
    if(types.length) p.set('types', types.join(','));
    var r = parseInt(f.rotate.value, 10); if(r) p.set('rotate', String(r));
    var base = location.origin + '/';
    var qs = p.toString();
    var full = qs ? base + '?' + qs : base;
    out.textContent = full;
    var open = document.getElementById('open'); if(open) open.href = qs ? '/?' + qs : '/';
    return full;
  }
  f.addEventListener('input', build);
  f.addEventListener('submit', function(e){ e.preventDefault(); var u = build(); location.href = u; });
  build();
})();`;
  return `<!doctype html><html lang=en><head><meta charset=utf-8>
<meta name=viewport content="width=device-width,initial-scale=1">
<title>Configure — MELEK Signage</title>
<meta name=description content="Configure a data.SoapBox TV signage board: pick slide types, rotation speed, and a topic, then cast the shareable URL to a screen.">
<meta name=robots content="noindex,follow">${cfgStyle}</head><body>
<main class="wrap">
  <h1><span class="alpha">Alpha</span>Signage setup</h1>
  <p class="lead">Pick what loops on your screen, then bookmark or cast the link. Put it on a lobby TV and it runs hands-free.</p>
  <form id="cfg" method="get" action="/">
    <div class="card">
      <h2 style="font-size:16px;margin:0 0 6px">Slides</h2>
      ${checks}
    </div>
    <div class="card">
      <h2 style="font-size:16px;margin:0 0 6px">Topic &amp; speed</h2>
      <div class="row">
        <input class="txt" name="topic" value="${esc(topic)}" placeholder="Topic / tag — e.g. sunflowers, jazz (optional)" autocomplete="off" aria-label="Topic">
        <label class="mut">Rotate every
          <input class="num" type="number" name="rotate" min="3" max="600" value="${esc(rot)}"> s</label>
      </div>
      <div class="out"><span class="mut">Shareable URL:</span><code id="url"></code>
        <div class="row"><button type="submit">Open the board →</button> <a id="open" href="/">open in a new context</a></div>
      </div>
    </div>
  </form>
  <div class="card">
    <h2 style="font-size:16px;margin:0 0 6px">Public Safety board</h2>
    <p class="mut">A dedicated, non-rotating incident board — live weather/quake alerts + a community scanner feed. Situational awareness only, not an official emergency source.</p>
    <div class="row"><a id="safetylink" href="/safety?state=TX">Open the Public Safety board →</a></div>
  </div>
</main>
<script>${client}</script>
</body></html>`;
}

// ── routing ───────────────────────────────────────────────────────────────────────────────────────
function sendHtml(res, html, code = 200) {
  res.writeHead(code, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
  res.end(html);
}
function sendJson(res, obj, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(obj));
}
function notFound(res) {
  sendHtml(res, `<!doctype html><meta charset=utf-8><title>Not found</title>${STYLE}
    <div class="slide slide-brand"><div class="mark">404</div><div class="sub">That’s not part of the signage board. <a style="color:#58a6ff" href="/config">Configure a board →</a></div></div>`, 404);
}

// The request handler — exported so offline tests drive routes through a mock req/res (no port bound).
export async function handler(req, res) {
  try {
    const url = new URL(req.url, BASE_URL);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    const topic = url.searchParams.get('topic') || '';
    const types = url.searchParams.getAll('types');
    const rotate = url.searchParams.get('rotate');
    const state = url.searchParams.get('state') || 'TX';

    if (path === '/health') { res.writeHead(200, { 'content-type': 'text/plain' }); return res.end('ok'); }

    if (path === '/api/slides') {
      const deck = await buildDeck({ topic, types, state }); // already soft-failed to a safe default deck
      return sendJson(res, deck);
    }

    if (path === '/api/safety') {
      const board = await buildSafetyBoard({ state, city: url.searchParams.get('city') });
      return sendJson(res, board);
    }

    if (path === '/safety') {
      const board = await buildSafetyBoard({ state, city: url.searchParams.get('city') });
      const q = new URLSearchParams();
      if (state) q.set('state', state);
      const city = url.searchParams.get('city');
      if (city) q.set('city', city);
      return sendHtml(res, safetyBoardPage(board, { state, query: q.toString() }));
    }

    if (path === '/config') {
      return sendHtml(res, configPage({ topic, types, rotate: rotate == null ? 12 : rotate }));
    }

    if (path === '/' || path === '/signage') {
      const deck = await buildDeck({ topic, types, state });
      // Preserve the same query on the client's /api/slides refresh so the deck stays consistent.
      const q = new URLSearchParams();
      if (topic) q.set('topic', topic);
      const tsel = parseTypes(types);
      if (tsel.length) q.set('types', tsel.join(','));
      if (state && state !== 'TX') q.set('state', state);
      const rot = clampRotate(rotate == null ? 12 : rotate);
      if (rot) q.set('rotate', String(rot));
      return sendHtml(res, displayPage(deck, { rotateSec: rot, query: q.toString() }));
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
    console.log(`MELEK Signage (data.SoapBox TV) on ${BASE_URL} (bound ${HOST}:${PORT})`);
  });
}
