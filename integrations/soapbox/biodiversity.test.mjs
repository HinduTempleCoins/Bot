// biodiversity.test.mjs — OFFLINE tests for the SoapBox Bio vertical (task #110). No network: a fake
// fetch is injected via __setFetch and we assert the normalization shapes + soft-fail behavior.
// Run: node --test integrations/soapbox/biodiversity.test.mjs
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch,
  speciesSearch, occurrences, observations, ebirdRecent, speciesProfile,
  normalizeSpecies, normalizeOccurrences, normalizeObservations, normalizeEbird,
} from './biodiversity.mjs';

// ---- fake-fetch harness --------------------------------------------------------------------------
// route by URL substring → JSON body (or a sentinel to simulate failure).
function mockFetch(routes) {
  return async (url) => {
    const u = String(url);
    for (const [frag, body] of Object.entries(routes)) {
      if (u.includes(frag)) {
        if (body === '__NETWORK_ERROR__') throw new Error('boom');
        if (body === '__NOT_OK__') return { ok: false, status: 500, json: async () => ({}) };
        return { ok: true, status: 200, json: async () => body };
      }
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
}

afterEach(() => { __setFetch(null); delete process.env.EBIRD_API_KEY; });

// ---- fixtures ------------------------------------------------------------------------------------
const GBIF_SPECIES = {
  results: [
    { key: 5219404, scientificName: 'Panthera leo (Linnaeus, 1758)', canonicalName: 'Panthera leo', rank: 'SPECIES', kingdom: 'Animalia', phylum: 'Chordata', class: 'Mammalia', order: 'Carnivora', family: 'Felidae', genus: 'Panthera', taxonomicStatus: 'ACCEPTED' },
    { scientificName: 'no key row but has a name' },
    null,
    { foo: 'bar' }, // junk → dropped (no key, no name)
  ],
};
const GBIF_OCC = {
  results: [
    { key: 111, scientificName: 'Panthera leo', country: 'Kenya', countryCode: 'KE', decimalLatitude: -1.2, decimalLongitude: 36.8, eventDate: '2024-01-02', basisOfRecord: 'HUMAN_OBSERVATION', datasetName: 'iNat' },
    null,
    { gbifID: 222, species: 'Panthera leo', year: 2020 },
  ],
};
const INAT_OBS = {
  results: [
    { id: 999, taxon: { name: 'Panthera leo', preferred_common_name: 'Lion', default_photo: { square_url: 'http://x/sq.jpg' } }, place_guess: 'Masai Mara', observed_on: '2024-03-03', user: { login: 'jane' }, quality_grade: 'research', photos: [{ url: 'http://x/p.jpg' }], uri: 'https://www.inaturalist.org/observations/999' },
    null,
    { id: 1000, taxon: {} },
  ],
};
const EBIRD = [
  { sciName: 'Haliaeetus leucocephalus', comName: 'Bald Eagle', howMany: 2, locName: 'Lake', lat: 40.1, lng: -75.2, obsDt: '2024-05-05 08:00' },
  null,
];

// ---- normalization unit tests --------------------------------------------------------------------
test('normalizeSpecies maps GBIF rows and drops junk/null', () => {
  const out = normalizeSpecies(GBIF_SPECIES.results);
  // the named-only row IS kept (has scientificName); the {foo} junk + null are dropped → 2 rows.
  assert.equal(out.length, 2);
  const lion = out[0];
  assert.equal(lion.key, 5219404);
  assert.equal(lion.canonicalName, 'Panthera leo');
  assert.equal(lion.family, 'Felidae');
  assert.equal(lion.status, 'ACCEPTED');
  assert.equal(lion.source, 'GBIF');
});

test('normalizeOccurrences keeps key|name rows, drops null', () => {
  const out = normalizeOccurrences(GBIF_OCC.results);
  assert.equal(out.length, 2);
  assert.equal(out[0].country, 'Kenya');
  assert.equal(out[0].lat, -1.2);
  assert.equal(out[1].key, 222);
  assert.ok(out.every((r) => r.source === 'GBIF'));
});

test('normalizeObservations maps iNat shape + builds url fallback', () => {
  const out = normalizeObservations(INAT_OBS.results);
  assert.equal(out.length, 2);
  assert.equal(out[0].commonName, 'Lion');
  assert.equal(out[0].photo, 'http://x/p.jpg');
  assert.equal(out[0].url, 'https://www.inaturalist.org/observations/999');
  // second row has no uri → url is synthesized from id
  assert.equal(out[1].url, 'https://www.inaturalist.org/observations/1000');
  assert.ok(out.every((r) => r.source === 'iNaturalist'));
});

test('normalizeEbird maps fields and drops null', () => {
  const out = normalizeEbird(EBIRD);
  assert.equal(out.length, 1);
  assert.equal(out[0].commonName, 'Bald Eagle');
  assert.equal(out[0].lon, -75.2);
  assert.equal(out[0].source, 'eBird');
});

test('normalizers tolerate non-array input', () => {
  assert.deepEqual(normalizeSpecies(undefined), []);
  assert.deepEqual(normalizeOccurrences(null), []);
  assert.deepEqual(normalizeObservations('nope'), []);
  assert.deepEqual(normalizeEbird({}), []);
});

// ---- exported function tests (with fake fetch) ---------------------------------------------------
test('speciesSearch hits GBIF species/search and normalizes', async () => {
  __setFetch(mockFetch({ 'species/search': GBIF_SPECIES }));
  const out = await speciesSearch('Panthera leo');
  assert.equal(out[0].key, 5219404);
  assert.equal(out[0].source, 'GBIF');
});

test('speciesSearch returns [] for empty query without calling network', async () => {
  __setFetch(() => { throw new Error('should not be called'); });
  assert.deepEqual(await speciesSearch('   '), []);
});

test('occurrences uses taxonKey for numeric, scientificName for text', async () => {
  let lastUrl = '';
  __setFetch(async (url) => { lastUrl = String(url); return { ok: true, json: async () => GBIF_OCC }; });
  await occurrences({ taxon: 5219404, country: 'ke' });
  assert.match(lastUrl, /taxonKey=5219404/);
  assert.match(lastUrl, /country=KE/); // uppercased
  await occurrences({ taxon: 'Panthera leo' });
  assert.match(lastUrl, /scientificName=Panthera/);
});

test('observations queries iNat by taxon_name', async () => {
  let lastUrl = '';
  __setFetch(async (url) => { lastUrl = String(url); return { ok: true, json: async () => INAT_OBS }; });
  const out = await observations({ taxon: 'Panthera leo' });
  assert.match(lastUrl, /inaturalist\.org/);
  assert.match(lastUrl, /taxon_name=Panthera/);
  assert.equal(out[0].commonName, 'Lion');
});

test('ebirdRecent soft-fails to [] when EBIRD_API_KEY is absent (no network)', async () => {
  delete process.env.EBIRD_API_KEY;
  __setFetch(() => { throw new Error('should not be called without a key'); });
  assert.deepEqual(await ebirdRecent({ region: 'US' }), []);
});

test('ebirdRecent sends the token header when key present', async () => {
  process.env.EBIRD_API_KEY = 'test-key';
  let sawHeader = '';
  __setFetch(async (url, opts) => { sawHeader = opts?.headers?.['X-eBirdApiToken'] || ''; return { ok: true, json: async () => EBIRD }; });
  const out = await ebirdRecent({ region: 'US-PA' });
  assert.equal(sawHeader, 'test-key');
  assert.equal(out[0].commonName, 'Bald Eagle');
});

// ---- soft-fail: never throw on network/non-ok/garbage ---------------------------------------------
test('all sources soft-fail (return []) on network error', async () => {
  __setFetch(mockFetch({ 'species/search': '__NETWORK_ERROR__', 'occurrence/search': '__NETWORK_ERROR__', 'inaturalist': '__NETWORK_ERROR__' }));
  assert.deepEqual(await speciesSearch('x'), []);
  assert.deepEqual(await occurrences({ taxon: 'x' }), []);
  assert.deepEqual(await observations({ taxon: 'x' }), []);
});

test('all sources soft-fail (return []) on non-OK status', async () => {
  __setFetch(mockFetch({ 'species/search': '__NOT_OK__', 'occurrence/search': '__NOT_OK__', 'inaturalist': '__NOT_OK__' }));
  assert.deepEqual(await speciesSearch('x'), []);
  assert.deepEqual(await occurrences({ taxon: 'x' }), []);
  assert.deepEqual(await observations({ taxon: 'x' }), []);
});

// ---- combined profile ----------------------------------------------------------------------------
test('speciesProfile combines GBIF + iNat (+ eBird for birds) into one object', async () => {
  process.env.EBIRD_API_KEY = 'test-key';
  __setFetch(mockFetch({
    'species/search': GBIF_SPECIES,
    'occurrence/search': GBIF_OCC,
    'inaturalist': INAT_OBS,
    'ebird.org': EBIRD,
  }));
  const p = await speciesProfile('Panthera leo');
  assert.equal(p.query, 'Panthera leo');
  assert.equal(p.taxonomy.key, 5219404);
  assert.ok(p.matches.length >= 1);
  assert.ok(p.occurrences.length >= 1);
  assert.ok(p.observations.length >= 1);
  // Mammalia, not Aves → eBird not consulted, no birds
  assert.deepEqual(p.birds, []);
  assert.deepEqual(p.sources, ['GBIF', 'iNaturalist']);
});

test('speciesProfile consults eBird for an Aves taxon when a key is present', async () => {
  process.env.EBIRD_API_KEY = 'test-key';
  const AVES = { results: [{ key: 1, scientificName: 'Haliaeetus leucocephalus', canonicalName: 'Haliaeetus leucocephalus', rank: 'SPECIES', class: 'Aves', family: 'Accipitridae' }] };
  __setFetch(mockFetch({ 'species/search': AVES, 'occurrence/search': GBIF_OCC, 'inaturalist': INAT_OBS, 'ebird.org': EBIRD }));
  const p = await speciesProfile('Bald Eagle');
  assert.ok(p.birds.length >= 1);
  assert.ok(p.sources.includes('eBird'));
});

test('speciesProfile returns null for empty name', async () => {
  __setFetch(() => { throw new Error('should not be called'); });
  assert.equal(await speciesProfile(''), null);
});

test('speciesProfile still returns a partial profile when sub-sources die', async () => {
  // GBIF species ok, everything else errors → taxonomy present, lists empty, no throw.
  __setFetch(mockFetch({ 'species/search': GBIF_SPECIES, 'occurrence/search': '__NETWORK_ERROR__', 'inaturalist': '__NETWORK_ERROR__' }));
  const p = await speciesProfile('Panthera leo');
  assert.equal(p.taxonomy.key, 5219404);
  assert.deepEqual(p.occurrences, []);
  assert.deepEqual(p.observations, []);
});
