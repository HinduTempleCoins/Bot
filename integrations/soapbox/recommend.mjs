// recommend.mjs — ONE Clarity-style recommendation ranker across cams / podcasts / radio (queue #115).
//
// PURE module, NO network. It unifies the scoring ideas already living in cams.mjs (rankCams: a live /
// popularity ordering) and media.mjs (recommend: a freshness + popularity blend) into a single
// cross-kind ranker, so the homepage can produce one merged "recommended now" rail across live cams,
// podcasts, and radio stations.
//
// The score is a blend of three signals, each normalized to 0..1:
//   • freshness   — recency with an exponential half-life (recent activity scores higher)
//   • engagement  — clicks / watch-time / votes / episode-count, log-compressed so a megastation
//                   doesn't swamp the list
//   • reliability — a COMPUTED source-quality prior (curated popularity, last-check-ok, etc.) — this is
//                   earned/observed, never bought.
//
// The blended 0..1 score is exposed as a normalized 0..100 `score`, plus the raw `_score` (0..1) and a
// `kind` tag. Everything is deterministic: pass `now` for repeatable tests.
//
//   import { scoreItem, rank, recommend } from './recommend.mjs'
//   node integrations/soapbox/recommend.mjs

// ── tunables ────────────────────────────────────────────────────────────────────────────────────
const HALF_LIFE_DAYS = 90;            // freshness decays to 0.5 after a quarter-year since activity
const DEFAULT_WEIGHTS = Object.freeze({ freshness: 0.35, engagement: 0.45, reliability: 0.20 });

const log10p = (n) => Math.log10(Math.max(0, Number(n) || 0) + 1);
const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/** Infer an item's media kind from its shape if it doesn't already carry a `kind` tag. PURE. */
export function kindOf(item) {
  if (!item) return 'unknown';
  if (item.kind) return item.kind;
  if (item.channelHandle || item.channelId) return 'cam';
  if (item.uuid) return 'radio';
  if (item.feedUrl || item.episodeCount != null) return 'podcast';
  return 'unknown';
}

// ── per-signal scores (each 0..1) ─────────────────────────────────────────────────────────────────

/**
 * Freshness via exponential half-life on the most recent activity timestamp we can find across the
 * three shapes. Returns 1 for "just now", 0.5 at one half-life, →0 as it ages; 0 if no usable date.
 */
export function freshnessScore(item, now = Date.now()) {
  if (!item) return 0;
  const iso = item.lastChangeIso || item.releaseDate || item.publishedAt || item.startedAt || '';
  const t = iso ? Date.parse(iso) : NaN;
  if (!Number.isFinite(t)) return 0;
  const days = Math.max(0, (now - t) / 86_400_000);
  return clamp01(Math.pow(0.5, days / HALF_LIFE_DAYS));
}

/**
 * Engagement: clicks / watch-time / votes / episode-count, log-compressed and normalized 0..1 per kind
 * so the scales are comparable across cams, radio, and podcasts. A live cam gets a strong floor.
 */
export function engagementScore(item) {
  if (!item) return 0;
  const k = kindOf(item);
  if (k === 'radio') {
    const pop = 0.6 * log10p(item.clickCount) + 0.4 * log10p(item.votes);
    const trend = (Number(item.clickTrend) || 0) > 0 ? 0.1 : 0;
    return clamp01(pop / 5 + trend);            // ~10^5 clicks saturates
  }
  if (k === 'podcast') {
    // episode count is the keyless engagement proxy; watchTime/plays used if present.
    const eps = log10p(item.episodeCount) / 3;  // ~1000 episodes saturates
    const plays = item.plays != null ? log10p(item.plays) / 6 : 0;
    return clamp01(Math.max(eps, plays));
  }
  if (k === 'cam') {
    // cams rarely carry counts; use watchTime/viewers if present, and floor live streams high.
    const wt = item.watchTime != null ? log10p(item.watchTime) / 6 : 0;
    const viewers = item.viewers != null ? log10p(item.viewers) / 5 : 0;
    const liveFloor = item.live === true ? 0.6 : 0;
    const base = (Number(item.popularity) || 0) / 100; // curated prior, lightly used as engagement
    return clamp01(Math.max(wt, viewers, liveFloor, base * 0.5));
  }
  // unknown shape: best-effort across any generic counters.
  const generic = Math.max(
    log10p(item.clickCount) / 5,
    log10p(item.plays) / 6,
    log10p(item.watchTime) / 6,
  );
  return clamp01(generic);
}

/**
 * Reliability: a COMPUTED source-quality prior, never purchased. Blends the curated popularity prior,
 * a working/online signal, and (for radio) bitrate quality. Defaults to a neutral 0.5 when unknown.
 */
