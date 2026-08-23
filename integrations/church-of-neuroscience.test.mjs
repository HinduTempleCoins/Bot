import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ARTICLES, POSTURE, DISCLAIMER, EDITORIAL_POSTURE, CAUTIONS, PARTS,
  esc, safeHref, getArticle, listArticles, search, renderIndex, renderArticle, handler,
} from './church-of-neuroscience.mjs';

// ── html safety ──────────────────────────────────────────────────────────────
test('esc escapes html-significant characters', () => {
  assert.equal(esc('<b>&"\''), '&lt;b&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});

test('safeHref allowlists http(s) and neutralizes javascript:/data: schemes', () => {
  assert.equal(safeHref('https://clinicaltrials.gov/study/NCT05637801'), 'https://clinicaltrials.gov/study/NCT05637801');
  assert.equal(safeHref('http://example.org'), 'http://example.org');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,<script>'), '');
  assert.equal(safeHref(''), '');
  assert.equal(safeHref(null), '');
});

// ── corpus integrity ─────────────────────────────────────────────────────────
test('every article has the required shape: id/title/part/body/sources + HOST posture + the disclaimer', () => {
  assert.ok(ARTICLES.length >= 19, `expected the full corpus, got ${ARTICLES.length}`);
  const ids = new Set();
  for (const a of ARTICLES) {
    assert.ok(a.id && typeof a.id === 'string', 'article has an id');
    assert.ok(!ids.has(a.id), `id ${a.id} is unique`);
    ids.add(a.id);
    assert.ok(a.title, `${a.id} has a title`);
    assert.ok([PARTS.I, PARTS.II, PARTS.III].includes(a.part), `${a.id} has a valid part`);
    assert.ok(Array.isArray(a.body) && a.body.length, `${a.id} has body paragraphs`);
    assert.ok(Array.isArray(a.sources) && a.sources.length, `${a.id} carries at least one source`);
    assert.equal(a.disclaimer, DISCLAIMER, `${a.id} carries the standing medical disclaimer`);
    assert.equal(a.posture, POSTURE.HOST, `${a.id} is HOST posture (operator's own writing)`);
  }
});

// ── scope discipline (BRIEF.md §6) ─────────────────────────────────────────────
test('the Datura article is a warning only: carries the poison caution and gives NO dose/seed-count', () => {
  const d = getArticle('datura');
  assert.ok(d, 'datura article exists');
  assert.ok((d.cautions || []).includes(CAUTIONS.DATURA), 'datura carries the poison caution');
  const prose = d.body.join(' ');
  assert.match(prose, /no (preparation|dose|seed count)/i, 'datura prose states there is no dose');
  // Hard scope line: no "N mg / N g / N seeds" dosing anywhere in the article body.
  assert.doesNotMatch(prose, /\b\d+(\.\d+)?\s?(mg|mcg|µg|grams?|g|seeds?)\b/i, 'datura carries no numeric dose/seed count');
});

test('no article body contains a mg/mcg dose-as-instruction (science-discussion, not a protocol)', () => {
  for (const a of ARTICLES) {
    const prose = a.body.join(' ');
    assert.doesNotMatch(prose, /\b\d+(\.\d+)?\s?(mg|mcg|µg)\b/i, `${a.id} carries no mg/mcg dosing`);
  }
});

test('the 40Hz articles carry the tACS, light-therapy and flicker-safety cautions', () => {
  const forty = getArticle('forty-hz-methods');
  const safety = getArticle('safety-and-retractions');
  assert.ok(forty && safety, 'both Part III 40Hz articles exist');
  assert.ok(forty.cautions.includes(CAUTIONS.TACS_40HZ), '40Hz methods carries the tACS caution');
  assert.ok(forty.cautions.includes(CAUTIONS.LIGHT_40HZ), '40Hz methods carries the light-therapy caution');
  assert.ok(safety.cautions.includes(CAUTIONS.FLICKER_SAFETY), 'safety article carries the flicker-safety caution');
  assert.ok(safety.cautions.includes(CAUTIONS.TACS_40HZ), 'safety article carries the tACS caution');
});

test('the tACS caution names the real risk and steers to a neurologist (not a home experiment)', () => {
  assert.match(CAUTIONS.TACS_40HZ, /current through the head/i);
  assert.match(CAUTIONS.TACS_40HZ, /not a home experiment/i);
  assert.match(CAUTIONS.TACS_40HZ, /neurologist/i);
});

test('Part III articles carry the "re-check vs HOPE trial" snapshot note', () => {
  const partIII = ARTICLES.filter((a) => a.part === PARTS.III);
  assert.ok(partIII.length, 'there are Part III articles');
  for (const a of partIII) {
    assert.match(a.asOf || '', /HOPE trial|NCT05637801/i, `${a.id} marks its 2026 snapshot`);
  }
});

test('the editorial posture reproduces the omitted-protocol / omitted-seed-count / no-medical-advice note', () => {
  assert.match(EDITORIAL_POSTURE, /preparation.*protocols are omitted/i);
  assert.match(EDITORIAL_POSTURE, /seed-count is omitted/i);
  assert.match(EDITORIAL_POSTURE, /nothing.*medical advice/i);
});

// ── lookups (pure, soft-fail) ──────────────────────────────────────────────────
test('getArticle is case-insensitive and soft-fails to null', () => {
  assert.equal(getArticle('DATURA').id, 'datura');
  assert.equal(getArticle('  datura  ').id, 'datura');
  assert.equal(getArticle('does-not-exist'), null);
  assert.equal(getArticle(null), null);
  assert.equal(getArticle(''), null);
});

test('listArticles filters by part and by tag; always returns an array', () => {
  const partI = listArticles({ part: 'I — Church' });
  assert.ok(partI.length && partI.every((a) => a.part === PARTS.I));
  const tagged = listArticles({ tag: '40hz' });
  assert.ok(tagged.length && tagged.every((a) => a.tags.includes('40hz')));
  assert.deepEqual(listArticles({ tag: 'no-such-tag' }), []);
  assert.equal(listArticles().length, ARTICLES.length);
});

test('search ranks title hits, is case-insensitive, and returns [] on empty query', () => {
  const hits = search('datura');
  assert.ok(hits.length && hits[0].id === 'datura', 'datura ranks first for its own name');
  assert.ok(search('DATURA').length === hits.length, 'search is case-insensitive');
  assert.deepEqual(search(''), []);
  assert.deepEqual(search(null), []);
});

// ── rendering (esc + safeHref) ─────────────────────────────────────────────────
test('renderIndex lists every article and shows the disclaimer + editorial posture', () => {
  const html = renderIndex();
  assert.match(html, /The Church of Neuroscience/);
  assert.ok(html.includes(esc(DISCLAIMER)), 'index carries the disclaimer');
  assert.ok(html.includes(esc(EDITORIAL_POSTURE)), 'index carries the editorial posture');
  for (const a of ARTICLES) assert.ok(html.includes(`/a/${a.id}`), `index links ${a.id}`);
});

test('renderArticle returns 200 with disclaimer + cautions for a known article', () => {
  const r = renderArticle('datura');
  assert.equal(r.code, 200);
  assert.ok(r.html.includes(esc(DISCLAIMER)), 'article page carries the disclaimer');
  assert.ok(r.html.includes(esc(CAUTIONS.DATURA)), 'datura page renders the poison caution');
});

test('renderArticle 404s safely and escapes a malicious id (no XSS)', () => {
  const r = renderArticle('<script>alert(1)</script>');
  assert.equal(r.code, 404);
  assert.doesNotMatch(r.html, /<script>alert/);
  assert.match(r.html, /&lt;script&gt;/);
});

test('article source links are http(s)-allowlisted in rendered HTML', () => {
  const r = renderArticle('forty-hz-methods');
  assert.match(r.html, /href="https:\/\/clinicaltrials\.gov\/study\/NCT05637801"/);
  assert.match(r.html, /rel="noopener noreferrer"/);
});

// ── HTTP handler ───────────────────────────────────────────────────────────────
function mockRes() {
  return {
    code: 0, headers: null, body: '',
    writeHead(c, h) { this.code = c; this.headers = h || null; },
    end(b) { this.body = b == null ? '' : String(b); },
  };
}

test('handler serves the index at / and /church-of-neuroscience', () => {
  for (const url of ['/', '/church-of-neuroscience']) {
    const res = mockRes();
    handler({ url }, res);
    assert.equal(res.code, 200);
    assert.match(res.body, /The Church of Neuroscience/);
  }
});

test('handler serves an article, 404s an unknown one, and both are HTML', () => {
  const ok = mockRes();
  handler({ url: '/a/datura' }, ok);
  assert.equal(ok.code, 200);
  assert.ok(ok.body.includes(esc(CAUTIONS.DATURA)));

  const miss = mockRes();
  handler({ url: '/a/nope' }, miss);
  assert.equal(miss.code, 404);
});

test('handler serves the JSON article list with the full count', () => {
  const res = mockRes();
  handler({ url: '/api/articles' }, res);
  assert.equal(res.code, 200);
  const j = JSON.parse(res.body);
  assert.equal(j.count, ARTICLES.length);
  assert.ok(j.articles.every((a) => a.id && a.title && a.part));
});

test('handler answers /health and 404s an unknown path without throwing', () => {
  const h = mockRes();
  handler({ url: '/health' }, h);
  assert.equal(h.code, 200);
  assert.equal(h.body, 'ok');

  const nf = mockRes();
  handler({ url: '/totally/unknown' }, nf);
  assert.equal(nf.code, 404);
});

test('handler never throws on a malformed request', () => {
  const res = mockRes();
  assert.doesNotThrow(() => handler({ url: undefined }, res));
});
