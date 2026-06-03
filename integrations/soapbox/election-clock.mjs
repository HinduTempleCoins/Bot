// election-clock.mjs — PURE federal-election calendar math (v3 §6A.3). NO NETWORK, NO KEYS, NO I/O.
// Deterministic given an input date + an injectable clock. This is the date-arithmetic spine the civic
// readers hang dates off of: it answers "when is the next general election?" and "by when must I register?"
// from first principles, so the system has a trustworthy fallback that does not depend on any API.
//
//   FEDERAL GENERAL ELECTION DAY (2 U.S.C. §7 / 3 U.S.C. §1): the Tuesday after the first Monday in
//   November, in EVEN-numbered years. (Presidential years are the subset divisible by 4; this module
//   computes the general-election date for any even year and flags whether it is a presidential year.)
//
//   REGISTRATION-DEADLINE OFFSETS are a CONFIG STUB: a per-state table of "days before election day"
//   (REGISTRATION_DEADLINE_OFFSETS). These are coarse placeholders for the wiring — the authoritative,
//   citable deadline for any voter comes from elections-info.mjs (official sources). This module's
//   deadline math is a deterministic estimate ONLY, and every result is labeled `estimate:true` with a
//   note to defer to official sources. Same-day-registration states are encoded as offset 0.
//
// Pattern: ESM, zero deps, pure functions, injectable `nowMs`/clock, NEVER throws (bad input → null/[]).
// No __setFetch (there is no fetch). Guarded CLI demo.
//
//   import { isElectionYear, isPresidentialYear, generalElectionDate, nextGeneralElection,
//            registrationDeadline, REGISTRATION_DEADLINE_OFFSETS, daysBetween } from './election-clock.mjs'
//   node integrations/soapbox/election-clock.mjs                 # next general election from today
//   node integrations/soapbox/election-clock.mjs 2026-03-01 CA   # next election + CA registration estimate

// ---- date helpers (UTC, pure) ----
// We work entirely in UTC to keep results deterministic regardless of host timezone.

