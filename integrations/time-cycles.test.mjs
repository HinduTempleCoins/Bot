import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CYCLES, KINDS, derive, byKind, classify, sharedArbitrary, DECK, AXIS_MUNDI } from './time-cycles.mjs';

test('the planetary week derives from the Chaldean order by the 24-hour rule', () => {
  assert.deepEqual(derive.chaldeanWeek(),
    ['Saturn', 'Sun', 'Moon', 'Mars', 'Mercury', 'Jupiter', 'Venus']);
});

test('the derived week is NOT the Chaldean order it came from — that is the proof', () => {
  const CHALDEAN = ['Saturn', 'Jupiter', 'Mars', 'Sun', 'Venus', 'Mercury', 'Moon'];
  const week = derive.chaldeanWeek();
  assert.notDeepEqual(week, CHALDEAN);
  assert.deepEqual([...week].sort(), [...CHALDEAN].sort(), 'same seven planets, different sequence');
});

test('the Aztec Calendar Round is lcm(260, 365) = 52 years', () => {
  const r = derive.calendarRound();
  assert.equal(r.tonalpohualli, 260);
  assert.equal(r.xiuhpohualli, 365);
  assert.equal(r.days, 18980);
  assert.equal(r.years, 52);
});

test('the sexagenary cycle is lcm(10 stems, 12 branches)', () => {
  assert.equal(derive.sexagenary(), 60);
});

test('the Metonic cycle is 235 lunations in 19 years, to within about two hours', () => {
  const m = derive.metonic();
  assert.equal(m.months, 235);
  assert.ok(m.errorHours < 3, `error was ${m.errorHours}h`);
});

test('the yugas run 4:3:2:1 on a base of 432,000', () => {
  const y = derive.yugas();
  assert.equal(y.kali, 432000);
  assert.equal(y.satya / y.kali, 4);
  assert.equal(y.treta / y.kali, 3);
  assert.equal(y.dvapara / y.kali, 2);
  assert.equal(y.mahayuga, 4320000);
});

test('Berossus reaches the same 432,000 by a completely different route', () => {
  const b = derive.berossus();
  assert.equal(b.total, 432000);
  assert.equal(b.sars * b.sarYears, derive.yugas().kali);
  assert.notEqual(b.sarYears, 432000, 'different construction, same total — that is what makes it a tracer');
});

test('432,000 is the ONLY shared arbitrary number that survives', () => {
  const shared = sharedArbitrary();
  assert.equal(shared.length, 1);
  assert.equal(shared[0].count, 432000);
  assert.deepEqual(shared[0].traditions, ['babylonian', 'hindu']);
  assert.deepEqual(shared[0].cycles.sort(), ['berossus-kings', 'yuga-base']);
});

test('the 24-hour day comes out of the 36 Egyptian decans', () => {
  const d = derive.decans();
  assert.equal(d.nightHours, 12);
  assert.equal(d.civilYear, 365);
});

test('the card-deck arithmetic is exact', () => {
  const d = derive.deck();
  assert.equal(d.cards, 52);
  assert.equal(d.courts, 12);
  assert.equal(d.pipSum, 364);
  assert.equal(d.pipSum + 1, 365, 'plus the joker');
  assert.deepEqual(DECK.arithmetic, d);
});

test('the card deck is nonetheless refused as evidence, with reasons', () => {
  assert.match(DECK.verdict, /unattested/i);
  assert.ok(DECK.why.length >= 4);
  assert.ok(DECK.why.some((w) => /Mamluk/.test(w)), 'the 4x13 shape predates Europe');
  assert.ok(DECK.why.some((w) => /Aztec|52/.test(w)), 'the Aztec 52 is the control');
});

test('the Aztec 52 is the control that kills the card-deck claim, and both are in the catalogue', () => {
  const cr = classify('calendar-round');
  assert.equal(cr.kind, 'derived');
  assert.match(cr.note, /CONTROL FOR THE CARD DECK/);
  assert.match(cr.licence, /licenses nothing/i);
});

test('classify() states what sharing a number does and does not license', () => {
  assert.match(classify('lunation').licence, /control/i);
  assert.match(classify('yuga-base').licence, /real evidence of contact/i);
  assert.match(classify('planetary-week').licence, /ORDER or the NAMES/);
  assert.equal(classify('nope'), null);
});

test('the observed cycles are marked as controls, never as evidence', () => {
  const observed = byKind('observed').map((c) => c.id);
  assert.ok(observed.includes('lunation'));
  assert.ok(observed.includes('solar-year'));
  for (const c of byKind('observed')) assert.match(classify(c.id).licence, /nothing whatsoever/i);
});

test('every cycle declares a legal kind and a source', () => {
  for (const c of CYCLES) {
    assert.ok(KINDS.includes(c.kind), `${c.id} has bad kind ${c.kind}`);
    assert.ok(c.source, `${c.id} has no source`);
    assert.ok(Array.isArray(c.traditions) && c.traditions.length, `${c.id} has no traditions`);
  }
});

test('the Rudras and lokas are carried, and marked as unstable rather than as tracers', () => {
  const rudras = classify('eleven-rudras');
  assert.equal(rudras.count, 11);
  assert.equal(rudras.kind, 'chosen');
  assert.match(rudras.note, /unstable/i);
  const lokas = classify('fourteen-lokas');
  assert.equal(lokas.count, 14);
  assert.match(lokas.note, /seven/i);
  // an unstable chosen set must not show up as a shared tracer
  assert.ok(!sharedArbitrary().some((s) => s.cycles.includes('eleven-rudras')));
});

test('the world-tree is held as structural, and the squirrel is the reason', () => {
  assert.equal(AXIS_MUNDI.verdict, 'structural, not a tracer');
  assert.equal(AXIS_MUNDI.instances.length, 3);
  const norse = AXIS_MUNDI.instances.find((i) => i.tradition === 'norse');
  assert.match(norse.detail, /Ratatoskr/);
  assert.match(norse.source, /Grimnismal/);
  assert.match(AXIS_MUNDI.why, /Ratatoskr/, 'the unique arbitrary detail is the argument');
});
