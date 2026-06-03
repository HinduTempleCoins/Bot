import { test } from 'node:test';
import assert from 'node:assert';
import {
  GOV_APIS, DOMAINS, byDomain, keylessApis, dataGovKeyApis, ownKeyApis, summary,
  federalRegister, usgsQuakes, fema, treasuryFiscal, __setFetch,
} from './govapis.mjs';

test('catalog is large and every entry has the required shape', () => {
  assert.ok(GOV_APIS.length >= 50, `expected 50+ entries, got ${GOV_APIS.length}`);
  for (const e of GOV_APIS) {
    assert.equal(typeof e.agency, 'string', 'agency');
    assert.ok(e.agency.length, 'agency non-empty');
    assert.ok(e.name && typeof e.name === 'string', 'name');
    assert.match(e.baseUrl, /^https:\/\//, `baseUrl is https: ${e.name}`);
    assert.equal(typeof e.keyless, 'boolean', `keyless bool: ${e.name}`);
    assert.equal(typeof e.keyViaDataGov, 'boolean', `keyViaDataGov bool: ${e.name}`);
    assert.ok(DOMAINS.includes(e.domain), `valid domain: ${e.name} (${e.domain})`);
    assert.ok(e.gives && typeof e.gives === 'string', `gives: ${e.name}`);
    assert.ok(e.pageIdea && typeof e.pageIdea === 'string', `pageIdea: ${e.name}`);
  }
});

test('entry names are unique', () => {
  const names = GOV_APIS.map((e) => e.name);
  assert.equal(new Set(names).size, names.length, 'no duplicate names');
});

test('byDomain returns only that domain and partitions correctly', () => {
  let counted = 0;
  for (const d of DOMAINS) {
    const rows = byDomain(d);
    for (const r of rows) assert.equal(r.domain, d);
    counted += rows.length;
  }
  assert.equal(counted, GOV_APIS.length, 'every entry lands in exactly one domain bucket');
  assert.deepEqual(byDomain('not-a-real-domain'), []);
});

test('keyless / data.gov-key / own-key filters are correct and the readers core are keyless', () => {
  for (const e of keylessApis()) assert.equal(e.keyless, true);
  for (const e of dataGovKeyApis()) assert.equal(e.keyViaDataGov, true);
  for (const e of ownKeyApis()) {
    assert.equal(e.keyless, false);
    assert.equal(e.keyViaDataGov, false);
  }
  assert.ok(keylessApis().length >= 20, 'plenty of fully-keyless endpoints');
  // The endpoints behind the live readers must be flagged keyless.
  const mustBeKeyless = ['Federal Register API', 'USAspending API', 'Treasury Fiscal Data API',
    'FEMA OpenFEMA API', 'USGS Earthquake (FDSN) API'];
  for (const n of mustBeKeyless) {
    const e = GOV_APIS.find((x) => x.name === n);
    assert.ok(e, `catalog has ${n}`);
    assert.equal(e.keyless, true, `${n} is keyless`);
  }
});

test('summary counts add up', () => {
  const s = summary();
  assert.equal(s.total, GOV_APIS.length);
  assert.equal(s.keyless, keylessApis().length);
  const domTotal = Object.values(s.byDomain).reduce((a, b) => a + b, 0);
  assert.equal(domTotal, GOV_APIS.length);
});

test('federalRegister normalizes injected response', async () => {
  __setFetch(async () => ({
    ok: true,
    json: async () => ({
      results: [
        { title: 'Rule on AI', type: 'Rule', agencies: [{ name: 'Commerce' }], publication_date: '2026-06-01', html_url: 'https://x/1' },
        { title: '', type: 'Notice', agencies: [], publication_date: '2026-06-02', html_url: 'https://x/2' }, // dropped (no title)
      ],
    }),
  }));
  const out = await federalRegister('ai');
  __setFetch(null);
  assert.equal(out.length, 1, 'empty-title row dropped');
  assert.deepEqual(out[0], { title: 'Rule on AI', type: 'Rule', agency: 'Commerce', date: '2026-06-01', url: 'https://x/1' });
});

test('readers soft-fail to [] on network error / non-ok', async () => {
  __setFetch(async () => { throw new Error('boom'); });
  assert.deepEqual(await federalRegister('x'), []);
  assert.deepEqual(await usgsQuakes(), []);
  assert.deepEqual(await fema(), []);
  assert.deepEqual(await treasuryFiscal(), []);

  __setFetch(async () => ({ ok: false, json: async () => ({}) }));
  assert.deepEqual(await usgsQuakes(), []);
  __setFetch(null);
});

test('usgsQuakes normalizes GeoJSON features', async () => {
  __setFetch(async () => ({
    ok: true,
    json: async () => ({
      features: [
        { properties: { mag: 4.2, place: '10km N of Town', time: 0, url: 'https://q/1' }, geometry: { coordinates: [-100, 40, 12.5] } },
        { properties: { mag: null, place: 'no mag', time: 0 }, geometry: { coordinates: [0, 0, 0] } }, // dropped
      ],
    }),
  }));
  const out = await usgsQuakes();
  __setFetch(null);
  assert.equal(out.length, 1);
  assert.equal(out[0].magnitude, 4.2);
  assert.equal(out[0].place, '10km N of Town');
  assert.equal(out[0].depthKm, 12.5);
  assert.equal(out[0].time, '1970-01-01T00:00:00.000Z');
});
