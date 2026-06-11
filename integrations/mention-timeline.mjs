// mention-timeline.mjs — Backlog be562a66fa / itinerary 240-243:
// "Mention → dated event timeline (pure)".
//
// A PURE transform. It takes mention records that some OTHER layer already fetched
// (IMAP, an API reader, a saved dump — not this module's concern) and turns them into a
// dated, deduped, grouped timeline plus a JSONL export for AI-training corpora.
//
// NO IMAP. NO NETWORK. NO IO. Input is an array of plain records:
//   { date | timestamp, source, text, subject?, url? }
// Everything here is deterministic and offline. Soft-fail: bad/missing dates land under
// 'undated', a missing query means the whole text becomes the snippet, and nothing ever
// throws — malformed input yields an empty-but-well-formed timeline.
//
//   import { buildTimeline, toJSONL, dedupe } from './mention-timeline.mjs'
//   const tl = buildTimeline(mentions, { query: 'MELEK', contextChars: 120 });
//   const jsonl = toJSONL(tl);
//   node integrations/mention-timeline.mjs demo

const UNDATED = 'undated';

// ── small safe helpers ──────────────────────────────────────────────────────────────
function str(v) {
  return typeof v === 'string' ? v : (v == null ? '' : String(v));
}

function clampInt(v, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return dflt;
  return Math.floor(n);
}

// Parse a record's date as a Date or null. Accepts Date, epoch ms/seconds, ISO strings,
// and most RFC-2822 / "human" forms Date can swallow. Returns null on anything invalid.
function parseDate(raw) {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw;
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return null;
    // Heuristic: 10-digit-ish values are epoch seconds, larger are ms.
    const ms = Math.abs(raw) < 1e12 ? raw * 1000 : raw;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (typeof raw === 'string') {
    const s = raw.trim();
    if (!s) return null;
    // Pure-numeric string → treat as epoch.
    if (/^-?\d+$/.test(s)) return parseDate(Number(s));
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function pickDate(m) {
  return parseDate(m && (m.date != null ? m.date : m.timestamp));
}

function dayKeyOf(d) {
  if (!d) return UNDATED;
  // YYYY-MM-DD in UTC, stable regardless of host tz.
  return d.toISOString().slice(0, 10);
}

// ── quote + snippet extraction around `query` ─────────────────────────────────────────
// quote = the matched span (the literal text that matched, preserving original casing).
// snippet = quote padded by ±contextChars of surrounding text. With no query, the whole
// (trimmed/collapsed) text is the snippet and there is no quote.
function extract(text, query, contextChars) {
  const full = str(text).replace(/\s+/g, ' ').trim();
  const q = str(query).trim();
  if (!q) return { quote: '', snippet: full };

  const idx = full.toLowerCase().indexOf(q.toLowerCase());
  if (idx === -1) {
    // No match in this record: keep a snippet (head of text) so the event still carries
    // context, but leave quote empty to signal "matched the record, not the span".
    return { quote: '', snippet: full.slice(0, contextChars * 2) };
  }

  const quote = full.slice(idx, idx + q.length);
  const start = Math.max(0, idx - contextChars);
  const end = Math.min(full.length, idx + q.length + contextChars);
  let snippet = full.slice(start, end);
  if (start > 0) snippet = '…' + snippet;
  if (end < full.length) snippet = snippet + '…';
  return { quote, snippet };
}

// ── dedupe ────────────────────────────────────────────────────────────────────────────
// Two mentions are the same event if their (source, normalized-text, day) match. URL, when
// present, is the strongest signal and short-circuits the comparison. Preserves order;
// keeps the first occurrence. Never throws.
export function dedupe(mentions) {
  if (!Array.isArray(mentions)) return [];
  const seen = new Set();
  const out = [];
  for (const m of mentions) {
    if (!m || typeof m !== 'object') continue;
    const url = str(m.url).trim();
    const d = pickDate(m);
    const day = dayKeyOf(d);
    const key = url
      ? 'u:' + url
      : ['s:' + str(m.source).trim().toLowerCase(),
         't:' + str(m.text).replace(/\s+/g, ' ').trim().toLowerCase(),
         'd:' + day].join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(m);
  }
  return out;
}

// ── buildTimeline ─────────────────────────────────────────────────────────────────────
export function buildTimeline(mentions, opts = {}) {
  const empty = { events: [], byDay: {}, bySubject: {}, range: { from: null, to: null }, count: 0 };
  const list = dedupe(mentions);
  if (list.length === 0) return empty;

  const query = str(opts && opts.query);
  const contextChars = clampInt(opts && opts.contextChars, 120);

  const events = [];
  for (const m of list) {
    const d = pickDate(m);
    const { quote, snippet } = extract(m.text, query, contextChars);
    events.push({
      dateISO: d ? d.toISOString() : null,
      dayKey: dayKeyOf(d),
      source: str(m.source).trim(),
      subject: str(m.subject).trim(),
      quote,
      snippet,
      url: str(m.url).trim(),
      _ts: d ? d.getTime() : null, // sort helper, stripped below
    });
  }

  // Sort ascending by date. Undated (null _ts) sink to the end, original order kept among ties.
  events
    .map((e, i) => ({ e, i }))
    .sort((a, b) => {
      const at = a.e._ts, bt = b.e._ts;
      if (at === bt) return a.i - b.i;
      if (at === null) return 1;
      if (bt === null) return -1;
      return at - bt;
    })
    .forEach((wrap, order) => { wrap.e._order = order; });
  events.sort((a, b) => a._order - b._order);

  const byDay = {};
  const bySubject = {};
  let from = null, to = null;
  for (const e of events) {
    delete e._ts;
    delete e._order;
    (byDay[e.dayKey] || (byDay[e.dayKey] = [])).push(e);
    const subj = e.subject || '(no subject)';
    (bySubject[subj] || (bySubject[subj] = [])).push(e);
    if (e.dateISO) {
      if (from === null || e.dateISO < from) from = e.dateISO;
      if (to === null || e.dateISO > to) to = e.dateISO;
    }
  }

  return { events, byDay, bySubject, range: { from, to }, count: events.length };
}

// ── toJSONL — one event per line, for AI-training export ───────────────────────────────
export function toJSONL(timeline) {
  const events = timeline && Array.isArray(timeline.events) ? timeline.events : [];
  const lines = [];
  for (const e of events) {
    try {
      lines.push(JSON.stringify(e));
    } catch {
      // Unserializable event (cyclic, etc.) — skip it rather than throw.
    }
  }
  return lines.join('\n');
}

// ── CLI demo (guarded) ─────────────────────────────────────────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const sample = [
    { date: '2026-01-02T10:00:00Z', source: 'hive', subject: 'hello', text: 'Saw MELEK launch today, exciting.', url: 'h:1' },
    { timestamp: 1735732800, source: 'email', subject: 'witness', text: 'The melek witness produced its first block.' },
    { date: 'not-a-date', source: 'forum', text: 'Heard about MELEK somewhere.' },
    { date: '2026-01-02T10:00:00Z', source: 'hive', subject: 'hello', text: 'Saw MELEK launch today, exciting.', url: 'h:1' }, // dup
  ];
  const tl = buildTimeline(sample, { query: 'melek', contextChars: 20 });
  console.log(JSON.stringify({ count: tl.count, range: tl.range, days: Object.keys(tl.byDay) }, null, 2));
  console.log('--- JSONL ---');
  console.log(toJSONL(tl));
}
