// reminder-schedule.mjs — deterministic reminder/recurrence next-fire calculator. Pure
// scheduling math: given a recurrence `rule` and a reference timestamp `fromTs` (ms), compute
// the next fire strictly after fromTs. No Date.now() inside — the caller injects the reference
// time, so every result is reproducible and fully offline-testable. No timers, no I/O.
//
//   import { nextFire, upcoming, describe } from './reminder-schedule.mjs'
//   nextFire({ every:'day', at:'09:00' }, fromTs)   -> ms timestamp > fromTs (or null)
//   upcoming({ every:'week', weekday:1 }, fromTs, 5) -> [ms, ms, ...] (or [])
//   describe({ every:'hour' })                       -> "Every hour" (esc-safe plain text)
//
// rule = {
//   every:   'day' | 'week' | 'hour' | number(ms interval),
//   at?:     'HH:MM'  (wall-clock time-of-day, UTC; for 'day'/'week'),
//   weekday?: 0..6    (0=Sunday; for 'week'),
//   count?:   number  (cap how many fires upcoming() / a bounded series yields)
// }
//
// Soft-fail: any malformed rule yields null (nextFire) / [] (upcoming) / a safe string
// (describe). Never throws. Distinct from integrations/timeline.mjs, which reconstructs PAST
// chain-op history; this looks only FORWARD and touches nothing external.

const DAY_MS = 86400000;
const HOUR_MS = 3600000;
const WEEK_MS = 7 * DAY_MS;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// HTML-escape, so describe() output is safe to drop into a page without re-escaping.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function isFiniteNum(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

// Parse 'HH:MM' -> { h, m } in 0..23 / 0..59, else null.
function parseAt(at) {
  if (typeof at !== 'string') return null;
  const m = /^(\d{1,2}):(\d{2})$/.exec(at.trim());
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (!Number.isInteger(h) || !Number.isInteger(min) || h < 0 || h > 23 || min < 0 || min > 59) return null;
  return { h, m: min };
}

// Normalize a rule into a canonical shape, or null if it can't be made sense of.
function normalize(rule) {
  if (!rule || typeof rule !== 'object') return null;
  const { every } = rule;
  // Distinguish "no time given" (ok, defaults to midnight) from "time given but malformed" (reject).
  let at = null;
  if (rule.at != null) {
    at = parseAt(rule.at);
    if (!at) return null;
  }
  let weekday = rule.weekday;
  if (weekday != null) {
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) return null;
  } else {
    weekday = null;
  }
  let count = rule.count;
  if (count != null) {
    if (!isFiniteNum(count) || count < 1) return null;
    count = Math.floor(count);
  } else {
    count = null;
  }

  if (typeof every === 'number') {
    if (!isFiniteNum(every) || every <= 0) return null;
    return { kind: 'interval', interval: every, at, weekday, count };
  }
  if (every === 'hour') return { kind: 'hour', at, weekday, count };
  if (every === 'day') return { kind: 'day', at, weekday, count };
  if (every === 'week') return { kind: 'week', at, weekday, count };
  return null;
}

// Build a UTC timestamp for the calendar day containing `base` (ms) at hour h / minute m.
function atTimeOfDay(base, h, m) {
  const d = new Date(base);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), h, m, 0, 0);
}

