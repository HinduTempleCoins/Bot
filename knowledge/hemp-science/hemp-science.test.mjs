// hemp-science.test.mjs — structural tests for the Hemp & Cannabinoid Science registry.
//
// Fully offline: the section is frozen data already in memory, so there is nothing to mock and no
// network to inject. These tests enforce the invariants the renderer relies on, so that a broken
// shelf fails here rather than on a live page:
//
//   - every shelf and page is addressable, with unique ids and slugs
//   - every citation key a section references resolves in that shelf's own bibliography
//   - every contested section carries its caveat (a caveat a reader must hunt for is not a caveat)
//   - no record claims an identifier and `verified: false` at the same time
//   - every seeAlso cross-link resolves to a page that exists
//   - paths() and the CYP matrix agree with the data they are derived from
//   - build() writes to a temp dir, never into the repo
//
// House style: node --test, no network, no side effects, no writes outside os.tmpdir().

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import * as sci from './index.mjs';

test('SECTION carries the framing the pages render', () => {
  assert.equal(sci.SECTION.id, 'hemp-science');
  for (const k of ['title', 'blurb', 'posture', 'boundary']) {
    assert.ok(String(sci.SECTION[k] || '').length > 20, `SECTION.${k} is missing or too short`);
  }
  // The boundary sentence is the section's defining editorial choice. It must name what IS taught.
  assert.match(sci.SECTION.boundary, /purification|separation/i);
});

test('every shelf is addressable and non-empty', () => {
  assert.ok(sci.SHELVES.length >= 11, `expected at least 11 shelves, got ${sci.SHELVES.length}`);
  const ids = new Set();
  for (const s of sci.SHELVES) {
    assert.ok(s.id, 'a shelf has no id');
    assert.equal(ids.has(s.id), false, `duplicate shelf id ${s.id}`);
    ids.add(s.id);
    assert.ok(String(s.title || '').length > 3, `${s.id}: no title`);
    assert.ok(String(s.blurb || '').length > 20, `${s.id}: no blurb`);
    assert.match(String(s.updated || ''), /^\d{4}-\d{2}-\d{2}$/, `${s.id}: updated is not an ISO date`);
    assert.ok(s.pages.length >= 1, `${s.id}: no pages`);
    assert.ok(Object.keys(s.cites).length >= 1, `${s.id}: no bibliography`);
    assert.equal(sci.shelf(s.id), s);
  }
  // Case and whitespace insensitive lookup, and a miss is null rather than a throw.
  assert.ok(sci.shelf(' CYP450 '));
  assert.equal(sci.shelf('no-such-shelf'), null);
  assert.equal(sci.shelf(null), null);
  assert.equal(sci.shelf(undefined), null);
});

test('the shelves the operator named as priority content are registered', () => {
  // formulation and safety carry the dose arithmetic, homogeneity, the K2 supply-chain analysis and
  // the toxidrome material. They are the shelves most likely to be dropped by a registry mistake,
  // so they are asserted by name rather than by count.
  for (const id of ['formulation', 'safety', 'cyp450', 'terpenes']) {
    const s = sci.shelf(id);
    assert.ok(s, `${id} is not registered in index.mjs`);
    assert.ok(s.pages.length >= 1, `${id} registered but has no pages`);
  }
});

test('every page is addressable, with a unique slug inside its shelf', () => {
  for (const s of sci.SHELVES) {
    const slugs = new Set();
    for (const p of s.pages) {
      assert.match(String(p.slug || ''), /^[a-z0-9][a-z0-9-]*$/, `${s.id}: bad slug ${JSON.stringify(p.slug)}`);
      assert.equal(slugs.has(p.slug), false, `${s.id}: duplicate slug ${p.slug}`);
      slugs.add(p.slug);
      assert.ok(String(p.title || '').length > 3, `${s.id}/${p.slug}: no title`);
      assert.ok(String(p.summary || '').length > 20, `${s.id}/${p.slug}: no summary`);
      assert.ok(Array.isArray(p.sections) && p.sections.length >= 1, `${s.id}/${p.slug}: no sections`);
      const got = sci.page(s.id, p.slug);
      assert.ok(got, `${s.id}/${p.slug}: page() could not resolve it`);
      assert.equal(got.shelfId, s.id);
      assert.equal(got.shelfTitle, s.title);
    }
  }
  assert.equal(sci.page('cyp450', 'no-such-page'), null);
  assert.equal(sci.page('no-such-shelf', 'overview'), null);
  assert.equal(sci.page(null, null), null);
});

