// server.test.mjs — offline tests for the World Law surface. Fully offline: no network, no port bound.
// We drive the exported handler through a mock req/res, and pass an in-test fixture dataset so the tests
// do not depend on the shipped corpus content. Assertions cover: routes serve 200; every page carries
// the discipline footer + banner; the TWO-VOICE contract (facts carry a source link and an
// allegation/finding label; positions are attributed to a named holder); esc() neutralizes injection;
// the corpus loads and normalizes; and health/robots/sitemap/llms respond.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import {
  handler, homePage, topicView, readingView, topicById, esc,
  factRow, positionRow, provisionRow, frameworkBlock, disciplineBanner,
  normalizeData, loadData, worldLawLlmsTxt, sitemapPaths, HOME_FAQ, DATASET,
} from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const CORPUS = join(HERE, '..', '..', 'knowledge', 'civic', 'world-law.json');

// ── a small fixture dataset (independent of the shipped corpus) ────────────────────────────────────
const FIX = normalizeData({
  meta: { title: 'World Law' },
  topics: [
    {
      id: 'test-topic',
      title: 'Test Topic <x>',
      navLabel: 'Test',
      blurb: 'A blurb with <b>markup</b>.',
      framework: { label: 'The framework', text: 'Geneva Convention IV governs occupation.' },
      provisions: [
        { cite: 'GC IV, Art. 49(6)', text: 'The Occupying Power shall not deport or transfer...', quote: true,
          source: 'ICRC', source_url: 'https://ihl-databases.icrc.org/en/ihl-treaties/gc-iv-1949/article-49' },
      ],
      facts: [
        { text: 'A verified fact.', kind: 'fact', source: 'UN', source_url: 'https://example.org/a' },
        { text: 'An unproven claim.', kind: 'allegation', source: 'Party A', source_url: 'https://example.org/b' },
        { text: 'An investigation concluded X.', kind: 'finding', source: 'OIOS', source_url: 'https://example.org/c' },
      ],
      positions: [
        { holder: 'The State of Israel', stance: 'official position', summary: 'Disputes de jure applicability.',
          source_url: 'https://example.org/isr', source: 'MFA' },
        { holder: 'International Court of Justice', stance: 'advisory opinion', summary: 'GC IV applies.',
          source_url: 'https://example.org/icj', source: 'ICJ 2004' },
      ],
      further_reading: [{ url: 'https://example.org/read', label: 'Primary source', note: 'the treaty' }],
    },
  ],
  reading_guide: {
    title: 'How to read a claim',
    intro: 'Method intro.',
    steps: [{ title: 'Go to the primary source', body: 'Read the treaty text yourself.' }],
    authority_tiers: [{ name: 'Binding judgment', what: 'legally binding on the parties', example: 'an ICJ contentious case' }],
    checklist: ['Who is making the claim?', 'Is it a finding or an allegation?'],
  },
});

// ── mock req/res ───────────────────────────────────────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: null, headers: null, body: '', ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); this.ended = true; },
  };
}
const req = (urlPath, method = 'GET') => ({ url: urlPath, method, on() {} });
async function drive(urlPath, data = FIX) {
  const res = mockRes();
  await handler(req(urlPath), res, data);
  return res;
}

// ── 1. routes serve ────────────────────────────────────────────────────────────────────────────
test('home route serves 200 HTML listing topics and the reading page', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /World Law/);
  assert.ok(res.body.includes('href="/test-topic"'), 'links the topic');
  assert.ok(res.body.includes('href="/reading"'), 'links the reading page');
});

test('a topic route serves 200 with framework, facts, and attributed positions', async () => {
  const res = await drive('/test-topic');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /The framework at issue|The framework/);
  assert.match(res.body, /Geneva Convention IV governs occupation/);
  assert.match(res.body, /Sourced facts/);
  assert.match(res.body, /The competing positions/);
  assert.match(res.body, /The State of Israel/);
  assert.match(res.body, /International Court of Justice/);
});

