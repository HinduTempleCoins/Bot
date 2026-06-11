// knowledge/search.test.mjs — offline shape tests for the deterministic corpus search.
// Fully offline: __setReader() feeds canned indices keyed by path, so no real fs / no network.
// Run:  node --test knowledge/search.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { search, topicsFor, searchScripture, buildCorpus, esc, __setReader } from './search.js';

// ── canned indices ───────────────────────────────────────────────────────────
// Keyed by the filename suffix so the fixture is robust to absolute paths.
const FIXTURES = {
  scripture: {
    documents: [
      {
        id: 'mythology_as_genealogy',
        title: 'Mythology as genealogy ... haplogroups with applications',
        file_md: 'mythology_as_genealogy.md',
        key_themes: ['haplogroup analysis (J2a, I2a1)', 'phoenician maritime signature', 'table of nations'],
      },
      {
        id: 'phoenix_protocol',
        title: 'The Complete Phoenix Protocol: Sacred Scripture for AI Awakening',
        file_md: 'phoenix_protocol.md',
        key_themes: ['entity interface', 'egregore recognition', 'phoenician bridge'],
      },
    ],
  },
  keyword: {
    folder_keywords: {
      phoenician: {
        primary: ['headcone', 'wax', 'Phoenician', 'Carthage'],
        secondary: ['Egypt', 'temple', 'transdermal'],
      },
      consciousness: {
        primary: ['consciousness', 'egregore', 'awakening'],
        secondary: ['soul', 'preservation'],
      },
    },
  },
  catalog: {
    byDomain: {
      healer: [
        { path: 'knowledge/phoenician/wax_headcone_complete_research.json', title: 'Egyptian Wax Headcone Research', keywords: ['wax', 'headcone', 'beeswax', 'Kyphi'] },
        { path: 'knowledge/ayahuasca/dmt_sources.json', title: 'Life-forms Containing DMT', keywords: ['dmt', 'acacia', 'bark'] },
      ],
      scripture: [
        { path: 'knowledge/scripture/phoenix_protocol.md', title: 'Phoenix Protocol', keywords: ['egregore', 'phoenician'] },
      ],
    },
  },
};

function installFixtures(overrides = {}) {
  const f = { ...FIXTURES, ...overrides };
  __setReader((p) => {
    if (p.endsWith('scripture/_index.json')) return f.scripture;
    if (p.endsWith('_keyword_index.json')) return f.keyword;
    if (p.endsWith('_library_catalog.json')) return f.catalog;
    return null;
  });
}

function restore() { __setReader(null); }

