import { test } from 'node:test';
import assert from 'node:assert/strict';
import { interpret, interpretMulti, reagentList, CAVEAT } from './reagent-interpreter.mjs';

test('interpret maps a reagent + color to candidate substances, always with the caveat', () => {
  const r = interpret('marquis', 'purple');
  assert.ok(r.candidates.some((c) => /MDMA|Opioids/i.test(c.substance)));
  assert.equal(r.caveat, CAVEAT);
  assert.match(r.caveat, /Presumptive only/);
});

test('normalizes messy color input (dark violet -> purple)', () => {
  const r = interpret('marquis', 'dark violet');
  assert.ok(r.candidates.length >= 1);
});

test("Simon's distinguishes MDMA (blue) from MDA (no reaction)", () => {
  assert.ok(interpret('simon', 'blue').candidates.some((c) => /MDMA/i.test(c.substance)));
  assert.ok(interpret('simon', 'none').candidates.some((c) => /MDA|amphetamine/i.test(c.substance)));
});

test('interpretMulti ranks by how many reagents agree', () => {
  const out = interpretMulti([{ reagent: 'marquis', color: 'purple' }, { reagent: 'simon', color: 'blue' }]);
  assert.ok(out.ranked.length >= 1);
  assert.match(out.ranked[0].substance, /MDMA/i);
  assert.ok(out.ranked[0].agree >= 2);
  assert.equal(out.caveat, CAVEAT);
});

test('unknown reagent soft-fails with the caveat still attached', () => {
  const r = interpret('nonsense', 'blue');
  assert.equal(r.known, false);
  assert.equal(r.candidates.length, 0);
  assert.equal(r.caveat, CAVEAT);
  assert.ok(reagentList().includes('marquis'));
});
