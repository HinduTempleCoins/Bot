// unitprice.test.mjs — OFFLINE tests for the SoapBox Unit Price Calculator (engine + handler; no port,
// no network). Verifies price-per-unit, best-value selection, pack counts, param parsing.

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, calculatorPage, compare, itemsFromParam, esc, safeHref, SITEMAP_PATHS } from './server.mjs';

test('compare: cheaper-per-unit option wins even when its sticker price is higher', () => {
  // 3.50 / 1000 = 0.0035/unit  vs  2.10 / 500 = 0.0042/unit → the 1000-size is best value
  const r = compare([{ price: 3.50, size: 1000 }, { price: 2.10, size: 500 }]);
  assert.ok(r.ok);
  assert.equal(r.bestIndex, 0);
  assert.equal(r.rows[0].unitPrice, 0.0035);
  assert.equal(r.rows[0].best, true);
  assert.equal(r.rows[1].best, false);
  assert.equal(r.rows[1].pctAboveBest, 20); // 0.0042 is 20% above 0.0035
});
test('compare: pack count multiplies the quantity', () => {
  // 6.00 for a 4-pack of 330 mL = 6 / 1320 vs single 500 mL at 2.00 = 0.004
  const r = compare([{ price: 6.00, size: 330, pack: 4 }, { price: 2.00, size: 500 }]);
  assert.ok(Math.abs(r.rows[0].unitPrice - (6 / 1320)) < 1e-5); // unitPrice is rounded to 6dp
});
test('compare: invalid rows are kept but not chosen; needs one valid', () => {
  const r = compare([{ price: 5, size: 0 }, { price: 4, size: 200 }]);
  assert.ok(r.ok); assert.equal(r.bestIndex, 1);
  assert.equal(r.rows[0].unitPrice, null);
});
test('compare: empty / all-invalid soft-fails, never throws', () => {
  assert.equal(compare([]).ok, false);
  assert.equal(compare([{ price: 1, size: 0 }]).ok, false);
});
test('itemsFromParam parses price@size and price@sizexPack', () => {
  const items = itemsFromParam('3.50@1000,6@330x4');
  assert.equal(items.length, 2);
  assert.equal(items[0].price, 3.5); assert.equal(items[0].size, 1000); assert.equal(items[0].pack, 1);
  assert.equal(items[1].pack, 4);
});

function mockRes() { return { code: null, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; return this; }, end(s) { this.body = s == null ? '' : String(s); return this; } }; }
async function get(path) { const res = mockRes(); await handler({ url: path, method: 'GET', headers: { host: 'up.test' } }, res); return res; }

test('home 200 renders the comparison form', async () => {
  const res = await get('/'); assert.equal(res.code, 200);
  assert.match(res.body, /Unit Price Calculator/);
  assert.match(res.body, /Add option/);
});
test('server does no network fetch', async () => {
  const orig = globalThis.fetch; let called = false;
  globalThis.fetch = () => { called = true; throw new Error('no net'); };
  try { assert.equal((await get('/')).code, 200); assert.equal(called, false); } finally { globalThis.fetch = orig; }
});
test('inline script only — no external CDN', async () => { assert.ok(!/<script src=/i.test((await get('/')).body)); });
test('JSON API computes and flags best', async () => {
  const j = JSON.parse((await get('/api/unit?items=3.50@1000,2.10@500')).body);
  assert.ok(j.ok); assert.equal(j.bestIndex, 0);
});
test('/health ok', async () => { assert.deepEqual(JSON.parse((await get('/health')).body), { ok: true }); });
test('robots/sitemap/sitemap-index/llms serve', async () => {
  assert.match((await get('/robots.txt')).body, /User-agent/);
  assert.match((await get('/sitemap.xml')).body, /<urlset|<url>/);
  assert.match((await get('/sitemap-index.xml')).body, /sitemapindex/);
  assert.match((await get('/llms.txt')).body, /unit price/i);
});
test('SITEMAP_PATHS covers home', () => { assert.ok(SITEMAP_PATHS.includes('/')); });
test('understated MELEK unlock, tool introduced first', async () => {
  const b = (await get('/')).body;
  assert.match(b, /free MELEK account/i);
  assert.ok(b.indexOf('Unit Price Calculator') < b.indexOf('MELEK'));
});
test('unknown path → 404', async () => { assert.equal((await get('/x/y')).code, 404); });
test('never throws on garbage URL', async () => { const res = mockRes(); await handler({ url: '/%%%', method: 'GET', headers: { host: 'up.test' } }, res); assert.ok(res.code >= 200); });
test('esc/safeHref sound', () => { assert.equal(esc('<b>'), '&lt;b&gt;'); assert.equal(safeHref('javascript:x'), ''); });
test('calculatorPage() is a pure string', () => { assert.equal(typeof calculatorPage(), 'string'); });
