// cams.mjs — the SoapBox live-cams watch layer (queue task #114). Most nature/news cams stream on
// YouTube Live. We ship a curated static list of known cam networks as link-outs to the channel's
// /live (always resolves to its current live video; no key, never a stale/broken embed) — exactly the
// LIVE_STREAMS pattern from news.mjs. Optional enrichment: if process.env.YOUTUBE_API_KEY is set we can
// query the YouTube Data API for live-status, but it ALWAYS soft-fails to "unknown" without the key or
// on any error — the curated link-outs stand on their own.
//
//   import { CAMS, liveStatus, rankCams, camsSummary } from './cams.mjs'
//   node integrations/soapbox/cams.mjs

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const UA = { 'User-Agent': 'SoapBoxData/1.0 (+https://data.soapbox.community)' };

// Curated cam networks — name + the channel handle. `popularity` is a coarse static prior (0–100) used
// by the ranker as a tiebreaker when live-status is unknown/equal; it is NOT a live subscriber count.
// `channelId` (UC…) is the canonical channel id the YouTube Data API needs; left null where we only
// carry the handle (liveStatus is key-gated + soft-fails to unknown either way).
const RAW_CAMS = [
  { name: 'Explore.org', handle: 'exploreorg', channelId: 'UCv5Sp1dQ_VzN-bbcAFFsk2A', topic: 'nature', popularity: 95 },
  { name: 'WildEarth', handle: 'WildEarth', channelId: 'UCdHQTtcd4j0xL6jvkXfBmYg', topic: 'safari', popularity: 80 },
  { name: 'Africam', handle: 'africam', channelId: null, topic: 'safari', popularity: 70 },
  { name: 'Cornell Lab Bird Cams', handle: 'CornellLabBirdCams', channelId: 'UCcb0_VC0HXFhBZHIqHQfp6w', topic: 'birds', popularity: 75 },
  { name: 'Monterey Bay Aquarium', handle: 'montereybayaquarium', channelId: 'UCsrJ2ygGTl0Ph9k5DI4wzg', topic: 'ocean', popularity: 78 },
  { name: 'National Park Service', handle: 'nationalparkservice', channelId: null, topic: 'parks', popularity: 60 },
  { name: 'NOAA', handle: 'usnoaagov', channelId: null, topic: 'ocean', popularity: 55 },
];

// link-out shape: {name, channelHandle, channelId, topic, popularity, url:`.../@<handle>/live`}.
// The /live URL is always valid (resolves to the channel's current live video or its live tab).
export const CAMS = RAW_CAMS.map((c) => ({
  name: c.name,
  channelHandle: c.handle,
  channelId: c.channelId,
  topic: c.topic,
  popularity: c.popularity,
  url: `https://www.youtube.com/@${c.handle}/live`,
}));

/**
 * Live-status for a channel via the YouTube Data API search endpoint (eventType=live). KEY-GATED:
 * returns { live: null } (unknown) immediately if YOUTUBE_API_KEY is unset, and on ANY error/non-OK —
 * never throws. On success returns { live: boolean, videoId, title } for the current live broadcast.
 * The key is read from env and only ever sent to googleapis.com; it is never logged or returned.
 */
export async function liveStatus(channelId) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key || !channelId) return { live: null };
  try {
    const u = `https://www.googleapis.com/youtube/v3/search?part=snippet&channelId=${encodeURIComponent(channelId)}&eventType=live&type=video&maxResults=1&key=${encodeURIComponent(key)}`;
    const r = await _fetch(u, { headers: UA });
    if (!r || !r.ok) return { live: null };
    const j = await r.json();
    const item = (j.items || [])[0];
    if (!item) return { live: false };
    return { live: true, videoId: item.id?.videoId || null, title: item.snippet?.title || '' };
  } catch { return { live: null }; }
}

/**
 * PURE ranker (no network). Orders cams by: live-now first (live === true), then unknown live (null),
 * then known-offline (false); within each band by popularity desc, then name asc. Accepts cams that may
 * carry an optional `live` field (e.g. from a prior liveStatus enrichment). Returns a new sorted array.
 */
export function rankCams(list = CAMS) {
  const band = (c) => (c && c.live === true ? 0 : c && c.live === false ? 2 : 1);
  return [...list].sort((a, b) => {
    const db = band(a) - band(b);
    if (db) return db;
    const dp = (b.popularity || 0) - (a.popularity || 0);
    if (dp) return dp;
    return String(a.name).localeCompare(String(b.name));
  });
}

/** Homepage chip: how many cam networks we link, how many have a known UC channelId (API-enrichable). */
export function camsSummary() {
  return {
    total: CAMS.length,
    enrichable: CAMS.filter((c) => c.channelId).length,
    apiKey: Boolean(process.env.YOUTUBE_API_KEY),
    topics: [...new Set(CAMS.map((c) => c.topic))],
  };
}

if (process.argv[1] && process.argv[1].endsWith('cams.mjs')) {
  // Best-effort enrich (soft-fails to unknown without a key), then rank + print.
  const enriched = await Promise.all(CAMS.map(async (c) => ({ ...c, ...(await liveStatus(c.channelId)) })));
  console.log('\n== SoapBox Live Cams ==');
  for (const c of rankCams(enriched)) {
    const dot = c.live === true ? '🔴 LIVE' : c.live === false ? '⚫ off ' : '⚪ ?   ';
    console.log(`  ${dot}  ${c.name.padEnd(26)} ${c.url}`);
  }
  const s = camsSummary();
  console.log(`\n${s.total} cams · ${s.enrichable} API-enrichable · key ${s.apiKey ? 'set' : 'unset'}`);
}