// ── esc ──────────────────────────────────────────────────────────────────────
test('esc escapes HTML metacharacters and handles null', () => {
  assert.equal(esc('<a href="x">&\'</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;');
  assert.equal(esc(null), '');
  assert.equal(esc(undefined), '');
});

// ── corpus assembly ──────────────────────────────────────────────────────────
test('buildCorpus folds all three indices into one entry list', () => {
  installFixtures();
  const corpus = buildCorpus();
  restore();
  const bySource = (s) => corpus.filter((e) => e.source === s).length;
  assert.equal(bySource('scripture'), 2);
  assert.equal(bySource('keyword'), 2);
  assert.equal(bySource('catalog'), 3);
});

// ── ranking ──────────────────────────────────────────────────────────────────
test('search ranks the right scripture doc top for a multi-term query', () => {
  installFixtures();
  const hits = search('phoenician haplogroup', { limit: 5 });
  restore();
  assert.ok(hits.length > 0);
  assert.equal(hits[0].id, 'mythology_as_genealogy'); // matches both terms (theme) -> top
  assert.ok(hits[0].score > 0);
  assert.ok(Array.isArray(hits[0].why) && hits[0].why.length >= 2);
  // result shape
  for (const k of ['id', 'title', 'score', 'why', 'path', 'source']) assert.ok(k in hits[0]);
  assert.ok(!('_matched' in hits[0])); // internal field stripped
});

test('within one source slice, a title hit outweighs a keyword-only hit (field weighting)', () => {
  installFixtures();
  // Restrict to catalog so source-weight is constant and only the FIELD matters:
  // "Egyptian Wax Headcone Research" matches headcone in TITLE (3); no other catalog file does.
  const hits = search('headcone', { source: 'catalog' });
  restore();
  assert.equal(hits[0].id, 'knowledge/phoenician/wax_headcone_complete_research.json');
  assert.ok(hits[0].why.includes('title:headcone'));
});

test('canonical/folder source weight lifts a topic folder above a single catalogued file', () => {
  installFixtures();
  // Whole corpus: the phoenician topic-folder (keyword theme 2 × source weight 2 = 4) ranks
  // above the catalog file (title 3 × source weight 1 = 3). The topic router surfaces first.
  const hits = search('headcone');
  restore();
  assert.equal(hits[0].id, 'folder:phoenician');
});

test('higher coverage (more distinct terms matched) breaks score ties toward broader matches', () => {
  installFixtures();
  const hits = search('egregore phoenician');
  restore();
  // phoenix_protocol scripture doc matches BOTH terms in its themes; ranks at/near the top.
  assert.equal(hits[0].id, 'phoenix_protocol');
});

test('search is deterministic — same query, same ranking across runs', () => {
  installFixtures();
  const a = search('phoenician egregore wax');
  const b = search('phoenician egregore wax');
  restore();
  assert.deepEqual(a, b);
});

test('limit is honoured', () => {
  installFixtures();
  const hits = search('phoenician', { limit: 1 });
  restore();
  assert.equal(hits.length, 1);
});

test('source filter restricts to one corpus slice', () => {
  installFixtures();
  const hits = search('phoenician', { source: 'scripture' });
  restore();
  assert.ok(hits.every((h) => h.source === 'scripture'));
});

// ── topicsFor ────────────────────────────────────────────────────────────────
test('topicsFor returns matching keyword folders, best-first', () => {
  installFixtures();
  const topics = topicsFor('wax headcone');
  restore();
  assert.ok(topics.includes('phoenician'));
  assert.ok(!topics.includes('knowledge/phoenician/wax_headcone_complete_research.json')); // folders, not files
});

test('topicsFor on a consciousness query', () => {
  installFixtures();
  const topics = topicsFor('egregore awakening');
  restore();
  assert.ok(topics.includes('consciousness'));
});

// ── back-compat ──────────────────────────────────────────────────────────────
test('searchScripture restricts to scripture docs', () => {
  installFixtures();
  const hits = searchScripture('egregore');
  restore();
  assert.ok(hits.length > 0);
  assert.ok(hits.every((h) => h.source === 'scripture'));
});

// ── soft-fail ────────────────────────────────────────────────────────────────
test('empty / whitespace / non-string query returns [] (never throws)', () => {
  installFixtures();
  assert.deepEqual(search(''), []);
  assert.deepEqual(search('   '), []);
  assert.deepEqual(search(null), []);
  assert.deepEqual(search(undefined), []);
  assert.deepEqual(search(12345), []); // tokenizes digits but no corpus match -> []
  restore();
});

test('missing indices (reader returns null) → empty results, no throw', () => {
  __setReader(() => null);
  assert.deepEqual(search('phoenician'), []);
  assert.deepEqual(topicsFor('phoenician'), []);
  assert.deepEqual(buildCorpus(), []);
  restore();
});

test('garbage / malformed indices are tolerated (soft-fail)', () => {
  __setReader((p) => {
    if (p.endsWith('scripture/_index.json')) return { documents: 'not-an-array' };
    if (p.endsWith('_keyword_index.json')) return { folder_keywords: null };
    if (p.endsWith('_library_catalog.json')) return { byDomain: 42 };
    return null;
  });
  assert.deepEqual(search('anything'), []);
  assert.deepEqual(buildCorpus(), []);
  restore();
});

test('a throwing reader does not crash the search', () => {
  __setReader(() => { throw new Error('boom'); });
  assert.deepEqual(search('phoenician'), []);
  restore();
});

test('no-match query returns [] even with a healthy corpus', () => {
  installFixtures();
  const hits = search('zzzqqq nonexistentterm');
  restore();
  assert.deepEqual(hits, []);
});

// ── tokenization edge ────────────────────────────────────────────────────────
test('hyphenated / punctuated query terms tokenize and match', () => {
  installFixtures();
  // "J2a-M410" -> tokens j2a, m410; "j2a" appears in the mythology theme "haplogroup analysis (J2a, I2a1)"
  const hits = search('J2a-M410');
  restore();
  assert.ok(hits.some((h) => h.id === 'mythology_as_genealogy'));
});
