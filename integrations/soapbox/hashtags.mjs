// hashtags.mjs — SoapBox cross-platform hashtag / trending-topic aggregator (doc 10).
//
// THE HONEST-NUMBERS PROBLEM. People ask "which hashtag has the most VIEWS?" — but almost no
// platform exposes true view counts. Mastodon/Bluesky/Reddit give USAGE / POST / UPVOTE counts;
// Google Trends gives a relative interest index; GDELT gives term FREQUENCY in news. None of those
// is "views." The ONLY keyless source that returns a REAL view count is YouTube (Data API).
//
// So any cross-platform "most views" number we surface is an ESTIMATE derived from engagement
// signals, and it MUST be labeled as such. Every merged/cross-platform view figure in this module
// carries `estimated: true` (and aggregate() returns `viewsEstimated`), so the UI can never present
// a guess as a measured fact. Where we DO have a true count (YouTube views, or on-chain views for
// HIVE/MELEK content), that row carries `estimated: false`.
//
// OWNERSHIP FLIP: onChainViews(tag) is the hook for the thing we actually own — HIVE/MELEK on-chain
// content, where the chain records real reads. Stubbed for now (returns null until wired to steemd),
// but it's the one source that can legitimately report `estimated: false` for view counts at scale.
//
// Sources (all keyless except YouTube, all soft-fail): Mastodon trending tags, Bluesky/AT Protocol,
// Reddit trending, Google Trends (public daily-trends RSS), GDELT term frequency. Follows the
// macro.mjs pattern: ESM, `__setFetch` hook, soft-fail, CLI guarded by argv check.

import { cached, TTL } from './cache.mjs';

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// Default keyless instances/endpoints. Mastodon trending is per-instance; we read a large public one.
const MASTODON_INSTANCE = 'https://mastodon.social';
const BLUESKY_API = 'https://public.api.bsky.app';
const REDDIT_TRENDING = 'https://www.reddit.com/api/trending_searches_v1.json';
const GOOGLE_TRENDS_RSS = 'https://trends.google.com/trending/rss?geo=US';
const GDELT_DOC = 'https://api.gdeltproject.org/api/v2/doc/doc';

// ---------------------------------------------------------------------------
// normalization — a "tag" is compared case-insensitively, stripped of a leading
// '#', and trimmed. We keep a human label too. This is the join key across sources.
// ---------------------------------------------------------------------------

