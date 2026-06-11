// cheetah-results-feed.mjs — read-only adapter exposing CheetahAdvanced results for the landing page.
//
// Pairs with site/landing. CheetahAdvanced (the credit-first librarian sibling bot, CHEETAH_ADVANCED.md)
// detects factual matches and stores them with source links + a confidence signal. This module is the thin,
// offline adapter that turns whatever the cheetah store emits into a clean, render-ready feed for the public
// landing page. It does NOT run cheetah, talk to the chain, or fetch anything — it normalizes the store's
// OUTPUT, handed in by the caller or read via an injected reader (__setReader).
//
//   import { normalizeResults, summarize, renderFeedHtml } from './cheetah-results-feed.mjs'
//   normalizeResults(raw)   -> [{ source, match, confidence, url, at }]   (cleans store output)
//   summarize(results)      -> { total, byConfidence, topMatches }
//   renderFeedHtml(results) -> string   (esc()'d HTML fragment)
//
// Accepts the common cheetah store shapes: an array of records, or { results:[...] } / { items:[...] } /
// { matches:[...] } wrappers, or a JSON string of any of those. Per-record it tolerates loose field names
// (source/origin/site, match/text/snippet/title, confidence/score/level, url/link/href, at/ts/time/date).
// Pure + offline: any file read goes through the injected reader; never fetches, never runs a model.
// Soft-fail: malformed input → empty/partial result, never throws. esc() for all HTML. Zero-WIF: data only.

let _reader = null; // injected: (path) => string  (for the CLI / file-backed feed)
export function __setReader(fn) { _reader = typeof fn === 'function' ? fn : null; }

export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const CONFIDENCE_BUCKETS = ['high', 'medium', 'low'];

// Map a loose confidence value (string label or numeric score 0..1 / 0..100) to a bucket label.
function toConfidence(v) {
  if (v == null || v === '') return 'unknown';
  if (typeof v === 'number' && Number.isFinite(v)) {
    const n = v > 1 ? v / 100 : v; // accept 0..1 or 0..100
    if (n >= 0.75) return 'high';
    if (n >= 0.4) return 'medium';
    return 'low';
  }
  const s = String(v).trim().toLowerCase();
  if (!s) return 'unknown';
  if (CONFIDENCE_BUCKETS.includes(s)) return s;
  // numeric-in-a-string
  const num = Number(s);
  if (Number.isFinite(num)) return toConfidence(num);
  if (/high|strong|certain|exact/.test(s)) return 'high';
  if (/med|moderate|likely|partial/.test(s)) return 'medium';
  if (/low|weak|maybe|loose/.test(s)) return 'low';
  return 'unknown';
}

const firstStr = (obj, keys) => {
  for (const k of keys) {
    const val = obj[k];
    if (val != null && val !== '') return String(val);
  }
  return '';
};

// Pull the result array out of whatever wrapper the store handed us.
function extractArray(raw) {
  let input = raw;
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input);
    } catch {
      return [];
    }
  }
  if (Array.isArray(input)) return input;
  if (input && typeof input === 'object') {
    for (const k of ['results', 'items', 'matches', 'data', 'records']) {
      if (Array.isArray(input[k])) return input[k];
    }
  }
  return [];
}

/**
 * Normalize whatever the cheetah store emits into a clean feed of
 * { source, match, confidence, url, at }. Tolerant of loose field names and
 * wrapper shapes. Soft-fail → []. Never throws.
 */
export function normalizeResults(raw) {
  const list = extractArray(raw);
  const out = [];
  for (const r of list) {
    if (!r || typeof r !== 'object') continue;
    const source = firstStr(r, ['source', 'origin', 'site', 'author', 'from']);
    const match = firstStr(r, ['match', 'text', 'snippet', 'title', 'content', 'quote']);
    const url = firstStr(r, ['url', 'link', 'href', 'permlink']);
    const at = firstStr(r, ['at', 'ts', 'time', 'timestamp', 'date', 'created']);
    const confidence = toConfidence(
      r.confidence ?? r.score ?? r.level ?? r.conf ?? r.similarity,
    );
    // require something worth showing
    if (!source && !match && !url) continue;
    out.push({ source, match, confidence, url, at });
  }
  return out;
}