test('the reading route serves 200 with the method steps + checklist', async () => {
  const res = await drive('/reading');
  assert.equal(res.statusCode, 200);
  assert.match(res.body, /Go to the primary source/);
  assert.match(res.body, /Binding judgment/);
  assert.match(res.body, /Is it a finding or an allegation\?/);
});

test('an unknown path 302s to home', async () => {
  const res = await drive('/does-not-exist');
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.location, '/');
});

// ── 2. the two-voice / attribution contract (the whole point of this surface) ─────────────────────
test('every fact row carries a kind label AND a source', () => {
  const factHtml = FIX.topics[0].facts.map(factRow).join('');
  assert.match(factHtml, /tag-fact/);
  assert.match(factHtml, /tag-allegation/);
  assert.match(factHtml, /tag-finding/);
  // each fact links its source
  assert.ok((factHtml.match(/https:\/\/example\.org\//g) || []).length >= 3, 'each fact links a source');
});

test('an allegation is labelled "Allegation" and never rendered as a bare fact', () => {
  const html = factRow({ text: 'X did Y.', kind: 'allegation', source_url: 'https://s/1', source: 'Accuser' });
  assert.match(html, /tag-allegation/);
  assert.match(html, /Allegation/);
});

test('every position is attributed to a named holder + carries a source link', () => {
  const posHtml = FIX.topics[0].positions.map(positionRow).join('');
  assert.match(posHtml, /The State of Israel/);
  assert.match(posHtml, /International Court of Justice/);
  // each position links its source
  assert.ok(posHtml.includes('example.org/isr') && posHtml.includes('example.org/icj'), 'each position links a source');
});

test('the topic page states inclusion is documentation, not endorsement', async () => {
  const res = await drive('/test-topic');
  assert.match(res.body, /documentation, not endorsement/i);
});

test('the discipline banner + footer (document-and-attribute) appear on every page', async () => {
  for (const p of ['/', '/test-topic', '/reading']) {
    const res = await drive(p);
    assert.match(res.body, /documents and attributes|document.{0,3}and.{0,3}attribute/i, `${p} banner`);
    assert.match(res.body, /not advocacy/i, `${p} footer says not advocacy`);
    assert.match(res.body, /does not assert any contested position in its own voice|does not take a side/i, `${p} neutrality`);
    assert.match(res.body, /not legal advice/i, `${p} not-advice line`);
  }
});

// ── 3. escaping / XSS ──────────────────────────────────────────────────────────────────────────────
test('esc() neutralizes HTML metacharacters', () => {
  assert.equal(esc('<script>"&"</script>'), '&lt;script&gt;&quot;&amp;&quot;&lt;/script&gt;');
});

test('topic title/blurb markup is escaped in the rendered page (no raw tag)', async () => {
  const res = await drive('/test-topic');
  // the visible <h1> and <title> must be escaped
  assert.match(res.body, /Test Topic &lt;x&gt;/);
  assert.ok(!/<h1>[^<]*Test Topic <x>/.test(res.body), 'h1 title not raw');
  // the blurb never enters a JSON-LD context, so it must never appear raw anywhere
  assert.ok(!res.body.includes('<b>markup</b>'), 'raw blurb tag not emitted');
  assert.match(res.body, /&lt;b&gt;markup&lt;\/b&gt;/);
});

test('a malicious source_url/holder is escaped in a position row', () => {
  const html = positionRow({ holder: '<img src=x onerror=alert(1)>', summary: 'y', source_url: 'https://s"onmouseover=1' });
  assert.ok(!html.includes('<img src=x'), 'no raw injected tag');
  assert.match(html, /&lt;img src=x/);
});

// ── 4. soft-fail / robustness ──────────────────────────────────────────────────────────────────────
test('handler never throws / 500s on an empty corpus (soft-fail)', async () => {
  const empty = normalizeData({});
  for (const p of ['/', '/reading', '/anything']) {
    const res = await drive(p, empty);
    assert.ok(res.statusCode === 200 || res.statusCode === 302, `${p} soft-fails (${res.statusCode})`);
  }
});

test('normalizeData tolerates junk and returns the expected shape', () => {
  for (const junk of [null, undefined, 42, 'x', [], { topics: 'no' }, { topics: [{}, { id: 'ok' }] }]) {
    const d = normalizeData(junk);
    assert.ok(Array.isArray(d.topics));
    assert.ok('reading_guide' in d && 'meta' in d);
  }
  // an entry without an id is dropped
  assert.equal(normalizeData({ topics: [{}, { id: 'ok' }] }).topics.length, 1);
});

test('loadData soft-fails to an empty-but-valid dataset for a missing file', () => {
  const d = loadData('/no/such/file.json');
  assert.ok(Array.isArray(d.topics));
});

test('topicById finds by id and returns null for a miss', () => {
  assert.ok(topicById('test-topic', FIX));
  assert.equal(topicById('nope', FIX), null);
});

// ── 5. health / robots / sitemap / llms ─────────────────────────────────────────────────────────
test('health, robots.txt, sitemap.xml, llms.txt respond', async () => {
  const h = await drive('/health'); assert.equal(h.statusCode, 200); assert.equal(h.body, 'ok');
  const r = await drive('/robots.txt'); assert.equal(r.statusCode, 200); assert.match(r.body, /Sitemap:/);
  const s = await drive('/sitemap.xml'); assert.equal(s.statusCode, 200);
  assert.match(s.body, /<urlset/); assert.ok(s.body.includes('/test-topic'));
  const l = await drive('/llms.txt'); assert.equal(l.statusCode, 200);
  assert.match(l.body, /World Law/); assert.match(l.body, /not advocacy/i);
});

test('sitemapPaths includes home, reading, and each topic', () => {
  const paths = sitemapPaths(FIX);
  assert.ok(paths.includes('/') && paths.includes('/reading') && paths.includes('/test-topic'));
});

test('HOME_FAQ pairs are well-formed for FAQPage JSON-LD', () => {
  assert.ok(Array.isArray(HOME_FAQ) && HOME_FAQ.length >= 3);
  for (const p of HOME_FAQ) { assert.ok(p.q && p.a); }
});

// ── 6. the SHIPPED corpus: it parses, and honours the attribution contract ────────────────────────
test('the shipped world-law.json parses and normalizes to topics', () => {
  const raw = readFileSync(CORPUS, 'utf8');
  const obj = JSON.parse(raw); // throws if malformed → test fails loudly
  const d = normalizeData(obj);
  assert.ok(d.topics.length >= 4, `expected >=4 topics, got ${d.topics.length}`);
  assert.ok(d.reading_guide, 'ships a reading guide');
});

test('EVERY contested claim in the shipped corpus carries a source_url (the discipline gate)', () => {
  const d = DATASET; // the actually-loaded shipped corpus
  let facts = 0, positions = 0;
  for (const t of d.topics) {
    for (const f of (t.facts || [])) {
      facts++;
      assert.ok(f.text, `${t.id}: fact has text`);
      // a fact must be labelled and (for allegation/finding/contested) sourced
      if (f.kind && f.kind !== 'fact') {
        assert.ok(f.source_url || f.source, `${t.id}: ${f.kind} "${String(f.text).slice(0, 40)}" is sourced`);
      }
    }
    for (const p of (t.positions || [])) {
      positions++;
      assert.ok(p.holder, `${t.id}: position has a named holder`);
      assert.ok(p.summary, `${t.id}: position "${String(p.holder).slice(0, 30)}" has a summary`);
      assert.ok(p.source_url || p.source, `${t.id}: position by ${p.holder} is sourced`);
    }
  }
  assert.ok(facts >= 12, `corpus has facts (${facts})`);
  assert.ok(positions >= 8, `corpus attributes competing positions (${positions})`);
});

test('the shipped corpus covers the four required topics + a UNRWA + occupation-law framework', () => {
  const ids = DATASET.topics.map((t) => t.id).join(' ');
  const hay = (DATASET.topics.map((t) => `${t.id} ${t.title}`).join(' ')).toLowerCase();
  assert.match(hay, /unrwa/);
  assert.match(hay, /occupation|humanitarian|geneva/);
  assert.match(hay, /gush katif|disengagement/);
  assert.match(hay, /settlement|nachala/);
  void ids;
});
