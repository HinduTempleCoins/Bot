// business-hours — when a fax will actually be answered, and when a clock actually runs.
//
// Two problems, one table.
//
// 1. SENDING. A fax sent at 03:00 lands in a dark room. The existing fax-service backoff is
//    1m/5m/15m/45m/hourly, which at 3 a.m. burns every retry against a machine nobody will put
//    paper in until 08:00. Retries have to snap to the next open window, not to a stopwatch.
//
// 2. COUNTING. Texas defines "business day" for the PIA by statute, and the definition is not
//    "not a weekend." Tex. Gov't Code § 552.0031 (added by Acts 2023, 88th Leg., H.B. 3033,
//    eff. 1 Sept 2023) excludes weekends, national holidays under § 662.003(a) AND state
//    holidays under § 662.003(b) -- and Texas state holidays include 24 and 26 December, the
//    Friday after Thanksgiving, and four dates no federal calendar has. A ten-business-day
//    deadline computed on weekends alone is simply wrong, and being wrong in our own favour is
//    how you accuse a records officer of being late when they are not.
//
// TIMEZONES ARE LOAD-BEARING HERE. This process runs in UTC. Dallas is America/Chicago and DOES
// observe DST; a fixed -6 offset is wrong for over half the year. Every wall-clock judgement in
// this file goes through Intl with an explicit IANA zone.
//
// WHAT THIS MODULE DELIBERATELY DOES NOT DO: promise an exact deadline. See § 552.0031(f) --
// a governmental body may designate up to TEN nonbusiness days a calendar year on its own say-so.
// We cannot know those. Every deadline here is returned with `exact: false` and the reason.

const str = (v) => String(v == null ? '' : v);
const pad = (n) => String(n).padStart(2, '0');

// ---------------------------------------------------------------------------
// 1. TIMEZONE PRIMITIVES
// ---------------------------------------------------------------------------

const PARTS = new Map();
function fmt(tz) {
  if (!PARTS.has(tz)) {
    PARTS.set(tz, new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', weekday: 'short',
    }));
  }
  return PARTS.get(tz);
}

const WD = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of a UTC instant, in a named zone. Throws nothing; bad zone -> UTC. */
export function zonedParts(date, tz = 'UTC') {
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  let p;
  try { p = fmt(tz).formatToParts(d); } catch { p = fmt('UTC').formatToParts(d); }
  const g = (t) => (p.find((x) => x.type === t) || {}).value;
  return {
    year: Number(g('year')), month: Number(g('month')), day: Number(g('day')),
    hour: Number(g('hour')) % 24, minute: Number(g('minute')), second: Number(g('second')),
    weekday: WD[g('weekday')] ?? 0,
    date: `${g('year')}-${g('month')}-${g('day')}`,
    minutesOfDay: (Number(g('hour')) % 24) * 60 + Number(g('minute')),
  };
}

/** The zone's UTC offset in ms at a given instant. Correct across DST because it asks Intl. */
export function tzOffsetMs(date, tz = 'UTC') {
  const p = zonedParts(date, tz);
  if (!p) return 0;
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const d = date instanceof Date ? date : new Date(date);
  return asUtc - d.getTime() + (d.getTime() % 1000 ? 0 : 0);
}

/**
 * A wall-clock time in a zone -> the UTC instant. Two passes, because the offset depends on the
 * answer. On a spring-forward gap the time does not exist and we land on the following instant,
 * which is the behaviour you want for "open at 08:00".
 */
export function zonedTimeToUtc({ year, month, day, hour = 0, minute = 0 }, tz = 'UTC') {
  const guess = Date.UTC(year, month - 1, day, hour, minute, 0);
  let inst = new Date(guess - tzOffsetMs(new Date(guess), tz));
  inst = new Date(guess - tzOffsetMs(inst, tz));
  return inst;
}

// ---------------------------------------------------------------------------
// 2. HOLIDAYS
//
// Texas: quoted from Tex. Gov't Code § 662.003, retrieved 2026-09-08.
// Federal: the days on which federal offices close, which is NOT the Texas list -- Texas has no
// Columbus Day and its § 662.003(a) national list omits Juneteenth (Texas carries 19 June as a
// STATE holiday instead), while federal offices observe both.
// ---------------------------------------------------------------------------

