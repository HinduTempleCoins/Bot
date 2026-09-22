// dilution.test.mjs — OFFLINE tests for the SoapBox Dilution Calculator (engine + handler; no port,
// no network). Verifies C1V1=C2V2, ratio and essential-oil math against known values.

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, calculatorPage, dilute, MODES, DROPS_PER_ML, esc, safeHref, SITEMAP_PATHS } from './server.mjs';

test('c1v1: 70% stock → 50% in 500 mL needs ~357.14 stock + ~142.86 solvent', () => {
  const r = dilute('c1v1', { c1: 70, c2: 50, v2: 500 });
  assert.ok(r.ok);
  assert.ok(Math.abs(r.stock - 357.143) < 0.01);
  assert.ok(Math.abs(r.solvent - 142.857) < 0.01);
  assert.ok(Math.abs(r.stock + r.solvent - 500) < 1e-6);
});
test('c1v1: target above stock is rejected (soft-fail)', () => {
  assert.equal(dilute('c1v1', { c1: 50, c2: 70, v2: 100 }).ok, false);
});
test('ratio: 1:10 into 1100 mL → 100 concentrate + 1000 water', () => {
  const r = dilute('ratio', { n: 10, v2: 1100 });
  assert.ok(r.ok);
  assert.equal(r.concentrate, 100);
  assert.equal(r.water, 1000);
  assert.equal(r.ratio, '1:10');
});
test('ratio: 1:0 is neat concentrate (all concentrate)', () => {
  const r = dilute('ratio', { n: 0, v2: 500 });
  assert.equal(r.concentrate, 500); assert.equal(r.water, 0);
});
test('eo: 2% in 100 mL carrier → 2 mL, ~40 drops, ~1.84 g', () => {
  const r = dilute('eo', { pct: 2, carrierMl: 100 });
  assert.ok(r.ok);
  assert.equal(r.eoMl, 2);
  assert.equal(r.drops, 2 * DROPS_PER_ML);      // 40 drops at 20/mL
  assert.ok(Math.abs(r.eoGrams - 1.84) < 0.01); // 2 mL × 0.92 g/mL
});
test('eo: custom drops/mL and density are honoured', () => {
  const r = dilute('eo', { pct: 1, carrierMl: 100, dropsPerMl: 25, density: 0.9 });
  assert.equal(r.drops, 25);              // 1 mL × 25
  assert.ok(Math.abs(r.eoGrams - 0.9) < 1e-6);
});
test('unknown mode / garbage soft-fails, never throws', () => {
  assert.equal(dilute('nope', {}).ok, false);
  assert.equal(dilute('c1v1', {}).ok, false);
});
test('MODES lists the three modes', () => { assert.deepEqual(MODES, ['c1v1', 'ratio', 'eo']); });

function mockRes() { return { code: null, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; return this; }, end(s) { this.body = s == null ? '' : String(s); return this; } }; }
async function get(path) { const res = mockRes(); await handler({ url: path, method: 'GET', headers: { host: 'dil.test' } }, res); return res; }

test('home 200 renders the three-mode calculator', async () => {
  const res = await get('/'); assert.equal(res.code, 200);
  assert.match(res.body, /Dilution &amp; Ratio Calculator/);
  assert.match(res.body, /data-mode=c1v1/); assert.match(res.body, /data-mode=eo/);
});
test('server does no network fetch', async () => {
  const orig = globalThis.fetch; let called = false;
  globalThis.fetch = () => { called = true; throw new Error('no net'); };
  try { assert.equal((await get('/')).code, 200); assert.equal(called, false); } finally { globalThis.fetch = orig; }
});
test('inline script only — no external CDN', async () => { assert.ok(!/<script src=/i.test((await get('/')).body)); });
test('JSON API computes', async () => {
  const j = JSON.parse((await get('/api/dilute?mode=c1v1&c1=70&c2=50&v2=500')).body);
  assert.ok(j.ok); assert.ok(Math.abs(j.stock - 357.143) < 0.01);
});
test('/health ok', async () => { assert.deepEqual(JSON.parse((await get('/health')).body), { ok: true }); });
test('robots/sitemap/sitemap-index/llms serve', async () => {
  assert.match((await get('/robots.txt')).body, /User-agent/);
  assert.match((await get('/sitemap.xml')).body, /<urlset|<url>/);
  assert.match((await get('/sitemap-index.xml')).body, /sitemapindex/);
  assert.match((await get('/llms.txt')).body, /dilution/i);
});
test('SITEMAP_PATHS covers home', () => { assert.ok(SITEMAP_PATHS.includes('/')); });
test('understated MELEK unlock, tool introduced first', async () => {
  const b = (await get('/')).body;
  assert.match(b, /free MELEK account/i);
  assert.ok(b.indexOf('Dilution') < b.indexOf('MELEK'));
});
test('unknown path → 404', async () => { assert.equal((await get('/x/y')).code, 404); });
test('never throws on garbage URL', async () => { const res = mockRes(); await handler({ url: '/%%%', method: 'GET', headers: { host: 'dil.test' } }, res); assert.ok(res.code >= 200); });
test('esc/safeHref sound', () => { assert.equal(esc('<b>'), '&lt;b&gt;'); assert.equal(safeHref('javascript:x'), ''); });
test('calculatorPage() is a pure string', () => { assert.equal(typeof calculatorPage(), 'string'); });
