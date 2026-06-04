// aggregator-directory.test.mjs — OFFLINE tests for the cross-industry aggregator directory (#231).
// No network. Asserts: 50+ verticals across all groups; every vertical has a valid mechanism (a key of
// affiliate.MECHANISMS); vertical()/listByGroup() accessors; monetizationFor returns a mechanism +
// disclosure; coverageReport counts built vs unbuilt and built includes the ones we shipped;
// renderDirectory escapes a malicious vertical name + always shows the brand guardrail line.

import { test } from 'node:test';
import assert from 'node:assert';
import { MECHANISMS } from './affiliate.mjs';
import {
  VERTICALS, GROUPS, BRAND_GUARDRAIL, esc,
  groups, vertical, listByGroup, monetizationFor, coverageReport, renderDirectory,
} from './aggregator-directory.mjs';

// --- shape / scale ----------------------------------------------------------

test('VERTICALS has 50+ entries spanning every group', () => {
  assert.ok(VERTICALS.length >= 50, `expected >=50 verticals, got ${VERTICALS.length}`);
  // Every declared group is represented by at least one vertical.
  for (const g of Object.keys(GROUPS)) {
    const items = VERTICALS.filter((x) => x.group === g);
    assert.ok(items.length >= 1, `group ${g} has no verticals`);
  }
  // No vertical references an unknown group.
  for (const vt of VERTICALS) {
    assert.ok(GROUPS[vt.group], `vertical ${vt.id} has unknown group ${vt.group}`);
  }
});

test('every vertical has a valid mechanism (a key of affiliate.MECHANISMS)', () => {
  const valid = new Set(Object.keys(MECHANISMS));
  for (const vt of VERTICALS) {
    assert.ok(vt.id && typeof vt.id === 'string', 'vertical missing id');
    assert.ok(vt.name && typeof vt.name === 'string', `vertical ${vt.id} missing name`);
    assert.ok(valid.has(vt.mechanism), `vertical ${vt.id} has invalid mechanism ${vt.mechanism}`);
    assert.equal(typeof vt.existsInRepo, 'boolean');
  }
});

test('vertical ids are unique', () => {
  const ids = VERTICALS.map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'duplicate vertical id');
});

// --- accessors --------------------------------------------------------------

test('vertical(id) is case-insensitive and returns undefined for unknown', () => {
  const f = vertical('FLIGHTS');
  assert.ok(f, 'expected to find flights');
  assert.equal(f.id, 'flights');
  assert.equal(vertical('does-not-exist'), undefined);
});

test('listByGroup() returns all groups; listByGroup(g) returns just that group', () => {
  const all = listByGroup();
  for (const g of groups()) {
    assert.ok(all[g], `missing group ${g}`);
    assert.equal(all[g].label, GROUPS[g]);
    assert.ok(Array.isArray(all[g].items));
  }
  const travel = listByGroup('travel');
  assert.ok(Array.isArray(travel));
  assert.ok(travel.length >= 1);
  for (const vt of travel) assert.equal(vt.group, 'travel');
  // unknown group -> empty array
  assert.deepEqual(listByGroup('nope'), []);
});

test('groups() matches GROUPS keys in order', () => {
  assert.deepEqual(groups(), Object.keys(GROUPS));
});

// --- monetization (delegates to affiliate.mjs) ------------------------------

test('monetizationFor returns a mechanism + disclosure', () => {
  const m = monetizationFor('flights');
  assert.equal(m.ok, true);
  assert.equal(m.id, 'flights');
  assert.ok(m.mechanism && Object.keys(MECHANISMS).includes(m.mechanism));
  assert.ok(m.mechanismCode && typeof m.mechanismCode === 'string');
  assert.ok(m.disclosure && m.disclosure.length > 0, 'expected a disclosure line');
  assert.ok(m.guardrail && m.guardrail.includes('Clarity'), 'expected the brand guardrail');
});

test('monetizationFor soft-fails on an unknown vertical', () => {
  const m = monetizationFor('not-real');
  assert.equal(m.ok, false);
  assert.ok(m.reason);
});

// --- coverage report (build tracker) ----------------------------------------

test('coverageReport counts built vs unbuilt and built includes the ones we shipped', () => {
  const cov = coverageReport();
  assert.equal(cov.total, VERTICALS.length);
  assert.equal(cov.built + cov.unbuilt, cov.total);
  assert.ok(cov.built >= 9, `expected >=9 built, got ${cov.built}`);

  // The ones we shipped must be flagged existsInRepo.
  const shipped = ['crypto', 'forex', 'commodities', 'stocks', 'cannabis', 'lawyers', 'where-to-watch', 'charities', 'benefits'];
  for (const id of shipped) {
    const vt = vertical(id);
    assert.ok(vt, `shipped vertical ${id} not in registry`);
    assert.equal(vt.existsInRepo, true, `shipped vertical ${id} not marked built`);
  }

  // byGroup tallies must sum to the totals.
  let sumTotal = 0;
  let sumBuilt = 0;
  for (const g of groups()) {
    const s = cov.byGroup[g];
    assert.ok(s, `byGroup missing ${g}`);
    assert.equal(s.built + s.unbuilt, s.total);
    sumTotal += s.total;
    sumBuilt += s.built;
  }
  assert.equal(sumTotal, cov.total);
  assert.equal(sumBuilt, cov.built);
});

// --- render (escaped HTML + brand guardrail) --------------------------------

test('renderDirectory escapes a malicious vertical name and always shows the brand guardrail', () => {
  const evil = '<script>alert(1)</script>';
  const saved = VERTICALS[0].name;
  VERTICALS[0].name = evil;
  try {
    const html = renderDirectory();
    assert.ok(!html.includes('<script>alert(1)</script>'), 'unescaped script leaked into HTML');
    assert.ok(html.includes(esc(evil)), 'escaped name not present');
    // brand guardrail line present and escaped form of it.
    assert.ok(html.includes(esc(BRAND_GUARDRAIL)), 'brand guardrail line missing');
    assert.ok(html.includes('brand-guardrail'), 'brand-guardrail class missing');
    // both built and planned states render.
    assert.ok(html.includes('LIVE'), 'no LIVE markers');
    assert.ok(html.includes('Planned'), 'no Planned markers');
  } finally {
    VERTICALS[0].name = saved;
  }
});

test('BRAND_GUARDRAIL states no-pay-to-rank and no-data-selling', () => {
  assert.ok(/never by commission|payment can never buy/i.test(BRAND_GUARDRAIL));
  assert.ok(/never sell your data/i.test(BRAND_GUARDRAIL));
  assert.ok(/Clarity/.test(BRAND_GUARDRAIL));
});