function pad2(n) { return String(n).padStart(2, '0'); }
/** Format a Date (or {y,m,d}) as 'YYYY-MM-DD' in UTC, or '' for invalid input. */
export function toISODate(d) {
  if (d instanceof Date) {
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
  }
  return '';
}
/** Parse 'YYYY-MM-DD' (or anything Date accepts) into a UTC Date at 00:00:00Z, or null. */
export function parseDate(input) {
  if (input instanceof Date) return Number.isNaN(input.getTime()) ? null : input;
  const s = String(input == null ? '' : input).trim();
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) {
    const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

const MS_PER_DAY = 86400000;
/** Whole days from `a` to `b` (b - a), using UTC midnights. null for bad input. */
export function daysBetween(a, b) {
  const da = parseDate(a), db = parseDate(b);
  if (!da || !db) return null;
  return Math.round((Date.UTC(db.getUTCFullYear(), db.getUTCMonth(), db.getUTCDate())
    - Date.UTC(da.getUTCFullYear(), da.getUTCMonth(), da.getUTCDate())) / MS_PER_DAY);
}

// ---- election-year predicates ----
/** Federal general elections fall in even-numbered years. */
export function isElectionYear(year) {
  const y = Number(year);
  return Number.isInteger(y) && y % 2 === 0;
}
/** Presidential elections are the subset of election years divisible by 4. */
export function isPresidentialYear(year) {
  const y = Number(year);
  return Number.isInteger(y) && y % 4 === 0;
}

// ---- the core: Tuesday after the first Monday in November ----
/**
 * The federal general election date for a given EVEN year — the Tuesday after the first Monday in
 * November. Returns a UTC Date, or null if `year` is not an even integer.
 * @param {number} year
 */
export function generalElectionDate(year) {
  const y = Number(year);
  if (!isElectionYear(y)) return null;
  // Nov 1 of that year; find the first Monday, then the Tuesday after it.
  const nov1 = new Date(Date.UTC(y, 10, 1)); // month 10 = November
  const dow = nov1.getUTCDay(); // 0=Sun..6=Sat
  // days from Nov 1 to the first Monday (day 1)
  const toFirstMonday = (1 - dow + 7) % 7;
  const firstMonday = 1 + toFirstMonday;
  const electionDay = firstMonday + 1; // Tuesday after the first Monday
  return new Date(Date.UTC(y, 10, electionDay));
}

/**
 * The next federal general election on or after `fromDate`. Returns:
 *   { date:'YYYY-MM-DD', year, presidential:boolean, daysUntil:number } | null
 * `fromDate` defaults to now (injectable via nowMs for deterministic tests).
 * @param {{fromDate?:string|Date, nowMs?:number}} [opts]
 */
export function nextGeneralElection({ fromDate, nowMs = Date.now() } = {}) {
  const from = parseDate(fromDate) || new Date(nowMs);
  if (!from || Number.isNaN(from.getTime())) return null;
  let year = from.getUTCFullYear();
  if (!isElectionYear(year)) year += 1; // jump to the next even year
  let d = generalElectionDate(year);
  // if this year's election already passed, advance to the next even year
  if (d && d.getTime() < Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) {
    year += 2;
    d = generalElectionDate(year);
  }
  if (!d) return null;
  return {
    date: toISODate(d),
    year,
    presidential: isPresidentialYear(year),
    daysUntil: daysBetween(from, d),
  };
}

// ---- registration-deadline CONFIG STUB (coarse "days before election day" by state) ----
// NON-AUTHORITATIVE placeholders for wiring. Official deadlines come from elections-info.mjs. Same-day
// registration states are encoded as 0. `_default` applies to any state not listed.
export const REGISTRATION_DEADLINE_OFFSETS = {
  _default: 30,   // many states close registration ~15–30 days out; 30 is a conservative stub
  // same-day / election-day registration states → 0
  CA: 0, CO: 0, CT: 0, DC: 0, HI: 0, IA: 0, ID: 0, IL: 0, ME: 0, MD: 0, MI: 0,
  MN: 0, MT: 0, NV: 0, NH: 0, NM: 0, VT: 0, WA: 0, WI: 0, WY: 0,
  // representative fixed-offset stubs (coarse)
  TX: 30, FL: 29, NY: 25, GA: 29, PA: 15, OH: 30, NC: 25, AZ: 29, VA: 22,
};

/** The configured registration-deadline offset (days before election day) for a state. */
export function registrationOffsetDays(state) {
  const s = String(state == null ? '' : state).trim().toUpperCase();
  if (s && Object.prototype.hasOwnProperty.call(REGISTRATION_DEADLINE_OFFSETS, s)) {
    return REGISTRATION_DEADLINE_OFFSETS[s];
  }
  return REGISTRATION_DEADLINE_OFFSETS._default;
}

/**
 * Estimated voter-registration deadline for the next general election in a given state. DETERMINISTIC
 * ESTIMATE ONLY — always returns { estimate:true } and a defer-to-officials note. Returns null on bad input.
 *   { state, electionDate, offsetDays, deadline:'YYYY-MM-DD', sameDay:boolean, estimate:true, note }
 * @param {{state:string, fromDate?:string|Date, nowMs?:number}} opts
 */
export function registrationDeadline({ state = '', fromDate, nowMs = Date.now() } = {}) {
  const next = nextGeneralElection({ fromDate, nowMs });
  if (!next) return null;
  const offsetDays = registrationOffsetDays(state);
  const electionDate = parseDate(next.date);
  const deadlineMs = electionDate.getTime() - offsetDays * MS_PER_DAY;
  const deadline = toISODate(new Date(deadlineMs));
  return {
    state: String(state || '').trim().toUpperCase(),
    electionDate: next.date,
    offsetDays,
    deadline,
    sameDay: offsetDays === 0,
    estimate: true,
    note: 'ESTIMATE from a config stub — confirm the actual deadline with official sources (see elections-info.mjs).',
  };
}

// ---- CLI (guarded) ----
if (process.argv[1] && process.argv[1].endsWith('election-clock.mjs')) {
  const [fromArg, stateArg] = process.argv.slice(2);
  const next = nextGeneralElection({ fromDate: fromArg });
  console.log('SoapBox election clock (pure calendar math; no network)');
  if (next) {
    console.log(`  next general election: ${next.date} (${next.presidential ? 'PRESIDENTIAL' : 'midterm'} year ${next.year}) — ${next.daysUntil} days out`);
  } else {
    console.log('  could not compute next election (bad input date)');
  }
  if (stateArg) {
    const rd = registrationDeadline({ state: stateArg, fromDate: fromArg });
    if (rd) {
      console.log(`  ${rd.state} registration deadline ESTIMATE: ${rd.deadline} (${rd.sameDay ? 'same-day registration' : rd.offsetDays + ' days before'})`);
      console.log(`  ⚠ ${rd.note}`);
    }
  } else {
    console.log('  (pass a state code as the 2nd arg for a registration-deadline estimate, e.g. "2026-03-01 CA")');
  }
}
