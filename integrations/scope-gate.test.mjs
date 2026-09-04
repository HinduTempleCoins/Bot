// scope-gate.test.mjs — offline, no network, no fixtures on disk.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isGated, gateItems, gateReason, gateEnabled, GATED } from './scope-gate.mjs';

test('the whole ayahuasca shelf is gated', () => {
  for (const p of ['knowledge/ayahuasca/a.json', 'knowledge/ayahuasca/deep/nested_tek.json']) {
    assert.equal(isGated(p), true, p);
  }
});

test('the named single-file GATE entries are gated', () => {
  for (const p of [
    'knowledge/oilahuasca/oilahuasca_practical_formulations.json',
    'knowledge/oilahuasca/oilahuasca_space_paste_recipe.json',
    'knowledge/oilahuasca/oilahuasca_dmtnexus_space_booze_thread.json',
    'knowledge/herbs/comprehensive_cannabinoid_synthesis_research.json',
    'knowledge/herbs/cannabinoid_synthesis_thc_threshold_brief.json',
    'knowledge/herbs/marijuana_advanced_growing.json',
    'knowledge/shulgin-pihkal-tihkal/pihkal_quotes.json',
    'knowledge/shulgin-pihkal-tihkal/tihkal_quotes.json',
  ]) assert.equal(isGated(p), true, p);
});

test('in-scope harm-reduction and scripture material is NOT gated', () => {
  for (const p of [
    'knowledge/herbs/chamomile.json',
    'knowledge/oilahuasca/oilahuasca_pharmacology_overview.json',
    'knowledge/psychedelics/harm_reduction.json',
    'knowledge/scripture/the_convergence.md',
    'knowledge/shulgin-pihkal-tihkal/biography.json',
  ]) assert.equal(isGated(p), false, p);
});

test('the gate list is exactly the audited rule set', () => {
  assert.equal(GATED.length, 9);                        // 1 shelf rule + 8 single files = 24 files
  assert.ok(GATED.includes('knowledge/ayahuasca/'));
});

test('path forms are normalised (./ prefix, backslashes, #chunk suffix)', () => {
  assert.equal(isGated('./knowledge/ayahuasca/x.json'), true);
  assert.equal(isGated('knowledge\\ayahuasca\\x.json'), true);
  assert.equal(isGated('knowledge/ayahuasca/x.json#3'), true);
});

test('gateItems drops gated passages for public callers', () => {
  const items = [
    { relPath: 'knowledge/ayahuasca/tek.json', text: 'x' },
    { relPath: 'knowledge/herbs/chamomile.json', text: 'y' },
  ];
  const out = gateItems(items);
  assert.equal(out.length, 1);
  assert.equal(out[0].relPath, 'knowledge/herbs/chamomile.json');
});

test('internal callers are unfiltered', () => {
  const items = [{ relPath: 'knowledge/ayahuasca/tek.json' }];
  assert.equal(gateItems(items, { internal: true }).length, 1);
});

test('gateItems is soft: bad input never throws', () => {
  assert.deepEqual(gateItems(null), []);
  assert.equal(gateItems([{}, { relPath: null }, 'nope']).length, 3);
});

test('gateItems falls back to src when relPath is absent', () => {
  assert.equal(gateItems([{ src: 'knowledge/ayahuasca/tek.json#0' }]).length, 0);
});

test('gateReason explains gated paths and is empty otherwise', () => {
  assert.match(gateReason('knowledge/ayahuasca/t.json'), /out-of-scope/);
  assert.equal(gateReason('knowledge/herbs/chamomile.json'), '');
});

test('the gate is on by default and off only by explicit env', () => {
  const prev = process.env.MELEK_SCOPE_GATE;
  delete process.env.MELEK_SCOPE_GATE;
  assert.equal(gateEnabled(), true);
  process.env.MELEK_SCOPE_GATE = 'off';
  assert.equal(gateEnabled(), false);
  assert.equal(gateItems([{ relPath: 'knowledge/ayahuasca/t.json' }]).length, 1);
  if (prev === undefined) delete process.env.MELEK_SCOPE_GATE; else process.env.MELEK_SCOPE_GATE = prev;
});
