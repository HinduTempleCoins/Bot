// podcasts.mjs — the SoapBox/Pentecaust PODCASTS reader (media layer, audio sibling of radio.mjs).
// Per Entertainment/Resource Center §7: "Radio/Podcast sibling verticals, same engine." Podcasts are
// meant to be played from their OWN RSS-hosted audio files, so this is strictly WINDOW / POINT: we
// surface a show's metadata + the episode's own enclosure audio URL + a link to the show's feed, and we
// NEVER rehost or re-encode the audio (the show's RSS host serves it; we point the player at it).
//
// Primary source: the iTunes / Apple Search API (https://itunes.apple.com — KEYLESS). The open, no-key
// catalog that every podcast app builds on. `search` finds shows; `lookup` fetches one by id. Episodes
// are then read from each show's OWN feedUrl (its public RSS) and parsed dependency-free.
//
// Pattern matches radio.mjs: ESM, zero deps, __setFetch hook, keyless, graceful soft-fail (any
// network/parse problem → [] / shaped empty, NEVER throws). Posture is POINT (license-router): the audio
// is the show's own; we link/point, we never host.
//
//   import { searchPodcasts, topPodcasts, episodes, renderList, dataNote, __setFetch } from './podcasts.mjs'
//   node integrations/soapbox/podcasts.mjs "history"     # keyless iTunes podcast search

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// iTunes / Apple Search API base (keyless). Override with ITUNES_BASE.
export const ITUNES_BASE = (process.env.ITUNES_BASE || 'https://itunes.apple.com').replace(/\/$/, '');

// Optional PodcastIndex seam — a documented no-op unless credentials are set. Keyless iTunes is the
// default path; this hook exists so a future keyed source can be wired without changing callers.
let _podcastIndex = null;
export function __setPodcastIndex(creds) {
  _podcastIndex = (creds && creds.key && creds.secret) ? { key: creds.key, secret: creds.secret } : null;
}
export function hasPodcastIndex() { return !!_podcastIndex; }

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Normalize an iTunes podcast result → our shaped show. Requires an id + a title. */
export function toShow(r = {}) {
  const id = r.collectionId != null ? r.collectionId : (r.trackId != null ? r.trackId : null);
  const title = r.collectionName || r.trackName || '';
  if (id == null || !title) return null;
  return {
    id: String(id),
    title: String(title).trim(),
    author: r.artistName || '',
    feedUrl: r.feedUrl || '',                    // the show's OWN RSS feed (we POINT here for episodes)
    artwork: r.artworkUrl600 || r.artworkUrl100 || r.artworkUrl60 || '',
    genre: r.primaryGenreName || '',
    episodeCount: Number(r.trackCount) || 0,
    homepage: r.collectionViewUrl || r.trackViewUrl || '',
    posture: 'point',                            // license-router: point-to-source, never rehost
  };
}

async function getJson(url) {
  try {
    const res = await _fetch(url, { headers: { 'user-agent': 'SoapBox-Podcasts/1.0', accept: 'application/json' } });
    if (!res || !res.ok) return null;
    return await res.json();
  } catch { return null; }
}

/** Search podcasts. {term, limit}. Soft-fail → []. */
export async function searchPodcasts({ term = '', limit = 40 } = {}) {
  if (!term) return [];
  const p = new URLSearchParams();
  p.set('media', 'podcast');
  p.set('entity', 'podcast');
  p.set('term', String(term));
  p.set('limit', String(Math.max(1, Math.min(200, +limit || 40))));
  const j = await getJson(`${ITUNES_BASE}/search?${p.toString()}`);
  const results = j && Array.isArray(j.results) ? j.results : [];
  const seen = new Set();
  const out = [];
  for (const s of results.map(toShow)) {
    if (!s || seen.has(s.id)) continue;
    seen.add(s.id);
    out.push(s);
  }
  return out;
}

/** Look up one show (and its feedUrl) by iTunes collection id. Soft-fail → null. */
export async function lookupPodcast(id) {
  if (id == null || id === '') return null;
  const j = await getJson(`${ITUNES_BASE}/lookup?id=${encodeURIComponent(String(id))}`);
  const results = j && Array.isArray(j.results) ? j.results : [];
  for (const r of results) {
    const s = toShow(r);
    if (s) return s;
  }
  return null;
}

/** Top / browse by genre — a simple keyless convenience search (term = genre). Soft-fail → []. */
export async function topPodcasts({ genre = '', limit = 40 } = {}) {
  return searchPodcasts({ term: genre || 'podcasts', limit });
}

