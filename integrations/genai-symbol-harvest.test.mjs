import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { licenceBucket, harvestSymbol, harvestSymbols, commonsSearchSvg, __setFetch, __setSleep } from './genai-symbol-harvest.mjs';

const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4"/></svg>'.padEnd(200, ' '));
const meta = (lic) => ({ LicenseShortName: { value: lic }, Artist: { value: '<a href="//x">Someone</a>' } });
const COMMONS = {
  'File:Ankh.svg': { mime: 'image/svg+xml', lic: 'Public domain' },
  'File:Nonfree.svg': { mime: 'image/svg+xml', lic: 'Fair use' },
  'File:Gfdl.svg': { mime: 'image/svg+xml', lic: 'GFDL' },
  'File:Good search.svg': { mime: 'image/svg+xml', lic: 'CC BY-SA 4.0' },
  'File:Photo.jpg': { mime: 'image/jpeg', lic: 'CC0' },
};

function stub({ lead = 'Ankh.svg', search = ['File:Nonfree.svg', 'File:Gfdl.svg', 'File:Good search.svg'] } = {}) {
  const calls = [];
  __setSleep(async () => {});
  __setFetch(async (url) => {
    const u = decodeURIComponent(String(url)); calls.push(u);
    if (u.includes('en.wikipedia.org/w/api.php')) {
      const title = (u.match(/titles=([^&]+)/) || [])[1] || '';
      return { ok: true, json: async () => ({ query: { pages: Object.fromEntries(title.split('|').map((t, i) => [i + 1, { pageid: i + 1, title: t, fullurl: `https://en.wikipedia.org/wiki/${t}`, extract: `${t} is a symbol.`, pageimage: lead }])) } }) };
    }
    if (u.includes('commons.wikimedia.org/w/api.php') && u.includes('list=search')) {
      return { ok: true, json: async () => ({ query: { search: search.map((title) => ({ title })) } }) };
    }
    if (u.includes('commons.wikimedia.org/w/api.php') && u.includes('prop=imageinfo')) {
      const titles = ((u.match(/titles=([^&]+)/) || [])[1] || '').split('|');
      const pages = {};
      titles.forEach((t, i) => { const c = COMMONS[t]; if (c) pages[i + 1] = { title: t, imageinfo: [{ url: `https://upload.wikimedia.org/${t.slice(5)}`, mime: c.mime, size: 200, extmetadata: meta(c.lic), descriptionurl: `https://commons.wikimedia.org/wiki/${t}` }] }; else pages[-(i + 1)] = { title: t, missing: '' }; });
      return { ok: true, json: async () => ({ query: { pages } }) };
    }
    if (u.includes('upload.wikimedia.org')) return { ok: true, arrayBuffer: async () => svg.buffer.slice(svg.byteOffset, svg.byteOffset + svg.byteLength) };
    return { ok: false, status: 404 };
  });
  return calls;
}

test('licenceBucket keeps only PD/CC0/CC BY/CC BY-SA', () => {
  assert.equal(licenceBucket('Public domain'), 'A');
  assert.equal(licenceBucket('CC0'), 'A');
  assert.equal(licenceBucket('CC BY 4.0'), 'B');
  assert.equal(licenceBucket('CC BY-SA 3.0'), 'B');
  assert.equal(licenceBucket('CC BY-NC-SA 4.0'), null);
  assert.equal(licenceBucket('CC BY-ND 2.0'), null);
  assert.equal(licenceBucket('GFDL'), null);
  assert.equal(licenceBucket('Fair use'), null);
  assert.equal(licenceBucket('OFL'), null);
  assert.equal(licenceBucket(''), null);
});

test('pinned file wins, sources come from the fetched articles', async () => {
  stub();
  const r = await harvestSymbol({ id: 'ankh', wiki: ['Ankh'], file: 'File:Ankh.svg', q: null, font: false });
  assert.equal(r.via, 'pinned');
  assert.equal(r.image.title, 'File:Ankh.svg');
  assert.equal(r.image.bucket, 'A');
  assert.equal(r.image.author, 'Someone');
  assert.equal(r.sources[0].url, 'https://en.wikipedia.org/wiki/Ankh');
});

test('search skips non-free and GFDL-only files, never reuses a used file', async () => {
  stub({ lead: 'Photo.jpg', search: ['File:Nonfree good.svg', 'File:Gfdl good.svg', 'File:Good search.svg'] });
  COMMONS['File:Nonfree good.svg'] = COMMONS['File:Nonfree.svg']; COMMONS['File:Gfdl good.svg'] = COMMONS['File:Gfdl.svg'];
  const r = await harvestSymbol({ id: 'x', wiki: ['X'], q: 'good', font: false });
  assert.equal(r.image.title, 'File:Good search.svg');
  assert.equal(r.via, 'search');
  assert.ok(r.rejected.some((x) => /Fair use/.test(x.why)));
  assert.ok(r.rejected.some((x) => /GFDL/.test(x.why)));
  const r2 = await harvestSymbol({ id: 'y', wiki: ['Y'], q: 'good', font: false }, { used: new Set(['File:Good search.svg']) });
  assert.equal(r2.image, null, 'raster lead is not used unless the row allows it');
  const r3 = await harvestSymbol({ id: 'z', wiki: ['Z'], q: 'good', font: false, raster: true }, { used: new Set(['File:Good search.svg']) });
  assert.equal(r3.via, 'wiki-lead-raster');
});

test('search ranking drops titles with no query word', async () => {
  stub({ search: ['File:Herb spiral.svg', 'File:Lamassu drawing.svg'] });
  assert.deepEqual(await commonsSearchSvg('lamassu drawing'), ['File:Lamassu drawing.svg']);
});

test('font rows fetch sources but no image', async () => {
  const calls = stub();
  const r = await harvestSymbol({ id: 'zodiac-aries', wiki: ['Aries (astrology)'], font: true, cp: 0x2648 });
  assert.equal(r.image, null);
  assert.equal(r.sources.length, 1);
  assert.ok(!calls.some((c) => c.includes('commons')));
});

test('harvestSymbols writes files + manifest, is incremental, and soft-fails', async () => {
  stub();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'symh-'));
  const specs = [{ id: 'ankh', wiki: ['Ankh'], file: 'File:Ankh.svg', font: false }, { id: 'aries', wiki: ['Aries'], font: true, cp: 0x2648 }];
  const s1 = await harvestSymbols({ dir, specs, delayMs: 0 });
  assert.equal(s1.downloaded, 1);
  assert.ok(fs.existsSync(path.join(dir, 'ankh.svg')));
  const mf = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
  assert.equal(mf.ankh.image.licence, 'Public domain');
  const s2 = await harvestSymbols({ dir, specs, delayMs: 0 });
  assert.equal(s2.downloaded, 0, 'second run skips what we hold');
  __setFetch(async () => { throw new Error('offline'); });
  const s3 = await harvestSymbols({ dir, specs: [{ id: 'q', wiki: ['Q'], q: 'q', font: false }], delayMs: 0 });
  assert.equal(s3.none, 1);
  __setFetch(null); __setSleep(null);
});
