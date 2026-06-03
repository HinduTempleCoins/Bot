// media.mjs — Radio + Podcasts layer for SoapBox (queue task #115). Keyless backbone so the public
// site always has something to play even with no API keys configured.
//
// RADIO: Radio Browser API (radio-browser.info) — free, no auth. The community-run mirror network is
// reached via a DNS round-robin (all.api.radio-browser.info → a list of live server hosts); we resolve
// that list and pick one, falling back to the well-known de1/at1/nl1 hosts. We search stations by
// name/country/tag, key results on the station UUID (stationuuid — the stable id; the legacy numeric
// `id` is mirror-local and must NOT be used), and support the click-counter POST
// (/json/url/<uuid>) which is how Radio Browser marks a station "popular" / hands back the resolved
// stream URL. We only ever RELAY the station's own stream.
//
// PODCASTS: Podcast Index (podcastindex.org) is the rich source but needs an API key + signed header,
// so it SOFT-FAILS to keyless Apple/iTunes Search when no key is present (or on any error).
//
// LICENSING NOTE: this is STATION-RELAY only — we hand the listener the broadcaster's own stream URL
// and they tune in; we ride the station's existing broadcast license, serve no audio ourselves, and
// store no audio. A track-on-demand "Pandora" that serves individual songs needs real music licensing
// (publishing + sound-recording / SoundExchange etc.) and is explicitly OUT OF SCOPE here.

import { cached, TTL } from './cache.mjs';

const UA = 'MELEK-Bot/1.0 (SoapBox; +https://data.soapbox.community)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Optional Podcast Index key/secret (soft-fail to Apple if absent). Never required, never logged.
const PI_KEY = process.env.PODCASTINDEX_KEY || '';
const PI_SECRET = process.env.PODCASTINDEX_SECRET || '';

// Well-known Radio Browser mirrors — used directly if the DNS server-list lookup fails.
const RB_FALLBACK_HOSTS = ['de1.api.radio-browser.info', 'at1.api.radio-browser.info', 'nl1.api.radio-browser.info'];

// ── Radio Browser server discovery (DNS pattern) ──────────────────────────────────────────────────
// The recommended pattern is to resolve the server list (the JSON mirror catalogue) and pick one, so
// load is spread and a dead mirror is avoided. Cached for an hour (server list is stable metadata).
async function rbHost() {
  return cached('media:rb:host', TTL.metadata, async () => {
    try {
      const r = await _fetch('https://all.api.radio-browser.info/json/servers', { headers: { 'user-agent': UA } });
      if (r.ok) {
        const list = await r.json();
        const hosts = (Array.isArray(list) ? list : []).map((s) => s && s.name).filter(Boolean);
        if (hosts.length) return hosts[Math.floor(Math.random() * hosts.length)];
      }
    } catch { /* fall through to a known-good mirror */ }
    return RB_FALLBACK_HOSTS[Math.floor(Math.random() * RB_FALLBACK_HOSTS.length)];
  });
}

async function rbGet(path) {
  try {
    const host = await rbHost();
    const r = await _fetch(`https://${host}${path}`, { headers: { 'user-agent': UA } });
    if (!r.ok) return null;
    return await r.json();
  } catch { return null; }
}

/** Normalize a raw Radio Browser station into the shape the site/ranker consume. PURE-ish (no I/O). */
export function normStation(s) {
  if (!s || !s.stationuuid) return null;
  return {
    uuid: s.stationuuid,                       // the stable id — keyed on this, never the legacy `id`
    name: (s.name || '').trim(),
    url: s.url_resolved || s.url || '',        // the stream the listener tunes in to (relay only)
    homepage: s.homepage || '',
    favicon: s.favicon || '',
    country: s.country || '',
    countryCode: s.countrycode || '',
    tags: (s.tags || '').split(',').map((t) => t.trim()).filter(Boolean),
    language: s.language || '',
    codec: s.codec || '',
    bitrate: Number(s.bitrate) || 0,
    votes: Number(s.votes) || 0,               // popularity signal
    clickCount: Number(s.clickcount) || 0,     // popularity signal
    clickTrend: Number(s.clicktrend) || 0,
    lastCheckOk: s.lastcheckok === 1 || s.lastcheckok === '1' || s.lastcheckok === true,
    lastChangeIso: s.lastchangetime_iso8601 || s.lastchangetime || '',
  };
}

