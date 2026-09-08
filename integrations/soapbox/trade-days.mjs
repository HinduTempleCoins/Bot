// trade-days — farmers markets, trade days and flea markets, and the schedule maths that make them
// findable. Companion to site/abuck (the true-dollar-store aggregator); same keyless posture.
//
// Operator: "we might want to make like a Farmers Market and like Canton and 3rd Monday Map, how we
// have abuck.soapbox.community".
//
// ── WHY THE SCHEDULE IS THE WHOLE PROBLEM ────────────────────────────────────────────────────────
//
// A map of markets is easy. Telling someone WHEN to go is not, because the two biggest trade days in
// Texas are both named after a day they are not open on:
//
//   Canton "First Monday Trade Days" runs THURSDAY THROUGH SUNDAY BEFORE the first Monday.
//   McKinney "Third Monday Trade Days" runs the WEEKEND BEFORE the third Monday.
//
// Read either name literally and you drive to an empty field on a Monday. Canton is 60 miles from
// Dallas; McKinney's is on Highway 380. A wrong answer here costs somebody their Saturday, which is
// exactly the kind of error a directory exists to prevent and most directories make.
//
// So the core of this module is `openDates()` — a rule engine that computes real dates from a
// recurrence pattern, with "the days before the Nth weekday" as a first-class case rather than an
// afterthought. Everything else is a list.
//
// House style: keyless (OSM/Overpass/Nominatim where discovery is needed — see nominatim.mjs and
// overpass.mjs), injectable fetch, soft-fail-never-throw, esc() all interpolation, offline-testable.

const str = (v) => String(v == null ? '' : v).trim();
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const WEEKDAYS = Object.freeze(['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']);
const dayIndex = (d) => WEEKDAYS.indexOf(String(d || '').toLowerCase());
const iso = (dt) => dt.toISOString().slice(0, 10);

/** UTC date, so a market's dates never shift because the reader is in another timezone. */
const utc = (y, m, d) => new Date(Date.UTC(y, m - 1, d));

/**
 * The date of the Nth given weekday in a month. n = 1..5; returns null if that month has no Nth.
 * (Some months have four Mondays, some five — asking for the 5th must return null, not roll over.)
 */
export function nthWeekdayOf(year, month, weekday, n) {
  const target = dayIndex(weekday);
  if (target < 0 || !(n >= 1 && n <= 5)) return null;
  const first = utc(year, month, 1);
  const shift = (target - first.getUTCDay() + 7) % 7;
  const day = 1 + shift + (n - 1) * 7;
  const dt = utc(year, month, day);
  return dt.getUTCMonth() === month - 1 ? dt : null;
}

/**
 * RECURRENCE RULES. Each is a plain object so a market's schedule is data, never code.
 *
 *   { kind: 'before-nth-weekday', n, weekday, days }
 *       The Canton/McKinney pattern. `days` are the weekday names actually open, taken from the week
 *       ENDING at that Nth weekday. This is the one everybody gets wrong.
 *   { kind: 'nth-weekday', n, weekday }        a single day, the literal reading
 *   { kind: 'weekly', days }                   every week on these days — most farmers markets
 *   { kind: 'monthly-day', day }               a fixed day number each month
 *
 * `season: { from, to }` (month numbers, inclusive, may wrap) closes it out of season.
 */
export function openDates(rule, year, month) {
  // An explicit null must not throw — a default parameter does not cover it, and this module's
  // contract is soft-fail-never-throw. A rule we cannot read means no dates, never an exception.
  if (!rule || typeof rule !== 'object') return [];
  const y = Number(year); const m = Number(month);
  if (!Number.isInteger(y) || !(m >= 1 && m <= 12)) return [];
  const season = rule.season;
  if (season) {
    const { from, to } = season;
    const inSeason = from <= to ? (m >= from && m <= to) : (m >= from || m <= to);
    if (!inSeason) return [];
  }
  const out = [];
  if (rule.kind === 'before-nth-weekday') {
    const anchor = nthWeekdayOf(y, m, rule.weekday, rule.n);
    if (!anchor) return [];
    const anchorIdx = anchor.getUTCDay();
    for (const d of (rule.days || [])) {
      const idx = dayIndex(d);
      if (idx < 0) continue;
      // How many days BEFORE the anchor is this weekday? Always the most recent one, 1..7 back —
      // never the anchor itself, because the anchor is the day the market is closed.
      const back = ((anchorIdx - idx) + 7) % 7 || 7;
      const dt = new Date(anchor.getTime() - back * 86400000);
      out.push(dt);
    }
  } else if (rule.kind === 'nth-weekday') {
    const dt = nthWeekdayOf(y, m, rule.weekday, rule.n);
    if (dt) out.push(dt);
  } else if (rule.kind === 'weekly') {
    for (let d = 1; d <= 31; d += 1) {
      const dt = utc(y, m, d);
      if (dt.getUTCMonth() !== m - 1) break;
      if ((rule.days || []).some((x) => dayIndex(x) === dt.getUTCDay())) out.push(dt);
    }
  } else if (rule.kind === 'monthly-day') {
    const dt = utc(y, m, Number(rule.day));
    if (dt.getUTCMonth() === m - 1) out.push(dt);
  } else {
    return [];
  }
  return out.sort((a, b) => a - b).map(iso);
}

