// metals-spot.test.mjs — melt value, sourcing premium, and the purity floor. Offline, no network.
//
// The test that matters most is the colloidal refusal. Junk silver is the cheapest silver per gram and
// it is the wrong silver for electrolysis, because the other 10% is copper. A calculator that quietly
// returned the cheapest option would be actively harmful, so the refusal is pinned here.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  COINS, TROY_OZ_GRAMS, OZ_PER_DOLLAR_FACE_90,
  meltValue, faceToOunces, premiumPerGram, purityFor, PURITY_FLOOR, spot, handler, __setFetch,
} from './metals-spot.mjs';

const SPOT = 30; // $30/oz, round number so the arithmetic is checkable by hand

// --- the constants -----------------------------------------------------------

test('coin table is frozen — a silver weight must not be mutable at runtime', () => {
  assert.throws(() => { COINS['quarter-90'].aswUnc = 99; }, TypeError);
});

test('every coin carries face, fineness, both silver weights and its years', () => {
  for (const [id, c] of Object.entries(COINS)) {
    assert.ok(c.label && c.years, `${id} missing label/years`);
    assert.ok(c.face > 0, `${id} bad face`);
    assert.ok(c.fineness > 0 && c.fineness <= 1, `${id} bad fineness`);
    assert.ok(c.aswUnc > 0 && c.aswCirc > 0, `${id} missing ASW`);
    assert.ok(c.aswCirc < c.aswUnc, `${id}: circulated must be LESS than uncirculated — metal wears off`);
  }
});

test('the 90% coins are 0.900 fine and the 40% and 35% are not', () => {
  assert.equal(COINS['quarter-90'].fineness, 0.9);
  assert.equal(COINS['half-40'].fineness, 0.4);
  assert.equal(COINS['nickel-35'].fineness, 0.35);
});

test('the bag shorthand is 0.715 oz per dollar face, and it is BELOW ten uncirculated dimes', () => {
  assert.equal(OZ_PER_DOLLAR_FACE_90, 0.715);
  assert.ok(OZ_PER_DOLLAR_FACE_90 < COINS['dime-90'].aswUnc * 10, 'wear must be baked into the bag figure');
});

// --- melt value --------------------------------------------------------------

test('one circulated silver quarter at $30/oz', () => {
  const r = meltValue({ 'quarter-90': 1 }, SPOT);
  assert.equal(r.totalOz, 0.17875);
  assert.equal(r.totalUsd, round2(0.17875 * SPOT));
  assert.equal(r.faceUsd, 0.25);
});

test('uncirculated is worth more than circulated for the same coin', () => {
  const c = meltValue({ 'quarter-90': 1 }, SPOT, { condition: 'circulated' });
  const u = meltValue({ 'quarter-90': 1 }, SPOT, { condition: 'uncirculated' });
  assert.ok(u.totalUsd > c.totalUsd);
});

test('timesFace is the number people actually want', () => {
  const r = meltValue({ 'quarter-90': 4 }, SPOT);   // $1.00 face
  assert.equal(r.faceUsd, 1);
  assert.ok(r.timesFace > 20, 'at $30 silver a 90% quarter is worth many times face');
});

test('a mixed pile sums correctly and itemises', () => {
  const r = meltValue({ 'quarter-90': 2, 'dime-90': 3, 'half-40': 1 }, SPOT);
  assert.equal(r.lines.length, 3);
  const sum = r.lines.reduce((a, l) => a + l.oz, 0);
  assert.ok(Math.abs(sum - r.totalOz) < 1e-6);
});

test('unknown coin ids are ignored rather than guessed at', () => {
  const r = meltValue({ 'quarter-90': 1, 'doubloon': 500, '': 3 }, SPOT);
  assert.equal(r.lines.length, 1);
});

test('fractional and negative quantities do not create value', () => {
  assert.equal(meltValue({ 'quarter-90': -5 }, SPOT).totalOz, 0);
  assert.equal(meltValue({ 'quarter-90': 1.9 }, SPOT).lines[0].qty, 1, 'you cannot hold 1.9 quarters');
});

test('meltValue never throws on junk and never invents a spot price', () => {
  for (const h of [null, undefined, 0, 'x', []]) {
    assert.doesNotThrow(() => meltValue(h, SPOT));
    assert.equal(meltValue(h, SPOT).totalUsd, 0);
  }
  for (const s of [null, undefined, -1, 'x', NaN]) {
    assert.equal(meltValue({ 'quarter-90': 1 }, s).totalUsd, 0);
  }
});

test('faceToOunces applies the bag shorthand', () => {
  assert.equal(faceToOunces(10), round4(10 * 0.715));
  assert.equal(faceToOunces(-3), 0);
  assert.equal(faceToOunces('x'), 0);
});

// --- sourcing ----------------------------------------------------------------