/**
 * Search stations by any of { country, tag, name }. Keyless. Returns normalized, online stations.
 * Cached per-query for the list TTL. Soft-fails to [] (never throws).
 */
export async function stations({ country = '', tag = '', name = '', limit = 30 } = {}) {
  const key = `media:stations:${country}|${tag}|${name}|${limit}`;
  return cached(key, TTL.list, async () => {
    const p = new URLSearchParams({ hidebroken: 'true', order: 'clickcount', reverse: 'true', limit: String(limit) });
    if (country) p.set('country', country);
    if (tag) p.set('tag', tag);
    if (name) p.set('name', name);
    const raw = await rbGet(`/json/stations/search?${p.toString()}`);
    return (Array.isArray(raw) ? raw : []).map(normStation).filter(Boolean);
  });
}

/** The most-clicked stations overall — the homepage "what's playing" rail. Keyless, cached. */
export async function topStations({ limit = 20 } = {}) {
  return cached(`media:topstations:${limit}`, TTL.list, async () => {
    const raw = await rbGet(`/json/stations/topclick/${limit}`);
    return (Array.isArray(raw) ? raw : []).map(normStation).filter(Boolean);
  });
}

/**
 * Mark a station popular + resolve its current stream URL via the Radio Browser click endpoint (POST).
 * This is the documented way to (a) bump the station's click counter and (b) get back the resolved
 * stream URL. Soft-fails to null. Call this when a listener actually presses play.
 */