/** Plain-English schedule, so a page never makes the reader do the arithmetic. */
export function describeRule(rule = {}) {
  if (rule.kind === 'before-nth-weekday') {
    const ord = ['', 'first', 'second', 'third', 'fourth', 'fifth'][rule.n] || `${rule.n}th`;
    const days = (rule.days || []).map((d) => d[0].toUpperCase() + d.slice(1)).join('–');
    return `${days} before the ${ord} ${rule.weekday[0].toUpperCase()}${rule.weekday.slice(1)} of the month — NOT on the ${rule.weekday} itself`;
  }
  if (rule.kind === 'weekly') return `Every ${(rule.days || []).map((d) => d[0].toUpperCase() + d.slice(1)).join(' and ')}`;
  if (rule.kind === 'nth-weekday') return `The ${rule.n}th ${rule.weekday} of the month`;
  if (rule.kind === 'monthly-day') return `The ${rule.day}th of each month`;
  return 'Schedule not recorded';
}

/**
 * The seeded list. Deliberately SHORT and every row carries `confidence` and `source`.
 *
 * A directory that lists a hundred markets it has not checked is worse than one listing five it has,
 * because the reader cannot tell which is which. `confidence: 'unverified'` means exactly that, and
 * the renderer says so rather than hiding it.
 */
export const MARKETS = Object.freeze([
  {
    id: 'canton-first-monday',
    name: 'First Monday Trade Days',
    kind: 'trade-days',
    city: 'Canton', state: 'TX', county: 'Van Zandt',
    rule: { kind: 'before-nth-weekday', n: 1, weekday: 'monday', days: ['thursday', 'friday', 'saturday', 'sunday'] },
    note: 'Among the largest flea markets in the United States. ~60 miles east of Dallas on I-20.',
    confidence: 'unverified',
    source: 'https://firstmondaycanton.com/',
    verify: 'Confirm the open days and any seasonal closures against the official site before publishing.',
  },
  {
    id: 'mckinney-third-monday',
    name: 'Third Monday Trade Days',
    kind: 'trade-days',
    city: 'McKinney', state: 'TX', county: 'Collin',
    rule: { kind: 'before-nth-weekday', n: 3, weekday: 'monday', days: ['friday', 'saturday', 'sunday'] },
    note: 'On US-380 in McKinney. The hometown one — same county as the local outreach cohort.',
    confidence: 'unverified',
    source: 'https://www.tmtd.com/',
    verify: 'Confirm open days and gate hours against the official site before publishing.',
  },
]);

export const market = (id) => MARKETS.find((m) => m.id === str(id)) || null;

/** Every open date across the seeded markets for a month, soonest first. */
export function calendar(year, month, markets = MARKETS) {
  const rows = [];
  for (const m of markets) {
    for (const d of openDates(m.rule, year, month)) {
      rows.push({ date: d, marketId: m.id, name: m.name, city: m.city, state: m.state, confidence: m.confidence });
    }
  }
  return rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The next open date on or after `fromIso`, looking up to `months` ahead. Null if none found. */
export function nextOpen(rule, fromIso, { months = 3 } = {}) {
  const from = str(fromIso);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from)) return null;
  let [y, m] = from.split('-').map(Number);
  for (let i = 0; i < Math.max(1, months); i += 1) {
    const hit = openDates(rule, y, m).find((d) => d >= from);
    if (hit) return hit;
    m += 1; if (m > 12) { m = 1; y += 1; }
  }
  return null;
}

/**
 * The Overpass query for discovering markets near a point. Returned as a STRING, not executed —
 * discovery is the caller's decision and this module makes no network call of its own.
 */
export function discoveryQuery(lat, lon, radiusMeters = 40000) {
  const la = Number(lat); const lo = Number(lon); const r = Math.max(100, Math.min(80000, Number(radiusMeters) || 40000));
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return `[out:json][timeout:25];(
  node["amenity"="marketplace"](around:${r},${la},${lo});
  way["amenity"="marketplace"](around:${r},${la},${lo});
  node["shop"="farm"](around:${r},${la},${lo});
);out center tags;`;
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'trade-days',
    markets: MARKETS.map((m) => ({ id: m.id, name: m.name, city: m.city, schedule: describeRule(m.rule), confidence: m.confidence })),
    rule: 'a market named after a day it is closed on is the normal case — compute the dates, never print the name',
  }, null, 2));
}

export default { MARKETS, market, openDates, nthWeekdayOf, describeRule, calendar, nextOpen, discoveryQuery, handler, esc };

if (process.argv[1] && process.argv[1].endsWith('trade-days.mjs')) {
  for (const m of MARKETS) {
    console.log(`\n${m.name} (${m.city}, ${m.state})  [${m.confidence}]`);
    console.log(`  ${describeRule(m.rule)}`);
    console.log(`  Sep 2026: ${openDates(m.rule, 2026, 9).join(', ')}`);
    console.log(`  Oct 2026: ${openDates(m.rule, 2026, 10).join(', ')}`);
  }
}
