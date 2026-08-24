// hashtag-external.mjs — the EXTERNAL half of the MELEK hashtag tracker.
// Companion to integrations/tag-tracker.mjs (the INTERNAL chain-tag analytics). The operator wants the
// tracker "connected to outside hashtags, not just internal tags" — so this module reads external social
// platforms for a hashtag and normalizes them into ONE shape that can sit next to the internal tag board.
//
// HONEST SCOPE (see .local/RESEARCH_SOCIAL_ANALYTICS_HASHTAG_MERIT.md, HALF A §2): the only external
// hashtag data pullable cheaply AND within ToS is YouTube (free quota), Reddit (keyless public search),
// and X/Twitter (paid — disabled unless a token is set). Instagram + TikTok hashtag firehoses are
// effectively closed to third parties since 2020; scraping them violates ToS and the flat-cost-infra rule
// ([[infra-fixed-cost-not-usage-metered]]) — so they are represented as available:false with a reason,
// NEVER scraped.
//
//   import { trackHashtag, renderExternal, youtube, reddit } from './integrations/hashtag-external.mjs';
//   const r = await trackHashtag('melek');
//   res.end(renderExternal(r));
//
// READ-ONLY · env-keyed per source · SOFT-FAIL-NEVER-THROW · injectable fetch → offline tests.
//
//   node integrations/hashtag-external.mjs melek     # print an external summary (live; soft-fails to n/a)

