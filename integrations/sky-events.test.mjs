// sky-events.test.mjs — OFFLINE, pure arithmetic.
//
// The point of this module is that the sky is COMPUTABLE and the meaning is ASSIGNED, and that a
// temple can schedule by the first without asserting the second. These tests protect that seam —
// and they hand-check the arithmetic rather than trusting the functions that produce it.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  EVENTS, KINDS, TIERS, BODIES, EPHEMERIDES, PRECESSION, ALIGNMENT_NOTE,
  byKind, getEvent, classification, tidalIndex, tidalRatio, precessionDrift, validate, handler, esc,
} from './sky-events.mjs';

test('every event carries a known kind, a note, and a sane period', () => {
  const v = validate();
  assert.equal(v.ok, true, v.problems.join('\n'));
});

test('the tier ladder is imported from pantheon-map, not restated', async () => {
  const pm = await import('./pantheon-map.mjs');
  assert.deepEqual(TIERS, pm.TIERS);
});

test('the KINDS vocabulary matches time-cycles — one frame, not two', async () => {
  const tc = await import('./time-cycles.mjs');
  for (const k of KINDS) assert.ok(tc.KINDS.includes(k), `${k} is not a time-cycles kind`);
});

// --- ⭐ the seam ---------------------------------------------------------------

test('most of the sky is observed; what is contested sits in `chosen`', () => {
  const c = classification();
  assert.ok(c.counts.observed > c.counts.chosen, 'the astronomy should outweigh the assignment');
  assert.ok(c.counts.chosen >= 2);
  assert.match(c.reading, /without asserting/);
});

test('planetary hours and portents are CHOSEN, not observed', () => {
  assert.equal(getEvent('planetary-hours').kind, 'chosen');
  assert.equal(getEvent('zodiac-meaning').kind, 'chosen');
  // ...and `chosen` must not read as dismissal — the planetary-hours note records that the scheme
  // demonstrably generated the weekday order.
  assert.match(getEvent('planetary-hours').note, /weekday|Dio Cassius/);
});

test('solstices, heliacal risings and standstills are OBSERVED', () => {
  for (const id of ['solstice', 'heliacal-rising', 'lunar-standstill', 'lunar-phase']) {
    assert.equal(getEvent(id).kind, 'observed', `${id} should be observed`);
  }
});

test('Metonic and Saros are DERIVED — arithmetic on observed cycles, not observations', () => {
  assert.equal(getEvent('metonic').kind, 'derived');
  assert.equal(getEvent('saros').kind, 'derived');
});

test('the heliacal-rising entry points at the decans rather than duplicating them', () => {
  assert.match(getEvent('heliacal-rising').note, /day-signs\.mjs/);
});

test('the lunar-phase entry defers the physiology question to light-signal', () => {
  assert.match(getEvent('lunar-phase').note, /light-signal\.mjs/);
  assert.match(getEvent('lunar-phase').note, /scheduling/i);
});

// --- ⭐ the influence claim, hand-checked -------------------------------------

test('tidal influence uses the CUBE of distance — the exponent is the whole answer', () => {
  // Hand-computed: 7.342e22 / (3.844e8)^3
  const expected = 7.342e22 / (3.844e8 ** 3);
  assert.ok(Math.abs(tidalIndex('moon') - expected) / expected < 1e-12);
  // If it used r² instead of r³ the Moon/Jupiter ratio would be wildly different — this is the guard.
  const wrong = (7.342e22 / (3.844e8 ** 2)) / (1.898e27 / (5.88e11 ** 2));
  assert.ok(Math.abs(tidalRatio('moon', 'jupiter') - wrong) > 1000, 'r² and r³ must not agree');
});

test('⭐ the Moon out-tides Jupiter by ~138,000×, and a midwife out-tides it by ~6e10×', () => {
  const mj = tidalRatio('moon', 'jupiter');
  assert.ok(mj > 100000 && mj < 200000, `moon/jupiter = ${mj}`);
  const wj = tidalRatio('midwife', 'jupiter');
  assert.ok(wj > 1e10, `midwife/jupiter = ${wj}`);
});

test('tidal lookups return null for an unknown body rather than a guess', () => {
  assert.equal(tidalIndex('nibiru'), null);
  assert.equal(tidalRatio('moon', 'nibiru'), null);
  assert.equal(tidalRatio('nibiru', 'moon'), null);
});

test('the alignment note explains that a conjunction is a VIEWING ANGLE', () => {
  assert.match(ALIGNMENT_NOTE.what, /ecliptic longitude/);
  assert.match(ALIGNMENT_NOTE.why, /not in a line in space/);
  assert.match(ALIGNMENT_NOTE.force, /M\/r³|r³/);
});

// --- ⭐ precession -------------------------------------------------------------

test('precession drift is arithmetic and shows its working', () => {
  const d = precessionDrift(-130, 2026);
  assert.equal(d.years, 2156);
  // 2156 × (360/25772) = 30.12°, hand-checked.
  assert.ok(Math.abs(d.degrees - 30.12) < 0.05, `got ${d.degrees}`);
  assert.match(d.note, /2156 years/);
});

test('⭐ since the signs were fixed in antiquity, the drift is one whole sign', () => {
  const d = precessionDrift(-130, 2026);
  assert.ok(Math.abs(d.signs - 1) < 0.05, `${d.signs} signs — this is the number that breaks the naive version`);
});

test('the precession note names BOTH systems as internally consistent', () => {
  assert.match(PRECESSION.note, /tropical/i);
  assert.match(PRECESSION.note, /sidereal/i);
  assert.match(PRECESSION.note, /internally consistent/i);
  assert.match(PRECESSION.note, /Ophiuchus/);
  assert.match(PRECESSION.note, /1930/, 'the IAU boundary convention is the real Ophiuchus answer');
});

test('precessionDrift refuses junk instead of returning a number', () => {
  for (const v of [null, undefined, 'x', {}, NaN]) assert.equal(precessionDrift(v), null);
});

// --- the licence question -----------------------------------------------------

test('⚠️ Swiss Ephemeris is flagged decision-required, not silently usable', () => {
  const se = EPHEMERIDES.find((e) => e.id === 'swiss-ephemeris');
  assert.equal(se.verdict, 'decision-required');
  assert.match(se.licence, /AGPL/);
  assert.match(se.note, /network use|hosting/i, 'AGPL reaching network use is the operative fact');
});

test('a permissive option exists, so the feature is buildable at all', () => {
  assert.ok(EPHEMERIDES.some((e) => e.verdict === 'usable' && /MIT|public domain/i.test(e.licence)));
});

// --- robustness ---------------------------------------------------------------

test('nothing throws on junk', () => {
  for (const v of [null, undefined, 0, '', [], {}]) {
    assert.doesNotThrow(() => byKind(v));
    assert.doesNotThrow(() => getEvent(v));
    assert.doesNotThrow(() => tidalIndex(v));
    assert.doesNotThrow(() => esc(v));
  }
  assert.equal(getEvent('nonsense'), null);
});

test('the module makes no efficacy or influence claim in its own voice', async () => {
  const { claimsCheck } = await import('../site/hathor-live/the-line.mjs');
  for (const s of [classification().reading, ALIGNMENT_NOTE.what, ALIGNMENT_NOTE.why, PRECESSION.note]) {
    const r = claimsCheck(s);
    assert.equal(r.ok, true, `claim phrase in our own prose: ${JSON.stringify(r.hits)}`);
  }
});

test('handler serves the classification and states the seam', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.match(j.note, /needs no mechanism/);
  assert.ok(j.classification.counts.observed > 0);
});
