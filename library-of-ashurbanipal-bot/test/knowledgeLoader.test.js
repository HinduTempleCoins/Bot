// knowledgeLoader.test.js — tests for the corpus/KB loader (#90: loader). Exercises the document
// loader + normalizer (loadAll / loadDomain / loadDocument), the JSON flattener, domain-tier mapping,
// keyword extraction + index, scored search, and excerpting — plus graceful handling of a missing,
// empty, or corrupt source.
//
// OFFLINE + deterministic: builds a throwaway knowledge-base directory tree in os.tmpdir() as a
// fixture (no network, no real knowledge/** read, no mocks needed — the loader is pure filesystem).
// .docx is NOT exercised (it would invoke mammoth on a real binary doc); .json/.md/.txt cover the
// normalization paths. console.log/warn/error are silenced so a missing-path warning doesn't add noise.
//
// Run: node test/knowledgeLoader.test.js   (node:test + node:assert, no new deps, no network)
//
// Invariant: every path used here is under a fresh tmp dir; nothing reads or writes knowledge/**.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import KnowledgeLoader, { KNOWLEDGE_HIERARCHY, KNOWLEDGE_BRIDGES } from '../src/utils/knowledgeLoader.js';

// ── quiet the loader's progress logging so test output stays clean/deterministic ──────────────────
const _log = console.log, _warn = console.warn, _error = console.error;
function silence() { console.log = () => {}; console.warn = () => {}; console.error = () => {}; }
function restore() { console.log = _log; console.warn = _warn; console.error = _error; }

// ── fixture builder: write a throwaway knowledge base tree and return its base path ───────────────
function makeKB(tree) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-'));
  for (const [domain, files] of Object.entries(tree)) {
    const dir = path.join(base, domain);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      const body = typeof content === 'string' ? content : JSON.stringify(content);
      fs.writeFileSync(path.join(dir, name), body, 'utf-8');
    }
  }
  return base;
}

// A representative fixture: a root domain (oilahuasca), a primary branch (phoenician), and a
// peripheral domain (cryptocurrency), plus a leading-underscore dir that must be ignored.
function standardKB() {
  return makeKB({
    oilahuasca: {
      'space_paste.json': {
        title: 'Space Paste',
        body: 'Oilahuasca uses essential oils and allylbenzene with an MAOI for transdermal delivery.',
        detail: { mechanism: 'CYP450 inhibition extends myristicin activity.' },
        tags: ['root'],
      },
      'overview.md': '# Oilahuasca\n\nOilahuasca is the root knowledge. It connects essential oils to consciousness.',
    },
    phoenician: {
      'headcones.txt': 'The Phoenician headcone is a beeswax kyphi incense cone for transdermal use. Punic wax.',
    },
    cryptocurrency: {
      'witness.md': 'A blockchain witness produces blocks. Graphene powers BitShares and Steem.',
    },
    _hidden: {
      'ignore.md': 'This domain starts with an underscore and must be skipped.',
    },
  });
}

// ── pure helpers (no filesystem) ──────────────────────────────────────────────────────────────────

test('getDomainTier maps domains to their hierarchy tier, defaults to peripheral', () => {
  const kl = new KnowledgeLoader('/nonexistent');
  assert.equal(kl.getDomainTier('oilahuasca'), 'root');
  assert.equal(kl.getDomainTier('phoenician'), 'primary');
  assert.equal(kl.getDomainTier('herbs'), 'secondary');
  assert.equal(kl.getDomainTier('history'), 'extended');
  assert.equal(kl.getDomainTier('cryptocurrency'), 'peripheral');
  assert.equal(kl.getDomainTier('totally-unknown-domain'), 'peripheral'); // default
});

test('flattenJSON renders nested objects and arrays into searchable key: value lines', () => {
  const kl = new KnowledgeLoader('/nonexistent');
  const flat = kl.flattenJSON({
    title: 'T',
    nested: { mechanism: 'CYP450 inhibition' },
    list: ['a', 'b'],
    objList: [{ x: 1 }],
  });
  assert.match(flat, /title: T/);
  assert.match(flat, /nested\.mechanism: CYP450 inhibition/); // nested key prefixed
  assert.match(flat, /list: a, b/);                            // scalar array joined
  assert.match(flat, /objList: \{"x":1\}/);                    // object array element stringified
});

