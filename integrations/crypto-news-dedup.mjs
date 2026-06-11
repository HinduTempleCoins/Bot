// crypto-news-dedup.mjs — Backlog a922b93527:
// "Crypto-news dedup + recency filter (last-48h, dupe collapse)".
//
// A PURE transform for the queue's crypto-news pipeline (the one that logs lines like
// "61 articles fetched" / "last 48 hours filtering"). Some UPSTREAM reader fetches the
// articles — that is the caller's concern, NOT this module's. Here we only:
//   - normalize titles into stable dedupe keys,
//   - collapse duplicates (same normalized title OR same url), keeping the earliest,
//   - drop anything older than N hours (default 48),
//   - group by source and render a Markdown digest.
//
// Distinct from mention-timeline.mjs (mention dedupe → dated timeline) and any digest layer.
//
// NO NETWORK. NO IO. Article shape:
//   { title, url, source, publishedAt }
// Soft-fail everywhere: a bad/missing publishedAt is treated as NOT recent; empty/invalid
// input yields empty-but-well-formed output; nothing ever throws.
//
//   import { pipeline } from './integrations/crypto-news-dedup.mjs'
//   const { articles, stats } = pipeline(fetched, { hours: 48, now: Date.now() });
//   node integrations/crypto-news-dedup.mjs demo

const HOUR_MS = 3600 * 1000;

// ── small safe helpers ──────────────────────────────────────────────────────────────────
function str(v) {
  return typeof v === 'string' ? v : (v == null ? '' : String(v));
}

