// event-timeline.mjs — generic chronological event-timeline builder.
//
// Distinct from integrations/timeline.mjs (which is hard-wired to trade-bot market
// history). This is a PURE, generic transform: feed it arbitrary event records and it
// produces an ordered, bucketed timeline plus Markdown / Mermaid renderings.
//
// Event record shape (all fields tolerant):
//   { date, title, tags?, source? }
//   - date: ISO string, epoch seconds, epoch ms, or YYYY / YYYY-MM. Unparseable → null,
//           and the event sorts LAST (after all dated events).
//
//   buildTimeline(events, { bucket:'day'|'month'|'year' })
//     -> { ordered:[...sorted], buckets:[{period, events}], span:{first,last} }
//   groupByTag(events) -> Map<tag, events[]>
//   renderMarkdown(timeline) -> deterministic Markdown (esc()'d)
//   renderMermaid(timeline)  -> a Mermaid `timeline` block
//
// Pure, no network, soft-fail (non-array input → empty timeline), never throws.
//
//   node integrations/event-timeline.mjs   (runs a tiny self-demo)

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// Tolerant date parse → { ms, iso } or null when unparseable.
// Accepts: ISO string, epoch seconds, epoch ms, YYYY, YYYY-MM, YYYY-MM-DD.
function parseDate(raw) {
  try {
    if (raw == null || raw === '') return null;

    // numeric (or numeric string) → epoch s/ms
    if (typeof raw === 'number' || /^\d+$/.test(String(raw).trim())) {
      const n = +String(raw).trim();
      if (!Number.isFinite(n)) return null;
      // 4-digit number is a year, not an epoch; everything else is an epoch.
      if (String(raw).trim().length === 4) {
        const ms = Date.UTC(n, 0, 1);
        return Number.isFinite(ms) ? { ms, iso: new Date(ms).toISOString() } : null;
      }
      const ms = n < 1e12 ? n * 1000 : n;
      const d = new Date(ms);
      return Number.isFinite(d.getTime()) ? { ms, iso: d.toISOString() } : null;
    }

    const s = String(raw).trim();

    // YYYY-MM (no day) → first of month, UTC
    let m = /^(\d{4})-(\d{1,2})$/.exec(s);
    if (m) {
      const ms = Date.UTC(+m[1], +m[2] - 1, 1);
      return Number.isFinite(ms) ? { ms, iso: new Date(ms).toISOString() } : null;
    }

    // anything else: hand to Date (covers ISO YYYY-MM-DD, full ISO datetime, etc.)
    const d = new Date(s);
    const t = d.getTime();
    return Number.isFinite(t) ? { ms: t, iso: d.toISOString() } : null;
  } catch {
    return null;
  }
}

// Bucket key for a parsed ms value at the requested granularity.
function periodKey(ms, bucket) {
  const iso = new Date(ms).toISOString();
  if (bucket === 'year') return iso.slice(0, 4);     // YYYY
  if (bucket === 'month') return iso.slice(0, 7);    // YYYY-MM
  return iso.slice(0, 10);                            // YYYY-MM-DD (default 'day')
}

function normTags(tags) {
  if (tags == null) return [];
  const arr = Array.isArray(tags) ? tags : [tags];
  return arr.map((t) => String(t)).filter((t) => t !== '');
}

export function buildTimeline(events, opts = {}) {
  const empty = { ordered: [], buckets: [], span: { first: null, last: null } };
  if (!Array.isArray(events)) return empty;

  const bucket = ['day', 'month', 'year'].includes(opts && opts.bucket) ? opts.bucket : 'day';

  // Normalize + parse. Keep original input index so the sort is stable & deterministic.
  const norm = events.map((e, i) => {
    const ev = e && typeof e === 'object' ? e : {};
    const p = parseDate(ev.date);
    return {
      idx: i,
      title: ev.title == null ? '' : String(ev.title),
      tags: normTags(ev.tags),
      source: ev.source == null ? null : String(ev.source),
      date: p ? p.iso : null,
      _ms: p ? p.ms : null,
    };
  });

  // Sort: dated events ascending by ms; unparseable (null) sort LAST; ties by input order.
  const ordered = [...norm].sort((a, b) => {
    if (a._ms == null && b._ms == null) return a.idx - b.idx;
    if (a._ms == null) return 1;
    if (b._ms == null) return -1;
    return (a._ms - b._ms) || (a.idx - b.idx);
  });

  // Bucket the dated events; undated collected under a stable 'unknown' period at the end.
  const map = new Map();   // period -> events[]
  let firstMs = null, lastMs = null, firstIso = null, lastIso = null;
  for (const e of ordered) {
    const period = e._ms == null ? 'unknown' : periodKey(e._ms, bucket);
    if (!map.has(period)) map.set(period, []);
    map.get(period).push(publicEvent(e));
    if (e._ms != null) {
      if (firstMs == null || e._ms < firstMs) { firstMs = e._ms; firstIso = e.date; }
      if (lastMs == null || e._ms > lastMs) { lastMs = e._ms; lastIso = e.date; }
    }
  }

  // Buckets in chronological order, 'unknown' always last.
  const periods = [...map.keys()].filter((p) => p !== 'unknown').sort();
  if (map.has('unknown')) periods.push('unknown');
  const buckets = periods.map((period) => ({ period, events: map.get(period) }));

  return {
    ordered: ordered.map(publicEvent),
    buckets,
    span: { first: firstIso, last: lastIso },
  };
}

