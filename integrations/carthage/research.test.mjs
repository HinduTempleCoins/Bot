// research.test.mjs — fully offline. Every external collaborator is stubbed through __setDeps,
// every HTTP call through __setFetch. Nothing in here touches the network or the real corpus.
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TIERS, LOCAL_ORDER, ALIASES, keywordsFor, searchLocal, searchBook, seedUrlsFor,
  buildDossier, renderDossier, loadLocalCorpus, __clearCorpusCache, __setDeps, __setFetch,
} from './research.mjs';
import { parseAll, loadSource } from './parse.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, 'fixtures', 'growth');

// Stubs for everything outside this module. `publicDomain` and `grounding` are stubbed too so the
// suite never depends on those modules' behaviour changing.
const STUB_PD = { classify: ({ pubYear } = {}) => ({ status: pubYear && pubYear < 1930 ? 'public-domain' : 'unknown', reason: 'stub', entersPdYear: null }) };
const STUB_GROUND = { rankSources: (l) => [...l] };

function stubAll(over = {}) {
  __setDeps({
    publicDomain: STUB_PD,
    grounding: STUB_GROUND,
    ourSearch: { search: async () => ({ hits: [] }) },
    booklore: { search: async () => [], ingestMany: async () => [] },
    seeds: { allSeedUrls: () => [] },
    bookApis: {},
    ...over,
  });
  __setFetch(async () => { throw new Error('no network in tests'); });
}

beforeEach(() => { __clearCorpusCache(); stubAll(); delete process.env.TAVILY_API_KEY; delete process.env.EXA_API_KEY; delete process.env.FIRECRAWL_API_KEY; });

test('the tier order is the method: emails first, keyed research APIs last', () => {
  assert.deepEqual(Object.keys(TIERS), ['local', 'book', 'ourSearch', 'booklore', 'bookApis', 'keyed']);
  assert.ok(TIERS.local < TIERS.book);
  assert.ok(TIERS.book < TIERS.ourSearch);
  assert.ok(TIERS.ourSearch < TIERS.booklore);
  assert.ok(TIERS.booklore < TIERS.bookApis);
  assert.ok(TIERS.bookApis < TIERS.keyed);
  assert.equal(LOCAL_ORDER[0], 'emails', 'the guides name the emails as the expansion source');
  assert.equal(LOCAL_ORDER[LOCAL_ORDER.length - 1], 'brujeria', 'the book itself is tier 2, not tier 1');
});

test('keywordsFor expands the guides\' worked example', () => {
  const k = keywordsFor({ text: 'Book of Tobit Jesus Fish' });
  assert.equal(k.phrase, 'Book of Tobit Jesus Fish');
  for (const t of ['tobit', 'jesus', 'fish']) assert.ok(k.terms.includes(t), `missing ${t}`);
  // the guides' own expansion list for this item
  for (const t of ALIASES['jesus fish']) assert.ok(k.terms.includes(t), `missing alias ${t}`);
  assert.ok(!k.terms.includes('the'), 'stopwords are dropped');
});

test("keywordsFor folds in the operator's note and extra terms", () => {
  const k = keywordsFor({ text: 'Sacred Tales', note: 'looks like Header, but I need my own Words between the Quotes' },
    { extraTerms: ['Aristides'] });
  assert.ok(k.terms.includes('Aristides'));
  assert.ok(k.terms.includes('words'));
});

test('loadLocalCorpus reads the growth corpora and caches them', () => {
  const docs = loadLocalCorpus(ROOT);
  assert.ok(docs.length >= 3);
  assert.ok(docs.some((d) => d.corpus === 'emails'));
  assert.equal(loadLocalCorpus(ROOT), docs, 'second call is served from cache');
});

test('searchLocal puts the email corpus ahead of every other corpus', () => {
  const hits = searchLocal(keywordsFor({ text: 'Book of Tobit Jesus Fish' }), { root: ROOT });
  assert.ok(hits.length >= 2, 'the fixture has Tobit in emails and in warchristmas');
  assert.equal(hits[0].source, 'emails');
  const firstNonEmail = hits.findIndex((h) => h.source !== 'emails');
  if (firstNonEmail > -1) {
    assert.ok(hits.slice(firstNonEmail).every((h) => h.source !== 'emails'),
      'no email hit may appear after a non-email hit');
  }
});

test('searchLocal orders email excerpts chronologically', () => {
  // Expansion Protocol step 3: "Compile excerpts - Chronologically (author's understanding
  // developed over time)". The fixture thread deliberately stores 2024 before 2022.
  const hits = searchLocal(keywordsFor({ text: 'Sacred Tales' }), { root: ROOT, perFile: 10 })
    .filter((h) => h.source === 'emails' && h.date);
  const dates = hits.map((h) => h.date);
  assert.deepEqual(dates, [...dates].sort(), `not chronological: ${dates.join(', ')}`);
});

