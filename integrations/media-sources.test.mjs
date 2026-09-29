// media-sources.test.mjs — offline: injected fetch per source; licence ceiling; NC/ND never returned; soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, sources, normLicence, attributionLine, __setFetch } from './media-sources.mjs';

const ok = (body) => ({ ok: true, json: async () => body });
function router(map) { return async (url) => { for (const [re, body] of map) if (re.test(url)) return typeof body === 'function' ? ok(body(url)) : ok(body); return { ok: false }; }; }

test('normLicence maps PD/CC0/BY/BY-SA and rejects NC/ND', () => {
  assert.equal(normLicence('https://creativecommons.org/publicdomain/zero/1.0/'), 'cc0');
  assert.equal(normLicence('Public domain'), 'pd');
  assert.equal(normLicence('pdm'), 'pd');
  assert.equal(normLicence('CC BY-SA 4.0'), 'cc-by-sa');
  assert.equal(normLicence('https://creativecommons.org/licenses/by/2.0/'), 'cc-by');
  assert.equal(normLicence('CC BY-NC 2.0'), null);
  assert.equal(normLicence('by-nd'), null);
  assert.equal(normLicence('All rights reserved'), null);
});

test('search merges sources, applies the licence ceiling, and attributes every hit', async () => {
  __setFetch(router([
    [/openverse/, { results: [
      { url: 'https://o/1.jpg', title: 'Meroe', creator: 'A', license: 'by-sa', license_version: '4.0', source: 'wikimedia' },
      { url: 'https://o/2.jpg', title: 'NC one', creator: 'B', license: 'by-nc' },
      { url: 'https://o/3.jpg', title: 'Zero', creator: 'C', license: 'cc0' }] }],
    [/commons\.wikimedia/, { query: { pages: { 1: { title: 'File:Meroe 1821.jpg', imageinfo: [{ url: 'https://c/1821.jpg', mime: 'image/jpeg', extmetadata: { LicenseShortName: { value: 'Public domain' }, Artist: { value: '<a>Cailliaud</a>' } } }] } } } }],
    [/metmuseum.*search/, { objectIDs: [7] }],
    [/metmuseum.*objects\/7/, { isPublicDomain: true, primaryImage: 'https://m/7.jpg', title: 'Amulet', objectURL: 'https://met/7' }],
    [/clevelandart/, { data: [{ share_license_status: 'CC0', title: 'Temple', images: { web: { url: 'https://cl/w.jpg' } } }] }],
    [/artic\.edu/, { data: [{ id: 5, title: 'Sphinx', is_public_domain: true, image_id: 'abc' }, { id: 6, title: 'Modern', is_public_domain: false, image_id: 'def' }] }],
    [/loc\.gov\/photos/, { results: [{ id: 'http://www.loc.gov/item/1/', title: 'Pyramids', image_url: ['https://l/s.jpg#h=1', 'https://l/b.jpg#h=2'] }] }],
    [/loc\.gov\/item\/1/, { item: { rights_advisory: 'No known restrictions on publication.' } }],
  ]));
  const all = await search('meroe', { type: 'image', licence: 'cc-by', limit: 20 });
  const urls = all.map((h) => h.url);
  assert.ok(urls.includes('https://o/1.jpg') && urls.includes('https://c/1821.jpg') && urls.includes('https://m/7.jpg'));
  assert.ok(urls.includes('https://cl/w.jpg') && urls.includes('https://l/b.jpg'));
  assert.ok(urls.some((u) => u.includes('artic.edu/iiif/2/abc')));
  assert.ok(!urls.includes('https://o/2.jpg'), 'NC is never returned');
  assert.ok(!urls.some((u) => u.includes('/iiif/2/def/')), 'non-PD museum works are dropped');
  const pd = await search('meroe', { type: 'image', licence: 'pd', limit: 20 });
  assert.ok(pd.every((h) => h.licence === 'pd'));
  const c = all.find((h) => h.url === 'https://c/1821.jpg');
  assert.equal(c.creator, 'Cailliaud');
  assert.match(c.attribution, /Public domain, via Wikimedia Commons/);
  assert.match(all.find((h) => h.url === 'https://o/1.jpg').attribution, /CC BY-SA 4\.0/);
});

test('keyed sources are skipped without a key; a dead source is just empty', async () => {
  delete process.env.EUROPEANA_API_KEY; delete process.env.FREESOUND_API_KEY;
  const s = sources();
  assert.equal(s.find((x) => x.name === 'Europeana').configured, false);
  assert.equal(s.find((x) => x.name === 'Openverse').configured, true);
  __setFetch(async () => { throw new Error('offline'); });
  assert.deepEqual(await search('x', { type: 'audio' }), []);
  __setFetch(null);
});

test('attributionLine', () => {
  assert.equal(attributionLine({ title: 'T', creator: 'C', licence: 'cc0', source: 'S' }), '"T", by C, CC0, via S');
});
