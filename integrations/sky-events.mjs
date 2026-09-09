// sky-events.mjs — WHAT THE SKY ACTUALLY DOES, sorted from what people say it means.
//
// Rebuilt after the original agent died at a rate limit without committing.
//
// ⭐ THE FRAME IS ALREADY IN THIS REPO. `time-cycles.mjs` declares
// `KINDS = ['derived', 'observed', 'chosen']`, and that is exactly the distinction this subject
// needs:
//
//   observed — a real event: a solstice, a heliacal rising, a lunar standstill, an eclipse.
//              Computable to the minute, checkable, and what temples actually tracked.
//   derived  — arithmetic on observed cycles: the Metonic 19 years, the Saros.
//   chosen   — an assigned meaning: which planet rules which hour, what a conjunction portends.
//
// **The astronomy is the achievement. The influence claim is a later add-on.** Sorting every item
// into one of those three lets a temple schedule by real sky events without asserting anything it
// cannot defend — which is the same move `light-signal.mjs` makes for the moon: TIMING and
// INFLUENCE are two different claims and must never be merged.
//
// The decans in `day-signs.mjs` are already an `observed` system in this corpus — deified stars whose
// heliacal risings marked the night-hours, tiered `epigraphic` at −2100. This module is their
// neighbour, not their replacement.
//
//   import { EVENTS, tidalRatio, precessionDrift, CLASSIFICATION } from './sky-events.mjs'
//   node integrations/sky-events.mjs tides

import { fileURLToPath } from 'node:url';
import { TIERS } from './pantheon-map.mjs';

export { TIERS };

export const esc = (s) => String(s == null ? '' : s)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const KINDS = Object.freeze(['observed', 'derived', 'chosen']);

// ── the events, classified ──────────────────────────────────────────────────────────────────────
export const EVENTS = [
  { id: 'solstice', label: 'Solstices and equinoxes', kind: 'observed', periodDays: 365.2422,
    note: 'The four turning points of the solar year. Computable to the minute and verifiable by anyone with a horizon.' },
  { id: 'heliacal-rising', label: 'Heliacal risings (a star first visible before dawn)', kind: 'observed', periodDays: 365.25,
    note: '⭐ The decans\' own mechanism — see day-signs.mjs. Sothis/Sirius anchored the Egyptian year. Depends on latitude and atmospheric extinction, so it is observed rather than purely calculated.' },
  { id: 'lunar-phase', label: 'Lunar phase (synodic month)', kind: 'observed', periodDays: 29.530588,
    note: 'The cycle the operator asked to schedule by. See light-signal.mjs for whether it does anything physiologically — it is a scheduling variable, and that is enough.' },
  { id: 'lunar-standstill', label: 'Lunar standstills (the nodal cycle)', kind: 'observed', periodDays: 6798.4,
    note: '18.6 years. The moon\'s rising range widens and narrows; major standstills are the extremes. Callanish and several other sites are argued to mark them.' },
  { id: 'metonic', label: 'The Metonic cycle', kind: 'derived', periodDays: 6939.6,
    note: '19 solar years ≈ 235 synodic months. DERIVED — it is arithmetic reconciling two observed cycles, which is why lunisolar calendars everywhere converge on it independently.' },
  { id: 'saros', label: 'The Saros', kind: 'derived', periodDays: 6585.32,
    note: '18 years 11 days 8 hours. Eclipses repeat in similar geometry. The 8 hours is why the next one lands a third of the world away — a fact you can only get by doing the arithmetic.' },
  { id: 'precession', label: 'Precession of the equinoxes', kind: 'observed', periodDays: 9413000,
    note: '⭐ ~25,772 years, about 1° per 72 years. The reason the tropical zodiac has slid off the constellations it is named after.' },
  { id: 'conjunction', label: 'Planetary conjunctions', kind: 'observed', periodDays: null,
    note: '⚠️ Genuinely observable, and genuinely misdescribed. A conjunction is a coincidence in ecliptic longitude AS SEEN FROM EARTH — a viewing angle. The planets are rarely anywhere near collinear in space. See ALIGNMENT_NOTE.' },
  { id: 'retrograde', label: 'Retrograde motion', kind: 'observed', periodDays: null,
    note: 'Apparent, not real. A parallax effect of two bodies on different orbits at different speeds. The planet does not slow, stop or reverse.' },
  { id: 'planetary-hours', label: 'Which planet rules which hour', kind: 'chosen', periodDays: null,
    note: 'An assignment, not an observation — see correspondences.mjs, which dates it. The Chaldean-order scheme demonstrably GENERATED the weekday order (Dio Cassius XXXVII.18–19), which makes it historically important and still chosen.' },
  { id: 'zodiac-meaning', label: 'What a sign or a conjunction portends', kind: 'chosen', periodDays: null,
    note: 'Assigned meaning. Recording it as `chosen` is not a dismissal — correspondences.mjs treats the whole genre this way and dates each table.' },
];

