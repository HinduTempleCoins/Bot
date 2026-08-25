// weather.test.mjs — OFFLINE tests for SoapBox Weather (drives `handler` with a mock req/res; no port
// bound, no network). Mirrors site/diagram/diagram.test.mjs. Verifies: the shell renders with a search
// box + geolocate + forecast panel, /health is ok JSON, robots/sitemap/sitemap-index/llms serve, the
// echoed ?q= city param is escaped, a hostile return URL is neutralised, no crypto pitch up front,
// unknown path is a 404 (never 500), and — critically — the server handler performs NO network fetch
// (a throwing global fetch is injected; the shell must still render; data fetch is client-side only).

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, weatherPage, esc, safeHref, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'weather.test', ...headers } }, res);
  return res;
}

test('home 200 renders the shell (city search + geolocate + forecast panel)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=q/);                          // city search input
  assert.match(res.body, /id=geo/);                        // geolocate button
  assert.match(res.body, /id=current/);                    // the forecast panel
  assert.match(res.body, /id=days/);                       // the 7-day strip container
  assert.match(res.body, /7-day forecast/i);               // reads like a normal free weather app
});

test('the server renders the SHELL WITHOUT any network fetch (throwing fetch injected → still renders)', async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error('network must not be touched by the server handler'); };
  try {
    const res = await get('/?q=London');
    assert.equal(res.code, 200);
    assert.match(res.body, /id=q/);
    assert.equal(called, false, 'server handler must not call fetch at request time');
  } finally {
    globalThis.fetch = orig;
  }
});

test('weather data uses a CLIENT-SIDE fetch to the keyless Open-Meteo API (no server call, no key)', async () => {
  const body = (await get('/')).body;
  assert.match(body, /fetch\(/);                                 // client-side fetch present
  assert.match(body, /open-meteo/i);                            // to Open-Meteo (forecast + geocoding)
  assert.match(body, /geocoding-api\.open-meteo|GEOCODE_API/);  // geocoding endpoint wired
  assert.ok(!/api[_-]?key/i.test(body), 'no API key should appear anywhere');
  assert.match(body, /load the forecast/i);                    // graceful fallback copy present
});

test('runs client-side — inline script only, no external script src / CDN', async () => {
  const body = (await get('/')).body;
  assert.ok(!/<script src=/i.test(body), 'no external script src (inline only)');
});

test('the MELEK unlock is understated and opt-in — no crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Save (your )?places/i);                // the understated unlock CTA
  assert.match(body, /free MELEK account/i);                 // revealed only inside the panel
  assert.ok(!/\b(crypto|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto pitch up front');
  const first = body.indexOf('7-day forecast');
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
  assert.match(llms.body, /Weather/i);
});

test('SITEMAP_PATHS covers the home page', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> in the echoed q param is escaped (no raw payload)', async () => {
  const res = await get('/?q=' + encodeURIComponent('<script>alert(1)</script>'));
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
  await handler({ url: '/%%%bad%%', headers: { host: 'weather.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('weatherPage() is a pure string with the search + forecast shell', () => {
  const html = weatherPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /id=q/);
  assert.match(html, /id=current/);
});
