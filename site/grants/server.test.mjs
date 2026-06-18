// server.test.mjs — the grants portal. Pure render + handler routing; offline, never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, homePage, fieldView, grantView, searchView, esc } from './server.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
const get = async (path) => { const { res, o } = cap(); await handler({ url: path, method: 'GET' }, res); return o; };

test('home lists fields + featured portals + guardrail', () => {
  const html = homePage();
  assert.match(html, /Browse by field/);
  assert.match(html, /Grants\.gov/);
  assert.match(html, /never charge for access to public money/i);
  assert.match(html, /Research &amp; science/);
});

test('a field page lists its sources, portals first', () => {
  const html = fieldView('portals');
  assert.ok(html.indexOf('Grants.gov') < html.indexOf('USAspending'), 'lead portal first');
});

test('unknown field / grant render friendly noindex pages', () => {
  assert.match(fieldView('nope'), /not found/i);
  assert.match(fieldView('nope'), /noindex/);
  assert.match(grantView('nope'), /not found/i);
});

test('a grant detail shows the official link', () => {
  const html = grantView('sbir-sttr');
  assert.match(html, /Seed Fund|SBIR/);
  assert.match(html, /sbir\.gov/);
  assert.match(html, /official source/);
});

test('search renders results + is empty-safe', () => {
  assert.match(searchView('research'), /NSF|NIH|science/i);
  assert.match(searchView(''), /browse/i);
  assert.match(searchView('zzzznope'), /No grants matched/);
});

test('routes return the right status codes', async () => {
  assert.equal((await get('/')).code, 200);
  assert.equal((await get('/field/research')).code, 200);
  assert.equal((await get('/g/grants-gov')).code, 200);
  assert.equal((await get('/field/nope')).code, 404);
  assert.equal((await get('/g/nope')).code, 404);
  assert.equal((await get('/nowhere')).code, 404);
});

test('SEO + health serve correct content types', async () => {
  assert.match((await get('/health')).type, /json/);
  assert.match((await get('/robots.txt')).type, /text\/plain/);
  const sm = await get('/sitemap.xml');
  assert.match(sm.type, /xml/);
  assert.match(sm.body, /\/field\/research/);
  assert.match((await get('/llms.txt')).type, /text\/plain/);
});

test('esc neutralizes HTML', () => {
  assert.equal(esc('<b>&</b>'), '&lt;b&gt;&amp;&lt;/b&gt;');
});
