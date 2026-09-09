// dissociation.test.mjs — OFFLINE. R9: an explainer, and the refusal to instrument it.
//
// The load-bearing tests are the ones that keep this page from becoming a screener. The temptation is
// real — the items are free and the arithmetic is easy — and the reason not to is base rates, not
// squeamishness. A test that let an instrument in here would defeat the page.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISSOCIATION, INSTRUMENT, WHY_NO_INSTRUMENT, dissociationHTML, handler, esc } from './dissociation.mjs';

test('⭐ this page is not an instrument, and says so in its own API', () => {
  let body = ''; handler({}, { statusCode: 0, setHeader() {}, end(b) { body = b; } });
  assert.equal(JSON.parse(body).isInstrument, false);
});

test('the construct is presented as DIMENSIONAL, with the low end called ordinary', () => {
  assert.match(DISSOCIATION.dimensional, /DIMENSIONAL|dimensional/);
  assert.match(DISSOCIATION.dimensional, /ordinary|universal/i);
  assert.match(DISSOCIATION.dimensional, /not a disorder/i);
});

test('the high end is routed to a clinician over time, never to a questionnaire', () => {
  assert.match(DISSOCIATION.highEnd, /clinician/);
  assert.match(DISSOCIATION.highEnd, /never by a single questionnaire|never by a web page/i);
});

test('⭐ it distinguishes absorption from dissociation rather than blurring them', () => {
  assert.match(DISSOCIATION.adjacent, /[Aa]bsorption/);
  assert.match(DISSOCIATION.adjacent, /NOT the same|not the same/);
  assert.match(DISSOCIATION.adjacent, /expectancy uptake/i, 'the shipped covariate must be named too');
});

test('the instrument clinicians use is NAMED, with its item count', () => {
  assert.match(INSTRUMENT.name, /Dissociative Experiences Scale|DES-II/);
  assert.equal(INSTRUMENT.items, 28);
  assert.match(INSTRUMENT.note, /screening|does not diagnose/i);
});

test('⭐ the refusal gives BASE RATES as the first reason — not caution', () => {
  const first = WHY_NO_INSTRUMENT[0];
  assert.match(first.reason, /[Bb]ase rate/);
  assert.match(first.detail, /86\.3|34\.5/, 'the PPV numbers are what make the argument checkable');
  assert.match(first.detail, /same instrument, same cutoff/i);
});

test('every refusal reason carries its detail — a bare refusal reads as squeamishness', () => {
  assert.ok(WHY_NO_INSTRUMENT.length >= 3);
  for (const w of WHY_NO_INSTRUMENT) { assert.ok(w.reason); assert.ok(w.detail.length > 60); }
});

test('the page renders the construct, the instrument, the refusal and CONSULT.full', async () => {
  const { CONSULT } = await import('./the-line.mjs');
  const h = dissociationHTML();
  assert.match(h, /DES-II|Dissociative Experiences Scale/);
  assert.match(h, /not going to give you one/i);
  assert.ok(h.includes(esc(CONSULT.full).slice(0, 40)), 'CONSULT.full must be on the page');
  assert.ok(!h.includes('<script>'));
});

test('the page contains no scored items and no cutoff', () => {
  const h = dissociationHTML();
  assert.ok(!/<input/i.test(h), 'an input would make this an instrument');
  assert.ok(!/your score|cut-?off of \d/i.test(h));
});

test('nothing throws on junk', () => {
  for (const v of [null, undefined, 0, '', [], {}]) assert.doesNotThrow(() => esc(v));
  assert.doesNotThrow(() => dissociationHTML());
});
