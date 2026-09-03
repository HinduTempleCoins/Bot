// hathor-describe.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { list, get, describe, describeAll, grounding, describePrompt, OFFERINGS, STATUS } from './hathor-describe.mjs';

test('catalog lists offerings; each has honest status + grounded fields', () => {
  const l = list();
  assert.ok(l.length >= 8);
  for (const o of l) {
    assert.ok(o.id && o.name && o.tagline && o.what && o.audience);
    assert.ok([STATUS.LIVE, STATUS.BUILT, STATUS.DESIGN].includes(o.status));
  }
  assert.ok(l.some((o) => o.id === 'login-with-melek'));
  assert.ok(l.some((o) => o.id === 'node-api' && o.tier === 'paas'));
});

test('describe(id) gives the facts and states status honestly (no dressing up design as live)', () => {
  const d = describe('node-api');
  assert.match(d, /Node API/);
  assert.match(d, /not yet deployed|design, not yet built/i);   // node-api is DESIGN → must say so
  const live = describe('indexing');
  assert.match(live, /live/i);                                   // indexing is LIVE
  assert.equal(describe('nope'), '');
});

test('the funds/permission description tells the truth: funds are off', () => {
  const d = describe('permission');
  assert.match(d, /turned off|closed|cannot|does not/i);
  assert.match(d, /who you are/i);
});

test('voiced description keeps the facts verbatim but adds Hathor’s disposition', () => {
  const facts = describe('login-with-melek');
  const voiced = describe('login-with-melek', { voiced: true });
  assert.ok(voiced.length > facts.length);                       // an opener was prepended
  assert.ok(voiced.includes('Login with MELEK'));                // facts preserved
});

test('describeAll joins every offering; grounding + prompt feed the LLM path', () => {
  const all = describeAll();
  for (const o of OFFERINGS) assert.ok(all.includes(o.name));
  const g = grounding('compute');
  assert.match(g, /STATUS: design/);
  assert.match(g, /Hathor/);
  assert.match(describePrompt('compute'), /compute/i);
  assert.equal(grounding('nope'), '');
});
