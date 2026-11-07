// site/yoni/server.test.mjs — OFFLINE. That the shelf serves, that it does NOT leak the public
// Library, that traversal is refused, and that the age gate is per surface rather than per site.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, listArticles, readArticle, esc, policyFor } from './server.mjs';

function call(url) {
  const req = { method: 'GET', url };
  const res = { code: 0, headers: {}, body: '',
    writeHead(c, h) { this.code = c; this.headers = h || {}; },
    end(b) { this.body = b || ''; } };
  return handler(req, res).then(() => ({ code: res.code, body: res.body, headers: res.headers }));
}

test('the shelf lists its own articles', () => {
  const arts = listArticles();
  assert.ok(arts.length >= 5, `expected the converted set, found ${arts.length}`);
  const slugs = arts.map((a) => a.slug);
  assert.ok(slugs.includes('The_Federal_Age_Floor_for_Filming'));
  assert.ok(slugs.includes('DMCA_and_Takedown_in_Adult_Media'));
});

test('IT MUST NOT SERVE THE PUBLIC LIBRARY — the two shelves stay separate', () => {
  const slugs = listArticles().map((a) => a.slug);
  for (const leaked of ['Nootropics', 'Cannabis', 'Ibogaine_Iboga_and_the_Apocynaceae', 'Oilahuasca']) {
    assert.ok(!slugs.includes(leaked), `${leaked} belongs to the public Library and must not appear here`);
  }
  assert.equal(readArticle('Nootropics'), null, 'a Library slug must not resolve on this surface');
});

test('the index renders every article as a link', async () => {
  const r = await call('/');
  assert.equal(r.code, 200);
  for (const a of listArticles()) assert.ok(r.body.includes(`/a/${a.slug}`), `${a.slug} missing from the index`);
  assert.match(r.body, /Not legal advice/);
});

test('an article renders through the wiki renderer', async () => {
  const r = await call('/a/The_Federal_Age_Floor_for_Filming');
  assert.equal(r.code, 200);
  assert.ok(r.body.length > 20000, 'the body should be the rendered article, not a stub');
  assert.ok(!r.body.includes("'''"), 'wiki markup must not reach the page');
});

test('path traversal is refused', async () => {
  for (const bad of ['/a/../../../etc/passwd', '/a/..%2f..%2fetc%2fpasswd', '/a/']) {
    const r = await call(bad);
    assert.notEqual(r.code, 200, `${bad} must not serve`);
  }
  assert.equal(readArticle('../../package'), null);
  assert.equal(readArticle('../wiki/seed-articles/Nootropics'), null);
});

test('the shelf is not indexed while the property is being assembled', async () => {
  const robots = await call('/robots.txt');
  assert.match(robots.body, /Disallow: \//);
  const page = await call('/');
  assert.match(page.body, /noindex/);
});

test('THE GATE IS PER SURFACE: reference is open, the media surfaces are not', async () => {
  assert.equal(policyFor('wiki').level, 'none', 'editorial and anatomical material is served open');
  for (const s of ['gallery', 'video', 'live']) {
    assert.equal(policyFor(s).level, 'verified', `${s} must require a real check`);
  }
  assert.equal(policyFor('upload').level, 'id');
  const g = await call('/gate?surface=live&subject=stranger');
  const j = JSON.parse(g.body);
  assert.equal(j.state.allowed, false);
  assert.equal(j.state.need, 'verified');
  assert.equal(j.state.paidCheckRequired, true);
});

test('an unknown surface fails closed even through the HTTP boundary', async () => {
  const g = await call('/gate?surface=whatever-comes-next&subject=x');
  assert.equal(JSON.parse(g.body).policy.level, 'id');
});

test('escaping holds at the render edge', () => {
  assert.equal(esc('<script>&"'), '&lt;script&gt;&amp;&quot;');
});

// ── the surface map and the upload door ─────────────────────────────────────────────────────────

test('/surfaces renders every declared surface with its level', async () => {
  const r = await call('/surfaces');
  assert.equal(r.code, 200);
  // built surfaces render as links inside the <b>; ones with no door yet render as plain text
  for (const name of ['wiki', 'preview', 'gallery', 'video', 'live', 'upload', 'payout']) {
    assert.match(r.body, new RegExp(`<b>(?:<a href="/${name}">)?${name}`), `${name} is listed`);
  }
  for (const name of ['preview', 'gallery', 'video', 'live', 'upload']) {
    assert.match(r.body, new RegExp(`<a href="/${name}">${name}</a>`), `${name} links to its door`);
  }
  // upload and payout are the id-level doors; the viewer surfaces are not
  assert.match(r.body, /upload<\/a><\/b>\s*<\/td>\s*<td><code>id<\/code>/);
  assert.match(r.body, /<b>payout<\/b>\s*<\/td>\s*<td><code>id<\/code>/);
  assert.match(r.body, /<b>wiki<\/b>\s*<\/td>\s*<td><code>none<\/code>/);
});

test('/surfaces is ordered by level, lowest first', async () => {
  const r = await call('/surfaces');
  const levels = [...r.body.matchAll(/<td><code>(none|attested|verified|id)<\/code>/g)].map((m) => m[1]);
  const order = ['none', 'attested', 'verified', 'id'];
  const ranks = levels.map((l) => order.indexOf(l));
  assert.deepEqual(ranks, [...ranks].sort((a, b) => a - b), `not ordered: ${levels.join(',')}`);
});

test('the upload door is closed to anyone not on the producer list', async () => {
  assert.equal(policyFor('upload').level, 'id');
  const r = await call('/upload?subject=nobody-has-verified-this');
  assert.equal(r.code, 200);
  assert.match(r.body, /<b>Closed\.<\/b>/);
  assert.match(r.body, /no third-party uploads/i);
  assert.doesNotMatch(r.body, /Cleared to publish/);
});

test('the upload door states the intake decision and what it buys', async () => {
  const r = await call('/upload');
  assert.match(r.body, /Intake is operator-only/);
  assert.match(r.body, /provider set\s*\n?\s*of one|provider set of one/);
  assert.match(r.body, /still requires a government ID examined for every/i);
});

test('the upload door states the 2257 subsections rather than paraphrasing them', async () => {
  const r = await call('/upload');
  for (const cite of ['2257\\(b\\)', '2257\\(c\\)', '2257\\(e\\)', '2257\\(f\\)', '2257\\(i\\)', '2257A']) {
    assert.match(r.body, new RegExp(`§ ${cite}`), `cites § ${cite.replace(/\\\\/g, '')}`);
  }
  assert.match(r.body, /custodian of records/i);
});

test('the upload door keeps the two stores apart and promises no document storage', async () => {
  const r = await call('/upload');
  assert.match(r.body, /The age gate/);
  assert.match(r.body, /§ 2257 records/);
  // the gate side must say plainly that it never holds the document
  assert.match(r.body, /Never holds/);
  assert.match(r.body, /the document, the document number, the date of birth/i);
});

test('an unknown surface fails closed at id', () => {
  assert.equal(policyFor('whatever-this-is').level, 'id');
});