test('every section has a heading and some substance', () => {
  // A section carries prose, OR a table, OR a bullet list — a table-only section ("The matrix",
  // "The checklist") is a deliberate shape, not a defect, so the assertion is on substance rather
  // than specifically on `body`.
  let n = 0; let tableOnly = 0;
  for (const p of sci.allPages()) {
    for (const sec of p.sections) {
      n += 1;
      assert.ok(String(sec.h || '').length > 3, `${p.shelfId}/${p.slug}: a section has no heading`);
      const prose = String(sec.body || '').length;
      const rows = (sec.table && Array.isArray(sec.table.rows)) ? sec.table.rows.length : 0;
      const bullets = Array.isArray(sec.bullets) ? sec.bullets.length : 0;
      assert.ok(prose > 40 || rows >= 2 || bullets >= 2,
        `${p.shelfId}/${p.slug} · ${sec.h}: no prose, no table and no bullets`);
      if (prose === 0) tableOnly += 1;
    }
  }
  assert.ok(n >= 100, `expected a substantial corpus, got ${n} sections`);
  // Prose is the norm; a table-only section is the exception. If that ever inverts, the shelf has
  // become a spreadsheet and the assertion should be looked at rather than raised.
  assert.ok(tableOnly / n < 0.1, `${tableOnly} of ${n} sections are table-only — too many`);
});

test('every citation key a section references resolves in its own shelf bibliography', () => {
  const missing = [];
  for (const p of sci.allPages()) {
    const keys = [...(p.cites || [])];
    for (const sec of p.sections) for (const k of sec.cites || []) keys.push(k);
    for (const k of keys) if (!sci.cite(p.shelfId, k)) missing.push(`${p.shelfId}/${p.slug} → ${k}`);
  }
  assert.deepEqual(missing, [], `unresolved citation keys:\n${missing.join('\n')}`);
});

test('a contested section always carries its caveat', () => {
  const bad = [];
  for (const p of sci.allPages()) {
    for (const sec of p.sections) {
      if (sec.contested && !String(sec.caveat || '').trim()) bad.push(`${p.shelfId}/${p.slug} · ${sec.h}`);
    }
  }
  assert.deepEqual(bad, [], `contested sections with no caveat:\n${bad.join('\n')}`);
});

test('a citation record is never in two minds about its own identifier', () => {
  // The honest states are: (a) an identifier plus the source it was resolved against, or (b) no
  // identifier and verified:false. A record holding a DOI while claiming to be unverified is a
  // defect either way round.
  //
  // `verified` is a KIND, not a boolean. 'crossref' and 'pubmed' are bibliographic resolutions and
  // must carry the identifier they resolved to. 'statute', 'case', 'cfr', 'standard' and 'patent'
  // are the non-bibliographic kinds: 21 U.S.C. § 802 has no DOI and USP <467> has no DOI, and
  // demanding one would push an author toward inventing one — which is the exact failure this whole
  // discipline exists to prevent. Those kinds are verified by citation form, not by identifier.
  // 'url' is the kind for a live reference work (the FDA interaction table, the Flockhart table,
  // CredibleMeds, a CRS report, an agency notice): the URL IS the identifier, and it is checked by
  // the same rule below because citeUrl() falls through to it.
  const NEEDS_ID = new Set(['crossref', 'pubmed', 'doi']);
  const KINDS = new Set([...NEEDS_ID, 'url', 'statute', 'case', 'cfr', 'standard', 'patent', 'agency', 'book', 'dataset']);
  const bad = [];
  for (const c of sci.allCites()) {
    if (c.verified === false && (c.doi || c.pmid)) bad.push(`${c.shelfId}/${c.key} — holds an identifier but says verified:false`);
    if (c.verified !== false && !KINDS.has(c.verified)) bad.push(`${c.shelfId}/${c.key} — unknown verification kind ${JSON.stringify(c.verified)}`);
    if (NEEDS_ID.has(c.verified) && !(c.doi || c.pmid || c.url)) bad.push(`${c.shelfId}/${c.key} — verified:${c.verified} but holds no identifier`);
    assert.ok(String(c.authors || '').length > 2, `${c.shelfId}/${c.key}: no authors`);
    assert.ok(String(c.title || '').length > 5, `${c.shelfId}/${c.key}: no title`);
  }
  assert.deepEqual(bad, [], bad.join('\n'));
});

