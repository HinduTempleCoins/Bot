import { test } from 'node:test';
import assert from 'node:assert/strict';
import { teach, topics, GUARDRAIL, SOURCES } from './protest-safety.mjs';

test('teach resolves topics + aliases, always with the guardrail', () => {
  const g = teach('tear gas');
  assert.equal(g.topic, 'chemical');
  assert.ok(g.points.some((p) => /upwind|water|saline/i.test(p)));
  assert.equal(g.guardrail, GUARDRAIL);
  assert.equal(teach('stampede').topic, 'crush');
  assert.equal(teach('detained').topic, 'rights');
});

test('crush guidance teaches staying upright + breathing', () => {
  const c = teach('crush');
  assert.ok(c.points.some((p) => /feet|upright/i.test(p)));
  assert.ok(c.points.some((p) => /breath|air/i.test(p)));
});

test('overview lists sections; sources cite Steal This Book + ACLU', () => {
  const o = teach();
  assert.equal(o.topic, 'overview');
  assert.ok(o.sections.length >= 6);
  assert.ok(SOURCES.some((s) => /Steal This Book/.test(s)));
  assert.ok(SOURCES.some((s) => /ACLU/.test(s)));
  assert.ok(topics().includes('rights'));
});
