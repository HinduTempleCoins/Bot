// integrations/festivals.mjs — FESTIVAL & EVENT TRACKER: get real-world events in, and back out again.
//
// ⭐ WHY iCal AND NOT APIs. Every events platform worth aggregating has locked its API down: Reddit is
// 2-4 weeks of manual approval then commercial pricing, Meetup's API is partner-gated, Eventbrite
// removed public event search in 2020. But all of them — Luma, Meetup, Eventbrite, Google Calendar,
// Bandsintown, and any WordPress events plugin — still publish a public .ics feed, because subscribing
// to a calendar is a feature users demand. iCal needs no key, no approval, no contract, and it is a
// frozen 1998 standard that cannot be revoked in a pricing change.
//
// This module is an ADAPTER, not a second calendar. integrations/calendar.mjs is the ecosystem store;
// this turns the outside world into rows it accepts, and turns our rows back into a feed people can
// subscribe to in any calendar app.
//
// ⚠️ THE THREE THINGS IMPLEMENTATIONS GET WRONG, all handled and all tested:
//   1. LINE FOLDING. RFC 5545 §3.1 folds long lines at 75 octets with CRLF + one space/tab. Parse
//      without unfolding and a long SUMMARY silently truncates mid-word.
//   2. DTEND IS EXCLUSIVE FOR ALL-DAY EVENTS. A one-day festival on the 17th is DTSTART;VALUE=DATE
//      :20260417 / DTEND;VALUE=DATE:20260418. Read that literally and every all-day event is a day
//      longer than it is — which for a 3-day festival means showing the wrong end date to everyone.
//   3. ESCAPED TEXT. \n \, \; \\ inside SUMMARY/DESCRIPTION/LOCATION are escapes, not literals.
//
// No network here — feeds are fetched by the caller and passed in as text. Soft-fail, never throws.

const clean = (s) => String(s == null ? '' : s).trim();
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** What kind of thing this is. Kept small on purpose — a taxonomy nobody can apply is noise. */
export const KINDS = Object.freeze(['festival', 'conference', 'meetup', 'ceremony', 'market', 'show', 'other']);
export const normKind = (k) => (KINDS.includes(clean(k).toLowerCase()) ? clean(k).toLowerCase() : 'other');

const DAY_MS = 86400000;

// ── iCal text unescaping (RFC 5545 §3.3.11) ─────────────────────────────────────────────────────────
export function unescapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\;/g, ';').replace(/\\\\/g, '\\');
}
export function escapeText(s) {
  return String(s == null ? '' : s)
    .replace(/\\/g, '\\\\').replace(/;/g, '\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/**
 * Unfold per RFC 5545 §3.1 — a CRLF followed by a single space or tab is a continuation, not a break.
 * Done BEFORE any line is read, or long values truncate silently.
 */
export const unfold = (text) => String(text == null ? '' : text).replace(/\r\n[ \t]|\r[ \t]|\n[ \t]/g, '');

/** Parse `DTSTART;TZID=America/Chicago:20260417T190000` → { name, params, value }. */
export function parseLine(line) {
  const s = String(line || '');
  // ⚠️ Find the first colon OUTSIDE quotes. RFC 5545 §3.2 lets a param value be quoted precisely so it
  // can contain a colon — `SUMMARY;X="a:b":hello`. A naive indexOf(':') splits inside the quotes and
  // silently hands back a truncated param plus a mangled value.
  let colon = -1; let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') { inQuote = !inQuote; continue; }
    if (c === ':' && !inQuote) { colon = i; break; }
  }
  if (colon < 0) return null;
  const left = s.slice(0, colon); const value = s.slice(colon + 1);
  const bits = left.split(';');
  const name = clean(bits.shift()).toUpperCase();
  if (!name) return null;
  const params = {};
  for (const b of bits) {
    const eq = b.indexOf('=');
    if (eq < 0) continue;
    params[clean(b.slice(0, eq)).toUpperCase()] = clean(b.slice(eq + 1)).replace(/^"|"$/g, '');
  }
  return { name, params, value };
}

/**
 * An iCal date/time → { ms, allDay }.
 * ⚠️ A floating or TZID-qualified local time is read as UTC. Without a tz database that is the honest
 * approximation, and it is recorded on the row as `tzApprox` so a caller can see it rather than
 * discovering a several-hour drift later.
 */
export function parseIcalDate(value, params = {}) {
  const v = clean(value);
  const isDate = clean(params.VALUE).toUpperCase() === 'DATE' || /^\d{8}$/.test(v);
  if (isDate) {
    const m = /^(\d{4})(\d{2})(\d{2})$/.exec(v);
    if (!m) return { ms: NaN, allDay: true };
    return { ms: Date.UTC(+m[1], +m[2] - 1, +m[3]), allDay: true, tzApprox: false };
  }
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(v);
  if (!m) return { ms: NaN, allDay: false };
  const ms = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]);
  return { ms, allDay: false, tzApprox: !m[7] };   // no Z and we have no tz db → approximate
}

