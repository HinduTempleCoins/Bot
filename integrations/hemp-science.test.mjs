// hemp-science.test.mjs — tests for the Hemp & Cannabinoid Science web surface.
//
// Fully offline. The renderer reads frozen in-memory data, so there is no fetch to inject and no
// network to reach; the tests drive handler(req, res) through a mock req/res with no port bound.
//
// What is enforced here:
//   - every path the registry publishes renders 200 with a real body (a smoke sweep of the corpus)
//   - an unknown shelf or page is a 404 with a helpful body, not a 500 and not a redirect
//   - esc() actually escapes: a script tag in a query string never reaches the browser live
//   - the matrix is served as valid JSON and still says absence is not safety
//   - the checker is indexable empty and noindex once it holds a query, and an empty result says
//     plainly that it is not a finding of safety
//   - unverified citations are MARKED on the rendered page, never quietly dropped
//   - nothing throws, for any input

import { test } from 'node:test';
import assert from 'node:assert/strict';

import * as hs from './hemp-science.mjs';
import * as sci from '../knowledge/hemp-science/index.mjs';

// ── a mock req/res, the house pattern ─────────────────────────────────────────────────────────────
function mock(url) {
  const res = {
    code: 0, headers: {}, body: '',
    writeHead(c, h) { this.code = c; this.headers = { ...(h || {}) }; return this; },
    end(b) { this.body = b == null ? '' : String(b); return this; },
  };
  hs.handler({ url, method: 'GET' }, res);
  return res;
}

