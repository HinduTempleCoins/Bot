// email-quote-extract.mjs — Mention quote-extractor for the MELEK email training-set pipeline.
//
// Pure, offline transform. It finds brand/keyword mentions (Van Kush Family and friends) INSIDE
// email bodies and pulls out the surrounding quote + context, organized by date and by subject.
// This mirrors the legacy email-scraper.py goal — "extract quotes and context, organize by
// date/subject" — but as a deterministic .mjs.
//
// It sits DOWNSTREAM of header parsing: email-thread.mjs splits a dump into per-message records
// (from/subject/date/body) and inbox-triage.mjs categorizes them; NEITHER pulls the in-body mention
// quotes. This module does exactly that and nothing else.
//
//   import { extractFromEmail, toRecords, organizeByDate, renderMarkdown } from './email-quote-extract.mjs'
//   const recs = toRecords(emails);                 // flat [{date,subject,from,term,quote}]
//   const md   = renderMarkdown(organizeByDate(emails.map(e => extractFromEmail(e))));
//
// NO network, NO fetch, NO scraping, NO PII intake beyond the text the caller already holds.
// Soft-fail everywhere: bad/empty input returns [] or {}; never throws.
//
// Shapes:
//   mention = { term, index, quote, before, after }
//   email   = { subject, date, from, body }
//   record  = { subject, date, from, mentions:[mention] }   (extractFromEmail)
//   flat    = { date, subject, from, term, quote }           (toRecords)

// ── DEFAULT_TERMS: the Van Kush Family brand/keyword set we hunt for in bodies. ──
// Public brand tokens only — no secrets, no PII. Callers may pass their own list.
export const DEFAULT_TERMS = [
  'Van Kush Family',
  'VanKush',
  'Van Kush',
  'VKBT',
  'CURE',
  'MELEK',
  'Hathor',
  'Shaivite',
  'Crypt-ology',
];

