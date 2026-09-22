// percent.test.mjs — OFFLINE tests for the SoapBox Percentage Calculator (engine + handler; no port,
// no network). Verifies each op's math, the JSON API, offline rendering, escaping and 404 soft-fail.

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, calculatorPage, compute, OPS, esc, safeHref, SITEMAP_PATHS } from './server.mjs';

test('compute: X% of Y', () => { assert.equal(compute('of', 15, 200).value, 30); });
test('compute: X is what % of Y', () => { const r = compute('isPctOf', 30, 200); assert.equal(r.value, 15); assert.equal(r.unit, '%'); });
test('compute: % change (increase)', () => { assert.equal(compute('change', 200, 250).value, 25); });
test('compute: % change (decrease is negative)', () => { assert.equal(compute('change', 200, 150).value, -25); });
test('compute: add %', () => { assert.equal(compute('addPct', 10, 200).value, 220); });
test('compute: subtract %', () => { assert.equal(compute('subPct', 10, 200).value, 180); });
test('compute: tip splitter', () => {
  const r = compute('tip', 20, 100, 4);
  assert.equal(r.tip, 20); assert.equal(r.total, 120); assert.equal(r.perPerson, 30); assert.equal(r.people, 4);
});
test('compute: unknown op soft-fails', () => { assert.equal(compute('bogus', 1, 2).ok, false); });
test('compute: divide-by-zero / NaN soft-fails, never throws', () => {
  assert.equal(compute('isPctOf', 5, 0).ok, false);
  assert.equal(compute('of', 'x', 'y').ok, false);
});
test('OPS lists all six operations', () => { assert.equal(OPS.length, 6); });

function mockRes() { return { code: null, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; return this; }, end(s) { this.body = s == null ? '' : String(s); return this; } }; }
async function get(path) { const res = mockRes(); await handler({ url: path, method: 'GET', headers: { host: 'pct.test' } }, res); return res; }

test('home 200 renders the tabbed calculator', async () => {
  const res = await get('/'); assert.equal(res.code, 200);
  assert.match(res.body, /Percentage Calculator/);
  assert.match(res.body, /data-op=change/); assert.match(res.body, /data-op=tip/);
});
test('server does no network fetch (throwing fetch injected → still renders)', async () => {
  const orig = globalThis.fetch; let called = false;
  globalThis.fetch = () => { called = true; throw new Error('no net'); };
  try { const res = await get('/'); assert.equal(res.code, 200); assert.equal(called, false); } finally { globalThis.fetch = orig; }
});
test('inline script only — no external CDN', async () => { assert.ok(!/<script src=/i.test((await get('/')).body)); });
test('JSON API computes', async () => {
  const j = JSON.parse((await get('/api/pct?op=of&a=15&b=200')).body);
  assert.equal(j.value, 30);
});
test('/health ok', async () => { assert.deepEqual(JSON.parse((await get('/health')).body), { ok: true }); });
test('robots/sitemap/sitemap-index/llms serve', async () => {
  assert.match((await get('/robots.txt')).body, /User-agent/);
  assert.match((await get('/sitemap.xml')).body, /<urlset|<url>/);
  assert.match((await get('/sitemap-index.xml')).body, /sitemapindex/);
  assert.match((await get('/llms.txt')).body, /percent/i);
});
test('SITEMAP_PATHS covers home', () => { assert.ok(SITEMAP_PATHS.includes('/')); });
test('understated MELEK unlock, tool introduced first', async () => {
  const b = (await get('/')).body;
  assert.match(b, /free MELEK account/i);
  assert.ok(b.indexOf('Percentage Calculator') < b.indexOf('MELEK'));
});
test('unknown path → 404, never 500', async () => { const r = await get('/x/y'); assert.equal(r.code, 404); });
test('never throws on garbage URL', async () => { const res = mockRes(); await handler({ url: '/%%%', method: 'GET', headers: { host: 'pct.test' } }, res); assert.ok(res.code >= 200); });
test('esc/safeHref sound', () => { assert.equal(esc('<b>'), '&lt;b&gt;'); assert.equal(safeHref('javascript:x'), ''); });
test('calculatorPage() is a pure string', () => { assert.equal(typeof calculatorPage(), 'string'); });
