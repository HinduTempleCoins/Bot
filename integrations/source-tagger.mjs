// source-tagger.mjs — source + date record tagger/normalizer for the scraped corpus.
// (backlog 1c63188904: "Tags by source and date" in the scraper pipeline.)
//
// PURE. No network, no secrets, no IO. Deterministic. Never throws on bad input.
//
// The scraper pulls raw records from many places (Reddit threads, bitcointalk
// posts, sacred-texts pages, ...). Before they land in the corpus they need a
// stable provenance stamp so downstream readers can attribute, dedupe, and
// filter by where/when a thing came from. This module does exactly that and
// nothing else: it derives a normalized `source` slug from a URL, stamps the
// fetch date, and merges/dedupes a `tags` array — without mutating the input.
//
//   import { sourceFromUrl, tagRecord, tagAll } from './source-tagger.mjs'
//   node integrations/source-tagger.mjs https://www.reddit.com/r/foo

// --- known-host map: hostname (or suffix) -> canonical source slug ----------
// Keys are matched against the lowercased, www-stripped hostname both exactly
// and by registrable-domain suffix, so `old.reddit.com` -> `reddit`.

export const KNOWN_HOSTS = {
  'reddit.com': 'reddit',
  'redd.it': 'reddit',
  'bitcointalk.org': 'bitcointalk',
  'sacred-texts.com': 'sacred-texts',
  'steemit.com': 'steemit',
  'hive.blog': 'hive',
  'peakd.com': 'hive',
  'twitter.com': 'twitter',
  'x.com': 'twitter',
  'youtube.com': 'youtube',
  'youtu.be': 'youtube',
  'medium.com': 'medium',
  'github.com': 'github',
  'archive.org': 'archive',
  'wikipedia.org': 'wikipedia',
};

// --- helpers ---------------------------------------------------------------

// Pull a hostname out of a URL string without throwing. Returns '' on failure.
function hostOf(url) {
  const raw = String(url ?? '').trim();
  if (!raw) return '';
  try {
    return new URL(raw).hostname.toLowerCase();
  } catch {
    // Tolerate scheme-less inputs like "www.reddit.com/r/foo" — but only when
    // the leading token actually looks like a domain (contains a dot), so a
    // bare word like "garbage" is treated as unparseable rather than a host.
    const head = raw.split(/[/?#\s]/)[0];
    if (!head.includes('.')) return '';
    try {
      return new URL('http://' + raw).hostname.toLowerCase();
    } catch {
      return '';
    }
  }
}

// Strip a leading "www." (and common locale/sub prefixes are left intact).
function stripWww(host) {
  return host.replace(/^www\./, '');
}

// Registrable-domain fallback: last two labels (e.g. "foo.bar.com" -> "bar.com").
// Crude but deterministic and offline; good enough for a corpus source slug.
function registrableDomain(host) {
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return host;
  return parts.slice(-2).join('.');
}

// Normalize an arbitrary value to an ISO date-time string, soft-failing to
// undefined when it can't be parsed. Accepts Date, ms-number, or string.
function toIso(value) {
  if (value == null) return undefined;
  let d;
  if (value instanceof Date) d = value;
  else if (typeof value === 'number') d = new Date(value);
  else d = new Date(String(value));
  const t = d.getTime();
  if (Number.isNaN(t)) return undefined;
  return d.toISOString();
}

// --- public API ------------------------------------------------------------

// sourceFromUrl(url) -> normalized source slug.
//   - lowercased, www-stripped hostname
//   - exact or suffix match against KNOWN_HOSTS
//   - else the registrable domain (e.g. "example.com")
//   - 'unknown' when there is no parseable host.
export function sourceFromUrl(url) {
  const host = stripWww(hostOf(url));
  if (!host) return 'unknown';

  // Exact known-host hit.
  if (Object.prototype.hasOwnProperty.call(KNOWN_HOSTS, host)) {
    return KNOWN_HOSTS[host];
  }
  // Suffix hit: host ends with a known domain (e.g. "old.reddit.com").
  for (const known of Object.keys(KNOWN_HOSTS)) {
    if (host === known || host.endsWith('.' + known)) {
      return KNOWN_HOSTS[known];
    }
  }
  // Fallback: registrable domain.
  return registrableDomain(host);
}

// Merge + dedupe tag-ish values into a clean string array, order-preserving.
function mergeTags(...lists) {
  const out = [];
  const seen = new Set();
  for (const list of lists) {
    const arr = Array.isArray(list) ? list : (list == null ? [] : [list]);
    for (const t of arr) {
      const s = String(t ?? '').trim();
      if (!s || seen.has(s)) continue;
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

// tagRecord(record, { url, fetchedAt }) -> a CLONE of record with provenance.
//   Adds:  source       (slug from url, or record.source, or 'unknown')
//          source_host  (lowercased, www-stripped hostname, or '')
//          scraped_at   (ISO string from fetchedAt; omitted if unparseable)
//          tags         (merged/deduped: existing record.tags + the source slug)
//   - never mutates the input record
//   - never throws; bad url -> source='unknown', source_host=''.
export function tagRecord(record, opts = {}) {
  const base = (record && typeof record === 'object' && !Array.isArray(record))
    ? record
    : {};
  const { url, fetchedAt } = (opts && typeof opts === 'object') ? opts : {};

  // Prefer the explicit url; fall back to a url already on the record.
  const effectiveUrl = url != null ? url : base.url;
  const host = stripWww(hostOf(effectiveUrl));
  const source = effectiveUrl != null
    ? sourceFromUrl(effectiveUrl)
    : (base.source != null ? String(base.source) : 'unknown');

  const clone = { ...base };
  clone.source = source;
  clone.source_host = host || '';

  const iso = toIso(fetchedAt);
  if (iso) clone.scraped_at = iso;
  else if (base.scraped_at != null) clone.scraped_at = String(base.scraped_at);

  clone.tags = mergeTags(base.tags, source);

  return clone;
}

// tagAll(records, opts) -> records.map(r => tagRecord(r, opts)).
//   Non-array input soft-fails to []. opts.url/fetchedAt apply to every record
//   (each record's own .url still takes precedence per-record when opts.url is
//   absent, via tagRecord's fallback).
export function tagAll(records, opts = {}) {
  if (!Array.isArray(records)) return [];
  return records.map((r) => tagRecord(r, opts));
}

// --- CLI -------------------------------------------------------------------

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const url = process.argv[2] || '';
  const out = tagRecord({ title: 'cli-demo', tags: ['demo'] }, {
    url,
    fetchedAt: new Date(),
  });
  process.stdout.write(JSON.stringify(out, null, 2) + '\n');
}