// [month, day] fixed, or ['nth', month, weekday, n] / ['last', month, weekday]
export const TX_NATIONAL = Object.freeze([            // § 662.003(a)
  { name: "New Year's Day", on: [1, 1] },
  { name: 'Martin Luther King, Jr., Day', on: ['nth', 1, 1, 3] },
  { name: "Presidents' Day", on: ['nth', 2, 1, 3] },
  { name: 'Memorial Day', on: ['last', 5, 1] },
  { name: 'Independence Day', on: [7, 4] },
  { name: 'Labor Day', on: ['nth', 9, 1, 1] },
  { name: 'Veterans Day', on: [11, 11] },
  { name: 'Thanksgiving Day', on: ['nth', 11, 4, 4] },
  { name: 'Christmas Day', on: [12, 25] },
]);

export const TX_STATE = Object.freeze([               // § 662.003(b)
  { name: 'Confederate Heroes Day', on: [1, 19] },
  { name: 'Texas Independence Day', on: [3, 2] },
  { name: 'San Jacinto Day', on: [4, 21] },
  { name: 'Emancipation Day in Texas', on: [6, 19] },
  { name: 'Lyndon Baines Johnson Day', on: [8, 27] },
  { name: 'Friday after Thanksgiving', on: ['after-thanksgiving'] },
  { name: '24 December', on: [12, 24] },
  { name: '26 December', on: [12, 26] },
]);

export const FEDERAL = Object.freeze([
  { name: "New Year's Day", on: [1, 1] },
  { name: 'Martin Luther King, Jr., Day', on: ['nth', 1, 1, 3] },
  { name: "Washington's Birthday", on: ['nth', 2, 1, 3] },
  { name: 'Memorial Day', on: ['last', 5, 1] },
  { name: 'Juneteenth National Independence Day', on: [6, 19] },
  { name: 'Independence Day', on: [7, 4] },
  { name: 'Labor Day', on: ['nth', 9, 1, 1] },
  { name: 'Columbus Day', on: ['nth', 10, 1, 2] },
  { name: 'Veterans Day', on: [11, 11] },
  { name: 'Thanksgiving Day', on: ['nth', 11, 4, 4] },
  { name: 'Christmas Day', on: [12, 25] },
]);

// § 662.003(c) optional holidays. Good Friday is computable. Rosh Hashanah and Yom Kippur are
// Hebrew-calendar dates and are NOT computed here -- guessing them would be worse than saying so.
// § 552.0031(c) makes an optional holiday a nonbusiness day only if the public-information
// officer observes it, which we also cannot know.
export const OPTIONAL_NOTE = 'Optional holidays under § 662.003(c) — Rosh Hashanah, Yom Kippur, '
  + 'Good Friday — are nonbusiness days only if the public information officer observes them '
  + '(§ 552.0031(c)). Good Friday is computed; the two Hebrew-calendar dates are not.';

function nthWeekday(year, month, weekday, n) {
  const first = new Date(Date.UTC(year, month - 1, 1));
  const shift = (weekday - first.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(year, month - 1, 1 + shift + (n - 1) * 7));
}
function lastWeekday(year, month, weekday) {
  const last = new Date(Date.UTC(year, month, 0));
  const shift = (last.getUTCDay() - weekday + 7) % 7;
  return new Date(Date.UTC(year, month - 1, last.getUTCDate() - shift));
}
/** Anonymous Gregorian computus. Returns Easter Sunday as a UTC date. */
export function easter(year) {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100;
  const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}
export function goodFriday(year) {
  const e = easter(year);
  return new Date(e.getTime() - 2 * 86400000);
}

const iso = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

function resolve(rule, year) {
  if (rule[0] === 'nth') return nthWeekday(year, rule[1], rule[2], rule[3]);
  if (rule[0] === 'last') return lastWeekday(year, rule[1], rule[2]);
  if (rule[0] === 'after-thanksgiving') {
    return new Date(nthWeekday(year, 11, 4, 4).getTime() + 86400000);
  }
  return new Date(Date.UTC(year, rule[0] - 1, rule[1]));
}

/**
 * Every nonbusiness date in a year, as YYYY-MM-DD -> name.
 *
 * `observed` implements § 552.0031(e): where a holiday falls on a weekend and the body observes
 * it on the adjacent Friday or Monday, THAT day is the nonbusiness day. Default true, because
 * that is what county offices actually do.
 */
export function holidays(year, { regime = 'TX_PIA', observed = true, optional = false } = {}) {
  const out = new Map();
  const sets = regime === 'FEDERAL' ? [FEDERAL] : [TX_NATIONAL, TX_STATE];
  for (const set of sets) {
    for (const h of set) {
      const d = resolve(h.on, year);
      out.set(iso(d), h.name);
      if (observed) {
        const wd = d.getUTCDay();
        if (wd === 6) out.set(iso(new Date(d.getTime() - 86400000)), `${h.name} (observed Friday)`);
        if (wd === 0) out.set(iso(new Date(d.getTime() + 86400000)), `${h.name} (observed Monday)`);
      }
    }
  }
  if (optional && regime !== 'FEDERAL') out.set(iso(goodFriday(year)), 'Good Friday (optional)');
  return out;
}

