import { test } from 'node:test';
import assert from 'node:assert';
import { ethanolArbSpread, crudePerGallon, SERIES } from './energy.mjs';

// All tests are OFFLINE — they exercise the pure spread/arb math with injected numbers. No network,
// no EIA key. (prices()/series() soft-fail to null without a key, which is the contract those rely on.)

test('crudePerGallon converts $/bbl to $/gal (42 gal per barrel)', () => {
  assert.equal(crudePerGallon(84), 2);          // 84 / 42
  assert.equal(crudePerGallon(42), 1);
  assert.equal(crudePerGallon(0), 0);
  assert.equal(crudePerGallon(undefined), null);
  assert.equal(crudePerGallon(NaN), null);
});

test('ethanolArbSpread: ethanol cheaper than gasoline ⇒ ethanol-favored', () => {
  // gasoline 3.20, ethanol 2.10, crude 84 $/bbl (= 2.00 $/gal)
  const r = ethanolArbSpread({ gasoline: 3.20, ethanol: 2.10, crude: 84 });
  assert.ok(r);
  assert.equal(r.crudePerGal, 2);
  assert.equal(r.gasMinusEthanol, 1.1);            // 3.20 − 2.10
  assert.equal(r.ethanolMinusCrude, 0.1);          // 2.10 − 2.00
  assert.equal(r.ethanolDiscountPct, 34.38);       // 1.1 / 3.20 * 100, 2dp
  assert.equal(r.signal, 'ethanol-favored');
});

test('ethanolArbSpread: ethanol more expensive than gasoline ⇒ gasoline-favored', () => {
  const r = ethanolArbSpread({ gasoline: 2.50, ethanol: 2.90, crude: 63 });
  assert.equal(r.gasMinusEthanol, -0.4);
  assert.equal(r.signal, 'gasoline-favored');
  assert.ok(r.ethanolDiscountPct < 0, 'negative discount = ethanol is at a premium');
});

test('ethanolArbSpread: spread within the deadband ⇒ neutral', () => {
  const r = ethanolArbSpread({ gasoline: 3.00, ethanol: 2.97, crude: 84 });
  assert.equal(r.gasMinusEthanol, 0.03);
  assert.equal(r.signal, 'neutral', '|0.03| < 0.05 deadband');
});

test('ethanolArbSpread: deadband boundaries (exactly ±0.05 is still neutral)', () => {
  assert.equal(ethanolArbSpread({ gasoline: 3.05, ethanol: 3.00, crude: 84 }).signal, 'neutral');
  assert.equal(ethanolArbSpread({ gasoline: 2.95, ethanol: 3.00, crude: 84 }).signal, 'neutral');
  // just past the boundary flips
  assert.equal(ethanolArbSpread({ gasoline: 3.051, ethanol: 3.00, crude: 84 }).signal, 'ethanol-favored');
  assert.equal(ethanolArbSpread({ gasoline: 2.949, ethanol: 3.00, crude: 84 }).signal, 'gasoline-favored');
});

test('ethanolArbSpread: ethanolMinusCrude is the blender margin over offset oil', () => {
  // ethanol 1.80 $/gal, crude 42 $/bbl = 1.00 $/gal ⇒ margin 0.80
  const r = ethanolArbSpread({ gasoline: 2.40, ethanol: 1.80, crude: 42 });
  assert.equal(r.crudePerGal, 1);
  assert.equal(r.ethanolMinusCrude, 0.8);
});

test('ethanolArbSpread: missing / invalid inputs ⇒ null (never throws)', () => {
  assert.equal(ethanolArbSpread(null), null);
  assert.equal(ethanolArbSpread(undefined), null);
  assert.equal(ethanolArbSpread('nope'), null);
  assert.equal(ethanolArbSpread({ gasoline: 3, ethanol: 2 }), null);          // no crude
  assert.equal(ethanolArbSpread({ gasoline: 3, ethanol: 'x', crude: 80 }), null);
  assert.equal(ethanolArbSpread({}), null);
});

test('ethanolArbSpread: gasoline of 0 ⇒ percent is null, not Infinity', () => {
  const r = ethanolArbSpread({ gasoline: 0, ethanol: 1, crude: 42 });
  assert.ok(r);
  assert.equal(r.ethanolDiscountPct, null);
  assert.equal(r.signal, 'gasoline-favored');   // 0 − 1 = −1 < −0.05
});

test('ethanolArbSpread: numeric strings are coerced', () => {
  const r = ethanolArbSpread({ gasoline: '3.20', ethanol: '2.10', crude: '84' });
  assert.ok(r);
  assert.equal(r.gasMinusEthanol, 1.1);
  assert.equal(r.signal, 'ethanol-favored');
});

test('SERIES covers all seven required energy types', () => {
  const ids = new Set(Object.values(SERIES).flat().map((s) => s.id));
  for (const id of ['wti', 'gasoline', 'diesel', 'propane', 'ethanol', 'natgas', 'electricity']) {
    assert.ok(ids.has(id), `missing series: ${id}`);
  }
  // every spec is well-formed
  for (const s of Object.values(SERIES).flat()) {
    assert.ok(s.id && s.label && s.route && s.unit, `malformed spec: ${JSON.stringify(s)}`);
  }
});
