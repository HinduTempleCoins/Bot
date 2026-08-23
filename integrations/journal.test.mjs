// integrations/journal.test.mjs — offline, deterministic tests for the VKFRI academic journal.
// Injected in-memory storage (Map) + injected clock. node --test, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createJournal, citation, handler,
  PIPELINE, OPEN_LICENSES, normalizeLicense, isOpenLicense,
} from './journal.mjs';

const T = 1_700_000_000_000; // fixed clock (2023-11-14 UTC → year 2023)
const mk = () => createJournal({ storage: new Map(), now: () => T });

const GOOD = { title: 'On Temple Technology', authors: ['A. Weaver', 'B. Neith'], abstract: 'An abstract.', body: 'The body.', keywords: ['temple', 'ai'], license: 'CC-BY' };

// ── submit validation ────────────────────────────────────────────────────────────────────────────
test('submit accepts a valid open-access submission', () => {
  const j = mk();
  const r = j.submit(GOOD);
  assert.equal(r.ok, true);
  assert.equal(r.article.status, 'submitted');
  assert.equal(r.article.doi, null);
  assert.equal(r.article.at, T);
  assert.deepEqual(r.article.authors, ['A. Weaver', 'B. Neith']);
  assert.equal(r.article.license, 'CC-BY');
  assert.ok(r.article.id);
});

test('submit soft-fails on missing required fields (never throws)', () => {
  const j = mk();
  assert.equal(j.submit({ ...GOOD, title: '' }).ok, false);
  assert.equal(j.submit({ ...GOOD, authors: [] }).ok, false);
  assert.equal(j.submit({ ...GOOD, abstract: '' }).ok, false);
});

test('submit rejects closed / NC / ND licenses, accepts all open ones', () => {
  const j = mk();
  for (const bad of ['CC-BY-NC', 'CC-BY-NC-4.0', 'CC-BY-ND', 'All Rights Reserved', 'proprietary', '']) {
    const r = j.submit({ ...GOOD, license: bad });
    assert.equal(r.ok, false, `expected reject for ${bad}`);
    assert.match(r.error, /license/i);
  }
  for (const good of ['CC-BY', 'CC-BY-SA', 'CC0', 'PD', 'cc-by 4.0', 'public domain']) {
    assert.equal(j.submit({ ...GOOD, license: good }).ok, true, `expected accept for ${good}`);
  }
});

test('license helpers normalize + classify', () => {
  assert.equal(normalizeLicense('cc-by 4.0'), 'CC-BY');
  assert.equal(normalizeLicense('Public Domain'), 'PD');
  assert.equal(normalizeLicense('CC-Zero'), 'CC0');
  assert.equal(isOpenLicense('CC-BY-NC'), false);
  assert.equal(isOpenLicense('CC0'), true);
  assert.deepEqual(OPEN_LICENSES, ['CC-BY', 'CC-BY-SA', 'CC0', 'PD']);
});

test('ids increment deterministically', () => {
  const j = mk();
  assert.equal(j.submit(GOOD).article.id, '1');
  assert.equal(j.submit(GOOD).article.id, '2');
});

// ── peer-review workflow ───────────────────────────────────────────────────────────────────────
test('assignReviewer records reviewer and opens review', () => {
  const j = mk();
  const id = j.submit(GOOD).article.id;
  const r = j.assignReviewer(id, 'Dr. Referee');
  assert.equal(r.ok, true);
  assert.equal(r.article.status, 'in-review');
  assert.deepEqual(r.article.reviewers, ['Dr. Referee']);
  // duplicate reviewer not doubled
  assert.deepEqual(j.assignReviewer(id, 'Dr. Referee').article.reviewers, ['Dr. Referee']);
  // unknown article soft-fails
  assert.equal(j.assignReviewer('999', 'X').ok, false);
});

