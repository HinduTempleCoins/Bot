// formulate.test.mjs — offline, no network, no fixtures.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  lotion, bodyButter, solidPerfume, balm, infusion,
  requiredHlb, EMULSIFIERS, PRESERVATIVES, PRESERVATIVE_RULE,
} from './formulate.mjs';
import { OILS, calculate } from './soapcalc.mjs';

test('a lotion that sums to 100% with a preservative is accepted', () => {
  const r = lotion({ waterPct: 70, oilPct: 20, emulsifierPct: 5, preservativePct: 1, humectantPct: 3, thickenerPct: 1, batchGrams: 200 });
  assert.equal(r.ok, true);
  assert.equal(r.totalPct, 100);
  assert.equal(r.grams.waterPhase, 140);
  assert.equal(r.grams.batch, 200);
});

test('a formula that does not sum to 100% is rejected with the total named', () => {
  const r = lotion({ waterPct: 70, oilPct: 20, emulsifierPct: 5, preservativePct: 1 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /96%|sum to exactly 100/);
});

test('water with no preservative is an ERROR, not a warning', () => {
  const r = lotion({ waterPct: 75, oilPct: 20, emulsifierPct: 5, preservativePct: 0 });
  assert.equal(r.ok, false);
  assert.match(r.errors.join(' '), /no preservative/i);
});

test('an out-of-range preservative rate warns but still calculates', () => {
  const r = lotion({ waterPct: 66, oilPct: 20, emulsifierPct: 5, preservativePct: 5, humectantPct: 3, thickenerPct: 1 });
  assert.equal(r.ok, true);
  assert.match(r.warnings.join(' '), /normally used at 0.5–1/);
});

test('e-wax off the 25%-of-oil-phase rule is flagged', () => {
  const r = lotion({ waterPct: 68, oilPct: 25, emulsifierPct: 1, preservativePct: 1, humectantPct: 3, thickenerPct: 2, emulsifier: 'ewax_nf' });
  assert.match(r.warnings.join(' '), /25% of the oil-phase/);
});

test('required HLB is a weight-average and names unknown components', () => {
  const r = requiredHlb({ coconut: 50, castor: 50 });
  assert.equal(r.ok, true);
  assert.equal(r.hlb, 11);
  const u = requiredHlb({ coconut: 50, unobtainium: 50 });
  assert.match(u.warnings.join(' '), /unobtainium/);
});

test('body butter: anhydrous, so no preservative demanded, but an antioxidant is named', () => {
  const r = bodyButter({ buttersPct: 60, liquidOilPct: 30, waxPct: 5, powderPct: 5 });
  assert.equal(r.ok, true);
  assert.equal(r.errors.length, 0);
  assert.match(r.antioxidantNote, /Neither is a preservative/i);
});

test('body butter with too little solid butter warns it will not whip', () => {
  const r = bodyButter({ buttersPct: 20, liquidOilPct: 70, waxPct: 5, powderPct: 5 });
  assert.match(r.warnings.join(' '), /will not hold a whip/);
});

test('solid perfume reports the carrier:wax ratio and flags a high fragrance load', () => {
  const r = solidPerfume({ waxPct: 25, carrierPct: 60, fragrancePct: 15 });
  assert.equal(r.ok, true);
  assert.equal(r.carrierToWaxRatio, 2.4);
  assert.match(r.warnings.join(' '), /IFRA/);
});

test('balm kinds have different expected wax bands', () => {
  const lip = balm({ kind: 'lipbalm', waxPct: 25, butterPct: 35, oilPct: 40 });
  assert.equal(lip.ok, true);
  assert.equal(lip.warnings.length, 0);
  const salve = balm({ kind: 'salve', waxPct: 25, butterPct: 35, oilPct: 40 });
  assert.match(salve.warnings.join(' '), /usually 10–20%/);
});

test('infusion returns herb weight and a readable ratio', () => {
  const r = infusion({ oilGrams: 500, herbRatio: 0.2 });
  assert.equal(r.ok, true);
  assert.equal(r.herbGrams, 100);
  assert.match(r.ratio, /1:5/);
});

test('every emulsifier and preservative entry has a usable rate band', () => {
  for (const [k, v] of Object.entries(EMULSIFIERS)) {
    assert.ok(v.name, `${k} needs a name`);
    assert.ok(v.max > v.min, `${k} needs min<max`);
  }
  for (const [k, v] of Object.entries(PRESERVATIVES)) {
    assert.ok(v.broad === true, `${k} must be broad-spectrum`);
    assert.ok(v.max >= v.min, `${k} needs a band`);
  }
  assert.match(PRESERVATIVE_RULE, /antioxidant/i);
});

test('nothing throws on garbage input — soft fail', () => {
  for (const fn of [lotion, bodyButter, solidPerfume, balm, infusion]) {
    assert.doesNotThrow(() => fn(undefined));
    assert.doesNotThrow(() => fn({ waterPct: 'abc', oilPct: null, batchGrams: -5 }));
  }
});

test('beeswax is in the lye engine, saponifies, and is credited no lather', () => {
  assert.ok(OILS.beeswax, 'beeswax must exist in OILS');
  assert.equal(OILS.beeswax.sap, 0.069);
  assert.equal(OILS.beeswax.wax, true);
  for (const v of Object.values(OILS.beeswax.fa)) assert.equal(v, 0);
  assert.match(OILS.beeswax.note, /1–3% of the oil weight/);
  assert.match(OILS.beeswax.note, /0.067–0.069/);
  const r = calculate({ oils: [{ id: 'olive', weight: 900 }, { id: 'beeswax', weight: 100 }], lyeType: 'NaOH', superfat: 5, waterRatio: 2 });
  assert.equal(r.ok, true);
  assert.ok(r.lye > 0, 'beeswax blend must still produce a lye figure');
});

test('e-wax is checked against a 20–25% band of the oil phase, not a single point', async () => {
  const { EMULSIFIERS: E } = await import('./formulate.mjs');
  assert.equal(E.ewax_nf.oilPhaseLo, 0.20);
  assert.equal(E.ewax_nf.oilPhaseHi, 0.25);
  assert.equal(E.ewax_nf.max, 10, 'creams need up to 10%');
  // 20% of a 20% oil phase = 4% — inside the band, no oil-phase warning
  const inside = lotion({ waterPct: 71, oilPct: 20, emulsifierPct: 4, preservativePct: 1, humectantPct: 3, thickenerPct: 1 });
  assert.ok(!inside.warnings.join(' ').includes('of the batch, and you have'), 'in-band must not warn');
  // 2% of a 20% oil phase is below the band
  const below = lotion({ waterPct: 73, oilPct: 20, emulsifierPct: 2, preservativePct: 1, humectantPct: 3, thickenerPct: 1 });
  assert.match(below.warnings.join(' '), /4–5%/);
});

test('the top of the band is flagged as draggy rather than silently accepted', () => {
  const top = lotion({ waterPct: 70, oilPct: 20, emulsifierPct: 5, preservativePct: 1, humectantPct: 3, thickenerPct: 1 });
  assert.match(top.warnings.join(' '), /top of the band|waxy or draggy/);
});

test('body butter far from 75:25 is flagged, and the ambient-temperature note is present', () => {
  const r = bodyButter({ buttersPct: 50, liquidOilPct: 45, waxPct: 0, powderPct: 5 });
  assert.match(r.warnings.join(' '), /75% solid butter to 25% liquid oil/);
  assert.match(r.ambientNote, /30:70 at 16–17/);
});

test('every figure in the engine is traceable to a published source', async () => {
  const { SOURCES } = await import('./formulate.mjs');
  assert.ok(Array.isArray(SOURCES) && SOURCES.length >= 5);
  for (const s of SOURCES) {
    assert.ok(s.topic, 'each source needs a topic');
    assert.match(s.url, /^https?:\/\//, 'each source needs a URL');
  }
});
