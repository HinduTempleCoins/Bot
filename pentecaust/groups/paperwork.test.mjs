import { test } from 'node:test';
import assert from 'node:assert';
import { kitFor, renderKit, PROGRAM_KITS, COMMON, DISCLAIMER } from './paperwork.mjs';
import { PROGRAMS } from './model.mjs';

test('every club program a club can be set to has a paperwork kit', () => {
  for (const p of PROGRAMS) assert.equal(kitFor(p).ok, true, p);
});

test('a kit is what everyone needs plus what this kind of club needs', () => {
  const k = kitFor('auto-club');
  assert.equal(k.label, 'Auto club');
  assert.ok(k.docs.some((d) => /waiver/i.test(d.title)));
  assert.ok(k.docs.some((d) => /insurance/i.test(d.title)));
  assert.equal(k.common, COMMON);
  assert.ok(COMMON.some((d) => /EIN/.test(d.title)));
  assert.equal(kitFor('nope').ok, false);
});

test('the metals club keeps the custody line, in the paperwork itself', () => {
  const k = kitFor('metals-club');
  assert.match(k.blurb, /never takes custody/);
  assert.ok(k.docs.some((d) => /custody rule/i.test(d.title) && /own name/.test(d.what)));
});

test('the benefit society states the insurer line', () => {
  const k = kitFor('benefit-society');
  assert.ok(k.docs.some((d) => /does not promise or pay a benefit as an insurer/.test(d.what)));
});

test('a mystery school says what a degree is not', () => {
  assert.ok(kitFor('mystery-school').docs.some((d) => /not an accredited academic degree/.test(d.what)));
});

test('every kit carries the same plain not-advice note', () => {
  for (const p of Object.keys(PROGRAM_KITS)) assert.equal(kitFor(p).disclaimer, DISCLAIMER);
  assert.match(DISCLAIMER, /not legal, tax or financial advice/);
  assert.match(renderKit('auto-club'), /Please read/);
});

test('rendered paperwork is escaped and has both sections', () => {
  const html = renderKit('metals-club');
  assert.match(html, /What this kind of club needs/);
  assert.match(html, /What every club needs/);
  assert.equal(html.includes('<script'), false);
  assert.match(renderKit('nope'), /no paperwork kit/);
});
