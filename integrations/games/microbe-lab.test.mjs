// microbe-lab.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CULTURES, PRODUCTS, SUBSTRATES, SOURCES, isolate, culture, productsOf,
  versatilityOf, cultureWeb,
} from './microbe-lab.mjs';

test('products carry domains → versatility (ferment/enzyme span many systems)', () => {
  assert.ok(versatilityOf('ferment') >= 3);
  assert.ok(versatilityOf('enzyme') >= 3);
  for (const p of Object.values(PRODUCTS)) assert.ok(p.domains.length >= 1);
});

test('strains come FROM the world: isolate from a source, deterministic, sometimes fails', () => {
  const a = isolate({ ctx: { blockId: '0x1', txId: '0x1' }, source: 'soil_swab' });
  const b = isolate({ ctx: { blockId: '0x1', txId: '0x1' }, source: 'soil_swab' });
  assert.deepEqual(a, b);
  assert.ok(a.strain === null || CULTURES[a.strain.id]);
  assert.equal(isolate({ source: 'not-a-source' }).strain, null);
});

test('culture yields reagents, but only on the RIGHT substrate', () => {
  const good = culture('bluemold', { ctx: { blockId: '0x1', txId: '0x2' }, substrate: 'agar' });
  assert.ok(good.ok && good.products.antibiotic >= 1);
  const bad = culture('bluemold', { ctx: { blockId: '0x1', txId: '0x2' }, substrate: 'whey' });
  assert.equal(bad.reason, 'wrong-substrate');
  assert.equal(bad.wants, 'agar');
  assert.equal(culture('nope').reason, 'unknown-strain');
});

test('MEDICINE and POISON both come from cultures — poison gated behind a biosafety lab', () => {
  assert.ok(productsOf('soil_actino').includes('antibiotic'));   // medicine
  const noLab = culture('toxigen', { substrate: 'broth' });
  assert.equal(noLab.reason, 'needs-biosafety-lab');             // hazard gate
  const withLab = culture('toxigen', { ctx: { blockId: '0x1', txId: '0x3' }, substrate: 'broth', bsl: true });
  assert.ok(withLab.ok && withLab.products.toxin >= 1 && withLab.hazard);
});

test('nematodes return for OTHER purposes: soil fauna + micro-feed, not gnat control', () => {
  assert.deepEqual(productsOf('nematode'), ['soil_fauna']);
  assert.deepEqual(PRODUCTS.soil_fauna.domains, ['soil', 'feed']);
});

test('cultureWeb enumerates every strain → products → domains', () => {
  const web = cultureWeb();
  assert.equal(web.length, Object.keys(CULTURES).length);
  assert.ok(web.every((s) => Array.isArray(s.products)));
  assert.ok(SOURCES.length >= 5 && SUBSTRATES.includes('agar'));
});
