// industrial-alchemical.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  RECIPES, INDUSTRIAL, ALCHEMICAL, VALUES, chainFor, familyOf, auditNoPump, canCraft, craft,
} from './industrial-alchemical.mjs';

test('recipes split into industrial + alchemical branches, all outputs priced', () => {
  assert.ok(INDUSTRIAL.length >= 12);
  assert.ok(ALCHEMICAL.length >= 6);
  for (const r of RECIPES) {
    assert.ok(VALUES[r.output.item] > 0, `unpriced output ${r.output.item}`);
    assert.ok(['industrial', 'alchemical'].includes(r.branch));
  }
});

test('the whole chain obeys value = labor (no money pump)', () => {
  const a = auditNoPump();
  assert.equal(a.ok, true, JSON.stringify(a.offenders));
});

test('the flagship examples exist: paper + spagyric elixir', () => {
  const outs = RECIPES.map((r) => r.output.item);
  for (const p of ['paper', 'soap', 'glass', 'leather', 'iron_gall_ink', 'spagyric_elixir', 'essence', 'mordant_dye', 'aqua_vitae']) {
    assert.ok(outs.includes(p), `missing ${p}`);
  }
});

test('PAPER is a multi-step chain that bottoms out at base plant materials', () => {
  const c = chainFor('paper');
  assert.equal(c.branch, 'industrial');
  assert.equal(c.from.length, 2); // pulp + sizing
  const pulp = c.from.find((x) => x.item === 'pulp');
  assert.ok(pulp.from, 'pulp is itself crafted (fiber + lye)');
  // lye traces back: potash → ash → timber (a base material)
  const lye = pulp.from.find((x) => x.item === 'lye');
  const potash = lye.from.find((x) => x.item === 'potash');
  const ash = potash.from.find((x) => x.item === 'ash');
  const timber = ash.from.find((x) => x.item === 'timber');
  assert.equal(timber.base, true);
});

test('SPAGYRIC ELIXIR recombines the three principles (Sulfur + Mercury + Salt)', () => {
  const c = chainFor('spagyric_elixir');
  assert.equal(c.branch, 'alchemical');
  const parts = c.from.map((x) => x.item).sort();
  assert.deepEqual(parts, ['essential_oil', 'plant_salt', 'tincture']); // Sulfur, Salt, Mercury
});

test('value = accumulated labor: deep products beat their intermediates', () => {
  assert.ok(VALUES.paper > VALUES.pulp);         // paper worth more than its pulp
  assert.ok(VALUES.spagyric_elixir > VALUES.tincture);
  assert.ok(VALUES.lye > 0 && VALUES.potash > VALUES.ash); // the alkali chain climbs
});

test('familyOf classifies produced items and base materials', () => {
  assert.equal(familyOf('paper'), 'industrial');
  assert.equal(familyOf('spagyric_elixir'), 'alchemical');
  assert.equal(familyOf('timber'), 'base');
});

test('crafting a chain step consumes inputs and mints the intermediate', () => {
  const lye = RECIPES.find((r) => r.id === 'make-lye');
  assert.equal(canCraft(lye, { potash: 1, water: 1 }), true);
  const after = craft(lye, { potash: 1, water: 1, fiber: 3 });
  assert.equal(after.lye, 1);
  assert.equal(after.fiber, 3); // untouched
});
