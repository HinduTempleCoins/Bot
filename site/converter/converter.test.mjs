// converter.test.mjs — OFFLINE tests for SoapBox Converter (drives `handler` with a mock req/res; no
// port bound, no network). Mirrors site/diagram/diagram.test.mjs. Verifies: the converter renders with
// unit tabs + currency tab + static reference tables, /health is ok JSON, robots/sitemap/sitemap-index/
// llms serve, a hostile <script> in the echoed cat param is escaped, a hostile return URL is neutralised,
// no crypto pitch up front, unknown path is a 404 (never 500), and — critically — the server handler
// performs NO network fetch (a throwing global fetch is injected; the page must still render).

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, converterPage, esc, safeHref, CATEGORY_KEYS, UNITS, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'convert.test', ...headers } }, res);
  return res;
}

test('home 200 renders the converter (value input + unit selects + tabs)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=inval/);                      // value input
  assert.match(res.body, /id=fromUnit/);                   // from-unit select
  assert.match(res.body, /id=toUnit/);                     // to-unit select
  assert.match(res.body, /data-cat="length"/);             // at least one unit tab
  assert.match(res.body, /data-cat="currency"/);           // the currency tab
  assert.match(res.body, /Unit &amp; currency converter/i);// reads like a normal free tool
});

test('every unit category has a tab, and the static reference tables render server-side', async () => {
  const body = (await get('/')).body;
  for (const k of CATEGORY_KEYS) {
    assert.ok(body.includes(`data-cat="${k}"`), `missing category tab ${k}`);
  }
  // the offline reference tables are rendered as real <table> markup (no fetch needed to see them)
  assert.match(body, /Conversion reference tables/i);
  assert.match(body, /<table class=ref>/);
  assert.ok(body.includes(esc(UNITS.length.units.mi.label)), 'expected a length unit label in the tables');
});

test('the server renders WITHOUT any network fetch (throwing fetch injected → still renders)', async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error('network must not be touched by the server handler'); };
  try {
    const res = await get('/');
    assert.equal(res.code, 200);
    assert.match(res.body, /id=inval/);
    assert.equal(called, false, 'server handler must not call fetch at request time');
  } finally {
    globalThis.fetch = orig;
  }
});

test('live currency uses a CLIENT-SIDE fetch to the keyless Frankfurter API (no server call, no key)', async () => {
  const body = (await get('/')).body;
  // the fetch lives in the inline client script; there is no API key anywhere
  assert.match(body, /fetch\(/);                                  // client-side fetch present
  assert.match(body, /frankfurter/i);                            // to Frankfurter
  assert.ok(!/api[_-]?key/i.test(body), 'no API key should appear anywhere');
  assert.match(body, /rates? (are )?unavailable/i);              // graceful fallback copy present
});

test('runs client-side — inline script only, no external script src / CDN', async () => {
  const body = (await get('/')).body;
  assert.ok(!/<script src=/i.test(body), 'no external script src (inline only)');
});

test('the MELEK unlock is understated and opt-in — no crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Save your conversions/i);              // the understated unlock CTA
  assert.match(body, /free MELEK account/i);                 // revealed only inside the panel
  assert.ok(!/\b(crypto|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto pitch up front');
  const first = body.indexOf('Unit &amp; currency converter');
  const melek = body.indexOf('MELEK');
  assert.ok(first >= 0 && first < melek, 'the tool is introduced before MELEK');
});

test('/health returns {"ok":true}', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  assert.match(robots.body, /User-agent/);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  assert.match(smi.body, /sitemapindex/);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /Converter/i);
});

test('SITEMAP_PATHS covers the home page', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> in the cat param is escaped (no raw payload)', async () => {
  const res = await get('/?cat=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('a hostile return URL is neutralised by safeHref (no javascript: href)', async () => {
  const res = await get('/?ret=' + encodeURIComponent('javascript:alert(1)'));
  assert.equal(res.code, 200);
  assert.ok(!/href="javascript:/i.test(res.body), 'javascript: URL must never become an href');
  const ok = await get('/?ret=' + encodeURIComponent('https://example.com/app'));
  assert.match(ok.body, /href="https:\/\/example\.com\/app"/);
});

test('esc() and safeHref() are sound', () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://ok.example/x'), 'https://ok.example/x');
  assert.equal(safeHref(''), '');
});

test('unknown path → 404, never a 500', async () => {
  const res = await get('/this/does/not/exist');
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/i);
});

test('never throws on a garbage URL', async () => {
  const res = mockRes();
  await handler({ url: '/%%%bad%%', headers: { host: 'convert.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('converterPage() is a pure string with the category tabs named', () => {
  const html = converterPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, />Length</);
  assert.match(html, />Temperature</);
  assert.match(html, />Currency</);
});
