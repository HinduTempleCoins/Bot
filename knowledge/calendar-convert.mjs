// calendar-convert.mjs — deterministic calendar conversion utilities for the
// MELEK knowledge corpus: Gregorian <-> proleptic-Julian <-> Julian Day Number.
//
// WHY THIS EXISTS
//   Seeded by the public-domain text 'Our Calendar' (Rev. George Nichols
//   Packer) in the corpus-ingest itinerary. The corpus dates historical and
//   liturgical material across both the Julian and Gregorian reckonings; to
//   reason about those dates without ambiguity we need a fixed astronomical
//   pivot. The Julian Day Number (JDN) — a continuous integer day count — is
//   that pivot. This module is pure integer/date math: it NEVER fetches, NEVER
//   calls an LLM, NEVER depends on the host locale or the JS Date timezone.
//   Every export soft-fails (invalid input coerces or returns null) and never
//   throws.
//
// EXPORTS
//   esc(s)                                  — HTML-safe escaping for interpolation
//   gregorianToJDN({year,month,day})        — integer JDN (Fliegel-Van Flandern)
//   jdnToGregorian(jdn)                     — {year,month,day}
//   julianToJDN({year,month,day})           — proleptic-Julian -> JDN
//   jdnToJulian(jdn)                        — JDN -> proleptic-Julian {year,month,day}
//   gregorianToJulian({year,month,day})     — cross-calendar via JDN
//   julianToGregorian({year,month,day})     — cross-calendar via JDN
//   dayOfWeek(jdn)                          — 0..6, Sunday=0
//   daysBetween(a,b)                        — integer day count (b - a), date objs or JDNs
//   isLeap(year, {calendar='gregorian'})    — bool
//
//   import { gregorianToJDN, jdnToGregorian, dayOfWeek } from './calendar-convert.mjs';
//
// NOTE ON YEARS
//   Years are astronomical/proleptic integers: 1 BC = year 0, 2 BC = year -1.
//   There is no year-numbering jump; the math is continuous in both directions.
//   month is 1..12, day is 1..(length of month). Inputs are validated and
//   coerced to integers; out-of-range or non-finite inputs return null.

// esc() — escape any value we interpolate into rendered text (HTML-context-safe).
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// toInt — coerce to a finite integer, or null. Accepts numbers and numeric
// strings; rejects NaN/Infinity/non-numeric. Used to harden every input.
function toInt(v) {
  if (v == null || v === '') return null;
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

// normDate — validate a {year,month,day} shape into integers, or null.
// month must be 1..12; day must be 1..31 (per-month length is enforced only
// loosely here — the JDN round-trip is the source of truth, but we reject the
// obviously-invalid so soft-fail callers get null rather than a silly date).
function normDate(date) {
  if (!date || typeof date !== 'object') return null;
  const year = toInt(date.year);
  const month = toInt(date.month);
  const day = toInt(date.day);
  if (year == null || month == null || day == null) return null;
  if (month < 1 || month > 12) return null;
  if (day < 1 || day > 31) return null;
  return { year, month, day };
}

// gregorianToJDN — Fliegel & Van Flandern (1968) integer algorithm.
// Returns the integer Julian Day Number, or null on bad input.
export function gregorianToJDN(date) {
  const d = normDate(date);
  if (!d) return null;
  const { year, month, day } = d;
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return (
    day +
    Math.floor((153 * m + 2) / 5) +
    365 * y +
    Math.floor(y / 4) -
    Math.floor(y / 100) +
    Math.floor(y / 400) -
    32045
  );
}

// jdnToGregorian — inverse of gregorianToJDN (Richards / Fliegel-Van Flandern).
export function jdnToGregorian(jdn) {
  const J = toInt(jdn);
  if (J == null) return null;
  const a = J + 32044;
  const b = Math.floor((4 * a + 3) / 146097);
  const c = a - Math.floor((146097 * b) / 4);
  const dd = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * dd) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = 100 * b + dd - 4800 + Math.floor(m / 10);
  return { year, month, day };
}

// julianToJDN — proleptic-Julian-calendar date -> JDN (no century/400 terms).
export function julianToJDN(date) {
  const d = normDate(date);
  if (!d) return null;
  const { year, month, day } = d;
  const a = Math.floor((14 - month) / 12);
  const y = year + 4800 - a;
  const m = month + 12 * a - 3;
  return day + Math.floor((153 * m + 2) / 5) + 365 * y + Math.floor(y / 4) - 32083;
}

// jdnToJulian — JDN -> proleptic-Julian-calendar {year,month,day}.
export function jdnToJulian(jdn) {
  const J = toInt(jdn);
  if (J == null) return null;
  const c = J + 32082;
  const dd = Math.floor((4 * c + 3) / 1461);
  const e = c - Math.floor((1461 * dd) / 4);
  const m = Math.floor((5 * e + 2) / 153);
  const day = e - Math.floor((153 * m + 2) / 5) + 1;
  const month = m + 3 - 12 * Math.floor(m / 10);
  const year = dd - 4800 + Math.floor(m / 10);
  return { year, month, day };
}

// gregorianToJulian — same instant, expressed on the proleptic-Julian calendar.
export function gregorianToJulian(date) {
  const jdn = gregorianToJDN(date);
  if (jdn == null) return null;
  return jdnToJulian(jdn);
}

// julianToGregorian — same instant, expressed on the Gregorian calendar.
export function julianToGregorian(date) {
  const jdn = julianToJDN(date);
  if (jdn == null) return null;
  return jdnToGregorian(jdn);
}

// dayOfWeek — 0..6 with Sunday=0. JDN 0 is a Monday; (JDN+1) mod 7 = Sunday-based.
export function dayOfWeek(jdn) {
  const J = toInt(jdn);
  if (J == null) return null;
  return ((J + 1) % 7 + 7) % 7;
}

// asJDN — accept either an integer JDN or a {year,month,day} Gregorian date.
// Helper for daysBetween so callers can pass dates or JDNs interchangeably.
function asJDN(v) {
  if (v && typeof v === 'object') return gregorianToJDN(v);
  return toInt(v);
}

// daysBetween — integer day count (b - a). Accepts JDNs or Gregorian dates.
export function daysBetween(a, b) {
  const ja = asJDN(a);
  const jb = asJDN(b);
  if (ja == null || jb == null) return null;
  return jb - ja;
}

// isLeap — leap-year test for the named calendar ('gregorian' default | 'julian').
export function isLeap(year, opts = {}) {
  const y = toInt(year);
  if (y == null) return null;
  const calendar = (opts && opts.calendar) || 'gregorian';
  if (calendar === 'julian') return ((y % 4) + 4) % 4 === 0;
  if (calendar === 'gregorian') {
    const div = (n) => (((y % n) + n) % n) === 0;
    return div(4) && (!div(100) || div(400));
  }
  return null;
}
