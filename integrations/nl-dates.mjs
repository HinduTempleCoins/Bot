// nl-dates.mjs — natural-language date extractor.
//
// Finds and normalizes dates inside free text to ISO + character offsets.
// PURE, deterministic, no network, soft-fail (never throws). Backs the
// "Extract key information (...dates)" + timeline-building itinerary items, and
// complements integrations/event-timeline.mjs (which consumes already-structured
// dates — this module produces them out of prose).
//
// Recognized formats:
//   - ISO:           YYYY-MM-DD
//   - US:            M/D/YYYY  (also M/D/YY, with INJECTED reference year)
//   - "Month D, YYYY"          (March 14, 2017 / Mar 14 2017)
//   - "D Month YYYY"           (14 March 2017)
//   - "Month YYYY"             (March 2017)  -> granularity 'month'
//   - bare 4-digit year        (2017)        -> granularity 'year', range 1000-2099
//
// Month-name table is built-in (English, case-insensitive, 3-letter + full).
// Ambiguous / invalid dates (e.g. 13/40/2020, Feb 30) are SKIPPED, never thrown.
// Reference year for 2-digit years is INJECTED via opts.now — never the wall clock.
//
//   extractDates(text, opts?) -> [{ raw, iso, granularity:'day'|'month'|'year', index }]
//   normalizeToIso(raw, opts?) -> string | null
//   earliest(text, opts?) / latest(text, opts?) -> iso | null
//
//   node integrations/nl-dates.mjs   (runs a tiny self-demo)

const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// English month names: full + 3-letter abbreviation -> 1-based month number.
const MONTHS = {
  january: 1, jan: 1,
  february: 2, feb: 2,
  march: 3, mar: 3,
  april: 4, apr: 4,
  may: 5,
  june: 6, jun: 6,
  july: 7, jul: 7,
  august: 8, aug: 8,
  september: 9, sep: 9, sept: 9,
  october: 10, oct: 10,
  november: 11, nov: 11,
  december: 12, dec: 12,
};

// Alternation of all month tokens, longest-first so "march" wins over "mar".
const MONTH_ALT = Object.keys(MONTHS).sort((a, b) => b.length - a.length).join('|');

const pad = (n) => String(n).padStart(2, '0');

// Days in a month, with leap-year handling. month is 1-based.
function daysInMonth(year, month) {
  if (month === 2) {
    const leap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
    return leap ? 29 : 28;
  }
  return [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

// Validate a (year, month, day) triple. Returns true only for a real calendar date.
function validYmd(y, m, d) {
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  if (y < 1000 || y > 2099) return false;
  if (m < 1 || m > 12) return false;
  if (d < 1 || d > daysInMonth(y, m)) return false;
  return true;
}

// Resolve a 2-digit year against an injected reference year (opts.now).
// Pivot: same century as the reference year, sliding +/- 50 years.
function resolveTwoDigitYear(yy, opts) {
  const refYear = referenceYear(opts);
  const century = Math.floor(refYear / 100) * 100;
  let full = century + yy;
  // Slide so the resolved year stays within ~50 years of the reference.
  if (full - refYear > 50) full -= 100;
  else if (refYear - full > 50) full += 100;
  return full;
}

// Reference year, INJECTED via opts.now (Date | epoch ms | ISO string | number-year).
// Never reads the wall clock; falls back to a fixed sentinel if absent/unparseable.
function referenceYear(opts) {
  const now = opts && opts.now;
  if (now != null) {
    try {
      if (now instanceof Date) {
        const t = now.getTime();
        if (Number.isFinite(t)) return now.getUTCFullYear();
      } else if (typeof now === 'number' && Number.isFinite(now)) {
        // 4-digit -> treat as a year; otherwise epoch ms.
        if (now >= 1000 && now <= 9999) return Math.trunc(now);
        const d = new Date(now);
        if (Number.isFinite(d.getTime())) return d.getUTCFullYear();
      } else if (typeof now === 'string') {
        const m = /^(\d{4})/.exec(now.trim());
        if (m) return +m[1];
        const d = new Date(now);
        if (Number.isFinite(d.getTime())) return d.getUTCFullYear();
      }
    } catch { /* fall through */ }
  }
  return 2000; // deterministic sentinel when no reference is injected
}

// One regex per format, all global. ORDER MATTERS in extractDates: more specific
// (with a day/month) is matched first, and matched spans are reserved so a bare
// year inside "March 14, 2017" is not double-counted.
function patterns() {
  return [
    // ISO YYYY-MM-DD
    { kind: 'iso', gran: 'day', re: /\b(\d{4})-(\d{1,2})-(\d{1,2})\b/g },
    // Month D, YYYY  /  Month D YYYY
    { kind: 'mdy-name', gran: 'day', re: new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})\\b`, 'gi') },
    // D Month YYYY
    { kind: 'dmy-name', gran: 'day', re: new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTH_ALT})\\.?,?\\s+(\\d{4})\\b`, 'gi') },
    // US numeric M/D/YYYY or M/D/YY
    { kind: 'us', gran: 'day', re: /\b(\d{1,2})\/(\d{1,2})\/(\d{2,4})\b/g },
    // Month YYYY  (no day)
    { kind: 'my-name', gran: 'month', re: new RegExp(`\\b(${MONTH_ALT})\\.?\\s+(\\d{4})\\b`, 'gi') },
    // bare 4-digit year (1000-2099)
    { kind: 'year', gran: 'year', re: /\b(1[0-9]{3}|20[0-9]{2})\b/g },
  ];
}