test('premium is computed on CONTAINED metal, not on gross weight', () => {
  // 31.1g of .999 at exactly spot => ~0% premium
  const at = premiumPerGram({ priceUsd: SPOT, grams: TROY_OZ_GRAMS, fineness: 0.999 }, SPOT);
  assert.ok(Math.abs(at.premiumPct) < 1, `expected ~0%, got ${at.premiumPct}`);
});

test('a sterling item priced like fine silver carries a big premium once alloy is accounted for', () => {
  const fine = premiumPerGram({ priceUsd: 100, grams: 100, fineness: 0.999 }, SPOT);
  const sterling = premiumPerGram({ priceUsd: 100, grams: 100, fineness: 0.925 }, SPOT);
  assert.ok(sterling.usdPerGramContained > fine.usdPerGramContained,
    'same price and weight, less silver, so each contained gram costs more');
});

test('premiumPerGram flags an unusable offer instead of dividing by zero', () => {
  for (const o of [{}, { priceUsd: 10 }, { grams: 10 }, { priceUsd: 10, grams: 10, fineness: 0 }, null]) {
    const r = premiumPerGram(o, SPOT);
    assert.equal(r.usable, false);
    assert.equal(r.usdPerGramContained, 0);
  }
  assert.equal(premiumPerGram({ priceUsd: 10, grams: 10, fineness: 0.999 }, 0).usable, false);
});

test('premiumPerGram never throws', () => {
  for (const o of [null, undefined, 0, 'x', []]) assert.doesNotThrow(() => premiumPerGram(o, SPOT));
});

// --- the purity floor: the part that matters ---------------------------------

test('COLLOIDAL REFUSES junk silver and sterling, and says why', () => {
  for (const f of [0.900, 0.925, 0.400, 0.350]) {
    const r = purityFor('colloidal', f);
    assert.equal(r.ok, false, `${f} fine should be refused for colloidal`);
    assert.match(r.why, /COPPER/, 'the refusal must name the actual hazard');
    assert.match(r.why, /\.999/);
  }
});

test('colloidal accepts .999 and above', () => {
  assert.equal(purityFor('colloidal', 0.999).ok, true);
  assert.equal(purityFor('colloidal', 0.9999).ok, true);
});

test('the colloidal floor is .999 and is not lower than any other use', () => {
  assert.equal(PURITY_FLOOR.colloidal, 0.999);
  for (const [use, floor] of Object.entries(PURITY_FLOOR)) {
    assert.ok(PURITY_FLOOR.colloidal >= floor, `${use} floor is above the colloidal floor`);
  }
});

test('jewellery accepts sterling — the floor is per-use, not global', () => {
  assert.equal(purityFor('jewellery', 0.925).ok, true);
  assert.equal(purityFor('colloidal', 0.925).ok, false);
});

test('an unknown use clears NOTHING rather than defaulting to permitted', () => {
  for (const u of ['', 'whatever', null, undefined, 0]) {
    const r = purityFor(u, 0.9999);
    assert.equal(r.ok, false, 'unknown use must not be cleared even at four nines');
    assert.match(r.why, /no purity floor defined/);
  }
});

// --- spot fetch --------------------------------------------------------------

test('spot parses a price', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ data: { amount: '31.42' } }) }));
  const r = await spot('silver');
  __setFetch(null);
  assert.equal(r.usdPerOz, 31.42);
  assert.equal(r.error, null);
});

test('spot asks for XAG for silver and XAU for gold', async () => {
  let seen = '';
  __setFetch(async (u) => { seen = u; return { ok: true, json: async () => ({ data: { amount: '1' } }) }; });
  await spot('silver'); assert.match(seen, /XAG-USD/);
  await spot('gold'); assert.match(seen, /XAU-USD/);
  __setFetch(null);
});

test('spot SOFT-FAILS to null and never invents a price', async () => {
  for (const f of [
    async () => { throw new Error('network down'); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => ({}) }),
    async () => ({ ok: true, json: async () => ({ data: { amount: 'not a number' } }) }),
    async () => ({ ok: true, json: async () => ({ data: { amount: '-5' } }) }),
    async () => ({ ok: true, json: async () => { throw new Error('bad json'); } }),
  ]) {
    __setFetch(f);
    const r = await spot('silver');
    assert.equal(r.usdPerOz, null, 'a failed fetch must yield null, never a number');
    assert.ok(r.error, 'and must say what went wrong');
  }
  __setFetch(null);
});

// --- handler -----------------------------------------------------------------

test('handler serves JSON', () => {
  let code = 0; let body = '';
  handler({}, { writeHead(c) { code = c; }, end(b) { body = b; } }, { 'quarter-90': 4 }, SPOT);
  assert.equal(code, 200);
  assert.equal(JSON.parse(body).faceUsd, 1);
});

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;