test('every local hit carries file + line provenance', () => {
  const hits = searchLocal(keywordsFor({ text: 'Book of Tobit Jesus Fish' }), { root: ROOT });
  for (const h of hits) {
    assert.equal(h.provenance.kind, 'local');
    assert.ok(h.provenance.file);
    assert.ok(Number.isInteger(h.provenance.line) && h.provenance.line > 0);
    assert.ok(h.quote.length > 0, 'a passage without its text is not evidence');
  }
});

test('searchLocal soft-fails on a missing corpus and on empty keywords', () => {
  assert.deepEqual(searchLocal({ terms: [] }, { root: ROOT }), []);
  assert.deepEqual(searchLocal(keywordsFor({ text: 'Ra' }), { root: path.join(HERE, 'nope') }), []);
});

test('searchBook finds the author on the same subject elsewhere, skipping the placeholder itself', () => {
  const { text } = loadSource(ROOT);
  const bp = parseAll({ root: ROOT }).bulletpoints.find((b) => b.text === 'The Puny Punic');
  const hits = searchBook(keywordsFor(bp), { text, excludeLine: bp.line });
  assert.ok(hits.length > 0);
  for (const h of hits) {
    assert.equal(h.tier, TIERS.book);
    assert.ok(Math.abs(h.provenance.line - bp.line) > 6, 'must not quote its own placeholder back');
    assert.ok(h.provenance.file.includes('Tanit'));
  }
});

test('buildDossier runs the tiers in order and never loses provenance', async () => {
  stubAll({
    ourSearch: {
      search: async () => ({ hits: [{ source: 'library', title: 'Ichthys', link: 'https://example.org/ichthys', snippet: 'fish', score: 0.9 }] }),
    },
  });
  const r = parseAll({ root: ROOT });
  const bp = r.bulletpoints.find((b) => b.text === 'Book of Tobit Jesus Fish');
  const d = await buildDossier(bp, { root: ROOT, sourceText: loadSource(ROOT).text, enough: 999 });

  assert.equal(d.ok, true);
  assert.ok(d.total > 0);
  const tiers = d.entries.map((e) => e.tier);
  assert.deepEqual(tiers, [...tiers].sort((a, b) => a - b), 'entries must be in tier order');
  assert.equal(d.entries[0].tierName, 'local', 'the emails lead the dossier');
  for (const e of d.entries) {
    assert.ok(e.provenance, 'every entry carries provenance');
    assert.ok(e.provenance.file || e.provenance.url, 'provenance names a file or a URL');
    if (e.provenance.kind === 'external') {
      assert.ok(e.provenance.retrieved, 'external hits record the retrieval date');
      assert.ok(e.publicDomain && e.publicDomain.status, 'external hits record PD status');
      assert.ok(e.publicDomain.fairUse.includes('not being sold'));
    }
    assert.ok(Number.isInteger(e.rank));
  }
});

test('buildDossier keeps the bulletpoint, its note and its context', async () => {
  const r = parseAll({ root: ROOT });
  const bp = r.bulletpoints.find((b) => b.text === 'Sacred Tales');
  const d = await buildDossier(bp, { root: ROOT, sourceText: loadSource(ROOT).text });
  assert.equal(d.bulletpoint.note, 'looks like Header, but I need my own Words between the Quotes');
  assert.equal(d.bulletpoint.inventoryN, 23);
  assert.ok(d.bulletpoint.contextAfter.length > 0);
});

test('later tiers are skipped once the earlier ones have enough', async () => {
  let called = 0;
  stubAll({ ourSearch: { search: async () => { called++; return { hits: [] }; } } });
  const r = parseAll({ root: ROOT });
  const bp = r.bulletpoints.find((b) => b.text === 'Book of Tobit Jesus Fish');
  await buildDossier(bp, { root: ROOT, sourceText: loadSource(ROOT).text, enough: 1 });
  assert.equal(called, 0, 'our-search is not called when the local corpora already answered');
});

