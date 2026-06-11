// corpus-merge.mjs — multi-source corpus record merge + provenance dedupe. PURE transform,
// NO network, NO embeddings, NO existing-file IO. The public-safe core of backlog item
// f82a57a4e2 (queue items 252-255 / 259-260): training records harvested from many sources
// (forum posts, Reddit, other forums) arrive tagged by source+date; this layer normalizes
// them into one schema, gives each a stable provenance id, merges, sorts deterministically,
// and de-duplicates identical text while preserving the earliest date + the union of every
// source that carried it.
//
//   import { normalizeRecord, mergeSources, dedupeByText, tagBySourceAndDate } from './corpus-merge.mjs'
//   node tools/corpus-merge.mjs            # merges two fake in-module fixtures, prints JSON
//
// normalizeRecord(rec, { source }) -> { id, source, date, text, meta } | null
//   id    = short hex hash of source + "|" + text via an in-module djb2 hash (NOT crypto).
//   source/date are guaranteed strings ('' when absent); meta is everything else.
//   Returns null when there is no usable (non-empty) text — caller skips it (soft-fail).
// mergeSources(sourcesMap) -> normalized records, sorted by date then source then id.
//   sourcesMap: { [source]: record[] }. Records lacking text are dropped, never thrown on.
// dedupeByText(records) -> deduped, keeping the earliest-dated occurrence; the survivor's
//   `sources[]` is the sorted union of every source that carried that exact text.
// tagBySourceAndDate(records) -> records with { source, date } guaranteed present (queue 260).
//
// Determinism: same input -> byte-identical output. Never throws on malformed input.

// --- tiny pure hash (djb2 -> 8 hex chars). NOT cryptographic; used only for stable ids. ---
export function djb2(str) {
  const s = String(str == null ? '' : str);
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    // h * 33 + c, kept in unsigned 32-bit space.
    h = (((h << 5) + h) + s.charCodeAt(i)) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

// stable provenance id from a (source, text) pair. "|" separator can't collide with the
// hashed content because text is content and source is a short tag, but the boundary is
// made explicit so the id is reproducible by any caller.
export function idFor(source, text) {
  return djb2(String(source == null ? '' : source) + '|' + String(text == null ? '' : text));
}

function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

// text from a record: prefer .text, fall back to .body / .content (common harvest fields).
function recText(rec) {
  if (!rec || typeof rec !== 'object') return '';
  const t = rec.text != null ? rec.text : (rec.body != null ? rec.body : rec.content);
  return str(t).trim();
}

// everything that is not a reserved top-level field becomes meta (provenance extras).
const RESERVED = new Set(['id', 'source', 'date', 'text', 'body', 'content', 'sources']);
function recMeta(rec) {
  const meta = {};
  if (!rec || typeof rec !== 'object') return meta;
  for (const k of Object.keys(rec)) {
    if (!RESERVED.has(k)) meta[k] = rec[k];
  }
  return meta;
}

export function normalizeRecord(rec, opts = {}) {
  const text = recText(rec);
  if (!text) return null; // soft-fail: no usable text -> skip
  const source = str((rec && rec.source) != null && rec.source !== '' ? rec.source : (opts && opts.source));
  const date = str(rec && rec.date);
  return {
    id: idFor(source, text),
    source,
    date,
    text,
    meta: recMeta(rec),
  };
}

// stable comparator: date asc, then source asc, then id asc (all string compares).
function cmp(a, b) {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.source !== b.source) return a.source < b.source ? -1 : 1;
  if (a.id !== b.id) return a.id < b.id ? -1 : 1;
  return 0;
}

export function mergeSources(sourcesMap) {
  const out = [];
  if (!sourcesMap || typeof sourcesMap !== 'object') return out;
  for (const source of Object.keys(sourcesMap)) {
    const list = sourcesMap[source];
    if (!Array.isArray(list)) continue;
    for (const rec of list) {
      const n = normalizeRecord(rec, { source });
      if (n) out.push(n);
    }
  }
  out.sort(cmp);
  return out;
}

// queue item 260: every record carries a present { source, date } (string, possibly '').
export function tagBySourceAndDate(records) {
  if (!Array.isArray(records)) return [];
  return records.map((r) => {
    const base = (r && typeof r === 'object') ? r : {};
    return { ...base, source: str(base.source), date: str(base.date) };
  });
}

// union sources of a record into a sorted unique array, folding in an incoming source list.
function unionSources(existing, source, extra) {
  const set = new Set(existing || []);
  if (source) set.add(source);
  if (Array.isArray(extra)) for (const s of extra) if (s) set.add(str(s));
  return [...set].sort();
}

export function dedupeByText(records) {
  if (!Array.isArray(records)) return [];
  const byText = new Map(); // text -> survivor record
  for (const r of records) {
    if (!r || typeof r !== 'object') continue;
    const text = recText(r);
    if (!text) continue; // soft-fail: skip textless
    const source = str(r.source);
    const date = str(r.date);
    const incomingSources = unionSources(r.sources, source, null);
    const prev = byText.get(text);
    if (!prev) {
      byText.set(text, {
        id: str(r.id) || idFor(source, text),
        source,
        date,
        text,
        meta: r.meta && typeof r.meta === 'object' ? r.meta : recMeta(r),
        sources: incomingSources,
      });
      continue;
    }
    // keep the earliest-dated occurrence as the survivor's primary fields.
    // empty date sorts before any real date, matching the merge ordering.
    const keepIncoming = date < prev.date;
    const merged = unionSources(prev.sources, source, incomingSources);
    if (keepIncoming) {
      byText.set(text, {
        id: str(r.id) || idFor(source, text),
        source,
        date,
        text,
        meta: r.meta && typeof r.meta === 'object' ? r.meta : recMeta(r),
        sources: merged,
      });
    } else {
      prev.sources = merged;
    }
  }
  const out = [...byText.values()];
  out.sort(cmp);
  return out;
}

// --- CLI fixtures (guarded) ------------------------------------------------
// two fake sources with one overlapping (identical-text) record across them.
const FIXTURES = {
  forum_a: [
    { text: 'The witness produces blocks.', date: '2026-01-02', author: 'alice' },
    { text: 'MELEK is five letters.', date: '2026-01-05' },
  ],
  reddit: [
    { body: 'MELEK is five letters.', date: '2026-01-01', subreddit: 'r/melek' }, // dup, earlier
    { text: 'Karma is off-chain.', date: '2026-01-03' },
    { text: '   ' }, // textless -> skipped
  ],
};

export function runCli(sources = FIXTURES) {
  const merged = mergeSources(sources);
  const deduped = dedupeByText(merged);
  return {
    sourceCount: Object.keys(sources).length,
    mergedCount: merged.length,
    dedupedCount: deduped.length,
    records: deduped,
  };
}

if (process.argv[1] && process.argv[1].endsWith('corpus-merge.mjs')) {
  console.log(JSON.stringify(runCli(), null, 2));
}
