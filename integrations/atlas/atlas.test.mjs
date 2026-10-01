// atlas.test.mjs — offline; no network, no host data. Uses a temp crosswalk + temp ATLAS_DIR.
import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { atlasBody, atlasLd, esc, gapSystems, loadCrosswalk, loadDerived, share, __resetAtlas } from './atlas.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'atlas-'));
const cwFile = path.join(tmp, 'cw.json');
fs.writeFileSync(cwFile, JSON.stringify({
  updated: '2026-09-30',
  systems: [
    { id: 'a', name: 'FBI PopStats', operator: 'FBI', markers: '23 STR', categories: ['Caucasians', 'African Americans'], mena: 'No Middle Eastern, North African or Levantine category. Scored as Caucasians.', source: 'Moretti 2016' },
    { id: 'b', name: 'gnomAD', operator: 'Broad', markers: 'exomes', categories: ['mid (Middle Eastern)'], mena: 'One of the few systems with a named Middle Eastern group.', source: 'gnomAD v4' },
  ],
  international: [{ id: 'uk', name: 'UK Biobank', country: 'UK', categories: 'UK Census coding; no MENA category', access: 'application', source: 'field 21000' }],
  ancestry_models: { entries: [
    { group: 'Lebanese', ancient_component: 'Canaanite', share: 'most of their ancestry', later_component: 'Eurasian', later_date: '~3,750-2,170 years ago', source: 'Haber 2017' },
    { group: 'Assyrians', ancient_component: 'Bronze Age Levant', share: 'NEEDS-EXTRACTION', later_component: 'Arabian-related', later_date: 'NEEDS-EXTRACTION', source: 'supplementary tables' },
  ] },
}));
process.env.ATLAS_CROSSWALK = cwFile;

const derivedDir = path.join(tmp, 'atlas-data');
fs.mkdirSync(derivedDir, { recursive: true });
fs.writeFileSync(path.join(derivedDir, '1kg_y_by_population.json'), JSON.stringify({
  populations: { TSI: { desc: 'Toscani', super: 'EUR', n: 10, haplogroups: { R1b: 6, J2: 3, I1: 1 } } },
}));
process.env.ATLAS_DIR = derivedDir;

test('esc() escapes every interpolation hazard', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
});

test('loadCrosswalk reads the sourced table; a missing file soft-fails to empty', () => {
  __resetAtlas();
  const d = loadCrosswalk(cwFile);
  assert.equal(d.systems.length, 2);
  assert.equal(d.international.length, 1);
  __resetAtlas();
  const miss = loadCrosswalk(path.join(tmp, 'nope.json'));
  assert.deepEqual(miss.systems, []);
  assert.deepEqual(miss.ancestry_models.entries, []);
  __resetAtlas();
});

test('gapSystems finds the systems with no MENA category, and not the ones that have it', () => {
  const gaps = gapSystems(loadCrosswalk(cwFile));
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].name, 'FBI PopStats');
});

test('loadDerived reads the worker-built aggregate table; share() computes a prefix-matched percentage', () => {
  const d = loadDerived(derivedDir);
  assert.ok(d.modernY && d.modernY.populations);
  const t = d.modernY.populations;
  assert.equal(share(t, 'TSI', 'R1b'), 60);
  assert.equal(share(t, 'TSI', 'J'), 30);
  assert.equal(share(t, 'NOPE', 'J'), null);
  assert.equal(share(null, 'TSI', 'J'), null);
});

test('loadDerived soft-fails when the host has no atlas dir', () => {
  const d = loadDerived(path.join(tmp, 'absent'));
  assert.equal(d.modernY, null);
  assert.equal(d.ancient, null);
});

test('atlasBody: Alpha label, the gap count, sources, and unextracted figures shown as unread not invented', () => {
  __resetAtlas();
  const html = atlasBody(loadCrosswalk(cwFile), loadDerived(derivedDir));
  assert.match(html, /<b>Alpha\.<\/b>/);
  assert.match(html, /1 of the 2 systems/);
  assert.match(html, /Moretti 2016/);
  assert.match(html, /UK Biobank/);
  assert.match(html, /most of their ancestry/);
  assert.match(html, /not yet read from the paper/);
  assert.ok(!html.includes('NEEDS-EXTRACTION'), 'placeholder must not leak to the page');
  assert.match(html, /R1b 60%/);
  __resetAtlas();
});

test('atlasBody survives empty data without throwing', () => {
  const html = atlasBody({ systems: [], international: [], ancestry_models: { entries: [] } }, { modernY: null, ancient: null });
  assert.match(html, /marker atlas/);
  assert.match(html, /has not been built on this host yet/);
});

test('atlasLd is a free, dated Dataset at /atlas', () => {
  const ld = atlasLd(loadCrosswalk(cwFile), 'https://example.test');
  assert.equal(ld['@type'], 'Dataset');
  assert.equal(ld.url, 'https://example.test/atlas');
  assert.equal(ld.isAccessibleForFree, true);
  assert.equal(ld.dateModified, '2026-09-30');
  __resetAtlas();
});

test('the page carries the interactive ancient-DNA map, loading its data from /atlas/ancient.json', async () => {
  const { ancientMapBlock } = await import('./atlas.mjs');
  const b = ancientMapBlock();
  assert.ok(b.includes('id=amap') && b.includes("fetch('/atlas/ancient.json')"));
  assert.ok(/close-kin/i.test(b) && /CC BY 4\.0/.test(b));
  assert.ok(!b.includes('${'), 'no unrendered template expressions leak into the client script');
  assert.ok(atlasBody().includes('id=amap'));
});