function esc(s) {
  return str(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function clampHours(v, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return dflt;
  return n;
}

// Parse publishedAt to epoch ms, or null on anything invalid. Accepts Date, epoch ms/seconds,
// ISO/RFC-2822 strings, and pure-numeric strings (treated as epoch).
function parseTs(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) {
    const t = raw.getTime();
    return Number.isNaN(t) ? null : t;
  }
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    // Heuristic: sub-1e12 magnitudes are epoch seconds, larger are ms.
    return Math.abs(raw) < 1e12 ? raw * 1000 : raw;
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    if (/^-?\d+$/.test(s)) return parseTs(Number(s));
    const t = new Date(s).getTime();
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

// ── normalizeTitle ──────────────────────────────────────────────────────────────────────
// Lowercase, strip punctuation, collapse whitespace → a stable dedupe key. Two titles that
// differ only in case, punctuation, or spacing collapse to the same key.
export function normalizeTitle(s) {
  return str(s)
    .toLowerCase()
    // drop anything that is not a letter/number/whitespace (unicode-aware where supported)
    .replace(/[^\p{L}\p{N}\s]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// ── dedupe ──────────────────────────────────────────────────────────────────────────────
// Collapse by normalized title OR same url, keeping the EARLIEST publishedAt among a group.
// Articles with no valid date are kept (they cannot be "earliest" against a dated one, so a
// dated member of the group wins; if all are undated the first seen wins). Preserves the
// relative order of the kept survivors by their first appearance.
//   returns { kept: [...], removed: int }
export function dedupe(articles) {
  if (!Array.isArray(articles)) return { kept: [], removed: 0 };

  // Each article may carry TWO match keys: its url and its normalized title. Either matching
  // an already-seen group collapses it in ("by normalized title OR same url"). We track which
  // group-slot owns each key; the first dated/first-seen article anchors the slot and is then
  // replaced in place by an earlier-dated member.
  const keyToSlot = new Map(); // match-key → slot index
  const slots = [];            // [{ article, ts }]
  let seenCount = 0;

  for (const a of articles) {
    if (!a || typeof a !== 'object') continue;
    seenCount++;
    const url = str(a.url).trim();
    const titleKey = normalizeTitle(a.title);
    const keys = [];
    if (url) keys.push('u:' + url.toLowerCase());
    if (titleKey) keys.push('t:' + titleKey);

    const ts = parseTs(a.publishedAt);

    // Find an existing slot any of this article's keys already point at.
    let slotIdx = -1;
    for (const k of keys) {
      if (keyToSlot.has(k)) { slotIdx = keyToSlot.get(k); break; }
    }

    if (slotIdx === -1) {
      // New group. An article with no usable keys still gets its own slot (never collapses).
      slotIdx = slots.length;
      slots.push({ article: a, ts });
    } else {
      // Duplicate: keep the earliest dated article. Undated never displaces a dated one.
      const slot = slots[slotIdx];
      if (ts != null && (slot.ts == null || ts < slot.ts)) {
        slot.article = a;
        slot.ts = ts;
      }
    }
    // Register this article's keys onto the slot (so a later article matching either collapses).
    for (const k of keys) {
      if (!keyToSlot.has(k)) keyToSlot.set(k, slotIdx);
    }
  }

  const kept = slots.map((s) => s.article);
  return { kept, removed: Math.max(0, seenCount - kept.length) };
}

// ── withinHours ─────────────────────────────────────────────────────────────────────────
// True iff the article's publishedAt is within `hours` of `now` (inclusive boundary) and not
// in the future beyond now. Bad/missing date → false (treated as not-recent).
export function withinHours(article, opts = {}) {
  if (!article || typeof article !== 'object') return false;
  const hours = clampHours(opts && opts.hours, 48);
  const now = Number.isFinite(Number(opts && opts.now)) ? Number(opts.now) : Date.now();
  const ts = parseTs(article.publishedAt);
  if (ts == null) return false;
  const ageMs = now - ts;
  // Inclusive at exactly `hours` ago. Future-dated (ageMs < 0) still counts as recent.
  return ageMs <= hours * HOUR_MS;
}

// ── recencyFilter ───────────────────────────────────────────────────────────────────────
export function recencyFilter(articles, opts = {}) {
  if (!Array.isArray(articles)) return [];
  const hours = clampHours(opts && opts.hours, 48);
  const now = Number.isFinite(Number(opts && opts.now)) ? Number(opts.now) : Date.now();
  return articles.filter((a) => withinHours(a, { hours, now }));
}

// ── pipeline ────────────────────────────────────────────────────────────────────────────
// dedupe → recency filter, with stats at each stage.
//   returns { articles, stats: { input, afterDedupe, afterRecency } }
export function pipeline(articles, opts = {}) {
  const list = Array.isArray(articles) ? articles.filter((a) => a && typeof a === 'object') : [];
  const input = list.length;
  const { kept } = dedupe(list);
  const afterDedupe = kept.length;
  const recent = recencyFilter(kept, opts);
  return {
    articles: recent,
    stats: { input, afterDedupe, afterRecency: recent.length },
  };
}

// ── groupBySource ───────────────────────────────────────────────────────────────────────
// { source: [...articles] }. Missing/blank source falls under '(unknown)'. Order of sources
// follows first appearance; order within a source follows input order.
export function groupBySource(articles) {
  const out = {};
  if (!Array.isArray(articles)) return out;
  for (const a of articles) {
    if (!a || typeof a !== 'object') continue;
    const src = str(a.source).trim() || '(unknown)';
    (out[src] || (out[src] = [])).push(a);
  }
  return out;
}

// ── renderMarkdown ──────────────────────────────────────────────────────────────────────
// A simple grouped digest. Pure string output; safe on malformed input.
export function renderMarkdown(articles) {
  const groups = groupBySource(articles);
  const sources = Object.keys(groups);
  if (sources.length === 0) return '_No articles._';
  const lines = [];
  for (const src of sources) {
    lines.push(`### ${src}`);
    for (const a of groups[src]) {
      const title = str(a.title).trim() || '(untitled)';
      const url = str(a.url).trim();
      lines.push(url ? `- [${title}](${url})` : `- ${title}`);
    }
    lines.push('');
  }
  return lines.join('\n').trimEnd();
}

// ── CLI demo (guarded) ──────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const now = Date.parse('2026-06-11T12:00:00Z');
  const sample = [
    { title: 'Bitcoin Surges Past $X!', url: 'https://a/1', source: 'CoinDesk', publishedAt: '2026-06-11T08:00:00Z' },
    { title: 'bitcoin surges past $x', url: 'https://a/2', source: 'CoinDesk', publishedAt: '2026-06-11T06:00:00Z' }, // title-dup, earlier
    { title: 'Old News', url: 'https://a/3', source: 'TheBlock', publishedAt: '2026-06-01T00:00:00Z' }, // stale
    { title: 'Same URL', url: 'https://a/4', source: 'Decrypt', publishedAt: '2026-06-11T10:00:00Z' },
    { title: 'Same URL again', url: 'https://a/4', source: 'Decrypt', publishedAt: '2026-06-11T09:00:00Z' }, // url-dup, earlier
    { title: 'No Date', url: 'https://a/5', source: 'Forum', publishedAt: 'not-a-date' }, // dropped by recency
  ];
  const { articles, stats } = pipeline(sample, { hours: 48, now });
  console.log(JSON.stringify(stats, null, 2));
  console.log('--- Markdown ---');
  console.log(renderMarkdown(articles));
}