test('addReview validates recommendation', () => {
  const j = mk();
  const id = j.submit(GOOD).article.id;
  j.assignReviewer(id, 'R');
  const r = j.addReview(id, { reviewer: 'R', recommendation: 'accept', notes: 'good' });
  assert.equal(r.ok, true);
  assert.equal(r.article.reviews.length, 1);
  assert.equal(r.article.reviews[0].at, T);
  assert.equal(j.addReview(id, { reviewer: 'R', recommendation: 'nope' }).ok, false);
  assert.equal(j.addReview('999', { recommendation: 'accept' }).ok, false);
});

test('decide walks the pipeline and soft-fails unknown transitions', () => {
  const j = mk();
  const id = j.submit(GOOD).article.id;
  assert.equal(j.decide(id, 'in-review').article.status, 'in-review');
  assert.equal(j.decide(id, 'revisions').article.status, 'revisions');
  assert.equal(j.decide(id, 'accepted').article.status, 'accepted');
  // unknown status name
  assert.equal(j.decide(id, 'banana').ok, false);
  // illegal transition (accepted → in-review is not allowed)
  assert.equal(j.decide(id, 'in-review').ok, false);
  // decide can never move to 'published' (publish() owns that)
  assert.equal(j.decide(id, 'published').ok, false);
  // unknown article
  assert.equal(j.decide('999', 'in-review').ok, false);
});

test('decide can reject at any review stage', () => {
  const j = mk();
  const id = j.submit(GOOD).article.id;
  j.decide(id, 'in-review');
  const r = j.decide(id, 'rejected');
  assert.equal(r.ok, true);
  assert.equal(r.article.status, 'rejected');
  // rejected is terminal
  assert.equal(j.decide(id, 'accepted').ok, false);
});

test('PIPELINE constant is the fixed set', () => {
  assert.deepEqual(PIPELINE, ['submitted', 'in-review', 'revisions', 'accepted', 'published', 'rejected']);
});

// ── publication ──────────────────────────────────────────────────────────────────────────────────
function accept(j) {
  const id = j.submit(GOOD).article.id;
  j.decide(id, 'in-review');
  j.decide(id, 'accepted');
  return id;
}

test('publish sets status + deterministic DOI + timestamp', () => {
  const j = mk();
  const id = accept(j);
  const r = j.publish(id, { volume: '2', issue: '3' });
  assert.equal(r.ok, true);
  assert.equal(r.article.status, 'published');
  assert.equal(r.article.doi, `10.melek/vkfri.2.${id}`);
  assert.equal(r.article.published_at, T);
  assert.equal(r.article.volume, '2');
  assert.equal(r.article.issue, '3');
});

test('publish only accepts an accepted article, defaults volume/issue', () => {
  const j = mk();
  const id = j.submit(GOOD).article.id;
  assert.equal(j.publish(id).ok, false); // still 'submitted'
  j.decide(id, 'in-review');
  j.decide(id, 'accepted');
  const r = j.publish(id);
  assert.equal(r.ok, true);
  assert.equal(r.article.doi, `10.melek/vkfri.1.${id}`);
  assert.equal(j.publish('999').ok, false);
});

// ── views ──────────────────────────────────────────────────────────────────────────────────────
test('issue() lists published articles for a volume/issue only', () => {
  const j = mk();
  const a = accept(j); j.publish(a, { volume: '1', issue: '1' });
  const b = accept(j); j.publish(b, { volume: '1', issue: '1' });
  const c = accept(j); j.publish(c, { volume: '1', issue: '2' });
  const d = j.submit(GOOD).article.id; // unpublished, must not appear
  const iss = j.issue('1', '1');
  assert.deepEqual(iss.map((x) => x.id).sort(), [a, b].sort());
  assert.equal(j.issue('9', '9').length, 0);
  assert.ok(!j.issue('1', '2').some((x) => x.id === d));
});

test('listArticles filters by status; getArticle returns a copy', () => {
  const j = mk();
  const pub = accept(j); j.publish(pub);
  j.submit(GOOD); // a 'submitted' one
  assert.equal(j.listArticles().length, 2);
  assert.equal(j.listArticles({ status: 'published' }).length, 1);
  assert.equal(j.listArticles({ status: 'submitted' }).length, 1);
  const got = j.getArticle(pub);
  got.title = 'MUTATED';
  assert.notEqual(j.getArticle(pub).title, 'MUTATED'); // stored copy untouched
  assert.equal(j.getArticle('999'), null);
});