export function holidayName(dateISO, opts = {}) {
  const s = str(dateISO).slice(0, 10);
  const year = Number(s.slice(0, 4));
  if (!year) return null;
  return holidays(year, opts).get(s) || null;
}

/** Is this calendar date a business day? Weekends and the holiday table decide. */
export function isBusinessDay(dateISO, opts = {}) {
  const s = str(dateISO).slice(0, 10);
  const d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return false;
  const wd = d.getUTCDay();
  if (wd === 0 || wd === 6) return false;
  const extra = Array.isArray(opts.designated) ? opts.designated.map((x) => str(x).slice(0, 10)) : [];
  if (extra.includes(s)) return false;
  return !holidays(d.getUTCFullYear(), opts).has(s);
}

/**
 * Add N business days. Returns the date AND the honest caveat, because § 552.0031(f) lets a body
 * declare up to ten more nonbusiness days a year that no calendar can predict.
 */
export function addBusinessDays(startISO, n, opts = {}) {
  const s = str(startISO).slice(0, 10);
  let d = new Date(`${s}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  const skipped = [];
  let left = Math.max(0, Number(n) || 0);
  while (left > 0) {
    d = new Date(d.getTime() + 86400000);
    const day = iso(d);
    if (isBusinessDay(day, opts)) left -= 1;
    else skipped.push({ date: day, why: holidayName(day, opts) || 'weekend' });
  }
  return {
    date: iso(d),
    skipped,
    exact: false,
    caveat: 'Estimate. Tex. Gov\'t Code § 552.0031(f) permits a governmental body to designate up '
          + 'to 10 additional nonbusiness days per calendar year; those cannot be predicted. Ask '
          + 'the body to identify any day it designated under § 552.0031(f) during the period.',
  };
}

// ---------------------------------------------------------------------------
// 3. BUSINESS HOURS
// ---------------------------------------------------------------------------

export const DEFAULT_HOURS = Object.freeze({
  tz: 'America/Chicago',
  days: [1, 2, 3, 4, 5],   // Mon-Fri
  open: '08:00',
  close: '16:30',          // county records counters commonly close before 5
  regime: 'TX_PIA',
});

const mins = (hhmm) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(str(hhmm));
  return m ? Number(m[1]) * 60 + Number(m[2]) : 0;
};

export function hoursFor(spec = {}) {
  return { ...DEFAULT_HOURS, ...spec, days: spec.days || DEFAULT_HOURS.days };
}

/** Is the recipient's office open at this instant? */
export function isOpen(instant, spec = {}) {
  const h = hoursFor(spec);
  const p = zonedParts(instant, h.tz);
  if (!p) return false;
  if (!h.days.includes(p.weekday)) return false;
  if (!isBusinessDay(p.date, h)) return false;
  return p.minutesOfDay >= mins(h.open) && p.minutesOfDay < mins(h.close);
}

/**
 * The next instant the office is open. If it is open now, that is now.
 * Scans forward day by day -- a year is the cap, and hitting it means the spec is nonsense.
 */
export function nextOpen(instant, spec = {}) {
  const h = hoursFor(spec);
  const start = instant instanceof Date ? instant : new Date(instant);
  if (Number.isNaN(start.getTime())) return null;
  if (isOpen(start, h)) return start;

  const openMin = mins(h.open);
  for (let i = 0; i < 400; i += 1) {
    const probe = new Date(start.getTime() + i * 86400000);
    const p = zonedParts(probe, h.tz);
    if (!p) continue;
    if (!h.days.includes(p.weekday) || !isBusinessDay(p.date, h)) continue;
    const openAt = zonedTimeToUtc(
      { year: p.year, month: p.month, day: p.day, hour: Math.floor(openMin / 60), minute: openMin % 60 },
      h.tz,
    );
    if (openAt.getTime() >= start.getTime()) return openAt;
    // same day, already past opening: only usable if we are before close
    if (p.minutesOfDay < mins(h.close)) return start;
  }
  return null;
}

export function msUntilOpen(instant, spec = {}) {
  const n = nextOpen(instant, spec);
  if (!n) return null;
  const t = (instant instanceof Date ? instant : new Date(instant)).getTime();
  return Math.max(0, n.getTime() - t);
}

/**
 * Should we (re)send right now, and if not, when?
 *
 * This is the whole point of the module for the fax path: a stopwatch backoff at 03:00 spends
 * every attempt on a closed office. Inside business hours, use the caller's backoff. Outside,
 * wait for the door to open.
 */
export function scheduleSend(instant, spec = {}, { backoffMs = 0 } = {}) {
  const h = hoursFor(spec);
  const now = instant instanceof Date ? instant : new Date(instant);
  if (isOpen(now, h)) {
    return {
      sendNow: true, waitMs: 0,
      at: new Date(now.getTime() + (Number(backoffMs) || 0)).toISOString(),
      reason: 'office is open',
    };
  }
  const wait = msUntilOpen(now, h);
  const at = wait == null ? null : new Date(now.getTime() + wait);
  const p = zonedParts(now, h.tz);
  const why = !p ? 'unknown'
    : !h.days.includes(p.weekday) ? 'weekend'
    : !isBusinessDay(p.date, h) ? (holidayName(p.date, h) || 'nonbusiness day')
    : p.minutesOfDay < mins(h.open) ? 'before opening'
    : 'after closing';
  return {
    sendNow: false,
    waitMs: wait,
    at: at ? at.toISOString() : null,
    localNow: p ? `${p.date} ${pad(p.hour)}:${pad(p.minute)} ${h.tz}` : '',
    reason: `office is closed — ${why}`,
  };
}

// ---------------------------------------------------------------------------
// 4. WHY THE SEND TIME MATTERS TO THE CLOCK
// ---------------------------------------------------------------------------

export const RECEIPT_NOTES = Object.freeze({
  fax: 'A fax transmission report establishes the actual date of receipt, which is what starts '
     + 'the § 552.301 count. Chapter 552 contains no after-hours rule, so an office that '
     + 'date-stamps on opening will stamp an overnight fax the next business day. Sending inside '
     + 'business hours makes the transmission report and the date stamp agree, which is the only '
     + 'reason the send time matters legally.',
  mail: 'Tex. Gov\'t Code § 552.301(a-1): where a request arrives by U.S. mail and the body '
      + 'cannot establish the actual date of receipt, it is deemed received on the THIRD business '
      + 'day after the postmark. Mail therefore costs up to three business days that a fax does not.',
  email: 'Email leaves no transmission report. Delivery is provable only from the sender\'s own '
       + 'logs, which the body did not generate.',
});

// ---------------------------------------------------------------------------
// 5. HTTP
// ---------------------------------------------------------------------------

export function handler(req, res) {
  const url = new URL(req.url || '/', 'http://localhost');
  const send = (code, obj) => {
    res.statusCode = code;
    res.setHeader('content-type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(obj, null, 2));
  };
  const tz = url.searchParams.get('tz') || DEFAULT_HOURS.tz;
  const regime = url.searchParams.get('regime') || 'TX_PIA';

  if (url.pathname.endsWith('/holidays')) {
    const year = Number(url.searchParams.get('year')) || new Date().getUTCFullYear();
    return send(200, {
      ok: true, year, regime,
      holidays: [...holidays(year, { regime }).entries()].map(([date, name]) => ({ date, name }))
        .sort((a, b) => a.date.localeCompare(b.date)),
      note: OPTIONAL_NOTE,
    });
  }

  if (url.pathname.endsWith('/deadline')) {
    const from = url.searchParams.get('from') || new Date().toISOString().slice(0, 10);
    const days = Number(url.searchParams.get('days')) || 10;
    return send(200, { ok: true, from, days, regime, ...addBusinessDays(from, days, { regime }) });
  }

  const nowISO = url.searchParams.get('at') || new Date().toISOString();
  return send(200, {
    ok: true, service: 'business-hours', tz, at: nowISO,
    open: isOpen(nowISO, { tz, regime }),
    schedule: scheduleSend(nowISO, { tz, regime }),
    routes: ['/holidays?year=&regime=', '/deadline?from=&days=&regime=', '/?at=&tz='],
  });
}

if (process.argv[1] && process.argv[1].endsWith('business-hours.mjs')) {
  const at = new Date();
  for (const [label, tz] of [['Dallas', 'America/Chicago'], ['DC', 'America/New_York']]) {
    const s = scheduleSend(at, { tz });
    console.log(`${label.padEnd(8)} ${s.sendNow ? 'OPEN — send now' : `CLOSED — ${s.reason}`}`);
    if (!s.sendNow) console.log(`${' '.repeat(9)}local ${s.localNow}; next open ${s.at}`);
  }
}