test('citeText marks an unverified record and citeUrl prefers the DOI', () => {
  assert.match(sci.citeText({ authors: 'A B', year: 2020, title: 'T', journal: 'J', verified: false }), /\[identifier unverified\]$/);
  assert.doesNotMatch(sci.citeText({ authors: 'A B', year: 2020, title: 'T', journal: 'J', doi: '10.1/x', verified: 'crossref' }), /unverified/);
  assert.equal(sci.citeUrl({ doi: '10.1/x', pmid: '9', url: 'https://e' }), 'https://doi.org/10.1/x');
  assert.equal(sci.citeUrl({ pmid: '9' }), 'https://pubmed.ncbi.nlm.nih.gov/9/');
  assert.equal(sci.citeUrl(null), '');
  assert.equal(sci.citeText(null), '');
});

// PENDING — cross-reference targets the corpus points at that are not written yet: the whole
// `equipment` shelf, and the six botanical monographs named in botanicals.mjs's header but not
// authored. These are FORWARD references, recorded here so that a genuinely NEW dead link fails the
// suite instead of hiding among them. The renderer drops any unresolvable See-also silently, so no
// live page shows a dead link either way — this test is about the data, not the page.
const PENDING_TARGETS = new Set([
  'equipment/overview', 'equipment/vacuum', 'equipment/thermal', 'equipment/glassware',
  'equipment/analytical', 'equipment/scales', 'equipment/safety-and-fire',
  'botanicals/kava', 'botanicals/black-pepper', 'botanicals/hops', 'botanicals/maca',
  'botanicals/echinacea', 'botanicals/acmella',
]);

test('every seeAlso cross-link is well formed, and resolves unless it is a recorded forward reference', () => {
  const broken = [];
  const pending = [];
  for (const p of sci.allPages()) {
    for (const ref of p.seeAlso || []) {
      const parts = String(ref).split('/');
      if (parts.length !== 2 || !parts[0] || !parts[1]) { broken.push(`${p.shelfId}/${p.slug} → ${ref} (not shelf/page)`); continue; }
      if (sci.page(parts[0], parts[1])) continue;
      if (PENDING_TARGETS.has(ref)) { pending.push(`${p.shelfId}/${p.slug} → ${ref}`); continue; }
      broken.push(`${p.shelfId}/${p.slug} → ${ref}`);
    }
  }
  assert.deepEqual(broken, [], `seeAlso links that point at nothing and are not recorded as pending:\n${broken.join('\n')}`);
  // Sanity: PENDING_TARGETS must not rot into a list of things that now exist.
  const stale = [...PENDING_TARGETS].filter((t) => { const [a, b] = t.split('/'); return !!sci.page(a, b); });
  assert.deepEqual(stale, [], `these targets now exist and should be removed from PENDING_TARGETS:\n${stale.join('\n')}`);
  assert.ok(pending.length > 0, 'PENDING_TARGETS is no longer needed — delete it and make this test strict');
});

test('the renderer never emits a dead See-also link', async () => {
  const { pageView } = await import('../../integrations/hemp-science.mjs');
  for (const p of sci.allPages()) {
    const html = pageView(p.shelfId, p.slug);
    for (const m of html.matchAll(/href="\/science\/([a-z0-9-]+)\/([a-z0-9-]+)"/g)) {
      assert.ok(sci.page(m[1], m[2]), `${p.shelfId}/${p.slug} rendered a dead link to /science/${m[1]}/${m[2]}`);
    }
  }
});