// Build an ISO-ish string (day -> YYYY-MM-DD, month -> YYYY-MM, year -> YYYY) from a
// regex match for the given pattern kind. Returns { iso, gran } or null if invalid.
function buildFromMatch(kind, m, opts) {
  try {
    if (kind === 'iso') {
      const y = +m[1], mo = +m[2], d = +m[3];
      if (!validYmd(y, mo, d)) return null;
      return { iso: `${y}-${pad(mo)}-${pad(d)}`, gran: 'day' };
    }
    if (kind === 'mdy-name') {
      const mo = MONTHS[m[1].toLowerCase()];
      const d = +m[2], y = +m[3];
      if (mo == null || !validYmd(y, mo, d)) return null;
      return { iso: `${y}-${pad(mo)}-${pad(d)}`, gran: 'day' };
    }
    if (kind === 'dmy-name') {
      const d = +m[1];
      const mo = MONTHS[m[2].toLowerCase()];
      const y = +m[3];
      if (mo == null || !validYmd(y, mo, d)) return null;
      return { iso: `${y}-${pad(mo)}-${pad(d)}`, gran: 'day' };
    }
    if (kind === 'us') {
      const mo = +m[1], d = +m[2];
      let y = +m[3];
      if (m[3].length <= 2) y = resolveTwoDigitYear(+m[3], opts);
      if (!validYmd(y, mo, d)) return null;
      return { iso: `${y}-${pad(mo)}-${pad(d)}`, gran: 'day' };
    }
    if (kind === 'my-name') {
      const mo = MONTHS[m[1].toLowerCase()];
      const y = +m[2];
      if (mo == null || y < 1000 || y > 2099 || mo < 1 || mo > 12) return null;
      return { iso: `${y}-${pad(mo)}`, gran: 'month' };
    }
    if (kind === 'year') {
      const y = +m[1];
      if (y < 1000 || y > 2099) return null;
      return { iso: `${y}`, gran: 'year' };
    }
  } catch { /* fall through */ }
  return null;
}

// Whether [start,end) overlaps any reserved span.
function overlaps(reserved, start, end) {
  for (const [s, e] of reserved) {
    if (start < e && end > s) return true;
  }
  return false;
}

export function extractDates(text, opts = {}) {
  const out = [];
  if (typeof text !== 'string' || text === '') return out;

  const reserved = []; // [start, end) spans already claimed by a more-specific match
  for (const { kind, re } of patterns()) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      // Guard against zero-length matches (shouldn't happen, but never loop forever).
      if (m.index === re.lastIndex) re.lastIndex++;
      const start = m.index;
      const end = start + m[0].length;
      if (overlaps(reserved, start, end)) continue;
      const built = buildFromMatch(kind, m, opts);
      // Reserve the span for ALL but the bare-year pattern, even when the date is
      // structurally a M/D/Y or Month-Y shape but invalid (e.g. 13/40/2020). This
      // stops a bare 4-digit year inside such junk from leaking through as a hit.
      if (kind !== 'year') reserved.push([start, end]);
      if (!built) continue;
      if (kind === 'year') reserved.push([start, end]);
      out.push({ raw: m[0], iso: built.iso, granularity: built.gran, index: start });
    }
  }

  // Deterministic order: by character index, then by raw length (longer first).
  out.sort((a, b) => (a.index - b.index) || (b.raw.length - a.raw.length));
  return out;
}

// Normalize a single date string (the whole string should be one date) to ISO.
// Returns the ISO string (granularity-appropriate) or null. Soft-fail.
export function normalizeToIso(raw, opts = {}) {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (s === '') return null;
  const hits = extractDates(s, opts);
  if (hits.length === 0) return null;
  // Prefer a hit anchored at the start covering the whole trimmed string when possible,
  // otherwise the first (earliest-index, longest) hit.
  const whole = hits.find((h) => h.index === 0 && h.raw.length === s.length);
  return (whole || hits[0]).iso;
}

// Compare two ISO-ish strings by their earliest-possible instant. 'month'/'year'
// granularities expand to their first day for ordering.
function isoToComparable(iso) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec(iso);
  if (!m) return null;
  const y = +m[1], mo = m[2] ? +m[2] : 1, d = m[3] ? +m[3] : 1;
  return Date.UTC(y, mo - 1, d);
}

export function earliest(text, opts = {}) {
  const hits = extractDates(text, opts);
  let best = null, bestT = null;
  for (const h of hits) {
    const t = isoToComparable(h.iso);
    if (t == null) continue;
    if (bestT == null || t < bestT) { bestT = t; best = h.iso; }
  }
  return best;
}

export function latest(text, opts = {}) {
  const hits = extractDates(text, opts);
  let best = null, bestT = null;
  for (const h of hits) {
    const t = isoToComparable(h.iso);
    if (t == null) continue;
    if (bestT == null || t > bestT) { bestT = t; best = h.iso; }
  }
  return best;
}

if (process.argv[1] && process.argv[1].endsWith('nl-dates.mjs')) {
  const sample = 'The Mathematicians email went out March 14, 2017; Phase 1 shipped 2026-06-05, ' +
    'Phase 2 in June 2026, and a stray US date 6/11/26 plus a bad one 13/40/2020. Founded 1999.';
  const ref = { now: '2026-01-01' };
  console.log('Extracted from sample:');
  for (const h of extractDates(sample, ref)) {
    console.log(`  [${h.index}] ${JSON.stringify(h.raw)} -> ${h.iso} (${h.granularity})`);
  }
  console.log('earliest:', earliest(sample, ref));
  console.log('latest:  ', latest(sample, ref));
  console.log('normalizeToIso("14 March 2017"):', normalizeToIso('14 March 2017', ref));
  console.log('esc demo:', esc('<March 2017>'));
}