// ── esc: HTML-escape any interpolated string (house rule). ──
// Never throws; non-strings are coerced. Used by the markdown/HTML-safe renderer paths.
export function esc(s) {
  if (s == null) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── escapeRegExp: make an arbitrary term safe to drop into a RegExp. ──
function escapeRegExp(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ── normalizeTerms: coerce the caller's term list into a clean, deduped array of non-empty strings.
function normalizeTerms(terms) {
  const src = Array.isArray(terms) ? terms : DEFAULT_TERMS;
  const seen = new Set();
  const out = [];
  for (const t of src) {
    if (t == null) continue;
    const s = String(t).trim();
    if (s === '') continue;
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

// ── sentenceAround: the sentence(s) containing a hit at [start,end) within text. ──
// Walks back to the previous sentence terminator (. ! ? or newline) and forward to the next one,
// so the returned slice is the full sentence the term sits in. Trimmed.
function sentenceAround(text, start, end) {
  const TERMINATORS = '.!?\n';
  let s = start;
  while (s > 0 && !TERMINATORS.includes(text[s - 1])) s--;
  let e = end;
  while (e < text.length && !TERMINATORS.includes(text[e])) e++;
  // Include the closing terminator if present.
  if (e < text.length) e++;
  return text.slice(s, e).trim();
}

// ── findMentions: scan a body for every term, return mention objects with quote + windowed context.
// terms defaults to DEFAULT_TERMS; { window } is the +/- char context span around each hit.
// Matching is case-insensitive and overlap-safe (advances past each whole match). Sorted by index.
// Bad/empty input -> []. Never throws.
export function findMentions(bodyText, terms = DEFAULT_TERMS, opts = {}) {
  try {
    if (bodyText == null) return [];
    const text = String(bodyText);
    if (text === '') return [];
    const list = normalizeTerms(terms);
    if (list.length === 0) return [];

    let window = 160;
    if (opts && opts.window != null) {
      const w = Number(opts.window);
      if (Number.isFinite(w) && w >= 0) window = Math.floor(w);
    }

    const lower = text.toLowerCase();
    const hits = [];
    for (const term of list) {
      const needle = term.toLowerCase();
      let from = 0;
      while (from <= lower.length) {
        const idx = lower.indexOf(needle, from);
        if (idx === -1) break;
        const end = idx + needle.length;
        const before = text.slice(Math.max(0, idx - window), idx);
        const after = text.slice(end, Math.min(text.length, end + window));
        const quote = sentenceAround(text, idx, end);
        hits.push({
          term,
          index: idx,
          quote,
          before,
          after,
        });
        from = end; // advance past this match
      }
    }
    hits.sort((a, b) => (a.index !== b.index ? a.index - b.index : a.term.localeCompare(b.term)));
    return hits;
  } catch {
    return [];
  }
}

// ── parseDate: best-effort date string -> ISO, or null. Never throws. (No network.) ──
function parseDate(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (s === '') return null;
  const ms = Date.parse(s);
  if (Number.isNaN(ms)) return null;
  try {
    return new Date(ms).toISOString();
  } catch {
    return null;
  }
}

// ── extractFromEmail: one email -> { subject, date, from, mentions:[...] }. ──
// date is normalized to ISO (or the original string if unparseable, or null). Bad input ->
// { subject:'', date:null, from:'', mentions:[] }. Never throws.
export function extractFromEmail(email, terms = DEFAULT_TERMS, opts = {}) {
  const out = { subject: '', date: null, from: '', mentions: [] };
  try {
    if (!email || typeof email !== 'object') return out;
    out.subject = email.subject == null ? '' : String(email.subject);
    out.from = email.from == null ? '' : String(email.from);
    const iso = parseDate(email.date);
    out.date = iso != null ? iso : email.date == null ? null : String(email.date);
    out.mentions = findMentions(email.body, terms, opts);
    return out;
  } catch {
    return out;
  }
}

// ── toRecords: emails[] -> flat [{ date, subject, from, term, quote }] (one row per mention). ──
// Emails with no mentions contribute no rows. Bad/empty input -> []. Never throws.
export function toRecords(emails = [], terms = DEFAULT_TERMS, opts = {}) {
  try {
    if (!Array.isArray(emails)) return [];
    const rows = [];
    for (const email of emails) {
      const rec = extractFromEmail(email, terms, opts);
      for (const m of rec.mentions) {
        rows.push({
          date: rec.date,
          subject: rec.subject,
          from: rec.from,
          term: m.term,
          quote: m.quote,
        });
      }
    }
    return rows;
  } catch {
    return [];
  }
}

// ── dateKey: ISO/loose date -> a YYYY-MM-DD bucket key, or 'no-date'. ──
function dateKey(date) {
  const iso = parseDate(date);
  if (iso != null) return iso.slice(0, 10);
  if (date == null) return 'no-date';
  const s = String(date).trim();
  return s === '' ? 'no-date' : s;
}

// ── organizeByDate: records (from extractFromEmail) -> [{ date, items:[...] }] sorted ascending. ──
// Buckets by YYYY-MM-DD day. Datable buckets sort ascending; 'no-date' and unparseable keys sort
// last in stable order. Bad input -> []. Never throws.
export function organizeByDate(records) {
  try {
    if (!Array.isArray(records)) return [];
    const order = [];
    const buckets = new Map();
    for (const r of records) {
      if (!r || typeof r !== 'object') continue;
      const key = dateKey(r.date);
      if (!buckets.has(key)) {
        buckets.set(key, []);
        order.push(key);
      }
      buckets.get(key).push(r);
    }
    const keys = [...buckets.keys()];
    keys.sort((a, b) => {
      const at = Date.parse(a);
      const bt = Date.parse(b);
      const an = Number.isNaN(at);
      const bn = Number.isNaN(bt);
      if (an && bn) return order.indexOf(a) - order.indexOf(b); // both undatable — input order
      if (an) return 1; // undatable last
      if (bn) return -1;
      if (at !== bt) return at - bt;
      return order.indexOf(a) - order.indexOf(b);
    });
    return keys.map((date) => ({ date, items: buckets.get(date) }));
  } catch {
    return [];
  }
}

// ── organizeBySubject: records -> { subjectKey: items[] }. ──
// Groups by the record's subject (empty subject -> '(no subject)'). Bad input -> {}. Never throws.
export function organizeBySubject(records) {
  try {
    const out = {};
    if (!Array.isArray(records)) return out;
    for (const r of records) {
      if (!r || typeof r !== 'object') continue;
      const subj = r.subject == null || String(r.subject).trim() === ''
        ? '(no subject)'
        : String(r.subject);
      if (!out[subj]) out[subj] = [];
      out[subj].push(r);
    }
    return out;
  } catch {
    return {};
  }
}

// ── renderMarkdown: organized output -> a human-readable digest string. ──
// Accepts either organizeByDate's array ([{date,items}]) or organizeBySubject's object
// ({subjectKey: items}). Each item may be a record (with .mentions) or a flat row (with .term/.quote).
// Bad/empty input -> ''. Never throws. (Plain markdown text; no HTML, but esc() guards any value
// that could be rendered as HTML downstream is not applied here since output is markdown.)
export function renderMarkdown(organized) {
  try {
    if (organized == null) return '';

    const lines = [];

    const renderItem = (item) => {
      if (!item || typeof item !== 'object') return;
      const subj = item.subject ? String(item.subject) : '(no subject)';
      const from = item.from ? String(item.from) : '(unknown)';
      // Flat row shape: term + quote directly on the item.
      if (typeof item.term === 'string' && item.term !== '') {
        lines.push(`- **${item.term}** — _${subj}_ (${from})`);
        if (item.quote) lines.push(`  > ${String(item.quote).replace(/\n+/g, ' ').trim()}`);
        return;
      }
      // Record shape: a list of mentions.
      if (Array.isArray(item.mentions)) {
        if (item.mentions.length === 0) return;
        lines.push(`- _${subj}_ (${from})`);
        for (const m of item.mentions) {
          if (!m || typeof m !== 'object') continue;
          lines.push(`  - **${m.term}**: ${String(m.quote || '').replace(/\n+/g, ' ').trim()}`);
        }
      }
    };

    if (Array.isArray(organized)) {
      // organizeByDate shape.
      for (const group of organized) {
        if (!group || typeof group !== 'object') continue;
        const date = group.date ? String(group.date) : 'no-date';
        lines.push(`## ${date}`);
        const items = Array.isArray(group.items) ? group.items : [];
        for (const it of items) renderItem(it);
        lines.push('');
      }
    } else if (typeof organized === 'object') {
      // organizeBySubject shape.
      for (const key of Object.keys(organized)) {
        lines.push(`## ${key}`);
        const items = Array.isArray(organized[key]) ? organized[key] : [];
        for (const it of items) renderItem(it);
        lines.push('');
      }
    } else {
      return '';
    }

    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  } catch {
    return '';
  }
}

// ── Guarded CLI: read a JSON array of emails from a file arg or stdin, print a markdown digest. ──
// Pure demo aid; no network, no secrets. `node integrations/email-quote-extract.mjs emails.json`
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      const { readFileSync } = await import('node:fs');
      const arg = process.argv[2];
      const raw = arg ? readFileSync(arg, 'utf8') : readFileSync(0, 'utf8');
      let emails = [];
      try {
        const parsed = JSON.parse(raw);
        emails = Array.isArray(parsed) ? parsed : [parsed];
      } catch {
        emails = [];
      }
      const records = emails.map((e) => extractFromEmail(e));
      const totalMentions = records.reduce((n, r) => n + r.mentions.length, 0);
      process.stdout.write(
        `email-quote-extract: ${records.length} email(s), ${totalMentions} mention(s)\n\n`,
      );
      process.stdout.write(renderMarkdown(organizeByDate(records)) + '\n');
    } catch (e) {
      process.stderr.write('email-quote-extract: ' + ((e && e.message) || String(e)) + '\n');
      process.exitCode = 1;
    }
  })();
}
