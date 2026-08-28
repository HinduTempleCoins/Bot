// credit.test.mjs — offline tests for the Credit-Score Help portal. No network, no keys.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { handler, homePage, buildPage, disputesPage, resourcesPage, esc } from './server.mjs';

function mockRes() { return { statusCode: 0, headers: {}, body: '', writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); }, end(b) { this.body = b || ''; } }; }
async function route(path) { const res = mockRes(); await handler({ url: path, method: 'GET', headers: {} }, res); return res; }

test('esc escapes metacharacters', () => {
  assert.equal(esc('<b>"&"</b>'), '&lt;b&gt;&quot;&amp;&quot;&lt;/b&gt;');
});

test('home shows the FICO factors, ranges, and the education-only disclaimer', () => {
  const h = homePage();
  assert.match(h, /Payment history/);
  assert.match(h, /35%/);
  assert.match(h, /Exceptional/);
  assert.match(h, /Education only/i);
  assert.match(h, /not financial or legal advice/i);
});

test('build page lists concrete steps + utilization advice', () => {
  const h = buildPage();
  assert.match(h, /Keep utilization low/);
  assert.match(h, /on time/i);
});

test('disputes page cites the FCRA + the three bureaus + free reports', () => {
  const h = disputesPage();
  assert.match(h, /Fair Credit Reporting Act|FCRA/);
  assert.match(h, /Equifax/);
  assert.match(h, /Experian/);
  assert.match(h, /TransUnion/);
  assert.match(h, /AnnualCreditReport/i);
});

test('resources page warns about paid credit-repair', () => {
  const h = resourcesPage();
  assert.match(h, /repair/i);
  assert.match(h, /free/i);
  assert.match(h, /consumerfinance|CFPB/i);
});

test('routes render 200 + sitemap/robots/llms respond', async () => {
  for (const p of ['/', '/build', '/disputes', '/resources']) {
    assert.equal((await route(p)).statusCode, 200, `${p} 200`);
  }
  assert.equal((await route('/health')).body, 'ok');
  assert.match((await route('/sitemap.xml')).body, /\/disputes/);
  assert.match((await route('/llms.txt')).body, /Credit-Score Help/);
});

test('unknown path redirects home', async () => {
  assert.equal((await route('/nope')).statusCode, 302);
});