test('stats rolls up totals by status + license', () => {
  const j = mk();
  const pub = accept(j); j.publish(pub);
  j.submit(GOOD);
  const s = j.stats();
  assert.equal(s.total, 2);
  assert.equal(s.published, 1);
  assert.equal(s.byStatus.published, 1);
  assert.equal(s.byStatus.submitted, 1);
  assert.equal(s.byLicense['CC-BY'], 2);
});

// ── citation ─────────────────────────────────────────────────────────────────────────────────────
test('citation renders APA + BibTeX, esc-safe', () => {
  const j = mk();
  const id = accept(j);
  const art = j.publish(id, { volume: '2', issue: '4' }).article;
  const apa = citation(art, 'apa');
  assert.match(apa, /A\. Weaver, B\. Neith/);
  assert.match(apa, /\(2023\)/);
  assert.match(apa, /On Temple Technology/);
  assert.match(apa, /Van Kush Family Research Institute Journal, 2\(4\)/);
  assert.match(apa, /https:\/\/doi\.org\/10\.melek\/vkfri\.2\./);

  const bib = citation(art, 'bibtex');
  assert.match(bib, /^@article\{vkfri/);
  assert.match(bib, /author = \{A\. Weaver and B\. Neith\}/);
  assert.match(bib, /title = \{On Temple Technology\}/);
  assert.match(bib, /doi = \{10\.melek\/vkfri\.2\./);
  assert.match(bib, /\n\}$/);
});

test('citation escapes dangerous interpolation', () => {
  const bad = { id: '1', title: '<script>x</script>', authors: ['A & B'], published_at: T, volume: '1', issue: '1', doi: '10.melek/vkfri.1.1' };
  const apa = citation(bad, 'apa');
  assert.ok(!apa.includes('<script>'));
  assert.match(apa, /A &amp; B/);
});

// ── HTTP handler ─────────────────────────────────────────────────────────────────────────────────
function fakeRes() {
  return { code: 0, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; } };
}
const jsonOf = (res) => JSON.parse(res.body);

test('handler GET /health returns stats', async () => {
  const j = mk();
  const res = fakeRes();
  await handler({ method: 'GET', url: '/health' }, res, { journal: j });
  assert.equal(res.code, 200);
  assert.equal(jsonOf(res).ok, true);
  assert.ok(jsonOf(res).stats);
});

test('handler POST /api/submit + GET articles + article + 404', async () => {
  const j = mk();
  // submit via handler
  let res = fakeRes();
  await handler({ method: 'POST', url: '/api/submit', body: GOOD }, res, { journal: j });
  assert.equal(res.code, 200);
  const id = jsonOf(res).article.id;

  // bad submit → 400
  res = fakeRes();
  await handler({ method: 'POST', url: '/api/submit', body: { ...GOOD, license: 'CC-BY-NC' } }, res, { journal: j });
  assert.equal(res.code, 400);
  assert.equal(jsonOf(res).ok, false);

  // list
  res = fakeRes();
  await handler({ method: 'GET', url: '/api/articles' }, res, { journal: j });
  assert.equal(jsonOf(res).articles.length, 1);

  // list filtered
  res = fakeRes();
  await handler({ method: 'GET', url: '/api/articles?status=published' }, res, { journal: j });
  assert.equal(jsonOf(res).articles.length, 0);

  // fetch one
  res = fakeRes();
  await handler({ method: 'GET', url: `/api/article/${id}` }, res, { journal: j });
  assert.equal(jsonOf(res).article.id, id);

  // missing article → 404
  res = fakeRes();
  await handler({ method: 'GET', url: '/api/article/999' }, res, { journal: j });
  assert.equal(res.code, 404);

  // unknown route → 404
  res = fakeRes();
  await handler({ method: 'GET', url: '/nope' }, res, { journal: j });
  assert.equal(res.code, 404);
});
