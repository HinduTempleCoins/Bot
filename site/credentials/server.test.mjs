// server.test.mjs — the credentials portal. Pure render + handler routing; offline, never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, homePage, industryView, credentialView, searchView, esc } from './server.mjs';

// minimal res capture
function cap() {
  const o = { code: 0, type: '', body: '' };
  return {
    res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } },
    o,
  };
}
const get = async (path) => { const { res, o } = cap(); await handler({ url: path, method: 'GET' }, res); return o; };

test('home page lists industries + featured free paths + the guardrail', () => {
  const html = homePage();
  assert.match(html, /Browse by industry/);
  assert.match(html, /Modern States/);          // featured free path
  assert.match(html, /never sell/i);            // honest guardrail
  assert.match(html, /Teaching English/);       // an industry card
});

test('an industry page lists its credentials free-first', () => {
  const html = industryView('teaching-english');
  assert.match(html, /CELTA/);
  assert.ok(html.indexOf('TEFL') < html.indexOf('CELTA'), 'low-cost TEFL before paid CELTA');
});

test('unknown industry / credential render a friendly noindex page, not a crash', () => {
  assert.match(industryView('nope'), /not found/i);
  assert.match(credentialView('nope'), /not found/i);
  assert.match(industryView('nope'), /noindex/);
});

test('a credential detail shows the issuer link', () => {
  const html = credentialView('saylor');
  assert.match(html, /Saylor Academy/);
  assert.match(html, /saylor\.org/);
  assert.match(html, /official issuer/);
});

test('search renders results for a goal query and is empty-safe', () => {
  assert.match(searchView('tefl'), /TEFL|TESOL|CELTA/);
  assert.match(searchView(''), /browse/i);
  assert.match(searchView('zzzznotacred'), /No credentials matched/);
});

test('routes return the right status codes', async () => {
  assert.equal((await get('/')).code, 200);
  assert.equal((await get('/industry/college-credit')).code, 200);
  assert.equal((await get('/c/iacet')).code, 200);
  assert.equal((await get('/industry/nope')).code, 404);
  assert.equal((await get('/c/nope')).code, 404);
  assert.equal((await get('/nowhere')).code, 404);
});

test('SEO + health routes serve the right content types', async () => {
  const health = await get('/health');
  assert.equal(health.code, 200);
  assert.match(health.type, /json/);
  assert.match((await get('/robots.txt')).type, /text\/plain/);
  assert.match((await get('/sitemap.xml')).type, /xml/);
  const sm = await get('/sitemap.xml');
  assert.match(sm.body, /\/industry\/teaching-english/);   // industries are in the sitemap
  assert.match((await get('/llms.txt')).type, /text\/plain/);
});

test('esc neutralizes HTML', () => {
  assert.equal(esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
});