export function reliabilityScore(item) {
  if (!item) return 0;
  const k = kindOf(item);
  const parts = [];
  if (item.popularity != null) parts.push(clamp01((Number(item.popularity) || 0) / 100));
  if (k === 'radio') {
    parts.push(item.lastCheckOk ? 1 : 0.2);                // dead/broken stations are unreliable
    if (item.bitrate != null) parts.push(clamp01((Number(item.bitrate) || 0) / 256)); // 256k = top
  }
  if (k === 'cam') {
    if (item.live === false) parts.push(0.3);              // known-offline is less reliable to surface
    if (item.channelId) parts.push(0.7);                  // API-verifiable channel
  }
  if (k === 'podcast' && item.feedUrl) parts.push(0.7);   // resolvable feed
  if (!parts.length) return 0.5;                          // neutral prior when we know nothing
  return clamp01(parts.reduce((a, b) => a + b, 0) / parts.length);
}

// ── blend ──────────────────────────────────────────────────────────────────────────────────────

/** Normalize+fill a weights object, defaulting missing keys and renormalizing so they sum to 1. */
function normWeights(weights) {
  const w = { ...DEFAULT_WEIGHTS, ...(weights || {}) };
  const sum = (Number(w.freshness) || 0) + (Number(w.engagement) || 0) + (Number(w.reliability) || 0);
  if (sum <= 0) return { ...DEFAULT_WEIGHTS };
  return { freshness: w.freshness / sum, engagement: w.engagement / sum, reliability: w.reliability / sum };
}

/**
 * Score a single item. Returns a NEW object (input not mutated) carrying:
 *   kind, parts:{freshness,engagement,reliability}, _score (0..1), score (0..100, rounded).
 * Pure; pass `now` for deterministic tests. `weights` overrides default blend (auto-renormalized).
 */
export function scoreItem(item, weights, now = Date.now()) {
  const w = normWeights(weights);
  const parts = {
    freshness: freshnessScore(item, now),
    engagement: engagementScore(item),
    reliability: reliabilityScore(item),
  };
  const raw = clamp01(w.freshness * parts.freshness + w.engagement * parts.engagement + w.reliability * parts.reliability);
  return {
    ...item,
    kind: kindOf(item),
    parts,
    _score: raw,
    score: Math.round(raw * 100),
  };
}

/**
 * Rank a flat list of items by blended score, desc. Returns a new sorted array of scored items (input
 * untouched). Stable tiebreak: higher engagement, then name asc. Pure.
 *   opts: { weights, now, limit }
 */
export function rank(items, { weights, now = Date.now(), limit = Infinity } = {}) {
  const scored = (Array.isArray(items) ? items : [])
    .filter(Boolean)
    .map((it) => scoreItem(it, weights, now));
  scored.sort((a, b) => {
    if (b._score !== a._score) return b._score - a._score;
    if (b.parts.engagement !== a.parts.engagement) return b.parts.engagement - a.parts.engagement;
    return String(a.name || '').localeCompare(String(b.name || ''));
  });
  return Number.isFinite(limit) ? scored.slice(0, limit) : scored;
}

/**
 * The unified cross-kind recommender. Takes { cams:[], podcasts:[], radio:[] }, tags each item with its
 * `kind`, and returns ONE merged ranked list (normalized 0..100 score). Missing kinds are fine. Pure.
 *   opts: { weights, now, limit }
 */
export function recommend(itemsByKind = {}, opts = {}) {
  const tag = (arr, kind) => (Array.isArray(arr) ? arr : []).filter(Boolean).map((it) => ({ ...it, kind: it.kind || kind }));
  const merged = [
    ...tag(itemsByKind.cams, 'cam'),
    ...tag(itemsByKind.podcasts, 'podcast'),
    ...tag(itemsByKind.radio, 'radio'),
  ];
  return rank(merged, opts);
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('recommend.mjs')) {
  // Tiny illustrative sample (no network) showing a cross-kind merged ranking.
  const now = Date.now();
  const day = 86_400_000;
  const sample = {
    cams: [
      { name: 'Explore.org Bear Cam', channelHandle: 'exploreorg', channelId: 'UCx', topic: 'nature', popularity: 95, live: true, watchTime: 50000 },
      { name: 'Quiet Park Cam', channelHandle: 'parkcam', topic: 'parks', popularity: 60, live: false },
    ],
    podcasts: [
      { title: 'Daily History', feedUrl: 'https://x/feed', episodeCount: 1200, releaseDate: new Date(now - 1 * day).toISOString() },
      { title: 'Dormant Show', feedUrl: 'https://y/feed', episodeCount: 30, releaseDate: new Date(now - 400 * day).toISOString() },
    ],
    radio: [
      { uuid: 'r1', name: 'Top 40 FM', clickCount: 120000, votes: 4000, bitrate: 256, lastCheckOk: true, lastChangeIso: new Date(now - 2 * day).toISOString() },
      { uuid: 'r2', name: 'Static Station', clickCount: 5, votes: 0, bitrate: 64, lastCheckOk: false, lastChangeIso: new Date(now - 200 * day).toISOString() },
    ],
  };
  console.log('\n== SoapBox unified recommendations ==');
  for (const it of recommend(sample, { now, limit: 10 })) {
    const label = it.name || it.title || '(untitled)';
    console.log(`  ${String(it.score).padStart(3)}  [${it.kind.padEnd(7)}]  ${label}`);
  }
}
