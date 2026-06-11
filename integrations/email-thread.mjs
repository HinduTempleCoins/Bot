// email-thread.mjs — Email/mbox-style thread parser for the MELEK training-set transform pipeline.
// This is the "Parse emails by date/subject" / "Extract key information (people, events, dates)"
// itinerary step: it splits a raw concatenated email/thread text dump into structured per-message
// records BEFORE qa-pairs.mjs turns the conversation into instruction pairs.
//
// Pure, network-free transform. NO scraping, NO network, NO PII intake beyond the text the caller
// already holds. Never throws — bad/empty input returns []. It sits UPSTREAM of qa-pairs.mjs:
//   import { parseEmailText, sortByDate } from './email-thread.mjs'
//   import { pairsFromThread } from './qa-pairs.mjs'
//   const records = sortByDate(parseEmailText(rawDump));
//   const messages = records.map(r => ({ author: r.from, text: r.body, ts: r.date }));
//   pairsFromThread({ messages });
//
//   import { parseEmailText, parseHeaders, sortByDate, extractParticipants } from './email-thread.mjs'
//
// Shapes:
//   record = { from, to?, subject, date(ISO|null), body, quotedDepth? }
//   headers = { from, to, subject, date, messageId }

// ── Header field matchers. ────────────────────────────────────────────────────────────────────
// RFC-822-ish "Header: value" lines. We only care about a small, public set.
const HEADER_RE = /^(From|To|Cc|Subject|Date|Sent|Message-ID|Message-Id)\s*:\s*(.*)$/i;

// "On <date>, X wrote:" attribution that introduces a quoted reply block — a soft message boundary
// in pasted threads that lack real headers.
const ATTRIBUTION_RE = /^\s*On\b.*\bwrote:\s*$/i;

// A run of dashes/underscores some clients use as an "Original Message" separator.
const ORIGINAL_MSG_RE = /^\s*-{2,}\s*(?:Original Message|Forwarded message)\s*-{2,}\s*$/i;

// ── parseDate: best-effort RFC/loose date string -> ISO string, or null. ──
// Never throws; unparseable / empty -> null. Uses the platform Date parser only (no network).
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

// ── parseHeaders: a header block (the lines before the blank line) -> structured headers. ──
// Accepts the raw header text (or a whole message — it stops at the first blank line). Returns
// { from, to, subject, date, messageId } with '' / null for absent fields. Never throws.
export function parseHeaders(block) {
  const out = { from: '', to: '', subject: '', date: null, messageId: '' };
  try {
    if (block == null) return out;
    const lines = String(block).replace(/\r\n?/g, '\n').split('\n');
    let rawDate = '';
    let lastKey = null;
    for (const line of lines) {
      // Header section ends at the first blank line.
      if (line.trim() === '') break;
      const m = HEADER_RE.exec(line);
      if (m) {
        const key = m[1].toLowerCase();
        const val = m[2].trim();
        if (key === 'from') { out.from = val; lastKey = 'from'; }
        else if (key === 'to' || key === 'cc') {
          out.to = out.to ? out.to + ', ' + val : val;
          lastKey = 'to';
        } else if (key === 'subject') { out.subject = val; lastKey = 'subject'; }
        else if (key === 'date' || key === 'sent') { rawDate = val; lastKey = 'date'; }
        else if (key === 'message-id') { out.messageId = val; lastKey = 'messageId'; }
        continue;
      }
      // Folded continuation line (leading whitespace) — append to the previous header.
      if (lastKey && /^\s+\S/.test(line)) {
        const cont = line.trim();
        if (lastKey === 'date') rawDate += ' ' + cont;
        else if (lastKey === 'messageId') out.messageId += ' ' + cont;
        else out[lastKey] = (out[lastKey] ? out[lastKey] + ' ' : '') + cont;
      }
    }
    out.date = parseDate(rawDate);
    return out;
  } catch {
    return out;
  }
}

