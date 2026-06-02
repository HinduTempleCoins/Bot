// Tests for the incremental updater (#85): manifest hashing, change detection, article mapping.
// Pure-logic only — no LLM / no network. Run: node --test src/incrementalUpdate.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildManifest, changedDocs, affectedArticles } from './incrementalUpdate.js';

// Minimal stand-in for KnowledgeLoader: just the shapes the functions read.
function fakeLoader(docs) {
  const documents = new Map();
  const domainDocuments = new Map();
  for (const [docId, { content, domain }] of Object.entries(docs)) {
    documents.set(docId, { content, domain });
    if (!domainDocuments.has(domain)) domainDocuments.set(domain, []);
    domainDocuments.get(domain).push(docId);
  }
  return { documents, domainDocuments };
}

test('buildManifest hashes content per doc; identical content → identical hash', () => {
  const a = buildManifest(fakeLoader({ 'd/a.md': { content: 'hello', domain: 'd' } }));
  const b = buildManifest(fakeLoader({ 'd/a.md': { content: 'hello', domain: 'd' } }));
  assert.equal(a.files['d/a.md'], b.files['d/a.md']);
  assert.match(a.files['d/a.md'], /^[a-f0-9]{64}$/);
});

test('changedDocs detects new and changed docs, ignores unchanged', () => {
  const prev = { files: { 'd/a.md': 'h1', 'd/b.md': 'h2' } };
  const cur = { files: { 'd/a.md': 'h1', 'd/b.md': 'CHANGED', 'd/c.md': 'h3' } };
  const changed = changedDocs(prev, cur).sort();
  assert.deepEqual(changed, ['d/b.md', 'd/c.md']);
});

test('first run (empty prev) marks every doc changed', () => {
  const cur = buildManifest(fakeLoader({ 'd/a.md': { content: 'x', domain: 'd' }, 'd/b.md': { content: 'y', domain: 'd' } }));
  const changed = changedDocs({ files: {} }, cur);
  assert.equal(changed.length, 2);
});

test('affectedArticles maps a changed doc to articles whose domain+searchTerm match', () => {
  const loader = fakeLoader({
    'cryptocurrency/witness.md': { content: 'A witness produces blocks on the chain.', domain: 'cryptocurrency' },
    'chem/oils.md': { content: 'essential oils and shulgin.', domain: 'chem' },
  });
  const articles = [
    { title: 'Witness', searchTerms: ['witness', 'block producer'], primaryDomains: ['cryptocurrency'], crossReferenceDomains: [] },
    { title: 'Oils', searchTerms: ['shulgin'], primaryDomains: ['chem'], crossReferenceDomains: [] },
  ];
  // Only the witness doc changed → only the Witness article is affected.
  const aff = affectedArticles(['cryptocurrency/witness.md'], loader, articles);
  assert.deepEqual(aff.map((a) => a.title), ['Witness']);
});

test('affectedArticles requires a searchTerm hit, not just a domain match', () => {
  const loader = fakeLoader({
    'cryptocurrency/unrelated.md': { content: 'this document is about gardening.', domain: 'cryptocurrency' },
  });
  const articles = [
    { title: 'Witness', searchTerms: ['witness'], primaryDomains: ['cryptocurrency'], crossReferenceDomains: [] },
  ];
  // Doc changed and is in the right domain, but no search term appears → NOT affected.
  assert.deepEqual(affectedArticles(['cryptocurrency/unrelated.md'], loader, articles), []);
});