export const byKind = (k) => EVENTS.filter((e) => e.kind === String(k || '').toLowerCase());
export const getEvent = (id) => EVENTS.find((e) => e.id === String(id || '').toLowerCase()) || null;

/** The counts, which are themselves the argument. */
export function classification() {
  const out = {};
  for (const k of KINDS) out[k] = byKind(k).length;
  return { counts: out, total: EVENTS.length,
    reading: 'Most of the sky is OBSERVED and computable. What is contested is almost entirely in the '
      + 'CHOSEN column — and a temple can schedule by the first without asserting the third.' };
}

// ── ⭐ the influence claim, computed rather than asserted ────────────────────────────────────────
// Tidal (differential) force falls off as M/r³, NOT as M/r². That exponent is the whole answer, and
// showing the arithmetic is better than quoting somebody's conclusion.
export const BODIES = Object.freeze({
  moon:     { massKg: 7.342e22, distanceM: 3.844e8,  label: 'the Moon' },
  sun:      { massKg: 1.989e30, distanceM: 1.496e11, label: 'the Sun' },
  jupiter:  { massKg: 1.898e27, distanceM: 5.88e11,  label: 'Jupiter at closest approach' },
  mars:     { massKg: 6.417e23, distanceM: 5.46e10,  label: 'Mars at closest approach' },
  midwife:  { massKg: 70,       distanceM: 0.5,      label: 'a 70 kg midwife half a metre away' },
});

/** Relative tidal influence, M/r³, in arbitrary shared units. Never throws. */
export function tidalIndex(id) {
  const b = BODIES[String(id || '').toLowerCase()];
  if (!b) return null;
  return b.massKg / (b.distanceM ** 3);
}

/** How many times greater a's tidal influence is than b's. */
export function tidalRatio(a, b) {
  const x = tidalIndex(a); const y = tidalIndex(b);
  if (x == null || y == null || !(y > 0)) return null;
  return x / y;
}

export const ALIGNMENT_NOTE = Object.freeze({
  what: 'A "planetary alignment" is a conjunction in ecliptic longitude as seen from Earth.',
  why: 'That is a viewing angle. The bodies share a direction in our sky; they are not in a line in '
    + 'space, and they are typically separated by degrees of ecliptic latitude and by astronomical '
    + 'units of distance.',
  force: 'Even granting a perfect line-up, tidal force goes as M/r³ — run tidalRatio() and the '
    + 'numbers answer it without anyone needing to be persuaded.',
});

// ── precession, the fact that breaks the naive version ──────────────────────────────────────────
export const PRECESSION = Object.freeze({
  cycleYears: 25772,
  degreesPerYear: 360 / 25772,
  note: '⚠️ The tropical zodiac is anchored to the equinox, not to the stars. Since the sign '
    + 'boundaries were fixed in antiquity the two have drifted apart, so a "Sun in Aries" tropical '
    + 'birth is typically Sun-in-Pisces sidereally. Both systems are internally consistent; what is '
    + 'not defensible is using constellation NAMES as though they still pointed at the constellations. '
    + 'Constellation boundaries are also an IAU convention of 1930 and are wildly unequal in size, '
    + 'which is what the Ophiuchus argument is really about.',
});

