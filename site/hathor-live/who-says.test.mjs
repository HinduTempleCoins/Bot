// who-says.test.mjs — OFFLINE. R5, the battery's framing page.
//
// The tests that matter are the ones that keep this page HONEST about its own position. The failure
// mode it exists to expose is a project quietly moving one row up its own table and becoming the
// authority — so a test that let us claim a higher row would defeat the entire point of the page.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  POSITIONS, OUR_ROW, NOT_EQUIVALENT, getPosition, driftCheck, whoSaysHTML, handler, esc,
} from './who-says.mjs';

test('the four positions are a ladder, self-authorised to externally authorised', () => {
  assert.equal(POSITIONS.length, 4);
  assert.deepEqual(POSITIONS.map((p) => p.row), [1, 2, 3, 4]);
  assert.equal(getPosition('amica').row, 1);
  assert.equal(getPosition('temple-exams').row, 4);
});

test('every position says who identifies the condition AND what the authority rests on', () => {
  for (const p of POSITIONS) {
    assert.ok(p.whoIdentifies, `${p.id} does not say who identifies`);
    assert.ok(p.groundedIn, `${p.id} does not say what the authority rests on`);
    assert.ok(p.note);
  }
});

// --- ⭐ our own row ------------------------------------------------------------

test('we occupy row 4 — the instrument measures, a clinician interprets', () => {
  assert.equal(OUR_ROW, 4);
  const us = getPosition('temple-exams');
  assert.equal(us.row, OUR_ROW);
  assert.match(us.whoIdentifies, /instrument measures/);
  assert.match(us.whoIdentifies, /clinician interprets/);
});

test('⭐ driftCheck catches every way of moving UP the table', () => {
  assert.equal(driftCheck().ok, true);
  assert.match(driftCheck().verdict, /Still row 4/);

  assert.equal(driftCheck({ interpretsForTaker: true }).ok, false);
  assert.equal(driftCheck({ namesACondition: true }).ok, false);
  assert.equal(driftCheck({ tellsYouWhatToDo: true }).ok, false);

  const all = driftCheck({ interpretsForTaker: true, namesACondition: true, tellsYouWhatToDo: true });
  assert.equal(all.drifts.length, 3);
  assert.match(all.verdict, /MOVED UP THE TABLE/);
});

test('driftCheck names WHICH row a drift lands in — the diagnosis is the useful part', () => {
  assert.match(driftCheck({ interpretsForTaker: true }).drifts[0], /row 2|specialist/);
  assert.match(driftCheck({ namesACondition: true }).drifts[0], /diagnosis/);
});

test('driftCheck never throws on junk and treats junk as no drift claimed', () => {
  for (const v of [null, undefined, 0, '', [], {}]) assert.doesNotThrow(() => driftCheck(v));
  assert.equal(driftCheck(undefined).ok, true);
});

// --- ⚠️ the anti-flattening rule ----------------------------------------------

test('⚠️ the page REFUSES to say the four are the same thing in different clothes', () => {
  assert.match(NOT_EQUIVALENT.claim, /not one thing in four costumes|not the same/i);
  assert.match(NOT_EQUIVALENT.why, /structurally/);
  // And it must give the REASON that refusing is the respectful move, not just assert it.
  assert.match(NOT_EQUIVALENT.because, /credits each|method/i);
  assert.match(NOT_EQUIVALENT.because, /disrespectful|kinder/i);
});

test('the rendered page carries the refusal, not just the data structure', () => {
  const h = whoSaysHTML();
  assert.match(h, /costumes|not the same/i);
  assert.match(h, /structurally/);
});

// --- the page ------------------------------------------------------------------

test('the page states our row and tells the reader how to catch us leaving it', () => {
  const h = whoSaysHTML();
  assert.match(h, /instrument measures/);
  assert.match(h, /clinician interprets/);
  assert.match(h, /interprets itself|names a condition|tells you what to do/i);
  assert.match(h, /it has moved/i, 'the reader must be given the test, not just the promise');
});

test('the page asks the prior question rather than "what is wrong with you"', () => {
  const h = whoSaysHTML();
  assert.match(h, /Who is authorised to say what is happening to you/);
  assert.match(h, /who gets to say/i);
});

test('each tradition gets its method credited, not just its label', () => {
  const h = whoSaysHTML();
  assert.match(h, /kodia/);
  assert.match(h, /256/);
  assert.match(h, /randomiser is the trivial part/i, 'the Ifá note is the one most likely to be flattened');
});

test('the AMICA row carries the outstanding correction rather than repeating the error', () => {
  const a = getPosition('amica');
  assert.match(a.note, /Ghadiali/);
  assert.match(a.note, /outstanding|⚠️/);
});

test('hostile values cannot break out of the markup', () => {
  const h = whoSaysHTML();
  assert.ok(!h.includes('<script>'));
  assert.equal(esc('"><script>alert(1)</script>'), '&quot;&gt;&lt;script&gt;alert(1)&lt;/script&gt;');
});

test('the page makes no efficacy claim in its own voice', async () => {
  const { claimsCheck } = await import('./the-line.mjs');
  for (const s of [NOT_EQUIVALENT.claim, NOT_EQUIVALENT.why, NOT_EQUIVALENT.because,
    ...POSITIONS.map((p) => p.whoIdentifies), ...POSITIONS.map((p) => p.groundedIn)]) {
    assert.equal(claimsCheck(s).ok, true, `claim phrase: ${s.slice(0, 60)}`);
  }
});

test('handler serves the row and the refusal', () => {
  let body = '';
  handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  const j = JSON.parse(body);
  assert.equal(j.ok, true);
  assert.equal(j.ourRow, 4);
  assert.equal(j.positions.length, 4);
  assert.ok(j.notEquivalent);
});
