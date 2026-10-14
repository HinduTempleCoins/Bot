import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teach, topics, GUARDRAIL, SOURCES } from './protest-organizing.mjs';

test('teaches the affinity-group/spokescouncil backbone', () => {
  const s = teach('affinity group');
  assert.equal(s.topic, 'structure');
  assert.ok(s.points.some((p) => /spokescouncil/i.test(p)));
  assert.equal(s.guardrail, GUARDRAIL);
});

test('discipline topic teaches recognizing provocateurs (not taking the bait)', () => {
  const d = teach('provocateur');
  assert.equal(d.topic, 'discipline');
  assert.ok(d.points.some((p) => /provocateur|agitator|bait/i.test(p)));
});

test('base-building carries the Black Panther survival-program lesson', () => {
  const b = teach('survival program');
  assert.equal(b.topic, 'base');
  assert.ok(b.points.some((p) => /survival program|breakfast|copwatch/i.test(p)));
});

test('overview + sources cite the CIA manual (orgs only) and the Panthers, guardrailed to nonviolence', () => {
  const o = teach();
  assert.equal(o.topic, 'overview');
  assert.ok(o.sections.length >= 7);
  assert.ok(SOURCES.some((s) => /Psychological Operations/.test(s)));
  assert.ok(SOURCES.some((s) => /Black Panther/.test(s)));
  assert.match(GUARDRAIL, /nonviolent|Not violence/i);
  assert.ok(topics().includes('program'));
});
