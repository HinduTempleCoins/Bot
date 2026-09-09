// light-signal.test.mjs — OFFLINE, pure arithmetic. No network, no clock.
//
// The load-bearing tests are the ones that keep a MEASUREMENT from becoming a CLAIM. This module
// exists next to United States v. Ghadiali (165 F.2d 957) in the-line.mjs, and the whole reason it
// is defensible is that it converts a light description into a published quantity instead of
// promising an effect. A test that lets an efficacy sentence in here is a test that lost the point.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  SYSTEMS, ALPHA_OPIC, MEL_DER, RECOMMENDATIONS, MOONLIGHT, PHOTOPERIOD,
  melanopicEDI, classifyExposure, lunarVerdict, handler, esc,
} from './light-signal.mjs';

// --- the two systems ---------------------------------------------------------

test('both visual systems are named, and each says who owns it', () => {
  assert.ok(SYSTEMS['image-forming'].ownedBy.includes('colour-and-light'));
  assert.equal(SYSTEMS['non-image-forming'].peakSensitivityNm, 480);
  assert.match(SYSTEMS['non-image-forming'].receptors, /melanopsin|OPN4/);
});

test('⭐ the module records that the mechanism POSTDATES the conviction', () => {
  // This is the distinction the module exists for: Spectro-Chrome was condemned in 1948 for a false
  // claim; melanopsin was described ~2000. Losing that ordering is how the two get conflated.
  assert.match(SYSTEMS['non-image-forming'].note, /1948/);
  assert.match(SYSTEMS['non-image-forming'].note, /2000/);
});

test('all five CIE S 026 α-opic classes are declared', () => {
  assert.equal(ALPHA_OPIC.length, 5);
  assert.ok(ALPHA_OPIC.includes('melanopic'));
  assert.ok(ALPHA_OPIC.includes('s-cone-opic'));
});

// --- the arithmetic ----------------------------------------------------------

test('D65 has a mel-DER of exactly 1 — by definition, not by measurement', () => {
  assert.equal(MEL_DER.d65, 1.00);
  const r = melanopicEDI(250, 'd65');
  assert.equal(r.mEDI, 250);
});

test('a warm source yields far less melanopic EDI than a cool one at the same lux', () => {
  const warm = melanopicEDI(100, 'led-2700k').mEDI;
  const cool = melanopicEDI(100, 'led-6500k').mEDI;
  assert.ok(cool > warm * 2, `2700K ${warm} vs 6500K ${cool} — the whole point is that lux alone does not say`);
});

test('every result is flagged APPROXIMATE — a real mEDI needs the measured spectrum', () => {
  for (const k of Object.keys(MEL_DER)) {
    const r = melanopicEDI(100, k);
    assert.equal(r.approximate, true, `${k} did not declare itself approximate`);
    assert.match(r.note, /spectrum/);
  }
});

test('an unknown source refuses and lists what it knows — never guesses a ratio', () => {
  const r = melanopicEDI(100, 'moonbeam');
  assert.equal(r.ok, false);
  assert.equal(r.mEDI, null);
  assert.match(r.reason, /unknown source/);
});

test('negative and non-numeric lux are refused, not coerced', () => {
  for (const bad of [-1, 'x', null, undefined, NaN, {}]) {
    assert.equal(melanopicEDI(bad, 'd65').ok, false, `accepted ${JSON.stringify(bad)}`);
  }
  assert.equal(melanopicEDI(0, 'd65').ok, true, 'zero lux is a legitimate measurement');
});

// --- the consensus -----------------------------------------------------------

test('the three phases carry the published numbers', () => {
  const byPhase = Object.fromEntries(RECOMMENDATIONS.map((r) => [r.phase, r]));
  assert.equal(byPhase.daytime.minMEDI, 250);
  assert.equal(byPhase.evening.maxMEDI, 10);
  assert.equal(byPhase.sleep.maxMEDI, 1);
});