/**
 * Summarize a normalized feed: { total, byConfidence:{high,medium,low,unknown}, topMatches }.
 * topMatches = up to 5 highest-confidence records (high > medium > low > unknown), in input order.
 * Soft-fail → zeroed summary. Never throws.
 */
export function summarize(results) {
  const list = Array.isArray(results) ? results.filter((r) => r && typeof r === 'object') : [];
  const byConfidence = { high: 0, medium: 0, low: 0, unknown: 0 };
  for (const r of list) {
    const c = byConfidence[r.confidence] != null ? r.confidence : 'unknown';
    byConfidence[c] += 1;
  }
  const rank = { high: 0, medium: 1, low: 2, unknown: 3 };
  const topMatches = list
    .map((r, i) => ({ r, i }))
    .sort((a, b) => (rank[a.r.confidence] ?? 3) - (rank[b.r.confidence] ?? 3) || a.i - b.i)
    .slice(0, 5)
    .map(({ r }) => r);
  return { total: list.length, byConfidence, topMatches };
}

/**
 * Render a normalized feed as an esc()'d HTML fragment for the landing page.
 * Empty/invalid feed → a friendly empty-state block (never throws).
 */
export function renderFeedHtml(results) {
  const list = Array.isArray(results) ? results.filter((r) => r && typeof r === 'object') : [];
  const sum = summarize(list);
  if (!list.length) {
    return '<section class="cheetah-feed cheetah-feed--empty">' +
      '<h2>CheetahAdvanced</h2>' +
      '<p>No matches to show yet.</p>' +
      '</section>';
  }
  const head =
    `<header class="cheetah-feed__summary">` +
    `<span class="cheetah-feed__total">${esc(sum.total)} match${sum.total === 1 ? '' : 'es'}</span>` +
    CONFIDENCE_BUCKETS.map(
      (c) => `<span class="cheetah-feed__count cheetah-feed__count--${esc(c)}">${esc(c)}: ${esc(sum.byConfidence[c])}</span>`,
    ).join('') +
    `</header>`;
  const rows = list
    .map((r) => {
      const matchHtml = r.url
        ? `<a class="cheetah-feed__match" href="${esc(r.url)}" rel="nofollow noopener">${esc(r.match || r.url)}</a>`
        : `<span class="cheetah-feed__match">${esc(r.match)}</span>`;
      return (
        `<li class="cheetah-feed__item cheetah-feed__item--${esc(r.confidence)}">` +
        matchHtml +
        (r.source ? `<span class="cheetah-feed__source">${esc(r.source)}</span>` : '') +
        `<span class="cheetah-feed__confidence">${esc(r.confidence)}</span>` +
        (r.at ? `<time class="cheetah-feed__at">${esc(r.at)}</time>` : '') +
        `</li>`
      );
    })
    .join('');
  return (
    `<section class="cheetah-feed">` +
    `<h2>CheetahAdvanced matches</h2>` +
    head +
    `<ul class="cheetah-feed__list">${rows}</ul>` +
    `</section>`
  );
}

// --- CLI (guarded; reads a cheetah-store JSON file via the injected reader) --------------------
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const path = process.argv[2];
  if (!path) {
    console.log('usage: node integrations/cheetah-results-feed.mjs <cheetah-store.json>  (needs an injected reader in tests)');
  } else if (!_reader) {
    console.log('no reader injected — this CLI path expects __setReader for file access (offline by design)');
  } else {
    const raw = _reader(path);
    const results = normalizeResults(raw);
    const sum = summarize(results);
    console.log(`${sum.total} match(es) — high:${sum.byConfidence.high} medium:${sum.byConfidence.medium} low:${sum.byConfidence.low}`);
  }
}