test('paths() covers every page exactly once, plus the tools', () => {
  const ps = sci.paths();
  assert.equal(new Set(ps).size, ps.length, 'paths() has duplicates');
  for (const t of ['/science', '/science/check', '/science/matrix.json']) assert.ok(ps.includes(t), `paths() is missing ${t}`);
  for (const s of sci.SHELVES) {
    assert.ok(ps.includes(`/science/${s.id}`), `paths() is missing the ${s.id} shelf`);
    for (const p of s.pages) assert.ok(ps.includes(`/science/${s.id}/${p.slug}`), `paths() is missing /science/${s.id}/${p.slug}`);
  }
});

test('search is deterministic, finds real terms, and never throws', () => {
  assert.deepEqual(sci.search(''), []);
  assert.deepEqual(sci.search(null), []);
  assert.deepEqual(sci.search('the and for'), [], 'stopwords alone must not match');
  assert.deepEqual(sci.search('zzqqxx-not-a-word-anywhere'), []);
  const a = sci.search('cytochrome');
  const b = sci.search('cytochrome');
  assert.deepEqual(a.map((x) => x.slug), b.map((x) => x.slug), 'search is not deterministic');
  assert.ok(a.length >= 1, 'no page matched "cytochrome"');
  for (const hit of a) {
    assert.ok(sci.page(hit.shelfId, hit.slug), `search returned an unresolvable hit ${hit.shelfId}/${hit.slug}`);
    assert.ok(hit.score > 0);
  }
  assert.ok(sci.search('cytochrome', { limit: 2 }).length <= 2);
});

test('pageText flattens prose, bullets and tables', () => {
  const p = sci.allPages()[0];
  const t = sci.pageText(p);
  assert.ok(t.includes(p.title));
  assert.ok(t.length > 200);
  assert.equal(sci.pageText(null), '');
});