test('esc escapes every character that can break out of an attribute or a tag', () => {
  assert.equal(hs.esc('<script>alert("x")</script>'), '&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  assert.equal(hs.esc(`'&'`), '&#39;&amp;&#39;');
  assert.equal(hs.esc(null), '');
  assert.equal(hs.esc(undefined), '');
  assert.equal(hs.esc(0), '0');
});

test('the section index renders the shelves, the posture and the boundary', () => {
  const r = mock('/science');
  assert.equal(r.code, 200);
  assert.match(r.headers['content-type'], /text\/html/);
  for (const s of sci.SHELVES) {
    assert.ok(r.body.includes(`/science/${s.id}`), `the index does not link the ${s.id} shelf`);
    assert.ok(r.body.includes(hs.esc(s.title)), `the index does not name ${s.title}`);
  }
  // The posture and the boundary are on the page, above the fold, not in a footer.
  assert.ok(r.body.includes(hs.esc(sci.SECTION.posture)));
  assert.ok(r.body.includes(hs.esc(sci.SECTION.boundary)));
  assert.match(r.body, /Absence is not safety/);
  // The tools are reachable from the index.
  assert.ok(r.body.includes('/science/check'));
  assert.ok(r.body.includes('/science/matrix.json'));
});

test('the index cross-links the sibling library shelves', () => {
  const r = mock('/science');
  for (const frag of ['oilahuasca', 'herbs', 'psychedelics', '/interactions']) {
    assert.ok(r.body.includes(frag), `the index does not cross-link ${frag}`);
  }
});

test('every path the registry publishes renders 200 with a substantial body', () => {
  const paths = sci.paths();
  assert.ok(paths.length >= 80, `expected the whole corpus to be routable, got ${paths.length} paths`);
  const failures = [];
  for (const p of paths) {
    const r = mock(p);
    if (r.code !== 200) { failures.push(`${p} → ${r.code}`); continue; }
    if (r.body.length < 400) failures.push(`${p} → body is only ${r.body.length} bytes`);
  }
  assert.deepEqual(failures, [], `paths that did not render:\n${failures.join('\n')}`);
});

test('a page renders its facts table, its sections and its references', () => {
  // Use a page picked from the data rather than a hard-coded slug, so the test does not rot.
  const page = sci.allPages().find((p) => Object.keys(p.facts || {}).length && (p.sections || []).length > 3);
  assert.ok(page, 'no page in the corpus has both facts and several sections');
  const r = mock(`/science/${page.shelfId}/${page.slug}`);
  assert.equal(r.code, 200);
  assert.ok(r.body.includes(hs.esc(page.title)));
  assert.ok(r.body.includes(hs.esc(page.summary)));
  assert.match(r.body, /At a glance/);
  assert.match(r.body, /On this page/, 'a page with several sections should render a table of contents');
  assert.match(r.body, /id=references/);
  for (const sec of page.sections) assert.ok(r.body.includes(hs.esc(sec.h)), `section "${sec.h}" is missing`);
  // The breadcrumb walks back up to the shelf and the section.
  assert.ok(r.body.includes(`href="/science/${page.shelfId}"`));
});

test('a contested section renders its caveat inline, not as a footnote', () => {
  const page = sci.allPages().find((p) => (p.sections || []).some((s) => s.contested && s.caveat));
  assert.ok(page, 'no contested section in the corpus');
  const sec = page.sections.find((s) => s.contested && s.caveat);
  const r = mock(`/science/${page.shelfId}/${page.slug}`);
  assert.equal(r.code, 200);
  assert.match(r.body, /contested<\/span>/, 'a contested section must carry a visible badge');
  assert.ok(r.body.includes(hs.esc(sec.caveat)), 'the caveat did not render');
});

test('an unverified citation is MARKED on the page, never silently dropped', () => {
  // Find a page that references a citation we could not resolve. The whole discipline of this corpus
  // is that such a record is still published, and published AS unverified.
  let found = null;
  for (const p of sci.allPages()) {
    const keys = [...(p.cites || []), ...(p.sections || []).flatMap((s) => s.cites || [])];
    const bad = keys.find((k) => { const c = sci.cite(p.shelfId, k); return c && c.verified === false; });
    if (bad) { found = { p, key: bad }; break; }
  }
  assert.ok(found, 'no page references an unverified citation — if that is real, relax this test');
  const r = mock(`/science/${found.p.shelfId}/${found.p.slug}`);
  assert.equal(r.code, 200);
  assert.match(r.body, /\[identifier unverified\]/, 'an unverified record rendered without its marker');
  const rec = sci.cite(found.p.shelfId, found.key);
  assert.ok(r.body.includes(hs.esc(rec.title)), 'the unverified record was dropped rather than marked');
});

test('a verified citation renders a resolvable DOI link', () => {
  let found = null;
  for (const p of sci.allPages()) {
    const keys = [...(p.cites || []), ...(p.sections || []).flatMap((s) => s.cites || [])];
    const good = keys.find((k) => { const c = sci.cite(p.shelfId, k); return c && c.doi; });
    if (good) { found = { p, key: good }; break; }
  }
  assert.ok(found);
  const rec = sci.cite(found.p.shelfId, found.key);
  const r = mock(`/science/${found.p.shelfId}/${found.p.slug}`);
  assert.ok(r.body.includes(`https://doi.org/${hs.esc(rec.doi)}`), 'the DOI did not render as a link');
  assert.match(r.body, /rel="nofollow noopener"/);
});

test('an unknown shelf or page is a 404 with a route back, not a 500 or a redirect', () => {
  for (const p of ['/science/no-such-shelf', '/science/cyp450/no-such-page', '/science/a/b/c']) {
    const r = mock(p);
    assert.equal(r.code, 404, `${p} should 404`);
    assert.match(r.body, /No such page/);
    assert.match(r.headers['content-type'], /text\/html/);
    // A dead end must still offer the shelves.
    for (const s of sci.SHELVES) assert.ok(r.body.includes(`/science/${s.id}`), `${p}: the 404 does not list ${s.id}`);
  }
});

test('the matrix is served as valid JSON and still carries its own caveat', () => {
  const r = mock('/science/matrix.json');
  assert.equal(r.code, 200);
  assert.match(r.headers['content-type'], /application\/json/);
  const m = JSON.parse(r.body);
  assert.equal(m.absenceIsNotSafety, true);
  assert.ok(m.enzymes.length >= 5);
  assert.ok(String(m.statement).length > 80);
  assert.equal(m.schema, 'melek-hemp-science/cyp-interaction-matrix/1');
});

test('the checker is indexable empty and noindex once it holds a query', () => {
  const empty = hs.render('/science/check', new URLSearchParams());
  assert.equal(empty.robots, 'index,follow');
  const queried = hs.render('/science/check', new URLSearchParams('taking=CBD'));
  assert.match(queried.robots, /noindex/, 'a per-query record must not be indexed');
});

test('the checker reads back what it was given and never calls an empty result safe', () => {
  const r = mock('/science/check?taking=zzqq-not-a-real-substance');
  assert.equal(r.code, 200);
  assert.match(r.body, /not in this dataset, not checked/);
  assert.match(r.body, /not a finding of safety/i);
  assert.match(r.body, /Absence is not safety/);
});

test('the checker finds a documented interaction and names the mechanism', () => {
  const r = mock('/science/check?taking=CBD%2C%20clobazam');
  assert.equal(r.code, 200);
  assert.match(r.body, /documented interaction/i);
  // The heading carries the mechanism AND the participants: two findings can share a mechanism name
  // and differ only in who is involved, and a reader must be able to tell them apart.
  assert.match(r.body, /CYP2C19 inhibition — Cannabidiol \(CBD\) \+ Benzodiazepines/,
    'the finding heading does not name both the mechanism and the participants');
  assert.match(r.body, /N-desmethylclobazam/, 'the CBD/clobazam finding lost its substantive note');
  assert.match(r.body, /Take this to a clinician/, 'the clinician export is the point of the page');
});

test('a hostile query string is escaped, in the form and in the read-back', () => {
  const payload = '<script>alert(1)</script>';
  for (const p of [`/science/check?taking=${encodeURIComponent(payload)}`, `/science/search?q=${encodeURIComponent(payload)}`]) {
    const r = mock(p);
    assert.equal(r.code, 200);
    assert.equal(r.body.includes(payload), false, `${p}: the raw payload reached the page`);
    assert.equal(r.body.includes('<script>alert'), false, `${p}: an injected script tag survived`);
    assert.ok(r.body.includes('&lt;script&gt;'), `${p}: the payload was dropped rather than escaped`);
  }
});

test('search renders hits that resolve, and an honest empty state', () => {
  const hit = mock('/science/search?q=cytochrome');
  assert.equal(hit.code, 200);
  for (const h of sci.search('cytochrome', { limit: 40 })) {
    assert.ok(hit.body.includes(`/science/${h.shelfId}/${h.slug}`), `search page is missing ${h.slug}`);
  }
  const miss = mock('/science/search?q=zzqqxx-nothing');
  assert.equal(miss.code, 200);
  assert.match(miss.body, /No page in this section matched/);
  const blank = mock('/science/search');
  assert.equal(blank.code, 200);
  assert.match(blank.body, /Type a term above/);
});

test('render returns null for a path outside the section, and the handler redirects', () => {
  assert.equal(hs.render('/', new URLSearchParams()), null);
  assert.equal(hs.render('/flower', new URLSearchParams()), null);
  assert.equal(hs.render('/sciencey', new URLSearchParams()), null);
  const r = mock('/flower');
  assert.equal(r.code, 302);
  assert.equal(r.headers.location, '/science');
});

test('a trailing slash is the same page, not a 404', () => {
  const a = mock('/science/cyp450/');
  assert.equal(a.code, 200);
  const b = mock('/science/');
  assert.equal(b.code, 200);
  assert.match(b.body, /Hemp/);
});

test('sciencePaths is sitemap-safe: pages only, no JSON, no duplicates', () => {
  const ps = hs.sciencePaths();
  assert.equal(new Set(ps).size, ps.length);
  for (const p of ps) {
    assert.match(p, /^\/science/);
    assert.equal(p.endsWith('.json'), false, `${p} is not a page and must not be in the sitemap`);
  }
  assert.ok(ps.includes('/science'));
});

test('health answers, and the handler never throws on anything', () => {
  assert.equal(mock('/health').body, 'ok');
  const nasty = [
    '/science/%2e%2e%2f%2e%2e%2fetc%2fpasswd', '/science/../../etc/passwd',
    '/science/check?taking=' + 'a,'.repeat(500), '/science/search?q=' + '%00',
    '/science/' + 'x'.repeat(5000), '/science/cyp450/%FF', '/science//', '/science/?',
  ];
  for (const u of nasty) {
    let r = null;
    assert.doesNotThrow(() => { r = mock(u); }, `threw on ${u}`);
    assert.notEqual(r.code, 500, `${u} produced a 500`);
  }
  // render() itself must tolerate junk rather than relying on the handler's catch as its design.
  for (const bad of [null, undefined, 0, {}, [], NaN]) {
    assert.doesNotThrow(() => hs.render(bad, new URLSearchParams()));
  }
  assert.doesNotThrow(() => hs.render('/science', null));
  assert.doesNotThrow(() => hs.indexView());
  assert.doesNotThrow(() => hs.checkView(null));
  assert.doesNotThrow(() => hs.searchView(null));
  assert.doesNotThrow(() => hs.matrixJson());
});

test('view functions return empty for an unknown target, so the caller can 404', () => {
  assert.equal(hs.shelfView('no-such-shelf'), '');
  assert.equal(hs.pageView('cyp450', 'no-such-page'), '');
  assert.equal(hs.pageView('no-such-shelf', 'x'), '');
});

test('every rendered page carries the posture and the absence-is-not-safety line', () => {
  // Spot-check across shelves rather than the whole corpus, to keep the suite quick.
  for (const s of sci.SHELVES) {
    const p = s.pages[0];
    const r = mock(`/science/${s.id}/${p.slug}`);
    assert.match(r.body, /Absence is not safety/, `${s.id}/${p.slug} is missing the absence line`);
    assert.ok(r.body.includes(hs.esc(sci.SECTION.boundary)), `${s.id}/${p.slug} is missing the boundary statement`);
  }
});
