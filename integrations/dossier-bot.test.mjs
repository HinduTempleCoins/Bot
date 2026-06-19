// dossier-bot.test.mjs — OFFLINE. All readers + fs injected; no network, no disk writes. Soft-fail.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildDossierFor, writeDossier, runQueue, slugify } from './dossier-bot.mjs';

const wikiOf = (extract, desc = 'American politician') => async (name) => ({
  title: name, description: desc, extract, url: `https://en.wikipedia.org/wiki/${name.replace(/ /g, '_')}`,
  source: { name: 'Wikipedia', url: `https://en.wikipedia.org/wiki/${name.replace(/ /g, '_')}` },
});
// real classifier (pure, no network) so the extract→events path is exercised for real
import { classifySentences } from './accountability-apis.mjs';

const deps = (over = {}) => ({
  wikipediaSummary: wikiOf('Smith was indicted on bribery charges in 2019. Smith later resigned from office.'),
  classifySentences,
  discoverMedia: async () => [{ type: 'statement', subject: 'x', label: 'Smith denied wrongdoing', candidate: true, source: { name: 'apnews.com', url: 'https://apnews.com/x' }, asOf: '2020-01-01' }],
  secEdgarFullText: async () => [],
  congressTrades: async () => [{ type: 'investment', holder: 'Smith', company: 'ACME', status: 'sold', label: 'Sale', source: { name: 'Senate Stock Watcher', url: 'u' }, asOf: '2021' }],
  ...over,
});

test('slugify makes safe slugs', () => {
  assert.equal(slugify('Josh Hawley'), 'josh-hawley');
  assert.equal(slugify('AT&T Inc.'), 'at-t-inc');
  assert.equal(slugify('  Robert "Bob" Menendez  '), 'robert-bob-menendez');
});

test('buildDossierFor assembles a sourced, auto-flagged dossier from Wikipedia + GDELT + trades', async () => {
  const d = await buildDossierFor('John Smith', { kind: 'person', chamber: 'senate', deps: deps() });
  assert.ok(d);
  assert.equal(d.auto, true);
  assert.equal(d.verified, false);
  assert.match(d.verifyNote, /Wikipedia/);                 // it used Wikipedia and says so
  assert.ok(d.builtFrom.includes('Wikipedia'));
  assert.ok(d.builtFrom.includes('Senate Stock Watcher'));
  // extract → a charge + a resignation event; GDELT → a statement; trades → a holding
  const kinds = d.records.map((r) => r.type);
  assert.ok(kinds.includes('charge'));
  assert.ok(kinds.includes('resignation') || kinds.includes('resignation-call'));
  assert.ok(kinds.includes('statement'));
  assert.ok(kinds.includes('investment'));
  assert.ok(d.records.every((r) => r.source || r.holder), 'every record carries a source/subject');
});

test('buildDossierFor returns null when nothing is sourced (no empty pages)', async () => {
  const d = await buildDossierFor('Nobody', { deps: deps({ wikipediaSummary: async () => null, discoverMedia: async () => [], congressTrades: async () => [] }) });
  assert.equal(d, null);
});

test('buildDossierFor de-dupes repeated events', async () => {
  const dup = { type: 'charge', subject: 'x', label: 'Same charge', candidate: true, source: { name: 's', url: 'u' } };
  const d = await buildDossierFor('Dupe Person', { deps: deps({
    wikipediaSummary: async () => null,
    discoverMedia: async () => [dup, { ...dup }],
    congressTrades: async () => [],
  }) });
  assert.equal(d.records.filter((r) => r.type === 'charge').length, 1);
});

test('writeDossier refuses to clobber a hand-curated (auto:false) file', async () => {
  const reads = { 'k/ken-paxton.json': JSON.stringify({ auto: false }) };
  const fs = {
    readFile: async (p) => { const k = p.endsWith('ken-paxton.json') ? 'k/ken-paxton.json' : null; if (k && reads[k]) return reads[k]; throw new Error('ENOENT'); },
    writeFile: async () => { throw new Error('should not write'); },
    mkdir: async () => {},
  };
  const r = await writeDossier({ slug: 'ken-paxton', auto: true, records: [] }, { dir: 'k', fs });
  assert.equal(r.ok, false);
  assert.match(r.reason, /curated/);
});

test('runQueue advances through the roster, tracking done in state', async () => {
  const written = {};
  const state = { val: null };
  const fs = {
    readFile: async (p) => { if (p.endsWith('_state.json')) { if (state.val) return state.val; throw new Error('fresh'); } throw new Error('ENOENT'); },
    writeFile: async (p, c) => { if (p.endsWith('_state.json')) state.val = c; else written[p] = c; },
    mkdir: async () => {},
  };
  const roster = [{ name: 'Alpha One', kind: 'person' }, { name: 'Beta Two', kind: 'person' }, { name: 'Gamma Three', kind: 'person' }];
  const d = deps();
  const r1 = await runQueue({ roster, limit: 2, dir: 'k', statePath: 'k/_state.json', deps: d, fs });
  assert.equal(r1.built.length, 2);
  assert.equal(r1.totalDone, 2);
  // second pass picks up where it left off (the 3rd subject), not redoing the first two
  const r2 = await runQueue({ roster, limit: 2, dir: 'k', statePath: 'k/_state.json', deps: d, fs });
  assert.equal(r2.built.length, 1, 'only the remaining subject');
  assert.equal(r2.built[0].name, 'Gamma Three');
  assert.equal(r2.remaining, 0);
});