/** Degrees of drift accumulated since a given year. Pure arithmetic; shows its own working. */
export function precessionDrift(sinceYear, nowYear = 2026) {
  // Number(null) is 0 and Number('') is 0 — and here 0 is a REAL YEAR, so a missing argument would
  // silently become "since 1 BC" and return a confident 28°. Third instance of this trap found in
  // this repo today; see covariateNote(), repeatStatistic(), and light-signal.mjs's num().
  const yr = (v) => (v == null || v === '' || typeof v === 'boolean' ? NaN : Number(v));
  const a = yr(sinceYear); const b = yr(nowYear);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  const years = b - a;
  const deg = years * PRECESSION.degreesPerYear;
  return {
    years, degrees: Math.round(deg * 100) / 100,
    signs: Math.round((deg / 30) * 100) / 100,
    note: `${years} years × ${PRECESSION.degreesPerYear.toFixed(5)}°/yr = ${deg.toFixed(2)}° ≈ ${(deg / 30).toFixed(2)} zodiac signs of drift.`,
  };
}

// ── tooling, and the licence question that decides buildability ─────────────────────────────────
export const EPHEMERIDES = Object.freeze([
  { id: 'astronomy-engine', licence: 'MIT', verdict: 'usable',
    note: 'Permissive. Risings, settings, phases, positions, seasons. ⭐ The right dependency if a licence read confirms MIT — no copyleft consequence for a hosted service.' },
  { id: 'swiss-ephemeris', licence: 'AGPL-3.0 or commercial', verdict: 'decision-required',
    note: '⚠️ AGPL reaches network use, so hosting a service built on it has real consequences. Do NOT vendor it without the operator deciding. Astrodienst sells a commercial licence for exactly this.' },
  { id: 'jpl-horizons', licence: 'US Government work — public domain', verdict: 'usable',
    note: 'Highest precision, network service. Fine for offline generation of a table we then ship.' },
]);

export function validate() {
  const problems = [];
  for (const e of EVENTS) {
    if (!KINDS.includes(e.kind)) problems.push(`${e.id}: unknown kind ${e.kind}`);
    if (!e.note) problems.push(`${e.id}: no note`);
    if (e.periodDays != null && !(e.periodDays > 0)) problems.push(`${e.id}: bad period`);
  }
  return { ok: problems.length === 0, problems };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'sky-events',
    classification: classification(), precession: PRECESSION, alignment: ALIGNMENT_NOTE,
    ephemerides: EPHEMERIDES,
    note: 'Observed / derived / chosen. Scheduling by a real sky event needs no mechanism; claiming '
        + 'the event influences a person is a separate claim and is not made here.',
  }, null, 2));
}

export default { EVENTS, KINDS, BODIES, EPHEMERIDES, PRECESSION, ALIGNMENT_NOTE, byKind, getEvent, classification, tidalIndex, tidalRatio, precessionDrift, validate, handler };

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (process.argv[2] === 'tides') {
    console.log('Relative tidal influence (M/r³):\n');
    for (const id of Object.keys(BODIES)) console.log(`  ${BODIES[id].label.padEnd(34)} ${tidalIndex(id).toExponential(3)}`);
    console.log(`\n  the Moon vs Jupiter        : ${Math.round(tidalRatio('moon', 'jupiter')).toLocaleString()}× greater`);
    console.log(`  the midwife vs Jupiter     : ${tidalRatio('midwife', 'jupiter').toExponential(2)}× greater`);
    console.log(`\n${ALIGNMENT_NOTE.what}\n${ALIGNMENT_NOTE.why}`);
  } else {
    const c = classification();
    console.log(`${c.total} events — ${JSON.stringify(c.counts)}  valid: ${validate().ok}`);
    for (const k of KINDS) { console.log(`\n[${k}]`); for (const e of byKind(k)) console.log(`  ${e.label}`); }
    const d = precessionDrift(-130);
    console.log(`\nprecession since 130 BC: ${d.note}`);
  }
}
