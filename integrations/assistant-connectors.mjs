// assistant-connectors.mjs — the private assistant's first capability grants (task #134).
//
// SCOPE — READ + DRAFT ONLY. The assistant may *read* the operator's calendar and mail, and
// *draft* an event or a reply, but it NEVER sends, pushes, or mutates anything. The operator
// reviews every draft and sends it himself. There is, by construction, no send function in this
// file — drafting returns a string (iCalendar VEVENT / RFC822 message) that the operator hands to
// his own client. This is the queue-#134 boundary: tokens are vault grants scoped to read+draft.
//
// Two grants:
//   • calendar (CalDAV)  — listEvents({range})            read existing events (parse injected CalDAV)
//                          createEventDraft(evt)           → an iCalendar VEVENT *string* (a DRAFT)
//   • email   (IMAP/JMAP) — listMessages({folder, query})  parse injected IMAP/JMAP → normalized rows
//                          draftReply({to, subject, body}) → an RFC822 *string* (a DRAFT, not sent)
//
// PURE + injectable: no live network in this module. A transport is injected (__setFetch for JMAP /
// CalDAV-over-HTTP, or pass a pre-fetched payload directly). The builders/parsers are pure and are
// what the offline tests exercise. Holds no keys; the bearer/vault grant lives outside this file.
//
//   import { calendar, email } from './integrations/assistant-connectors.mjs';
//   const events = await calendar.listEvents({ range, transport });
//   const ics    = calendar.createEventDraft({ summary, start, end });   // DRAFT string
//   const rows   = email.listMessages({ folder: 'INBOX', raw });        // normalized
//   const eml    = email.draftReply({ to, subject, body });             // DRAFT string

// ── injectable transport (no live network here) ──────────────────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const pad2 = (n) => String(n).padStart(2, '0');
const esc = (s) => String(s == null ? '' : s);

// ── PURE: iCalendar (RFC 5545) ────────────────────────────────────────────────────────────────────

/** Format a Date|ISO-string|epoch-ms as an iCal UTC timestamp: YYYYMMDDTHHMMSSZ. */
export function icalDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('icalDate: invalid date');
  return (
    d.getUTCFullYear() +
    pad2(d.getUTCMonth() + 1) +
    pad2(d.getUTCDate()) +
    'T' +
    pad2(d.getUTCHours()) +
    pad2(d.getUTCMinutes()) +
    pad2(d.getUTCSeconds()) +
    'Z'
  );
}