// Strip internal bookkeeping fields for the public shape.
function publicEvent(e) {
  return { date: e.date, title: e.title, tags: e.tags, source: e.source };
}

export function groupByTag(events) {
  const map = new Map();
  if (!Array.isArray(events)) return map;
  for (const e of events) {
    const ev = e && typeof e === 'object' ? e : {};
    const tags = normTags(ev.tags);
    const rec = { date: ev.date == null ? null : ev.date, title: ev.title == null ? '' : String(ev.title), tags, source: ev.source == null ? null : String(ev.source) };
    if (tags.length === 0) {
      if (!map.has('untagged')) map.set('untagged', []);
      map.get('untagged').push(rec);
      continue;
    }
    for (const t of tags) {
      if (!map.has(t)) map.set(t, []);
      map.get(t).push(rec);
    }
  }
  return map;
}

export function renderMarkdown(timeline) {
  const tl = timeline && typeof timeline === 'object' ? timeline : { buckets: [], span: {} };
  const buckets = Array.isArray(tl.buckets) ? tl.buckets : [];
  const span = tl.span && typeof tl.span === 'object' ? tl.span : {};

  const lines = [];
  lines.push('# Timeline');
  lines.push('');
  lines.push(`- Span: ${esc(span.first || '—')} → ${esc(span.last || '—')}`);
  lines.push('');
  for (const b of buckets) {
    const period = b && b.period != null ? String(b.period) : '';
    lines.push(`## ${esc(period)}`);
    const evs = Array.isArray(b && b.events) ? b.events : [];
    for (const e of evs) {
      const title = esc((e && e.title) || '');
      const tags = Array.isArray(e && e.tags) && e.tags.length ? `  _[${e.tags.map(esc).join(', ')}]_` : '';
      const src = e && e.source ? ` (${esc(e.source)})` : '';
      lines.push(`- ${title}${src}${tags}`);
    }
    lines.push('');
  }
  return lines.join('\n');
}

export function renderMermaid(timeline) {
  const tl = timeline && typeof timeline === 'object' ? timeline : { buckets: [] };
  const buckets = Array.isArray(tl.buckets) ? tl.buckets : [];

  // Mermaid `timeline` syntax: a section per period, then `: event` lines.
  // Sanitize text: Mermaid uses ':' as a delimiter, so collapse it.
  const clean = (s) => esc(s).replace(/:/g, '-').replace(/\n/g, ' ').trim();

  const lines = ['```mermaid', 'timeline', '    title Event Timeline'];
  for (const b of buckets) {
    const period = b && b.period != null ? String(b.period) : '';
    lines.push(`    section ${clean(period)}`);
    const evs = Array.isArray(b && b.events) ? b.events : [];
    if (evs.length === 0) {
      lines.push('        : (no events)');
    }
    for (const e of evs) {
      lines.push(`        : ${clean((e && e.title) || '(untitled)')}`);
    }
  }
  lines.push('```');
  return lines.join('\n');
}

if (process.argv[1] && process.argv[1].endsWith('event-timeline.mjs')) {
  const demo = [
    { date: '2017-03-14', title: 'Mathematicians email', tags: ['lineage'], source: 'archive' },
    { date: 1717200000, title: 'Genesis block (epoch s)', tags: ['chain'] },
    { date: '2026-06', title: 'Phase 2 substantially shipped', tags: ['build', 'phase2'] },
    { date: 'not-a-date', title: 'undated note' },
  ];
  const tl = buildTimeline(demo, { bucket: 'year' });
  console.log(renderMarkdown(tl));
  console.log('');
  console.log(renderMermaid(tl));
  console.log('');
  console.log('Tags:', [...groupByTag(demo).keys()].join(', '));
}