test('the keyed research APIs are a last resort, not a tier that just runs', async () => {
  process.env.TAVILY_API_KEY = 'test-key-never-logged';
  let fetched = 0;
  __setFetch(async () => { fetched++; return { json: async () => ({ results: [{ title: 'x', url: 'https://x.test/', content: 'y' }] }) }; });
  const r = parseAll({ root: ROOT });

  // something the local corpora DO answer → keyed tier must stay untouched
  const known = r.bulletpoints.find((b) => b.text === 'Book of Tobit Jesus Fish');
  await buildDossier(known, { root: ROOT, sourceText: loadSource(ROOT).text, enough: 999 });
  assert.equal(fetched, 0, 'keyed APIs must not run while any other tier produced something');

  // nothing anywhere → keyed tier is allowed to run
  const d = await buildDossier({ id: 'X', text: 'Zzzyxqqq Unfindable', line: 1 },
    { root: ROOT, sourceText: loadSource(ROOT).text });
  assert.equal(fetched, 1);
  assert.equal(d.entries[0].tierName, 'keyed');
  assert.ok(d.notes.some((n) => n.includes('last resort')));
  // the key itself must never appear in the dossier
  assert.ok(!JSON.stringify(d).includes('test-key-never-logged'));
});

test('a dead tier contributes nothing and never throws', async () => {
  stubAll({
    ourSearch: { search: async () => { throw new Error('down'); } },
    booklore: { search: async () => { throw new Error('down'); } },
    bookApis: { gutendex: async () => { throw new Error('down'); } },
  });
  const d = await buildDossier({ id: 'Y', text: 'Zzzyxqqq Unfindable', line: 1 },
    { root: ROOT, sourceText: '', enough: 999 });
  assert.equal(d.ok, true);
  assert.deepEqual(d.entries, []);
});

test('booklore ingests seed pages only when it has nothing and only when asked', async () => {
  const ingested = [];
  let searches = 0;
  stubAll({
    booklore: {
      search: async () => (searches++ ? [{ url: 'https://sacred-texts.com/egy/p.htm', title: 'Pashupati', host: 'sacred-texts.com', chunk: 'text', score: 1 }] : []),
      ingestMany: async (urls) => { ingested.push(...urls); return urls; },
    },
    seeds: { allSeedUrls: () => [{ host: 'sacred-texts.com', title: 'Hinduism', url: 'https://sacred-texts.com/hin/index.htm' }] },
  });
  const d = await buildDossier({ id: 'Z', text: 'Hinduism Pashupati', line: 1 },
    { root: path.join(HERE, 'nope'), sourceText: '', ingest: true, tiers: ['booklore'], enough: 999 });
  assert.deepEqual(ingested, ['https://sacred-texts.com/hin/index.htm']);
  assert.equal(d.entries.length, 1);
  assert.equal(d.entries[0].tierName, 'booklore');

  // without ingest:true nothing is fetched from the small non-profit hosts
  searches = 0; ingested.length = 0;
  await buildDossier({ id: 'Z', text: 'Hinduism Pashupati', line: 1 },
    { root: path.join(HERE, 'nope'), sourceText: '', tiers: ['booklore'], enough: 999 });
  assert.deepEqual(ingested, []);
});

test('seedUrlsFor returns only a handful of URLs (politeness)', async () => {
  __setDeps({
    seeds: { allSeedUrls: () => Array.from({ length: 20 }, (_, i) => ({ host: 'sacred-texts.com', title: 'Egyptian index', url: `https://sacred-texts.com/egy/${i}.htm` })) },
  });
  const urls = await seedUrlsFor(keywordsFor({ text: 'Egyptian Moon' }));
  assert.ok(urls.length <= 3, 'ingest a handful of leaf pages at a time, not the whole tree');
});

test('the keyless book APIs are read through the shared free-apis clients', async () => {
  stubAll({
    bookApis: {
      gutendex: async () => ({ results: [{ id: 1, title: 'The Book of Tobit', authors: [{ name: 'Anon', death_year: 100 }], formats: {} }] }),
      openlibrary: async () => ({ docs: [{ title: 'Tobit', key: '/works/OL1W', author_name: ['Anon'], first_publish_year: 1611 }] }),
      crossref: async () => ({ message: { items: [] } }),
      semanticScholar: async () => ({ data: [] }),
      arxiv: async () => '',
    },
  });
  const d = await buildDossier({ id: 'Q', text: 'Book of Tobit Jesus Fish', line: 1 },
    { root: path.join(HERE, 'nope'), sourceText: '', tiers: ['bookApis'], enough: 999 });
  assert.equal(d.counts['book-apis'], 2);
  assert.ok(d.entries.every((e) => e.publicDomain));
  assert.ok(d.entries.some((e) => e.provenance.host === 'openlibrary.org'));
});

test('renderDossier escapes everything and names a source on every passage', async () => {
  const d = await buildDossier({ id: 'E', text: '<b>Ra</b>', line: 1 },
    { root: ROOT, sourceText: loadSource(ROOT).text });
  const out = renderDossier(d);
  assert.ok(out.includes('&lt;b&gt;Ra&lt;/b&gt;'));
  assert.ok(!out.includes('<b>Ra</b>'));
  assert.equal(renderDossier(null), '');
});