/**
 * Parse an .ics document into normalized event rows. Never throws; a malformed VEVENT is skipped with
 * the rest kept, because one bad entry in a public feed must not cost you the other 200.
 */
export function parseIcs(text, { source = '', defaultKind = 'other' } = {}) {
  const out = []; const skipped = [];
  const body = unfold(text);
  if (!body.trim()) return { events: out, skipped, source };

  const blocks = body.split(/BEGIN:VEVENT/i).slice(1);
  for (const raw of blocks) {
    const block = raw.split(/END:VEVENT/i)[0] || '';
    const fields = {};
    for (const line of block.split(/\r?\n/)) {
      const p = parseLine(line);
      if (!p) continue;
      if (!fields[p.name]) fields[p.name] = p;
    }
    const summary = unescapeText(fields.SUMMARY ? fields.SUMMARY.value : '');
    if (!summary) { skipped.push({ reason: 'no SUMMARY' }); continue; }
    if (!fields.DTSTART) { skipped.push({ reason: 'no DTSTART', title: summary }); continue; }

    const st = parseIcalDate(fields.DTSTART.value, fields.DTSTART.params);
    if (!Number.isFinite(st.ms)) { skipped.push({ reason: 'unparseable DTSTART', title: summary }); continue; }

    let endMs = st.ms;
    let allDay = st.allDay;
    if (fields.DTEND) {
      const en = parseIcalDate(fields.DTEND.value, fields.DTEND.params);
      if (Number.isFinite(en.ms)) {
        // ⚠️ DTEND is EXCLUSIVE for DATE values. A one-day festival is 0417→0418; read literally,
        // every all-day event runs a day long, and a 3-day festival shows the wrong closing date.
        endMs = en.allDay ? Math.max(st.ms, en.ms - DAY_MS) : en.ms;
        allDay = allDay || en.allDay;
      }
    } else if (fields.DURATION) {
      const d = /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?)?$/i.exec(clean(fields.DURATION.value));
      if (d) endMs = st.ms + ((+d[1] || 0) * DAY_MS) + ((+d[2] || 0) * 3600000) + ((+d[3] || 0) * 60000);
    }

    const description = unescapeText(fields.DESCRIPTION ? fields.DESCRIPTION.value : '');
    // ⚠️ Luma — the feed that matters most here — sends NO URL property. Verified against a live
    // Denver feed: 12 events, zero URL fields, and the canonical link sitting inside DESCRIPTION as
    // "Get up-to-date information at: https://luma.com/…". Taking only fields.URL yields an event
    // nobody can click through to, which is most of the value gone.
    let url = fields.URL ? clean(fields.URL.value) : '';
    if (!url) {
      const m = /https?:\/\/[^\s<>"'\\]+/.exec(description);
      if (m) url = m[0].replace(/[.,;)]+$/, '');
    }

    // GEO is `lat;lon` per RFC 5545 §3.8.1.6. Luma sends it; it is the difference between a list and
    // a map, and it is free.
    let lat = null; let lon = null;
    if (fields.GEO) {
      const g = clean(fields.GEO.value).split(';').map(Number);
      if (g.length === 2 && Number.isFinite(g[0]) && Number.isFinite(g[1])) { [lat, lon] = g; }
    }

    // ORGANIZER carries a display name in CN; the MAILTO is usually the platform's own relay address
    // (Luma sends calendar-invite@lu.ma for every event) so it is NOT a contact route and is dropped.
    const organizer = fields.ORGANIZER ? clean(fields.ORGANIZER.params.CN || '') : '';

    out.push(normalize({
      uid: fields.UID ? clean(fields.UID.value) : '',
      title: summary,
      start: st.ms,
      end: Math.max(st.ms, endMs),
      allDay,
      tzApprox: !!st.tzApprox,
      location: unescapeText(fields.LOCATION ? fields.LOCATION.value : ''),
      description,
      url, lat, lon, organizer,
      kind: defaultKind,
      source,
    }));
  }
  return { events: out, skipped, source };
}

/** Pull a city out of a free-text LOCATION. Best-effort and marked as such — never asserted as truth. */
export function guessCity(location) {
  const parts = String(location || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return '';
  // "Venue, 123 St, Austin, TX 78701, USA" → the part before a state/zip/country tail
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (/^\d/.test(p)) continue;                                  // street number
    if (/^(usa|united states|uk|canada|mexico)$/i.test(p)) continue;
    if (/^[A-Z]{2}(\s+\d{5})?$/.test(p)) continue;                // state, or state + zip
    // `i > 0` was wrong: in "Austin, TX" the city IS index 0, so every two-part location returned
    // nothing. The guard should only reject a SINGLE-part string, which the length check above does.
    return p;
  }
  return '';
}