// ── RSS episode parse (dependency-free) ──────────────────────────────────────────────────────────────
// Minimal, string/regex parse of a show's OWN feed. We only read metadata + the episode's enclosure
// audio URL (the show's host serves it — POINT posture). No xml lib, soft-fail → [].

function tagText(block, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const m = block.match(re);
  if (!m) return '';
  return stripCdata(m[1]).trim();
}

function stripCdata(s) {
  return String(s == null ? '' : s).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1');
}

/** "HH:MM:SS" | "MM:SS" | "3600" → seconds. Bad/empty → 0. */
export function parseDuration(raw) {
  const s = String(raw == null ? '' : raw).trim();
  if (!s) return 0;
  if (/^\d+$/.test(s)) return Number(s);
  const parts = s.split(':').map((n) => Number(n));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

/** Parse RSS XML text → shaped episodes. POINT posture on each. Pure; soft-fail → []. */
export function parseEpisodes(xml, limit = 20) {
  const text = String(xml == null ? '' : xml);
  if (!text) return [];
  const n = Math.max(1, Math.min(200, +limit || 20));
  const items = text.match(/<item[\s\S]*?<\/item>/gi) || [];
  const seen = new Set();
  const out = [];
  for (const block of items) {
    // enclosure url="…" — the episode's OWN audio file. Required; no enclosure → skip (we can't POINT).
    const encMatch = block.match(/<enclosure\b[^>]*\burl\s*=\s*["']([^"']+)["'][^>]*>/i);
    const audioUrl = encMatch ? encMatch[1].trim() : '';
    if (!audioUrl || seen.has(audioUrl)) continue;
    seen.add(audioUrl);
    const durRaw = tagText(block, 'itunes:duration') || tagText(block, 'duration');
    out.push({
      title: tagText(block, 'title') || 'Untitled episode',
      audioUrl,                                   // the show's own enclosure (we POINT here, never host)
      pubDate: tagText(block, 'pubDate'),
      durationSec: parseDuration(durRaw),
      desc: (tagText(block, 'description') || tagText(block, 'itunes:summary') || '').slice(0, 600),
      posture: 'point',
    });
    if (out.length >= n) break;
  }
  return out;
}

/** Fetch a show's OWN RSS feed and parse its latest episodes. Soft-fail → []. */
export async function episodes(feedUrl, limit = 20) {
  if (!feedUrl) return [];
  try {
    const res = await _fetch(feedUrl, { headers: { 'user-agent': 'SoapBox-Podcasts/1.0', accept: 'application/rss+xml, application/xml, text/xml' } });
    if (!res || !res.ok) return [];
    const xml = await res.text();
    return parseEpisodes(xml, limit);
  } catch { return []; }
}

/** A tiny HTML show list (esc'd) — a "Listen" affordance carries the show's feedUrl (POINT posture). */
export function renderList(shows = []) {
  const list = Array.isArray(shows) ? shows : [];
  if (!list.length) return '<p class=empty>No podcasts right now — try another search.</p>';
  return list.map((s) => `<div class=podcast data-feed="${esc(s.feedUrl)}">
    <span class=pname>${esc(s.title)}</span>
    <span class=pmeta>${esc(s.author)}${s.genre ? ' · ' + esc(s.genre) : ''}${s.episodeCount ? ' · ' + esc(s.episodeCount) + ' eps' : ''}</span>
    <button class=listen data-feed="${esc(s.feedUrl)}" data-title="${esc(s.title)}">▶ Listen</button>
  </div>`).join('');
}

export function dataNote() {
  return 'Podcast metadata via Apple/iTunes (keyless). We point to each show’s own feed and episode audio (its RSS enclosure) — we never rehost or re-encode the audio.';
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('podcasts.mjs')) {
  const term = process.argv.slice(2).join(' ').trim();
  const shows = await searchPodcasts({ term, limit: 15 });
  console.log(`SoapBox Podcasts — "${term || '(browse)'}" — ${shows.length} show(s)`);
  console.log('─'.repeat(60));
  for (const s of shows) console.log(`  ${(s.title || 'Untitled').slice(0, 40).padEnd(42)} ${s.genre || '----'}  ${s.episodeCount ? '[' + s.episodeCount + ' eps]' : ''}  (${s.author})`);
  console.log(`  ${dataNote()}`);
}