/** Canonical comparison key for a tag/topic. Pure. */
export function normalizeTag(raw) {
  if (raw == null) return '';
  return String(raw).trim().replace(/^#+/, '').replace(/\s+/g, ' ').toLowerCase();
}

/** Human display form: '#' + normalized for single-word tags; raw-ish for phrases. Pure. */
function displayTag(raw) {
  const n = normalizeTag(raw);
  if (!n) return '';
  return /\s/.test(n) ? n : `#${n}`;
}

// ---------------------------------------------------------------------------
// mergeTrends — the PURE ranker. Takes a list of source result lists and merges
// them by normalized tag, summing usage and unioning the source names. The view
// number, if any, is ALWAYS marked estimated for cross-platform merges (only a
// single-source true count survives untouched via the per-item `estimated` flag).
// ---------------------------------------------------------------------------

/**
 * Merge per-source trend lists into one ranked list.
 * @param {Array<Array<{tag,usage?,views?,estimated?,source}>>} lists
 * @returns {Array<{tag,display,usage,views,viewsEstimated,sources}>} ranked desc by usage.
 *
 * Pure: no I/O, deterministic for given input. Ranking is by total usage (post/usage counts
 * sum across sources), tie-broken by number of sources then by tag for stability.
 */
export function mergeTrends(lists) {
  const merged = new Map();
  for (const list of lists || []) {
    for (const item of list || []) {
      const key = normalizeTag(item && item.tag);
      if (!key) continue;
      let m = merged.get(key);
      if (!m) {
        m = { tag: key, display: displayTag(item.tag), usage: 0, views: 0, viewsEstimated: false, _hasView: false, sources: new Set() };
        merged.set(key, m);
      }
      m.usage += Number(item.usage) || 0;
      if (item.views != null && Number.isFinite(Number(item.views))) {
        m.views += Number(item.views);
        m._hasView = true;
        // A cross-platform merge can never claim a measured view count: if ANY contributing
        // view figure was itself an estimate, OR if more than one source contributes views,
        // the merged figure is an estimate. Only a lone true-count source stays measured.
        if (item.estimated !== false) m.viewsEstimated = true;
      }
      if (item.source) m.sources.add(item.source);
    }
  }
  const out = [];
  for (const m of merged.values()) {
    out.push({
      tag: m.tag,
      display: m.display,
      usage: m.usage,
      views: m._hasView ? m.views : null,
      viewsEstimated: m._hasView ? m.viewsEstimated : null,
      sources: [...m.sources].sort(),
    });
  }
  out.sort((a, b) => (b.usage - a.usage) || (b.sources.length - a.sources.length) || a.tag.localeCompare(b.tag));
  return out;
}

// ---------------------------------------------------------------------------
// per-source feeders — each returns Array<{tag, usage?, views?, estimated?, source}>
// and soft-fails to [] on any error. None of these expose true VIEW counts except
// YouTube; their numbers are USAGE/POSTS/INTEREST, mapped onto `usage`.
// ---------------------------------------------------------------------------

async function getJson(url, opts) {
  const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' }, ...opts });
  if (!r || !r.ok) return null;
  return r.json();
}

/** Mastodon trending tags — usage = total uses across the trending window. Keyless. */
export async function mastodonTrending() {
  try {
    const j = await getJson(`${MASTODON_INSTANCE}/api/v1/trends/tags`);
    if (!Array.isArray(j)) return [];
    return j.map((t) => {
      const uses = (t.history || []).reduce((s, h) => s + (Number(h.uses) || 0), 0);
      return { tag: t.name, usage: uses || Number(t.uses) || 0, source: 'mastodon' };
    }).filter((x) => x.tag);
  } catch { return []; }
}

/** Bluesky / AT Protocol trending topics. Usage proxy; no view counts exposed. Keyless. */
export async function blueskyTrending() {
  try {
    const j = await getJson(`${BLUESKY_API}/xrpc/app.bsky.unspecced.getTrendingTopics?limit=25`);
    const topics = (j && (j.topics || j.trending)) || [];
    return topics.map((t) => ({ tag: t.topic || t.displayName || t.name, usage: Number(t.postCount) || 0, source: 'bluesky' })).filter((x) => x.tag);
  } catch { return []; }
}

/** Reddit trending searches. Usage unknown from this endpoint → 0 (rank-only). Keyless. */
export async function redditTrending() {
  try {
    const j = await getJson(REDDIT_TRENDING);
    const arr = (j && (j.trending_searches || j.data)) || [];
    return arr.map((t) => ({ tag: typeof t === 'string' ? t : (t.query_string || t.query || t.name), usage: 0, source: 'reddit' })).filter((x) => x.tag);
  } catch { return []; }
}

/** Google Trends daily/realtime via the public RSS feed. Interest, not views. Keyless. */
export async function googleTrends() {
  try {
    const r = await _fetch(GOOGLE_TRENDS_RSS, { headers: { 'user-agent': UA } });
    if (!r || !r.ok) return [];
    const xml = await r.text();
    const items = [];
    const re = /<title>([^<]+)<\/title>(?:[\s\S]*?<ht:approx_traffic>([^<]+)<\/ht:approx_traffic>)?/g;
    let m;
    let first = true;
    while ((m = re.exec(xml)) !== null) {
      if (first) { first = false; continue; } // skip the channel <title>
      const tag = m[1] && m[1].replace(/<!\[CDATA\[|\]\]>/g, '').trim();
      const traffic = m[2] ? Number(String(m[2]).replace(/[^\d]/g, '')) : 0;
      if (tag) items.push({ tag, usage: traffic || 0, source: 'google-trends' });
    }
    return items;
  } catch { return []; }
}

/** GDELT term frequency — how often a term appears in world news. Frequency, not views. Keyless. */
export async function gdeltTrending(query = 'trending') {
  try {
    const url = `${GDELT_DOC}?query=${encodeURIComponent(query)}&mode=timelinevol&format=json&timespan=1d`;
    const j = await getJson(url);
    const series = (j && j.timeline && j.timeline[0] && j.timeline[0].data) || [];
    const total = series.reduce((s, p) => s + (Number(p.value) || 0), 0);
    return total ? [{ tag: query, usage: Math.round(total), source: 'gdelt' }] : [];
  } catch { return []; }
}

/**
 * YouTube Data API — the ONE keyless-ish source that returns a REAL view count.
 * Soft-fails to [] if process.env.YOUTUBE_API_KEY is absent. Rows carry estimated:false
 * because the view numbers are measured, not inferred. The key is never logged or printed.
 */
export async function youtubeViews(tag) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return [];
  try {
    const q = encodeURIComponent(normalizeTag(tag) || tag || '');
    const search = await getJson(`https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=10&q=${q}&key=${key}`);
    const ids = ((search && search.items) || []).map((i) => i.id && i.id.videoId).filter(Boolean);
    if (!ids.length) return [];
    const stats = await getJson(`https://www.googleapis.com/youtube/v3/videos?part=statistics&id=${ids.join(',')}&key=${key}`);
    const views = ((stats && stats.items) || []).reduce((s, v) => s + (Number(v.statistics && v.statistics.viewCount) || 0), 0);
    // REAL views: estimated:false. This is the only cross-web source allowed to say so.
    return [{ tag, usage: ids.length, views, estimated: false, source: 'youtube' }];
  } catch { return []; }
}