// Core: the single next fire strictly after fromTs for a normalized rule.
function nextFireNorm(n, fromTs) {
  if (n.kind === 'interval') {
    // Anchor the interval grid at fromTs+1 .. so the next slot is strictly after fromTs.
    // The grid is phase-locked to epoch 0 for determinism.
    const k = Math.floor(fromTs / n.interval) + 1;
    return k * n.interval;
  }

  if (n.kind === 'hour') {
    // Fire at minute n.at.m of each hour if given, else exactly one hour after fromTs's
    // hour boundary.
    const min = n.at ? n.at.m : 0;
    const d = new Date(fromTs);
    let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), d.getUTCHours(), min, 0, 0);
    if (t <= fromTs) t += HOUR_MS;
    return t;
  }

  const tod = n.at || { h: 0, m: 0 };

  if (n.kind === 'day') {
    let t = atTimeOfDay(fromTs, tod.h, tod.m);
    while (t <= fromTs) t += DAY_MS;
    return t;
  }

  if (n.kind === 'week') {
    let t = atTimeOfDay(fromTs, tod.h, tod.m);
    if (n.weekday != null) {
      // Advance to the target weekday (UTC).
      let guard = 0;
      while ((new Date(t).getUTCDay() !== n.weekday || t <= fromTs) && guard < 14) {
        t += DAY_MS;
        guard++;
      }
      if (new Date(t).getUTCDay() !== n.weekday) return null;
      return t;
    }
    // No weekday: weekly cadence anchored on fromTs's day-of-week.
    while (t <= fromTs) t += WEEK_MS;
    return t;
  }

  return null;
}

// Public: next fire timestamp (ms) strictly after fromTs, or null on bad input.
export function nextFire(rule, fromTs) {
  if (!isFiniteNum(fromTs)) return null;
  const n = normalize(rule);
  if (!n) return null;
  const t = nextFireNorm(n, fromTs);
  return isFiniteNum(t) ? t : null;
}

// Public: the next `n` fire timestamps after fromTs. Honors rule.count as an upper cap.
export function upcoming(rule, fromTs, n) {
  if (!isFiniteNum(fromTs)) return [];
  const norm = normalize(rule);
  if (!norm) return [];
  let want = isFiniteNum(n) ? Math.floor(n) : 0;
  if (want < 1) return [];
  if (norm.count != null) want = Math.min(want, norm.count);

  const out = [];
  let cursor = fromTs;
  let guard = 0;
  const maxGuard = want * 8 + 16;
  while (out.length < want && guard < maxGuard) {
    guard++;
    const t = nextFireNorm(norm, cursor);
    if (!isFiniteNum(t) || t <= cursor) break;
    out.push(t);
    cursor = t;
  }
  return out;
}

// Public: human-readable, esc-safe plain-text summary of a rule. Never throws.
export function describe(rule) {
  const n = normalize(rule);
  if (!n) return esc('Invalid schedule');

  // Time-of-day renders only when explicitly supplied; default midnight stays implicit.
  const atStr = n.at ? ` at ${String(n.at.h).padStart(2, '0')}:${String(n.at.m).padStart(2, '0')} UTC` : '';
  const capStr = n.count != null ? ` (up to ${n.count} time${n.count === 1 ? '' : 's'})` : '';

  let base;
  if (n.kind === 'interval') {
    base = `Every ${n.interval} ms`;
  } else if (n.kind === 'hour') {
    base = n.at ? `Every hour at :${String(n.at.m).padStart(2, '0')}` : 'Every hour';
  } else if (n.kind === 'day') {
    base = `Every day${atStr}`;
  } else if (n.kind === 'week') {
    base = n.weekday != null ? `Every ${WEEKDAYS[n.weekday]}${atStr}` : `Every week${atStr}`;
  } else {
    base = 'Schedule';
  }

  // 'interval' and 'hour' already fold `at` into their text; only append for the others.
  const tail = n.kind === 'day' || n.kind === 'week' ? capStr : `${n.kind === 'interval' || n.kind === 'hour' ? capStr : ''}`;
  return esc(`${base}${tail}`);
}

// CLI: describe + show the next few fires from a reference time. Guarded so importing is silent.
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const every = process.argv[2] || 'day';
  const at = process.argv[3];
  const ref = Number(process.argv[4]) || Date.parse('2026-01-01T00:00:00Z');
  const rule = { every: /^\d+$/.test(every) ? Number(every) : every, at };
  // eslint-disable-next-line no-console
  console.log(describe(rule));
  // eslint-disable-next-line no-console
  console.log(upcoming(rule, ref, 5).map(t => new Date(t).toISOString()).join('\n'));
}