test('extractKeywords picks up domain keywords and important global terms, case-insensitively', () => {
  const kl = new KnowledgeLoader('/nonexistent');
  const content = 'This text mentions Allylbenzene and an MAOI plus the Headcone and Space Paste.';
  const kws = kl.extractKeywords(content, 'oilahuasca');
  // domain keyword (allylbenzene, maoi, space paste) + global important term — all lowercased matches
  assert.ok(kws.includes('allylbenzene'), 'domain keyword found');
  assert.ok(kws.includes('maoi'), 'domain keyword found (case-insensitive)');
  assert.ok(kws.includes('space paste'), 'multi-word term found');
  assert.ok(kws.includes('headcone'), 'global important term found');
  // dedupe: a term that is BOTH a domain keyword and a global term appears once
  assert.equal(kws.filter((k) => k === 'allylbenzene').length, 1);
});

test('getExcerpt centers on the search term and adds ellipses only when truncated', () => {
  const kl = new KnowledgeLoader('/nonexistent');
  const content = 'alpha beta gamma TARGET delta epsilon ' + 'word '.repeat(200);
  const ex = kl.getExcerpt(content, 'TARGET', 60);
  assert.ok(ex.includes('TARGET'), 'excerpt contains the search term');
  assert.ok(ex.endsWith('...'), 'truncated on the right → trailing ellipsis');
  // a short doc shorter than maxLength is returned whole, no ellipses
  const short = kl.getExcerpt('just a short doc', 'short', 500);
  assert.equal(short, 'just a short doc');
  // missing term → falls back to the start of the content (does not throw)
  const missing = kl.getExcerpt('no match here at all', 'zzz', 500);
  assert.equal(missing, 'no match here at all');
});

// ── loadAll / loadDomain / loadDocument: load + normalize the corpus ───────────────────────────────

test('loadAll loads + normalizes JSON/MD/TXT, skips underscore domains, builds the index', async () => {
  const base = standardKB();
  const kl = new KnowledgeLoader(base);
  silence();
  try { await kl.loadAll(); } finally { restore(); }

  assert.equal(kl.loaded, true);
  // four real docs across three domains (the _hidden domain is skipped)
  assert.equal(kl.documents.size, 4);
  assert.ok(kl.documents.has('oilahuasca/space_paste.json'));
  assert.ok(kl.documents.has('oilahuasca/overview.md'));
  assert.ok(kl.documents.has('phoenician/headcones.txt'));
  assert.ok(kl.documents.has('cryptocurrency/witness.md'));
  assert.ok(![...kl.documents.keys()].some((k) => k.startsWith('_hidden')), 'underscore domain skipped');

  // domainDocuments grouping
  assert.deepEqual(kl.domainDocuments.get('oilahuasca').sort(), ['oilahuasca/overview.md', 'oilahuasca/space_paste.json']);
  assert.equal(kl.domainDocuments.get('cryptocurrency').length, 1);

  // a normalized doc carries the full shape
  const doc = kl.documents.get('oilahuasca/space_paste.json');
  assert.equal(doc.domain, 'oilahuasca');
  assert.equal(doc.filename, 'space_paste.json');
  assert.equal(doc.tier, 'root');
  assert.match(doc.content, /transdermal delivery/);       // body prose flattened in
  assert.match(doc.content, /CYP450 inhibition/);          // nested detail flattened in
  assert.ok(Array.isArray(doc.keywords) && doc.keywords.length > 0, 'keywords extracted');
  assert.ok(Array.isArray(doc.bridges) && doc.bridges.length > 0, 'bridges from KNOWLEDGE_BRIDGES');

  // keyword index is built and points at the right docs
  assert.ok((kl.index.get('allylbenzene') || []).includes('oilahuasca/space_paste.json'));
});

test('loadAll is idempotent — a second call does not double-load', async () => {
  const base = standardKB();
  const kl = new KnowledgeLoader(base);
  silence();
  try {
    await kl.loadAll();
    const sizeAfterFirst = kl.documents.size;
    await kl.loadAll(); // guarded by this.loaded
    assert.equal(kl.documents.size, sizeAfterFirst);
  } finally { restore(); }
});

// ── graceful handling: missing / empty / corrupt sources ──────────────────────────────────────────

test('missing base path → loadAll returns gracefully, loads nothing, does not throw', async () => {
  const kl = new KnowledgeLoader(path.join(os.tmpdir(), 'kb-does-not-exist-' + Date.now()));
  silence();
  try {
    await assert.doesNotReject(kl.loadAll());
  } finally { restore(); }
  assert.equal(kl.documents.size, 0);
  assert.equal(kl.loaded, false); // never reached the loaded=true line (early return)
});

test('empty knowledge base (no domains) → loads zero documents without error', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'kb-empty-'));
  const kl = new KnowledgeLoader(base);
  silence();
  try { await kl.loadAll(); } finally { restore(); }
  assert.equal(kl.documents.size, 0);
  assert.equal(kl.loaded, true); // base existed (just empty) → completes normally
});

