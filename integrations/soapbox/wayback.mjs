// wayback.mjs — Internet Archive Wayback Machine readers (catalog #23 + #24). Keyless, open.
//
//   Availability API — "closest archived snapshot" for a URL (one call, one answer).
//   CDX Server API   — the full capture history (query/filter every snapshot IA holds).
//
// WHY (synthesis §4 "window, don't host"): when a cited source 404s — a legal citation, a paper
// link, a dead reference in the Library — we don't re-host the file (Hachette v. IA lesson); we
// POINT at the Archive's own capture. Recovering the information is fine; re-hosting is not.
// salvageLink() is the one-stop helper the verticals call on any dead outbound link.
//
// Pattern mirrors library-catalog.mjs: ESM, __setFetch hook, soft-fail (a dead Archive yields
// null/[] — never throws), CLI guarded by argv check.

const UA = 'Mozilla/5.0 (compatible; MELEK-Bot/1.0; +https://soapbox.community)';
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

async function getJSON(url) {
  try {
    const r = await _fetch(url, { headers: { 'user-agent': UA, accept: 'application/json' } });
    if (!r || !r.ok) return null;
    return await r.json();
  } catch { return null; }
}

// The Wayback APIs match best on the scheme-less form ("gutenberg.org/page", not
// "https://gutenberg.org/page" — the encoded-scheme variant returns empty for URLs the
// Archive demonstrably holds). Normalize before querying.
function bareUrl(url) {
  return String(url || '').trim().replace(/^https?:\/\//i, '');
}

/**
 * Closest archived snapshot for a URL (Wayback Availability API).
 * `timestamp` (optional, YYYYMMDD[hhmmss]) biases "closest" toward that moment.
 * Returns { url, timestamp, status } or null when IA holds no capture / is unreachable.
 */
export async function availability(url, { timestamp } = {}) {
  if (!url) return null;
  const ts = timestamp ? `&timestamp=${encodeURIComponent(timestamp)}` : '';
  const j = await getJSON(`https://archive.org/wayback/available?url=${encodeURIComponent(bareUrl(url))}${ts}`);
  const snap = j?.archived_snapshots?.closest;
  if (!snap?.available || !snap.url) return null;
  return {
    url: String(snap.url).replace(/^http:/, 'https:'),
    timestamp: snap.timestamp || null,
    status: snap.status || null,
  };
}

/**
 * Capture history for a URL (CDX Server API), newest first. Returns rows of
 * { timestamp, url, original, mimetype, status } — [] when none / unreachable.
 * `from`/`to` are YYYYMMDD bounds; `limit` caps the rows fetched (newest kept via fastLatest).
 */
export async function captures(url, { limit = 25, from, to } = {}) {
  if (!url) return [];
  const parts = [
    `url=${encodeURIComponent(bareUrl(url))}`,
    'output=json',
    'fl=timestamp,original,mimetype,statuscode',
    // fastLatest + reverse sort would need full scan; limit=-N returns the LAST N (newest) cheaply.
    `limit=-${Math.max(1, Math.min(limit, 500))}`,
  ];
  if (from) parts.push(`from=${encodeURIComponent(from)}`);
  if (to) parts.push(`to=${encodeURIComponent(to)}`);
  const j = await getJSON(`https://web.archive.org/cdx/search/cdx?${parts.join('&')}`);
  if (!Array.isArray(j) || j.length < 2) return [];
  // First row is the field-name header; data rows follow.
  return j.slice(1).map((row) => {
    const [timestamp, original, mimetype, statuscode] = row;
    return {
      timestamp: timestamp || null,
      original: original || null,
      mimetype: mimetype || null,
      status: statuscode || null,
      url: timestamp && original ? `https://web.archive.org/web/${timestamp}/${original}` : null,
    };
  }).filter((r) => r.url).reverse(); // newest first
}

/**
 * Dead-link salvage: given any outbound URL, return where a reader can still see it.
 *   { original, archived: {url, timestamp} | null, captureCount }
 * One Availability call + one bounded CDX call; soft-fails to archived:null.
 */
export async function salvageLink(url, { history = 5 } = {}) {
  if (!url) return { original: null, archived: null, captureCount: 0 };
  const [closest, hist] = await Promise.all([
    availability(url).catch(() => null),
    captures(url, { limit: history }).catch(() => []),
  ]);
  const archived = closest || (hist[0] ? { url: hist[0].url, timestamp: hist[0].timestamp, status: hist[0].status } : null);
  return { original: url, archived, captureCount: hist.length };
}

// ── CLI ──────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('wayback.mjs')) {
  const u = process.argv[2] || 'https://example.com';
  const out = await salvageLink(u);
  console.log(`\nWayback: ${u}`);
  console.log(out.archived
    ? `  archived: ${out.archived.url} (ts ${out.archived.timestamp})`
    : '  no capture found');
  console.log(`  recent captures seen: ${out.captureCount}`);
}