/** Escape a value for an iCal TEXT field (RFC 5545 §3.3.11). */
export function icalText(s) {
  return esc(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/** Fold a content line at 75 octets per RFC 5545 §3.1 (continuation lines start with a space). */
export function foldLine(line) {
  if (line.length <= 75) return line;
  const out = [];
  let rest = line;
  out.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 74) {
    out.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  if (rest.length) out.push(' ' + rest);
  return out.join('\r\n');
}

/**
 * PURE iCalendar builder. Returns a complete VCALENDAR wrapping one VEVENT — a DRAFT string.
 * Does NOT push to any calendar. evt: { uid?, summary, description?, location?, start, end?, organizer?, attendees? }
 */
export function buildICalendar(evt = {}) {
  if (!evt.start) throw new Error('buildICalendar: start is required');
  const uid = evt.uid || `${Date.now()}-${Math.random().toString(36).slice(2)}@melek-assistant`;
  const dtstamp = icalDate(evt.dtstamp || new Date());
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//MELEK//assistant-connectors//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${icalText(uid)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${icalDate(evt.start)}`,
  ];
  if (evt.end) lines.push(`DTEND:${icalDate(evt.end)}`);
  lines.push(`SUMMARY:${icalText(evt.summary || '(no title)')}`);
  if (evt.description) lines.push(`DESCRIPTION:${icalText(evt.description)}`);
  if (evt.location) lines.push(`LOCATION:${icalText(evt.location)}`);
  if (evt.organizer) lines.push(`ORGANIZER:mailto:${icalText(evt.organizer)}`);
  for (const a of evt.attendees || []) lines.push(`ATTENDEE:mailto:${icalText(a)}`);
  // It is a DRAFT held for the operator's review, not a confirmed booking.
  lines.push('STATUS:TENTATIVE');
  lines.push('END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.map(foldLine).join('\r\n') + '\r\n';
}

// ── PURE: CalDAV / iCal parsing (read side) ─────────────────────────────────────────────────────

/** Unfold RFC 5545 content lines (a leading space/tab continues the previous line). */
function unfold(raw) {
  return esc(raw).replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/** Reverse icalText escaping for a TEXT value. */
function unescapeIcalText(s) {
  return esc(s)
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\');
}

/** Parse an iCal UTC/basic timestamp back to an ISO string (best-effort). */
function parseIcalDate(v) {
  const m = esc(v).match(/(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?/);
  if (!m) return null;
  const [, y, mo, d, hh = '00', mm = '00', ss = '00', z] = m;
  const iso = `${y}-${mo}-${d}T${hh}:${mm}:${ss}${z ? 'Z' : 'Z'}`;
  const dt = new Date(iso);
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString();
}

/** PURE: parse raw iCal text (one or more VEVENTs) → [{ uid, summary, start, end, location, description }]. */
export function parseICalEvents(raw) {
  const text = unfold(raw);
  const out = [];
  const blocks = text.split('BEGIN:VEVENT').slice(1);
  for (const b of blocks) {
    const body = b.split('END:VEVENT')[0];
    const ev = {};
    for (const line of body.split('\n')) {
      const idx = line.indexOf(':');
      if (idx < 0) continue;
      const keyPart = line.slice(0, idx); // may carry params: DTSTART;TZID=...
      const value = line.slice(idx + 1).trim();
      const key = keyPart.split(';')[0].toUpperCase();
      if (key === 'UID') ev.uid = value;
      else if (key === 'SUMMARY') ev.summary = unescapeIcalText(value);
      else if (key === 'DESCRIPTION') ev.description = unescapeIcalText(value);
      else if (key === 'LOCATION') ev.location = unescapeIcalText(value);
      else if (key === 'DTSTART') ev.start = parseIcalDate(value);
      else if (key === 'DTEND') ev.end = parseIcalDate(value);
    }
    if (ev.uid || ev.summary || ev.start) out.push(ev);
  }
  return out;
}

/** Keep events whose start falls within [range.start, range.end] (inclusive). Missing bound = open. */
export function filterByRange(events, range = {}) {
  const lo = range.start != null ? new Date(range.start).getTime() : -Infinity;
  const hi = range.end != null ? new Date(range.end).getTime() : Infinity;
  return (events || []).filter((e) => {
    if (!e.start) return false;
    const t = new Date(e.start).getTime();
    return t >= lo && t <= hi;
  });
}

// ── PURE: RFC822 (email message) builder, read+draft ────────────────────────────────────────────

/** Encode a header value with RFC 2047 if it contains non-ASCII; else return as-is. */
export function encodeHeader(value) {
  const v = esc(value);
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(v)) return v;
  return `=?UTF-8?B?${Buffer.from(v, 'utf8').toString('base64')}?=`;
}

/** Ensure a reply subject is prefixed with "Re:" exactly once. */
export function replySubject(subject) {
  const s = esc(subject).trim();
  return /^re:/i.test(s) ? s : `Re: ${s}`;
}

/**
 * PURE RFC822 builder. Returns a complete message string — a DRAFT. Does NOT send.
 * msg: { from?, to, cc?, subject, body, inReplyTo?, references?, date? }
 */
export function buildRfc822(msg = {}) {
  if (!msg.to) throw new Error('buildRfc822: to is required');
  const date = (msg.date ? new Date(msg.date) : new Date()).toUTCString();
  const toList = Array.isArray(msg.to) ? msg.to.join(', ') : msg.to;
  const headers = [];
  if (msg.from) headers.push(`From: ${encodeHeader(msg.from)}`);
  headers.push(`To: ${encodeHeader(toList)}`);
  if (msg.cc) headers.push(`Cc: ${encodeHeader(Array.isArray(msg.cc) ? msg.cc.join(', ') : msg.cc)}`);
  headers.push(`Subject: ${encodeHeader(msg.subject || '')}`);
  headers.push(`Date: ${date}`);
  if (msg.inReplyTo) headers.push(`In-Reply-To: ${msg.inReplyTo}`);
  if (msg.references) headers.push(`References: ${Array.isArray(msg.references) ? msg.references.join(' ') : msg.references}`);
  headers.push('MIME-Version: 1.0');
  headers.push('Content-Type: text/plain; charset=UTF-8');
  headers.push('Content-Transfer-Encoding: 8bit');
  // X-MELEK-Draft marks this as held for operator review; it is never sent by this module.
  headers.push('X-MELEK-Draft: read-and-draft-only; operator-sends');
  const body = esc(msg.body).replace(/\r?\n/g, '\r\n');
  return headers.join('\r\n') + '\r\n\r\n' + body + '\r\n';
}

// ── PURE: simple mailbox parser ─────────────────────────────────────────────────────────────────

/** Decode an RFC 2047 encoded-word ("=?UTF-8?B?...?=" / "=?...?Q?...?="). Best-effort. */
function decodeHeaderWord(value) {
  return esc(value).replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, _cs, enc, data) => {
    try {
      if (enc.toUpperCase() === 'B') return Buffer.from(data, 'base64').toString('utf8');
      // Q-encoding
      return data.replace(/_/g, ' ').replace(/=([0-9A-Fa-f]{2})/g, (_m, h) => String.fromCharCode(parseInt(h, 16)));
    } catch { return data; }
  });
}

/** PURE: parse a raw RFC822 message string → normalized { from, subject, date, snippet }. */
export function parseRfc822(raw) {
  const text = esc(raw).replace(/\r\n/g, '\n');
  const split = text.indexOf('\n\n');
  const head = split >= 0 ? text.slice(0, split) : text;
  const body = split >= 0 ? text.slice(split + 2) : '';
  // unfold folded headers
  const headerText = head.replace(/\n[ \t]+/g, ' ');
  const headers = {};
  for (const line of headerText.split('\n')) {
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    headers[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
  }
  const snippet = body.replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    from: decodeHeaderWord(headers.from || ''),
    subject: decodeHeaderWord(headers.subject || ''),
    date: headers.date || '',
    snippet,
  };
}

/** Normalize one message-shaped object (from IMAP ENVELOPE / JMAP / pre-parsed) → {from,subject,date,snippet}. */
export function normalizeMessage(m = {}) {
  if (typeof m === 'string') return parseRfc822(m);
  if (m.raw || m.rfc822) return parseRfc822(m.raw || m.rfc822);
  // JMAP Email shape: from = [{name,email}], subject, receivedAt, preview
  const fromField =
    Array.isArray(m.from) && m.from.length
      ? m.from.map((f) => (f.name ? `${f.name} <${f.email}>` : f.email)).join(', ')
      : m.from || m.sender || '';
  const snippet = (m.preview || m.snippet || m.bodyText || m.body || '').toString().replace(/\s+/g, ' ').trim().slice(0, 200);
  return {
    from: decodeHeaderWord(fromField),
    subject: decodeHeaderWord(m.subject || ''),
    date: m.date || m.receivedAt || m.internalDate || '',
    snippet,
  };
}

/** PURE: parse an injected IMAP/JMAP response into normalized rows.
 *  Accepts: an array of message objects/strings, a JMAP { list: [...] } / { ids, list }, or
 *  a JMAP method-response [["Email/get",{ list:[...] }, "0"]]. */
export function parseMailbox(payload) {
  let list = [];
  if (Array.isArray(payload)) {
    // JMAP method-response triple?
    if (payload.length && Array.isArray(payload[0]) && payload[0][0] && payload[0][1]) {
      const args = payload[0][1];
      list = args.list || args.messages || [];
    } else {
      list = payload;
    }
  } else if (payload && typeof payload === 'object') {
    if (Array.isArray(payload.methodResponses)) {
      const mr = payload.methodResponses.find((r) => r[1] && (r[1].list || r[1].messages));
      list = (mr && (mr[1].list || mr[1].messages)) || [];
    } else {
      list = payload.list || payload.messages || payload.items || [];
    }
  }
  return list.map(normalizeMessage);
}

// ── GRANT: calendar (CalDAV), read + draft ──────────────────────────────────────────────────────
export const calendar = {
  /**
   * READ existing events within a range. Pure parse over injected data — no live network in this
   * module. Pass one of: { raw } (iCal text), { events } (pre-parsed), or { transport } (an async
   * fn returning iCal text, e.g. a CalDAV REPORT result). range: { start, end } (ISO/Date/epoch).
   */
  async listEvents({ range = {}, raw = null, events = null, transport = null } = {}) {
    let evs = events;
    if (!evs) {
      let icalText = raw;
      if (icalText == null && typeof transport === 'function') icalText = await transport({ range });
      evs = icalText != null ? parseICalEvents(icalText) : [];
    }
    return filterByRange(evs, range);
  },

  /** DRAFT an event → an iCalendar VEVENT string. NOT pushed to any calendar; operator reviews + adds. */
  createEventDraft(evt) {
    return buildICalendar(evt);
  },
};

// ── GRANT: email (IMAP/JMAP), read + draft ──────────────────────────────────────────────────────
export const email = {
  /**
   * READ messages from a folder. Pure parse over an injected IMAP/JMAP response — no live network.
   * Pass one of: { raw } (a response payload to parse) or { transport } (async fn → response).
   * Returns normalized rows: { from, subject, date, snippet }. `query` is passed to the transport.
   */
  async listMessages({ folder = 'INBOX', query = '', raw = null, transport = null } = {}) {
    let payload = raw;
    if (payload == null && typeof transport === 'function') payload = await transport({ folder, query });
    if (payload == null) return [];
    return parseMailbox(payload);
  },

  /** DRAFT a reply → an RFC822 message string. NOT sent. Operator reviews + sends from his client. */
  draftReply({ to, subject, body, from = null, inReplyTo = null, references = null } = {}) {
    return buildRfc822({ to, subject: replySubject(subject), body, from, inReplyTo, references });
  },
};

// NOTE: there is deliberately NO send/push function in this module. Read + draft only (queue #134).
// The operator sends. Tokens are vault grants scoped to read+draft; this file holds no keys.

// ── CLI (guarded) ────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('assistant-connectors.mjs')) {
  console.log('assistant-connectors — READ + DRAFT only (operator sends). No send function exists.\n');
  console.log('— iCalendar VEVENT draft —');
  console.log(
    calendar.createEventDraft({
      summary: 'Review the MELEK witness brief',
      start: '2026-06-10T15:00:00Z',
      end: '2026-06-10T16:00:00Z',
      location: 'Server 4',
      description: 'Read + draft only; operator confirms.',
    }),
  );
  console.log('— RFC822 reply draft —');
  console.log(
    email.draftReply({
      to: 'someone@example.com',
      subject: 'the proposal',
      body: 'Thank you — a considered reply will follow.\n\n— drafted by the assistant, for the operator to send',
      from: 'operator@example.com',
    }),
  );
}