test('classifyExposure reads a ceiling as a ceiling and a floor as a floor', () => {
  assert.equal(classifyExposure(300, 'daytime').meets, true);
  assert.equal(classifyExposure(100, 'daytime').meets, false);
  assert.equal(classifyExposure(0.5, 'sleep').meets, true);
  assert.equal(classifyExposure(5, 'sleep').meets, false);
  assert.match(classifyExposure(5, 'sleep').verdict, /ABOVE/);
});

test('an unknown phase refuses rather than defaulting to the most permissive', () => {
  const r = classifyExposure(1, 'twilight');
  assert.equal(r.ok, false);
  assert.match(r.reason, /unknown phase/);
});

// --- ⭐ the lunar verdict -----------------------------------------------------

test('the lunar verdict is COMPUTED and shows its arithmetic', () => {
  const v = lunarVerdict();
  assert.deepEqual(v.fullMoonPhotopicLux, [0.1, 0.3]);
  assert.equal(v.melDER, MEL_DER.moonlight);
  // 0.3 lux × 0.8 = 0.24 — hand-checked, not taken from the function.
  assert.equal(v.fullMoonMEDI[1], 0.24);
  assert.equal(v.sleepCeilingMEDI, 1);
  assert.equal(v.belowCeiling, true);
});

test('⭐ full moonlight falls BELOW the level already called acceptable during sleep', () => {
  const v = lunarVerdict();
  assert.ok(v.factorBelow > 1);
  assert.match(v.verdict, /BELOW/);
  assert.match(v.verdict, /null human literature|zeitgeber/i);
});

test('⭐ the verdict does NOT collapse scheduling into physiology', () => {
  const v = lunarVerdict();
  assert.match(v.andYet, /SCHEDULING/);
  assert.match(v.andYet, /two different claims/i);
  // The negative result must not be reported as "lunar timing is useless".
  assert.ok(!/useless\b(?!\.)/.test(v.andYet.replace('does not make lunar timing useless', '')));
});

test('the contrast caveat is kept — a null on absolute level is not a null on relative change', () => {
  assert.match(lunarVerdict().caveat, /CONTRAST/);
  assert.match(lunarVerdict().caveat, /lit bedroom/);
});

test('both lunar studies are cited WITH what each one bears on', () => {
  assert.equal(MOONLIGHT.studies.length, 2);
  for (const s of MOONLIGHT.studies) {
    assert.match(s.cite, /doi:10\./, 'every study needs a resolvable handle');
    assert.ok(s.bears, `${s.cite.slice(0, 30)} has no statement of what it bears on`);
  }
  // The Cajochen entry must carry the objection, not just the headline.
  const caj = MOONLIGHT.studies.find((s) => /Cajochen/.test(s.cite));
  assert.match(caj.what, /replication/i);
});

// --- photoperiod and robustness ---------------------------------------------

test('photoperiod records DURATION as the signal, and the human caveat', () => {
  assert.match(PHOTOPERIOD.signal, /DURATION/);
  assert.match(PHOTOPERIOD.honest, /hamster|weaker/i);
});

test('nothing throws on junk', () => {
  for (const v of [null, undefined, 0, '', [], {}]) {
    assert.doesNotThrow(() => melanopicEDI(v, v));
    assert.doesNotThrow(() => classifyExposure(v, v));
    assert.doesNotThrow(() => esc(v));
  }
  assert.doesNotThrow(() => lunarVerdict());
});

test('⚠️ the module makes no efficacy claim in its own voice', async () => {
  const { claimsCheck } = await import('../site/hathor-live/the-line.mjs');
  const ours = [
    ...RECOMMENDATIONS.map((r) => r.why),
    PHOTOPERIOD.signal, PHOTOPERIOD.consequence, PHOTOPERIOD.honest,
    lunarVerdict().verdict, lunarVerdict().andYet, lunarVerdict().caveat,
  ];
  for (const s of ours) {
    const r = claimsCheck(s);
    assert.equal(r.ok, true, `efficacy phrase in our own prose: ${JSON.stringify(r.hits)} — ${s.slice(0, 70)}`);
  }
});

test('handler serves the quantities and disclaims being a health claim', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.match(j.note, /not a health claim|not a diagnosis/i);
  assert.equal(j.lunar.belowCeiling, true);
});