const UA = 'MELEK-Bot/1.0 (+https://github.com/HinduTempleCoins/Bot)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);
// Scheme allowlist for hrefs. esc() escapes HTML chars but does NOT neutralize a `javascript:`/`data:`
// scheme in an href — and `top[].url` can come from an external API response (e.g. Reddit's `p.url`).
// Return the URL only when it is an absolute http(s) URL; anything else → '' (no href rendered).
const safeHref = (u) => (/^https?:\/\//i.test(String(u == null ? '' : u).trim()) ? String(u).trim() : '');
export const normTag = (t) => String(t || '').trim().toLowerCase().replace(/^#/, '').replace(/[^a-z0-9_]/g, '');

// One normalized row per source. Every reader returns exactly this shape (top may be []).
function row(source, hashtag, { available = false, count = 0, top = [], reason = null } = {}) {
  const r = { source, hashtag, available: !!available, count: num(count), top: Array.isArray(top) ? top : [] };
  if (reason) r.reason = String(reason);
  return r;
}

async function getJson(url, { headers = {}, timeout = 12000 } = {}) {
  const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json', ...headers }, signal: ctrl.signal });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; } finally { clearTimeout(t); }
}

// ── per-source readers ──────────────────────────────────────────────────────────────────────────────

/**
 * YouTube Data API v3 search.list by q=#tag. Env: YOUTUBE_API_KEY (free daily quota).
 * @returns normalized row. Soft-fails to available:false with a reason (no key / no result).
 */
export async function youtube(tag, { max = 5 } = {}) {
  const g = normTag(tag);
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) return row('youtube', g, { reason: 'no YOUTUBE_API_KEY' });
  const q = encodeURIComponent('#' + g);
  const url = `https://www.googleapis.com/youtube/v3/search?part=snippet&type=video&maxResults=${num(max, 5)}&q=${q}&key=${encodeURIComponent(key)}`;
  const d = await getJson(url);
  if (!d) return row('youtube', g, { reason: 'youtube unreachable' });
  if (d.error) return row('youtube', g, { reason: 'youtube api error' });
  const items = Array.isArray(d.items) ? d.items : [];
  const count = num(d.pageInfo && d.pageInfo.totalResults, items.length);
  const top = items.filter((it) => it && it.id && it.id.videoId).slice(0, num(max, 5)).map((it) => ({
    title: (it.snippet && it.snippet.title) || '(untitled)',
    url: `https://www.youtube.com/watch?v=${it.id.videoId}`,
    score: null,
  }));
  return row('youtube', g, { available: true, count, top });
}

/**
 * Reddit keyless public search (search.json). Env optional: REDDIT_SEARCH_URL to override the endpoint.
 * The "subreddit analogy" source. @returns normalized row; soft-fails to available:false with a reason.
 */
export async function reddit(tag, { max = 5 } = {}) {
  const g = normTag(tag);
  const base = process.env.REDDIT_SEARCH_URL || 'https://www.reddit.com/search.json';
  const url = `${base}?q=%23${encodeURIComponent(g)}&sort=top&limit=${num(max, 5) * 5}&t=week`;
  const d = await getJson(url);
  if (!d) return row('reddit', g, { reason: 'reddit unreachable' });
  const children = d.data && Array.isArray(d.data.children) ? d.data.children : [];
  if (!children.length) return row('reddit', g, { available: true, count: 0, top: [] });
  const top = children.slice(0, num(max, 5)).map((c) => {
    const p = (c && c.data) || {};
    return {
      title: p.title || '(untitled)',
      url: p.permalink ? `https://www.reddit.com${p.permalink}` : (p.url || ''),
      score: num(p.score),
    };
  });
  return row('reddit', g, { available: true, count: children.length, top });
}

/**
 * X/Twitter API v2 recent search/counts. Env: X_BEARER_TOKEN. PAID — stays disabled unless the token is set.
 * @returns normalized row; available:false with reason when unconfigured.
 */
export async function xtwitter(tag, { max = 5 } = {}) {
  const g = normTag(tag);
  const token = process.env.X_BEARER_TOKEN;
  if (!token) return row('xtwitter', g, { reason: 'paid API not configured' });
  const q = encodeURIComponent(`#${g}`);
  const url = `https://api.twitter.com/2/tweets/search/recent?query=${q}&max_results=${Math.max(10, num(max, 5))}&tweet.fields=public_metrics`;
  const d = await getJson(url, { headers: { authorization: `Bearer ${token}` } });
  if (!d) return row('xtwitter', g, { reason: 'x unreachable' });
  if (d.errors && !d.data) return row('xtwitter', g, { reason: 'x api error' });
  const items = Array.isArray(d.data) ? d.data : [];
  const count = num(d.meta && d.meta.result_count, items.length);
  const top = items.slice(0, num(max, 5)).map((it) => ({
    title: (it.text || '').slice(0, 140) || '(no text)',
    url: it.id ? `https://twitter.com/i/web/status/${it.id}` : '',
    score: num(it.public_metrics && it.public_metrics.like_count),
  }));
  return row('xtwitter', g, { available: true, count, top });
}

/** Instagram — no public hashtag API since 2020 (ToS). Documented, never scraped. */
export async function instagram(tag) {
  return row('instagram', normTag(tag), { reason: 'no public hashtag API (ToS)' });
}

/** TikTok — hashtag firehose is gated/closed to general devs (ToS). Documented, never scraped. */
export async function tiktok(tag) {
  return row('tiktok', normTag(tag), { reason: 'no public hashtag API (ToS)' });
}

// ── aggregate ───────────────────────────────────────────────────────────────────────────────────────

const READERS = { youtube, reddit, xtwitter, instagram, tiktok };
export const ALL_SOURCES = Object.keys(READERS);

/**
 * Track one hashtag across the enabled external sources, each soft-failing independently and in parallel.
 * @param {string} tag
 * @param {{sources?:string[]}} opts  which sources to run (default: all).
 * @returns {Promise<{hashtag,asOf,sources:row[],totalCount:number}>}
 */
export async function trackHashtag(tag, { sources } = {}) {
  const g = normTag(tag);
  const want = (Array.isArray(sources) && sources.length ? sources : ALL_SOURCES)
    .map((s) => String(s).toLowerCase()).filter((s) => READERS[s]);
  const list = want.length ? want : ALL_SOURCES;
  const rows = await Promise.all(list.map(async (s) => {
    try { return await READERS[s](g); }
    catch { return row(s, g, { reason: 'source failed' }); }
  }));
  const totalCount = rows.reduce((a, r) => a + (r.available ? num(r.count) : 0), 0);
  return { hashtag: g, asOf: new Date().toISOString(), sources: rows, totalCount };
}

// ── render ──────────────────────────────────────────────────────────────────────────────────────────

/** Escaped HTML summary block, built to sit beside the internal tag-tracker board. */
export function renderExternal(result) {
  if (!result || !Array.isArray(result.sources)) return `<div class="hx"><p>External hashtag tracker unavailable.</p></div>`;
  const tag = esc(result.hashtag);
  const items = result.sources.map((s) => {
    const name = esc(s.source);
    if (!s.available) return `<li class="hx-src hx-off"><strong>${name}</strong> — n/a <span class="hx-mut">(${esc(s.reason || 'unavailable')})</span></li>`;
    const links = (s.top || []).length
      ? `<ul class="hx-top">${s.top.map((p) => {
          const sc = p.score == null ? '' : ` · ${esc(p.score)}`;
          const su = safeHref(p.url);
          const href = su ? ` href="${esc(su)}"` : '';
          return `<li><a${href} rel="noopener noreferrer">${esc(p.title)}</a>${sc}</li>`;
        }).join('')}</ul>`
      : `<p class="hx-mut">No top results.</p>`;
    return `<li class="hx-src hx-on"><strong>${name}</strong> — ${esc(s.count)} results${links}</li>`;
  }).join('');
  return `<div class="hx">`
    + `<h2>#${tag} <span class="hx-mut">— external</span></h2>`
    + `<p class="hx-mut">${esc(result.totalCount)} total results across available sources.</p>`
    + `<ul class="hx-list">${items}</ul>`
    + `</div>`;
}

// ── CLI ─────────────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('hashtag-external.mjs')) {
  const tag = process.argv[2] || 'melek';
  const r = await trackHashtag(tag);
  console.log(`#${r.hashtag} — external sources (${r.totalCount} total results):`);
  for (const s of r.sources) {
    console.log(`  ${s.source.padEnd(10)} ${s.available ? `${s.count} results` : `n/a (${s.reason})`}`);
  }
  if (!process.env.YOUTUBE_API_KEY) console.log('(YOUTUBE_API_KEY unset — YouTube soft-fails.)');
  if (!process.env.X_BEARER_TOKEN) console.log('(X_BEARER_TOKEN unset — X/Twitter disabled, paid API.)');
}