// ── splitBody: separate fresh text from quoted (`>`) reply text. ──
// Returns { body, quotedDepth } where body is the non-quoted lines (attribution headers and
// "Original Message" separators dropped) and quotedDepth is the max `>` nesting seen (0 if none).
function splitBody(text) {
  const lines = String(text == null ? '' : text).replace(/\r\n?/g, '\n').split('\n');
  const kept = [];
  let maxDepth = 0;
  for (const line of lines) {
    const qm = /^(\s*>+)/.exec(line);
    if (qm) {
      const depth = (qm[1].match(/>/g) || []).length;
      if (depth > maxDepth) maxDepth = depth;
      continue; // quoted line — not part of the fresh body
    }
    if (ATTRIBUTION_RE.test(line)) continue; // "On ... wrote:" attribution
    if (ORIGINAL_MSG_RE.test(line)) continue; // "----- Original Message -----"
    kept.push(line);
  }
  const body = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return { body, quotedDepth: maxDepth };
}

// ── Boundary detection. ──
// A new message starts at a line that begins a header block (a "From:" line, optionally with a
// "Subject:"/"Date:" nearby), an mbox "From " envelope line, an "On ... wrote:" attribution, or an
// "Original Message" separator. We scan line-by-line and cut on these.
function isHeaderStart(line) {
  // mbox envelope: "From foo@bar Mon Jan 1 ..." (no colon after From).
  if (/^From \S+@?\S*\s+\w/.test(line)) return true;
  // RFC header "From:" line is the canonical block start.
  return /^From\s*:/i.test(line);
}

// ── parseEmailText: raw dump -> [{ from, to?, subject, date, body, quotedDepth }]. ──
// Splits on header blocks ("From:"/"Subject:"/"Date:"), mbox "From " envelopes, and "On <date>, X
// wrote:" separators. Strips quoted (`>`) reply text into quotedDepth and keeps only fresh body
// text. Bad/empty input -> []. Never throws.
export function parseEmailText(raw) {
  try {
    if (typeof raw !== 'string') return [];
    const norm = raw.replace(/\r\n?/g, '\n');
    if (norm.trim() === '') return [];
    const lines = norm.split('\n');

    // Find the cut points: indices where a new message begins.
    const cuts = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (isHeaderStart(line)) {
        cuts.push(i);
      } else if (ATTRIBUTION_RE.test(line) || ORIGINAL_MSG_RE.test(line)) {
        // Attribution / separator: only a boundary if it's not the very first line and there is
        // some content already accumulated (it splits an inline reply chain).
        if (cuts.length === 0) cuts.push(0);
        if (i > (cuts[cuts.length - 1] || 0)) cuts.push(i);
      }
    }
    // No recognizable boundary at all — treat the whole dump as one bodied message.
    if (cuts.length === 0) {
      const { body, quotedDepth } = splitBody(norm);
      if (body === '') return [];
      return [{ from: '', subject: '', date: null, body, quotedDepth }];
    }
    if (cuts[0] !== 0) cuts.unshift(0);

    const records = [];
    for (let c = 0; c < cuts.length; c++) {
      const start = cuts[c];
      const end = c + 1 < cuts.length ? cuts[c + 1] : lines.length;
      const chunk = lines.slice(start, end);
      if (chunk.length === 0) continue;

      const startLine = chunk[0];
      let headers = { from: '', to: '', subject: '', date: null, messageId: '' };
      let bodyLines = chunk;
      let attributionOnly = false;

      if (isHeaderStart(startLine) && /^From\s*:/i.test(startLine)) {
        // RFC header block: parse headers, body is after the first blank line.
        headers = parseHeaders(chunk.join('\n'));
        const blankAt = chunk.findIndex((l) => l.trim() === '');
        bodyLines = blankAt >= 0 ? chunk.slice(blankAt + 1) : [];
      } else if (/^From \S/.test(startLine)) {
        // mbox envelope line — try to parse any header lines that follow it, then body.
        const rest = chunk.slice(1);
        headers = parseHeaders(rest.join('\n'));
        const blankAt = rest.findIndex((l) => l.trim() === '');
        bodyLines = blankAt >= 0 ? rest.slice(blankAt + 1) : (headers.from || headers.subject ? [] : rest);
      } else if (ATTRIBUTION_RE.test(startLine)) {
        // "On <date>, X wrote:" — derive from/date from the attribution, body is the rest.
        const am = /^\s*On\s+(.*?),?\s+(.+?)\s+wrote:\s*$/i.exec(startLine);
        if (am) {
          const maybeDate = parseDate(am[1]);
          headers.date = maybeDate;
          headers.from = (am[2] || '').trim();
        }
        bodyLines = chunk.slice(1);
        // An attribution that introduces only quoted text (no fresh body) is just a quote header,
        // not a real message — drop it. Mark so the empty-chunk check below applies even though we
        // derived a `from` from the attribution.
        attributionOnly = true;
      }

      const { body, quotedDepth } = splitBody(bodyLines.join('\n'));
      // Drop a chunk with no fresh body when it carries no real headers (preamble before the first
      // header, or an attribution that only fronted quoted text).
      const hasRealHeaders = !attributionOnly && (headers.from || headers.subject || headers.date != null);
      if (body === '' && !hasRealHeaders) {
        // An attribution-only chunk is the previous message's reply context — fold its quote depth
        // back onto the previous record so the `>` nesting signal isn't lost.
        const prev = records[records.length - 1];
        if (attributionOnly && prev && quotedDepth > (prev.quotedDepth || 0)) {
          prev.quotedDepth = quotedDepth;
        }
        continue;
      }

      const rec = {
        from: headers.from || '',
        subject: headers.subject || '',
        date: headers.date != null ? headers.date : null,
        body,
        quotedDepth,
      };
      if (headers.to) rec.to = headers.to;
      records.push(rec);
    }
    return records;
  } catch {
    return [];
  }
}

