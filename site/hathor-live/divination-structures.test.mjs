// divination-structures.test.mjs — OFFLINE. R11: four systems compared by architecture.
//
// The load-bearing tests are the REFUSALS. A page that casts eight bits and prints an odu name has
// performed a divination however carefully it is hedged, and these tests are what stop that from ever
// arriving by accident.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SYSTEMS, LESSONS, CONTESTED, REFUSED, getSystem, divinationHTML, handler, esc } from './divination-structures.mjs';

test('all four systems carry mechanism, outcome count and where the meaning lives', () => {
  assert.equal(SYSTEMS.length, 4);
  for (const s of SYSTEMS) {
    assert.ok(s.mechanism); assert.ok(s.meaningLives); assert.ok(Number.isInteger(s.outcomes));
  }
});

test('the outcome counts are the real ones', () => {
  assert.equal(getSystem('ifa').outcomes, 256);
  assert.equal(getSystem('i-ching').outcomes, 64);
  assert.equal(getSystem('geomancy').outcomes, 16);
  assert.equal(getSystem('dilogun').outcomes, 17);
});

test('⭐ 2^8 = 256 is stated as the reason Ifá has 256 odu', () => {
  assert.match(getSystem('ifa').note, /2⁸|2\^8/);
  assert.match(getSystem('ifa').note, /address/i, 'the odu-as-address point is the teaching');
});

test('⭐ the first lesson is that the randomiser is the trivial part', () => {
  assert.match(LESSONS[0].lesson, /randomiser is the trivial part/i);
  assert.match(LESSONS[0].detail, /corpus/);
  // "neither is a piece of software" — the point is that the corpus and the training are the system.
  assert.match(LESSONS[0].detail, /neither is a piece of software/i);
  assert.match(LESSONS[0].detail, /interpretive training/i);
});

test('the recurrence lesson refuses the diffusion inference', () => {
  const l = LESSONS.find((x) => x.id === 'binary-generator');
  assert.match(l.detail, /cosmologies\.mjs/, 'it must point at the module that already solved this');
  assert.match(l.detail, /not evidence of contact/i);
});

// --- ⚠️ the refusals ----------------------------------------------------------

test('⚠️ the Ifá–geomancy link is marked CONTESTED and is never asserted', () => {
  assert.equal(CONTESTED.status, 'genuinely contested');
  assert.match(CONTESTED.rule, /[Dd]o not assert/);
  assert.match(CONTESTED.rule, /loanword|technique|name/, 'it must say what WOULD count as evidence');
});

test('⛔ no odu name appears anywhere in the module or the rendered page', () => {
  const h = divinationHTML() + JSON.stringify(SYSTEMS) + JSON.stringify(LESSONS);
  // A sample of real odu names. None may appear.
  for (const odu of ['Ogbè', 'Ogbe', 'Òfún', 'Ofun', 'Ìwòrì', 'Iwori', 'Òdí', 'Ìrosùn', 'Ọ̀wọ́nrín']) {
    assert.ok(!h.includes(odu), `an odu name leaked: ${odu}`);
  }
});

test('⛔ the page states what it refuses and why — the refusal IS the content', () => {
  assert.ok(REFUSED.length >= 3);
  const kinds = REFUSED.map((r) => r.what).join(' ');
  assert.match(kinds, /ese/);
  assert.match(kinds, /odu names/);
  assert.match(kinds, /generated reading/);
  const h = divinationHTML();
  assert.match(h, /does not contain/i);
  assert.match(h, /[Cc]opyright expiry is not consent/);
});

test('⛔ the page casts nothing — no randomiser, no result, no form', () => {
  const h = divinationHTML();
  assert.ok(!/<input|<button|<form/i.test(h), 'any control here would make this a divination');
  assert.ok(!/Math\.random|your (result|reading|odu)/i.test(h));
});

test('the babalawo is named as the authority, not as an obstacle', () => {
  const why = REFUSED.map((r) => r.why).join(' ');
  assert.match(why, /babalawo/);
  assert.match(why, /random number generator/i);
});

test('⭐ the I Ching entry records WHY it travelled and the others did not', () => {
  const i = getSystem('i-ching');
  assert.match(i.meaningLives, /text/i);
  assert.match(i.note, /book can be carried|initiation cannot/i);
});

test('lookups are exact; unknown returns null', () => {
  assert.ok(getSystem('IFA'));
  assert.equal(getSystem('if'), null);
  assert.equal(getSystem('nonsense'), null);
});

test('nothing throws on junk, and markup cannot break out', () => {
  for (const v of [null, undefined, 0, '', [], {}]) {
    assert.doesNotThrow(() => getSystem(v));
    assert.doesNotThrow(() => esc(v));
  }
  assert.ok(!divinationHTML().includes('<script>'));
});

test('handler serves architecture and lists what it refuses', () => {
  let body = ''; handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.equal(j.systems.length, 4);
  assert.ok(j.refuses.length >= 3);
  assert.match(j.note, /randomiser is the trivial part/i);
});