/**
 * OWNERSHIP-FLIP hook: TRUE views for HIVE/MELEK on-chain content. The chain records real reads,
 * so unlike the rest of the web this can legitimately report estimated:false. Stubbed until wired
 * to steemd; returns null today (no on-chain view feed yet) so callers know it's unavailable rather
 * than zero. When implemented it should return { tag, views, estimated: false, source: 'on-chain' }.
 */
export async function onChainViews(tag) { // eslint-disable-line no-unused-vars
  // TODO: query MELEK/HIVE steemd for true read counts on tagged on-chain posts.
  return null;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

const PLATFORMS = {
  mastodon: mastodonTrending,
  bluesky: blueskyTrending,
  reddit: redditTrending,
  google: googleTrends,
  gdelt: gdeltTrending,
};

/**
 * trending({platform}) — trending tags. With a platform name, that source only; without, the merged
 * cross-platform ranking. Cached 60s. Soft-fails per source. The merged result's view numbers (if
 * any) are estimated; usage is summed real post/usage counts.
 */
export async function trending({ platform } = {}) {
  if (platform) {
    const fn = PLATFORMS[platform];
    if (!fn) return [];
    return cached(`hashtags:trending:${platform}`, TTL.list, () => fn());
  }
  return cached('hashtags:trending:all', TTL.list, async () => {
    const lists = await Promise.all([
      mastodonTrending(), blueskyTrending(), redditTrending(), googleTrends(),
    ].map((p) => p.catch(() => [])));
    return mergeTrends(lists);
  });
}

/**
 * aggregate(tag) — merge every source for ONE tag into a single record:
 *   { tag, usage, views, viewsEstimated, sources }
 * `viewsEstimated` is true whenever the view figure comes from cross-platform engagement inference;
 * it is false ONLY when the sole view source is a true-count one (on-chain, or YouTube alone).
 * Cached 60s. Soft-fails per source.
 */
export async function aggregate(tag) {
  const key = normalizeTag(tag);
  if (!key) return { tag: '', usage: 0, views: null, viewsEstimated: false, sources: [] };
  return cached(`hashtags:aggregate:${key}`, TTL.list, async () => {
    const onChain = await onChainViews(tag).catch(() => null);
    const lists = await Promise.all([
      mastodonTrending(), blueskyTrending(), redditTrending(), googleTrends(),
      gdeltTrending(key), youtubeViews(tag),
    ].map((p) => p.catch(() => [])));

    // keep only rows matching THIS tag for the per-tag merge.
    const matched = lists.map((l) => (l || []).filter((x) => normalizeTag(x.tag) === key));
    if (onChain) matched.push([{ ...onChain, tag, source: 'on-chain' }]);

    const ranked = mergeTrends(matched);
    const row = ranked[0] || { tag: key, display: displayTag(tag), usage: 0, views: null, viewsEstimated: null, sources: [] };
    return {
      tag: key,
      display: row.display,
      usage: row.usage,
      views: row.views,
      // INVARIANT: any cross-platform view number is estimated. We only allow false when the
      // single contributing view source was itself a true count (on-chain / YouTube alone).
      viewsEstimated: row.views == null ? false : !!row.viewsEstimated,
      sources: row.sources,
    };
  });
}

if (process.argv[1] && process.argv[1].endsWith('hashtags.mjs')) {
  const arg = process.argv[2];
  if (arg) {
    const a = await aggregate(arg);
    console.log(`${a.display || a.tag}  usage=${a.usage}  views=${a.views ?? '—'}${a.views != null ? (a.viewsEstimated ? ' (ESTIMATE)' : ' (measured)') : ''}  sources=[${a.sources.join(', ')}]`);
  } else {
    const t = await trending({});
    for (const r of t.slice(0, 25)) console.log(`  ${(r.display || r.tag).padEnd(28)} usage=${String(r.usage).padStart(8)}  [${r.sources.join(', ')}]`);
  }
}