test('corrupt JSON in one file is skipped; the rest of the domain still loads', async () => {
  const base = makeKB({
    oilahuasca: {
      'good.json': { body: 'Oilahuasca with essential oils and allylbenzene.' },
      'broken.json': '{ this is not valid json ,,, ',   // will throw in JSON.parse → caught per-file
      'also_good.md': '# Fine\n\nA second valid document about transdermal headcone delivery.',
    },
  });
  const kl = new KnowledgeLoader(base);
  silence();
  try { await assert.doesNotReject(kl.loadAll()); } finally { restore(); }
  // broken doc dropped, two good docs survive
  assert.ok(kl.documents.has('oilahuasca/good.json'));
  assert.ok(kl.documents.has('oilahuasca/also_good.md'));
  assert.ok(!kl.documents.has('oilahuasca/broken.json'), 'corrupt file excluded');
  assert.equal(kl.documents.size, 2);
});

test('unsupported file extensions are ignored entirely', async () => {
  const base = makeKB({
    oilahuasca: {
      'note.md': 'Valid markdown about oilahuasca.',
      'image.png': 'not really a png but the extension is unsupported',
      'data.csv': 'a,b,c',
    },
  });
  const kl = new KnowledgeLoader(base);
  silence();
  try { await kl.loadAll(); } finally { restore(); }
  // only the .md was eligible (the loader filters extensions before loadDocument)
  assert.deepEqual([...kl.documents.keys()], ['oilahuasca/note.md']);
});

// ── search: scored, tier-weighted retrieval ───────────────────────────────────────────────────────

test('search returns scored hits ordered by relevance, root tier weighted up', async () => {
  const base = standardKB();
  const kl = new KnowledgeLoader(base);
  silence();
  try { await kl.loadAll(); } finally { restore(); }

  const results = kl.search('oilahuasca essential oils', 10);
  assert.ok(results.length >= 1, 'finds matching documents');
  // every returned hit carries docId/doc/score and a positive score
  for (const r of results) {
    assert.ok(typeof r.docId === 'string');
    assert.ok(r.score > 0);
  }
  // results are sorted by score descending
  for (let i = 1; i < results.length; i++) {
    assert.ok(results[i - 1].score >= results[i].score, 'scores are non-increasing');
  }
  // the oilahuasca (root-tier) document outranks the unrelated crypto doc for this query
  const topDomains = results.map((r) => r.doc.domain);
  assert.equal(topDomains[0], 'oilahuasca');
});

test('search respects maxResults and excludes peripheral docs that do not match', async () => {
  const base = standardKB();
  const kl = new KnowledgeLoader(base);
  silence();
  try { await kl.loadAll(); } finally { restore(); }
  assert.ok(kl.search('oils', 1).length <= 1, 'maxResults caps the result count');

  // Quirk under test (see note below): a no-match query still returns any NON-peripheral doc, because
  // the tier bonus (root=4 … extended=1) is added before the score>0 gate, so only peripheral docs
  // (bonus 0) drop out on a pure no-match. The peripheral cryptocurrency doc must NOT appear.
  const noMatch = kl.search('zzzznomatchquery_unique_string', 10);
  assert.ok(!noMatch.some((r) => r.doc.domain === 'cryptocurrency'), 'peripheral no-match doc excluded');
  for (const r of noMatch) {
    assert.notEqual(r.doc.tier, 'peripheral', 'only tier-bonus (non-peripheral) docs survive a no-match');
  }
});

test('search returns [] when a peripheral-only corpus has no query match', async () => {
  // A corpus made only of peripheral-tier docs (tier bonus 0): a true no-match yields an empty list.
  const base = makeKB({ cryptocurrency: { 'a.md': 'graphene witness', 'b.md': 'block producer' } });
  const kl = new KnowledgeLoader(base);
  silence();
  try { await kl.loadAll(); } finally { restore(); }
  assert.deepEqual(kl.search('zzzznomatchquery_unique_string', 10), []);
});

// ── exported hierarchy/bridge constants are well-formed (loader depends on them) ───────────────────

test('KNOWLEDGE_HIERARCHY tiers and KNOWLEDGE_BRIDGES keywords are coherent', () => {
  assert.deepEqual(KNOWLEDGE_HIERARCHY.root, ['oilahuasca']);
  assert.ok(Array.isArray(KNOWLEDGE_BRIDGES.oilahuasca.bridges));
  assert.ok(KNOWLEDGE_BRIDGES.oilahuasca.keywords.includes('allylbenzene'));
});