/** One row, shaped and defended. */
export function normalize(input = {}) {
  const e = input && typeof input === 'object' ? input : {};
  const start = Number(e.start);
  const end = Number.isFinite(Number(e.end)) ? Math.max(start, Number(e.end)) : start;
  const location = clean(e.location);
  return {
    uid: clean(e.uid),
    title: clean(e.title),
    start, end,
    allDay: !!e.allDay,
    tzApprox: !!e.tzApprox,
    days: Math.max(1, Math.round((end - start) / DAY_MS) + (e.allDay ? 1 : 0)),
    kind: normKind(e.kind),
    location,
    city: clean(e.city) || guessCity(location),
    url: clean(e.url),
    description: clean(e.description).slice(0, 600),
    source: clean(e.source),
    organizer: clean(e.organizer),
    lat: Number.isFinite(Number(e.lat)) ? Number(e.lat) : null,
    lon: Number.isFinite(Number(e.lon)) ? Number(e.lon) : null,
    tags: Array.isArray(e.tags) ? e.tags.map((t) => clean(t).toLowerCase()).filter(Boolean) : [],
  };
}

/**
 * ⚠️ Dedupe across feeds. The same festival appears on the organiser's calendar, the venue's, and an
 * aggregator's, with three different UIDs — so UID alone is not enough. Two rows are the same event
 * when they start the same day and their titles agree once punctuation and noise words are stripped.
 */
export const dedupeKey = (e) => {
  const t = String(e.title || '').toLowerCase()
    .replace(/\b(the|a|an|annual|\d{4})\b/g, '')
    .replace(/[^a-z0-9]/g, '');
  return `${t}|${new Date(Number(e.start) || 0).toISOString().slice(0, 10)}`;
};

export function merge(lists = []) {
  const seen = new Map();
  const dupes = [];
  for (const row of [].concat(...lists.filter(Array.isArray))) {
    if (!row || !row.title || !Number.isFinite(Number(row.start))) continue;
    const k = dedupeKey(row);
    const prev = seen.get(k);
    if (!prev) { seen.set(k, row); continue; }
    dupes.push({ key: k, kept: prev.source, dropped: row.source });
    // Keep the richer row — a listing with a url and a location beats a bare title.
    const score = (x) => (x.url ? 2 : 0) + (x.location ? 1 : 0) + (x.description ? 1 : 0);
    if (score(row) > score(prev)) seen.set(k, { ...row, source: prev.source === row.source ? row.source : `${prev.source}+${row.source}` });
    else if (prev.source !== row.source) seen.set(k, { ...prev, source: `${prev.source}+${row.source}` });
  }
  const events = [...seen.values()].sort((a, b) => a.start - b.start);
  return { events, duplicates: dupes };
}

export const upcoming = (events, fromMs, limit = 50) =>
  (Array.isArray(events) ? events : [])
    .filter((e) => Number(e.end) >= Number(fromMs)).sort((a, b) => a.start - b.start).slice(0, Math.max(0, limit));

// ── emitting a feed people can subscribe to ─────────────────────────────────────────────────────────
const pad = (n) => String(n).padStart(2, '0');
const icalDate = (ms) => { const d = new Date(ms); return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}`; };
const icalStamp = (ms) => `${icalDate(ms)}T${pad(new Date(ms).getUTCHours())}${pad(new Date(ms).getUTCMinutes())}${pad(new Date(ms).getUTCSeconds())}Z`;

/** Fold a content line at 75 octets with CRLF + space, per RFC 5545 §3.1. */
export function fold(line) {
  const s = String(line || '');
  if (s.length <= 75) return s;
  const parts = [s.slice(0, 75)];
  for (let i = 75; i < s.length; i += 74) parts.push(` ${s.slice(i, i + 74)}`);
  return parts.join('\r\n');
}

export function toIcs(events = [], { name = 'MELEK Events', prodId = '-//MELEK//Festival Tracker//EN', now = Date.now() } = {}) {
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:${prodId}`, 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    fold(`X-WR-CALNAME:${escapeText(name)}`)];
  for (const [i, e] of (Array.isArray(events) ? events : []).entries()) {
    if (!e || !Number.isFinite(Number(e.start))) continue;
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${escapeText(e.uid || `melek-${i}-${e.start}`)}`);
    lines.push(`DTSTAMP:${icalStamp(Number(now))}`);
    if (e.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${icalDate(e.start)}`);
      // Exclusive again on the way OUT — the inverse of the read, or a round trip loses a day.
      lines.push(`DTEND;VALUE=DATE:${icalDate(Number(e.end) + DAY_MS)}`);
    } else {
      lines.push(`DTSTART:${icalStamp(e.start)}`);
      lines.push(`DTEND:${icalStamp(Number(e.end) || e.start)}`);
    }
    lines.push(fold(`SUMMARY:${escapeText(e.title)}`));
    if (e.location) lines.push(fold(`LOCATION:${escapeText(e.location)}`));
    if (e.url) lines.push(fold(`URL:${escapeText(e.url)}`));
    if (e.description) lines.push(fold(`DESCRIPTION:${escapeText(e.description)}`));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

export default { parseIcs, parseLine, parseIcalDate, unfold, normalize, merge, dedupeKey, upcoming, toIcs, fold, escapeText, unescapeText, guessCity, KINDS, normKind, esc };