export async function clickStation(uuid) {
  if (!uuid) return null;
  try {
    const host = await rbHost();
    const r = await _fetch(`https://${host}/json/url/${encodeURIComponent(uuid)}`, {
      method: 'POST',
      headers: { 'user-agent': UA },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return { ok: j && j.ok !== false, url: (j && j.url) || '', name: (j && j.name) || '' };
  } catch { return null; }
}

// ── Podcasts ──────────────────────────────────────────────────────────────────────────────────────

/** Normalize an Apple/iTunes Search podcast result into the shared podcast shape. PURE (no I/O). */
export function normApplePodcast(r) {
  if (!r) return null;
  return {
    id: String(r.collectionId || r.trackId || ''),
    title: r.collectionName || r.trackName || '',
    author: r.artistName || '',
    feedUrl: r.feedUrl || '',
    image: r.artworkUrl600 || r.artworkUrl100 || r.artworkUrl60 || '',
    genres: Array.isArray(r.genres) ? r.genres : (r.primaryGenreName ? [r.primaryGenreName] : []),
    episodeCount: Number(r.trackCount) || 0,
    releaseDate: r.releaseDate || '',          // ISO; used as freshness signal
    source: 'apple',
  };
}

/** Normalize a Podcast Index feed object into the shared podcast shape. PURE (no I/O). */
export function normPiPodcast(f) {
  if (!f) return null;
  return {
    id: String(f.id || ''),
    title: f.title || '',
    author: f.author || f.ownerName || '',
    feedUrl: f.url || '',
    image: f.artwork || f.image || '',
    genres: f.categories ? Object.values(f.categories) : [],
    episodeCount: Number(f.episodeCount) || 0,
    releaseDate: f.newestItemPubdate ? new Date(f.newestItemPubdate * 1000).toISOString() : '',
    source: 'podcastindex',
  };
}

async function applePodcastSearch(q, limit) {
  const p = new URLSearchParams({ term: q, media: 'podcast', entity: 'podcast', limit: String(limit) });
  try {
    const r = await _fetch(`https://itunes.apple.com/search?${p.toString()}`, { headers: { 'user-agent': UA } });
    if (!r.ok) return [];
    const j = await r.json();
    return (j && Array.isArray(j.results) ? j.results : []).map(normApplePodcast).filter(Boolean);
  } catch { return []; }
}

// Podcast Index requires a sha1(key + secret + unixtime) auth header. Soft-fail to [] on any hiccup.
async function piPodcastSearch(q, limit) {
  if (!PI_KEY || !PI_SECRET) return null;   // no key → caller falls back to Apple
  try {
    const { createHash } = await import('node:crypto');
    const ts = Math.floor(Date.now() / 1000);
    const auth = createHash('sha1').update(PI_KEY + PI_SECRET + ts).digest('hex');
    const r = await _fetch(`https://api.podcastindex.org/api/1.0/search/byterm?q=${encodeURIComponent(q)}&max=${limit}`, {
      headers: { 'user-agent': UA, 'X-Auth-Key': PI_KEY, 'X-Auth-Date': String(ts), Authorization: auth },
    });
    if (!r.ok) return null;
    const j = await r.json();
    return (j && Array.isArray(j.feeds) ? j.feeds : []).map(normPiPodcast).filter(Boolean);
  } catch { return null; }
}

/**
 * Search podcasts by query. Prefers Podcast Index (richer) when a key is set; soft-fails to the
 * keyless Apple/iTunes Search API otherwise (or on any error/empty). Never throws. Cached.
 */
export async function podcastSearch(q, { limit = 20 } = {}) {
  const term = (q || '').trim();
  if (!term) return [];
  return cached(`media:podcast:${term}|${limit}`, TTL.metadata, async () => {
    const pi = await piPodcastSearch(term, limit);
    if (pi && pi.length) return pi;
    return applePodcastSearch(term, limit);
  });
}

// ── Ranker (PURE) ───────────────────────────────────────────────────────────────────────────────
// recommend(): freshness + popularity blend, normalized 0..1. Works on either media shape:
//   stations have votes/clickCount/clickTrend + lastChangeIso; podcasts have episodeCount + releaseDate.
// Pure function — no network, no clock dependency beyond an injectable `now` for deterministic tests.
const HALF_LIFE_DAYS = 90;  // freshness decays to 0.5 after a quarter-year since last activity

export function freshnessScore(item, now = Date.now()) {
  const iso = item && (item.lastChangeIso || item.releaseDate);
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 0;
  const days = Math.max(0, (now - t) / 86_400_000);
  return Math.pow(0.5, days / HALF_LIFE_DAYS);   // 1 today → 0.5 at one half-life → →0
}

export function popularityScore(item) {
  if (!item) return 0;
  // log-compress raw counts so a megastation doesn't swamp the list; blend the available signals.
  const log = (n) => Math.log10(Math.max(0, Number(n) || 0) + 1);
  if (item.uuid) {                               // station
    const pop = 0.6 * log(item.clickCount) + 0.4 * log(item.votes);
    const trendBoost = (Number(item.clickTrend) || 0) > 0 ? 0.1 : 0;
    return Math.min(1, pop / 5 + trendBoost);    // ~10^5 clicks saturates
  }
  return Math.min(1, log(item.episodeCount) / 3); // podcast: ~1000 episodes saturates
}

/**
 * Rank media items by a freshness+popularity blend (default 40/60 popularity-weighted). Returns a new
 * array (does not mutate input), each item carrying a `_score`. Pure; pass `now` for deterministic tests.
 */
export function recommend(items, { now = Date.now(), wFresh = 0.4, wPop = 0.6, limit = Infinity } = {}) {
  const scored = (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((it) => ({ ...it, _score: wFresh * freshnessScore(it, now) + wPop * popularityScore(it) }))
    .sort((a, b) => b._score - a._score);
  return Number.isFinite(limit) ? scored.slice(0, limit) : scored;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('media.mjs')) {
  const top = await topStations({ limit: 10 });
  console.log('\nTop stations (by clicks):');
  for (const s of recommend(top, { limit: 10 })) {
    console.log(`  ${s.name.padEnd(34).slice(0, 34)} ${String(s.bitrate).padStart(4)}k  ${s.country.padEnd(16)} score=${s._score.toFixed(3)}`);
  }
  const pods = await podcastSearch('history');
  console.log(`\nPodcasts for "history": ${pods.length} found`);
  for (const p of recommend(pods, { limit: 5 })) console.log(`  ${p.title}  — ${p.author} (${p.source})`);
}
