// science-data.test.mjs — offline tests for Hathor's hard-science readers.
// All network calls stubbed via __setFetch; the CODATA constants table is pure / in-process.
// Run: node --test integrations/science-data.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  compound, constant, CONSTANTS, horizons, exoplanetCount, exoplanet, __setFetch,
} from './science-data.mjs';

// ── PubChem compound (stubbed) ───────────────────────────────────────────────────────────────────

test('compound resolves a name to formula / MW / CID with a PubChem citation', async () => {
  __setFetch(async (url) => {
    assert.match(String(url), /pubchem.*compound\/name\/water/);
    return {
      ok: true,
      json: async () => ({ PropertyTable: { Properties: [
        { CID: 962, MolecularFormula: 'H2O', MolecularWeight: '18.015', IUPACName: 'oxidane' },
      ] } }),
    };
  });
  const c = await compound('water');
  __setFetch(null);
  assert.equal(c.found, true);
  assert.equal(c.formula, 'H2O');
  assert.equal(c.molecularWeight, 18.015);
  assert.equal(c.cid, 962);
  assert.match(c.source, /PubChem/);
  assert.equal(c.url, 'https://pubchem.ncbi.nlm.nih.gov/compound/962');
});

test('compound soft-fails to { found:false } on no match / error / empty', async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ PropertyTable: { Properties: [] } }) }));
  assert.equal((await compound('asdfqwer')).found, false);
  __setFetch(async () => { throw new Error('down'); });
  assert.equal((await compound('water')).found, false);
  __setFetch(null);
  assert.equal((await compound('')).found, false);
});

// ── NIST CODATA constants (pure) ─────────────────────────────────────────────────────────────────

test('constant looks up speed of light by key, symbol, and common name', () => {
  const byKey = constant('c');
  assert.equal(byKey.value, 299792458);
  assert.equal(byKey.unit, 'm/s');
  assert.match(byKey.source, /NIST CODATA/);
  assert.equal(constant('speed of light').value, 299792458);
  assert.equal(constant('lightspeed').value, 299792458);
});

test('constant resolves several constants by alias', () => {
  assert.equal(constant('avogadro').value, 6.02214076e23);
  assert.equal(constant('boltzmann').value, 1.380649e-23);
  assert.equal(constant('planck').value, 6.62607015e-34);
  assert.equal(constant('gravitational constant').symbol, 'G');
  assert.equal(constant('gas constant').value, 8.314462618);
});

test('constant returns null for an unknown name and every entry carries a source', () => {
  assert.equal(constant('unobtanium'), null);
  assert.equal(constant(''), null);
  for (const [, v] of Object.entries(CONSTANTS)) {
    assert.ok(v.source && /CODATA/.test(v.source), `${v.name} must cite CODATA`);
    assert.equal(typeof v.value, 'number');
  }
});

test('CONSTANTS table has at least ~20 of the most-used constants', () => {
  assert.ok(Object.keys(CONSTANTS).length >= 20, 'expected >= 20 constants');
});

// ── JPL Horizons (stubbed) ───────────────────────────────────────────────────────────────────────

test('horizons returns the ephemeris text block with a JPL citation', async () => {
  __setFetch(async (url) => {
    const s = String(url);
    assert.match(s, /horizons\.api/);
    assert.match(s, /COMMAND/);
    return { ok: true, json: async () => ({ result: '$$SOE\n 2026-Jun-03 ... \n$$EOE' }) };
  });
  const h = await horizons('499');
  __setFetch(null);
  assert.equal(h.found, true);
  assert.equal(h.body, '499');
  assert.match(h.result, /\$\$SOE/);
  assert.match(h.source, /JPL Horizons/);
});

test('horizons soft-fails to { found:false } on error / empty body', async () => {
  __setFetch(async () => ({ ok: false }));
  assert.equal((await horizons('499')).found, false);
  __setFetch(async () => { throw new Error('down'); });
  assert.equal((await horizons('301')).found, false);
  __setFetch(null);
  assert.equal((await horizons('')).found, false);
});

// ── NASA Exoplanet Archive (stubbed) ─────────────────────────────────────────────────────────────

test('exoplanetCount returns the confirmed-planet count', async () => {
  __setFetch(async (url) => {
    assert.match(String(url), /TAP\/sync/);
    return { ok: true, json: async () => [{ n: 5678 }] };
  });
  const r = await exoplanetCount();
  __setFetch(null);
  assert.equal(r.count, 5678);
  assert.match(r.source, /Exoplanet Archive/);
});

test('exoplanet looks up a planet by name and normalizes fields', async () => {
  __setFetch(async (url) => {
    assert.match(decodeURIComponent(String(url)), /pscomppars/);
    return { ok: true, json: async () => [
      { pl_name: 'Kepler-22 b', hostname: 'Kepler-22', disc_year: 2011, pl_orbper: '289.86', pl_rade: '2.1', pl_bmasse: null },
    ] };
  });
  const r = await exoplanet('Kepler-22');
  __setFetch(null);
  assert.equal(r.found, true);
  assert.equal(r.planets[0].name, 'Kepler-22 b');
  assert.equal(r.planets[0].discoveryYear, 2011);
  assert.equal(r.planets[0].orbitalPeriodDays, 289.86);
  assert.equal(r.planets[0].massEarth, null);
});

test('exoplanet soft-fails to empty on no match / error / empty query', async () => {
  __setFetch(async () => ({ ok: true, json: async () => [] }));
  assert.equal((await exoplanet('Nowhere-99')).found, false);
  __setFetch(async () => { throw new Error('down'); });
  assert.equal((await exoplanet('Kepler')).found, false);
  __setFetch(null);
  const empty = await exoplanet('');
  assert.equal(empty.found, false);
  assert.deepEqual(empty.planets, []);
});

test('exoplanet escapes single quotes in the ADQL literal (injection safety)', async () => {
  let captured = '';
  __setFetch(async (url) => { captured = decodeURIComponent(String(url)); return { ok: true, json: async () => [] }; });
  await exoplanet("o'brien");
  __setFetch(null);
  assert.match(captured, /o''brien/); // doubled quote, no broken literal
});
