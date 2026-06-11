// source-attribution.mjs — Hathor's source-attribution / citation formatter.
//
// A PURE formatter for the recurring "Attribution requirements" / "Show sources for answers"
// itinerary items. When the Witness (or Cheetah) pulls a fact from a scraped page or the corpus,
// it must be able to render WHERE the fact came from, in a normalized, deterministic line.
//
// This module is DISTINCT from its two siblings:
//   • compute-cite.mjs — provenance for a COMPUTED or LOOKED-UP number (value + method + confidence).
//   • (any future citations.mjs) — does not exist here; do not assume it.
// This one is pure presentation: take a source descriptor, render a clean citation string and a
// Markdown reference list, dedupe a pile of sources, and weave [n] footnote markers into prose.
//
// A source descriptor:
//   { title, author?, url?, publisher?, year?, accessed?, license? }
//
// Contract: zero network, no IO, no deps. Soft-fail — a bad/empty entry is SKIPPED, never thrown.
// All HTML/Markdown interpolation is HTML-escaped via esc(). Deterministic output (stable order,
// no Date.now(), no randomness). CLI guarded by process.argv[1].
//
//   import { formatAttribution, formatList, dedupeSources, toFootnotes } from './source-attribution.mjs'
//   formatAttribution({ title:'Phoenix Protocol', author:'Van Kush', url:'https://x/y', year:2024 })
//   formatList([ ...sources ])                 → Markdown numbered list
//   dedupeSources([ ...sources ])              → unique-by-url||title, most-complete kept
//   toFootnotes('see A and B', [a, b])         → { text:'see A and B [1][2]', footnotes:'1. …' }
//
//   node integrations/source-attribution.mjs '{"title":"Phoenix Protocol","author":"Van Kush"}'

/** HTML-escape every interpolation point. Null/undefined → ''. */
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// The recognized fields, in canonical rendering order.
const FIELDS = ['title', 'author', 'url', 'publisher', 'year', 'accessed', 'license'];

/**
 * Coerce + trim a raw source into a clean descriptor, or null if there's nothing usable.
 * A source is "usable" only if it has at least a title OR a url after cleaning. Soft-fail: any
 * non-object, or an object with no title/url, returns null (the caller skips it).
 */
function cleanSource(src) {
  if (!src || typeof src !== 'object' || Array.isArray(src)) return null;
  const out = {};
  for (const f of FIELDS) {
    const raw = src[f];
    if (raw == null) continue;
    const v = String(raw).trim();
    if (v) out[f] = v;
  }
  if (!out.title && !out.url) return null;
  return out;
}

/** Count how many of the canonical fields a (cleaned) source carries — used to pick the "most complete". */
function completeness(src) {
  let n = 0;
  for (const f of FIELDS) if (src[f]) n++;
  return n;
}

/**
 * Normalize a url||title into a dedup key: lowercased, trailing slash stripped, scheme/`www.`
 * folded for urls, whitespace collapsed. Returns '' when there's nothing to key on.
 */
function dedupeKey(src) {
  if (src.url) {
    let u = src.url.toLowerCase().trim();
    u = u.replace(/^https?:\/\//, '').replace(/^www\./, '');
    u = u.replace(/\/+$/, '');
    return 'url:' + u;
  }
  if (src.title) {
    return 'title:' + src.title.toLowerCase().replace(/\s+/g, ' ').trim().replace(/\/+$/, '');
  }
  return '';
}

/**
 * Render ONE normalized, esc()'d citation string from a source descriptor. Absent fields are
 * omitted cleanly (no empty parens, no dangling separators). Deterministic. Soft-fails to '' on a
 * bad/empty entry — never throws.
 *
 * Shape (fields dropped when absent):
 *   Author. "Title." Publisher (Year). <url> [Accessed accessed]. License: license.
 */
export function formatAttribution(src) {
  const s = cleanSource(src);
  if (!s) return '';
  const parts = [];
  if (s.author) parts.push(esc(s.author) + '.');
  if (s.title) parts.push('&quot;' + esc(s.title) + '.&quot;');
  // Publisher (Year) — combine so a lone year still reads cleanly.
  if (s.publisher && s.year) parts.push(esc(s.publisher) + ' (' + esc(s.year) + ').');
  else if (s.publisher) parts.push(esc(s.publisher) + '.');
  else if (s.year) parts.push('(' + esc(s.year) + ').');
  if (s.url) parts.push('&lt;' + esc(s.url) + '&gt;');
  if (s.accessed) parts.push('[Accessed ' + esc(s.accessed) + '].');
  if (s.license) parts.push('License: ' + esc(s.license) + '.');
  return parts.join(' ');
}

/**
 * Deduplicate a list of sources, unique by normalized url||title (case- and trailing-slash-
 * insensitive). When two entries collide, the MOST-COMPLETE record is kept (ties → the earlier
 * one). Bad/empty entries are skipped. Order of first appearance is preserved. Never throws.
 */
export function dedupeSources(sources) {
  if (!Array.isArray(sources)) return [];
  const order = [];
  const byKey = new Map();
  for (const raw of sources) {
    const s = cleanSource(raw);
    if (!s) continue;
    const key = dedupeKey(s);
    if (!key) continue;
    if (!byKey.has(key)) {
      byKey.set(key, s);
      order.push(key);
    } else if (completeness(s) > completeness(byKey.get(key))) {
      byKey.set(key, s); // keep the more-complete record (strictly greater → ties keep the first)
    }
  }
  return order.map((k) => byKey.get(k));
}

/**
 * Render a Markdown numbered reference list from a list of sources. Deduped first, bad entries
 * skipped, each line esc()'d via formatAttribution. Returns '' when nothing is renderable.
 *   1. Author. "Title." …
 *   2. …
 */
export function formatList(sources) {
  const clean = dedupeSources(sources);
  if (!clean.length) return '';
  return clean
    .map((s, i) => (i + 1) + '. ' + formatAttribution(s))
    .join('\n');
}

/**
 * Append [n] footnote markers to a block of text and produce the matching footnote list.
 * The sources are deduped; one [n] marker per surviving source is appended to the text (space-
 * separated), and `footnotes` is the Markdown numbered list (same numbering). The input text is
 * esc()'d so the result is safe to drop into HTML/Markdown. Soft-fails: empty/garbage sources →
 * the text is returned unchanged (escaped) with footnotes:''. Never throws.
 *
 *   toFootnotes('See the brief', [a, b])
 *     → { text: 'See the brief [1][2]', footnotes: '1. …\n2. …' }
 */
export function toFootnotes(text, sources) {
  const body = esc(text == null ? '' : text).trim();
  const clean = dedupeSources(sources);
  if (!clean.length) return { text: body, footnotes: '' };
  const markers = clean.map((_, i) => '[' + (i + 1) + ']').join('');
  const outText = body ? body + ' ' + markers : markers;
  const footnotes = clean
    .map((s, i) => (i + 1) + '. ' + formatAttribution(s))
    .join('\n');
  return { text: outText, footnotes };
}

// ── CLI (guarded; pure, offline) ────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('source-attribution.mjs')) {
  const argv = process.argv.slice(2);
  let parsed = [];
  for (const a of argv) {
    try {
      const v = JSON.parse(a);
      if (Array.isArray(v)) parsed.push(...v);
      else parsed.push(v);
    } catch { parsed.push({ title: a }); }
  }
  console.log('--- citations ---');
  for (const s of parsed) {
    const line = formatAttribution(s);
    if (line) console.log(line);
  }
  console.log('\n--- reference list (deduped) ---');
  console.log(formatList(parsed) || '(none)');
}