// ── sortByDate: chronological (oldest first); undated records sorted last, original order kept. ──
// Stable: equal/undated keep their input order. Returns a new array. Bad input -> []. Never throws.
export function sortByDate(records) {
  try {
    if (!Array.isArray(records)) return [];
    const indexed = records
      .filter((r) => r && typeof r === 'object')
      .map((r, i) => ({ r, i, t: r.date != null ? Date.parse(r.date) : NaN }));
    indexed.sort((a, b) => {
      const an = Number.isNaN(a.t);
      const bn = Number.isNaN(b.t);
      if (an && bn) return a.i - b.i; // both undated — preserve order
      if (an) return 1; // undated last
      if (bn) return -1;
      if (a.t !== b.t) return a.t - b.t;
      return a.i - b.i; // tie — preserve order
    });
    return indexed.map((x) => x.r);
  } catch {
    return [];
  }
}

// ── extractParticipants: deduped, sorted list of from/to addresses + display names. ──
// Pulls "Name <addr>" / "addr" tokens out of every record's from/to, dedupes case-insensitively on
// the normalized token, and returns them sorted. Bad input -> []. Never throws.
export function extractParticipants(records) {
  try {
    if (!Array.isArray(records)) return [];
    const seen = new Map(); // normalized -> original token
    const addTokens = (field) => {
      if (field == null) return;
      // Split a recipient list on commas / semicolons.
      for (const part of String(field).split(/[,;]/)) {
        const tok = part.trim();
        if (tok === '') continue;
        const key = tok.toLowerCase();
        if (!seen.has(key)) seen.set(key, tok);
      }
    };
    for (const r of records) {
      if (!r || typeof r !== 'object') continue;
      addTokens(r.from);
      addTokens(r.to);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

// ── Guarded CLI: read a raw email dump from a file arg or stdin, print a record-count summary. ──
// Pure demo aid; no network, no secrets. `node integrations/email-thread.mjs path/to/dump.txt`
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    try {
      const { readFileSync } = await import('node:fs');
      const arg = process.argv[2];
      const raw = arg ? readFileSync(arg, 'utf8') : readFileSync(0, 'utf8');
      const records = sortByDate(parseEmailText(raw));
      const participants = extractParticipants(records);
      const dated = records.filter((r) => r.date != null).length;
      process.stdout.write(
        `email-thread: ${records.length} message(s), ${dated} dated, ` +
          `${participants.length} participant(s)\n`,
      );
      for (const r of records) {
        process.stdout.write(
          `  - [${r.date || 'no-date'}] ${r.from || '(unknown)'} :: ${r.subject || '(no subject)'}\n`,
        );
      }
    } catch (e) {
      process.stderr.write('email-thread: ' + ((e && e.message) || String(e)) + '\n');
      process.exitCode = 1;
    }
  })();
}