test('the CYP matrix is derived from the shelf and says absence is not safety', () => {
  const m = sci.matrix();
  assert.equal(m.schema, 'melek-hemp-science/cyp-interaction-matrix/1');
  assert.equal(m.absenceIsNotSafety, true);
  assert.ok(String(m.statement || '').length > 80, 'the matrix must carry its own caveat in the payload');
  assert.ok(m.enzymes.length >= 5, `expected the major CYP isoforms, got ${m.enzymes.length}`);
  for (const k of ['strong', 'moderate', 'weak']) assert.ok(m.potencyDefinitions[k], `no definition for a ${k} inhibitor`);
  for (const e of m.enzymes) {
    assert.ok(e.id && e.name, 'an enzyme row has no id or name');
    assert.match(e.page, /^\/science\/cyp450\//);
    const slug = e.page.split('/').pop();
    assert.ok(sci.page('cyp450', slug), `matrix points at /science/cyp450/${slug}, which does not exist`);
    for (const group of ['substrates', 'inhibitors', 'inducers']) assert.ok(Array.isArray(e[group]), `${e.id}.${group} is not an array`);
    for (const x of e.inhibitors) {
      assert.ok(x.name, `${e.id}: an inhibitor has no name`);
      assert.equal(x.role, 'inhibits');
      assert.ok(['strong', 'moderate', 'weak', 'variable', 'unclear'].includes(x.potency), `${e.id}/${x.name}: bad potency ${x.potency}`);
    }
    for (const x of e.inducers) assert.equal(x.role, 'induces');
  }
  // JSON-serialisable, because it is served as JSON.
  assert.ok(JSON.parse(JSON.stringify(m)).enzymes.length === m.enzymes.length);
});

test('shelfJson puts the prose in the values, for the recall path', () => {
  for (const s of sci.SHELVES) {
    const j = sci.shelfJson(s.id);
    assert.ok(j, `${s.id}: shelfJson returned null`);
    assert.equal(j.shelf, s.id);
    assert.ok(j.title.includes(s.title));
    assert.ok(j.posture.length > 20, 'the posture must travel with the JSON, not only the page');
    const slugs = Object.keys(j.pages);
    assert.equal(slugs.length, s.pages.length, `${s.id}: page count mismatch in the JSON copy`);
    for (const sl of slugs) {
      const pj = j.pages[sl];
      assert.ok(pj.text.length > 100, `${s.id}/${sl}: the JSON copy has no prose — corpus-rag would score it empty`);
      assert.equal(pj.path, `/science/${s.id}/${sl}`);
      assert.ok(pj.title);
    }
  }
  assert.equal(sci.shelfJson('no-such-shelf'), null);
});

test('build writes the JSON shelves and the matrix — into a temp dir, never the repo', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hemp-science-build-'));
  try {
    const files = sci.build({ dir });
    assert.equal(files.length, sci.SHELVES.length + 1, 'expected one JSON per shelf plus the matrix');
    for (const s of sci.SHELVES) {
      const f = join(dir, `${s.id}.json`);
      assert.ok(files.includes(f), `build did not write ${s.id}.json`);
      const parsed = JSON.parse(readFileSync(f, 'utf8'));
      assert.equal(parsed.shelf, s.id);
    }
    const m = JSON.parse(readFileSync(join(dir, 'cyp_interaction_matrix.json'), 'utf8'));
    assert.equal(m.absenceIsNotSafety, true);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('stats reports a shape the index can render', () => {
  const st = sci.stats();
  assert.equal(st.shelves, sci.SHELVES.length);
  assert.equal(st.pages, sci.allPages().length);
  assert.ok(st.sections >= st.pages);
  assert.ok(st.cites >= 100, `expected a real bibliography, got ${st.cites}`);
  assert.ok(st.unverifiedCites <= st.cites);
  assert.ok(st.words > 50000, `expected a substantial corpus, got ${st.words} words`);
  assert.ok(st.sectionsWithCites / st.sections > 0.6, 'most sections should carry a citation');
});

test('the editorial boundary holds: no reagent-plus-conditions recipe for an intoxicant conversion', () => {
  // A NARROW defect detector, not a content gate. This section deliberately teaches separation,
  // purification, distillation, crystallisation, formulation and dosing arithmetic WITH real
  // parameters — temperatures, pressures, solvent polarity, mg/unit — because withholding that from
  // someone who will proceed anyway is the harm the library exists to prevent. What it does not
  // publish is a preparative route whose endpoint is a more intoxicating cannabinoid: the acid
  // -catalysed isomerisation of CBD, side-chain homologation, acetylation. Those are described
  // structurally and cited, never reproduced.
  //
  // So the test fires only on the co-occurrence that distinguishes a RECIPE from a description: a
  // named acid catalyst or acylating reagent, in the SAME section, alongside a stoichiometry
  // (equivalents / mol%) AND a process yield. Prose that names a reagent to say the route exists
  // trips nothing. If this ever fails, the right response is to read the section and raise it — not
  // to delete corpus content.
  const REAGENT = /\b(p-?toluenesulfonic|tosic acid|pTSA|acetic anhydride|boron trifluoride|BF3|zinc chloride|Lewis acid catalyst)\b/i;
  const STOICH = /\b\d+(\.\d+)?\s?(equiv|equivalents|mol\s?%)\b/i;
  const YIELD = /\b(yield(?:ing)?|conversion)\s+of\s+\d+(\.\d+)?\s?%|\b\d+(\.\d+)?\s?%\s+(isolated\s+)?yield\b/i;
  const hits = [];
  for (const p of sci.allPages()) {
    for (const sec of p.sections) {
      const t = [sec.body, ...(sec.bullets || [])].filter(Boolean).join(' ');
      if (REAGENT.test(t) && STOICH.test(t) && YIELD.test(t)) hits.push(`${p.shelfId}/${p.slug} · ${sec.h}`);
    }
  }
  assert.deepEqual(hits, [], `sections carrying reagent + stoichiometry + yield together:\n${hits.join('\n')}`);
});

test('nothing in the registry throws on hostile input', () => {
  for (const bad of [null, undefined, 0, '', {}, [], NaN, '../../etc/passwd', '<script>']) {
    assert.doesNotThrow(() => sci.shelf(bad));
    assert.doesNotThrow(() => sci.page(bad, bad));
    assert.doesNotThrow(() => sci.search(bad));
    assert.doesNotThrow(() => sci.cite(bad, bad));
    assert.doesNotThrow(() => sci.shelfJson(bad));
  }
});
