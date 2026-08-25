// flashlight.test.mjs — OFFLINE tests for SoapBox Flashlight (drives `handler` with a mock req/res; no
// port bound, no network). Mirrors the assertion style of site/diagram/diagram.test.mjs. Verifies: the
// flashlight renders with its controls, /health is ok JSON, robots/sitemap/sitemap-index/llms serve, a
// hostile <script>/colour in an echoed param is escaped, a hostile return URL is neutralised by
// safeHref, no crypto pitch appears up front, and an unknown path is a 404 (never a 500).

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, flashlightPage, esc, safeHref, safeColor, SWATCH_KEYS, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'flashlight.test', ...headers } }, res);
  return res;
}

test('home 200 renders the flashlight (tap panel + brightness + colour + strobe)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=light/);                 // the tap-to-toggle panel
  assert.match(res.body, /id=bright/);                // brightness control
  assert.match(res.body, /id=picker/);                // colour picker
  assert.match(res.body, /id=strobe/);                // strobe toggle
  assert.match(res.body, /Free online flashlight/i);  // reads like a normal free tool
});

test('every swatch has a colour button on the page', async () => {
  const body = (await get('/')).body;
  for (const k of SWATCH_KEYS) {
    assert.ok(body.includes(`title="${k}"`), `missing swatch ${k}`);
  }
});

test('the MELEK unlock is understated and opt-in — no crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Save (settings|your settings)/i);   // the understated unlock CTA
  assert.match(body, /free MELEK account/i);              // revealed only inside the panel
  assert.ok(!/\b(crypto|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto pitch up front');
  // MELEK never leads: the tool copy comes before the first MELEK mention
  const first = body.indexOf('Free online flashlight');
  const melek = body.indexOf('MELEK');
  assert.ok(first >= 0 && first < melek, 'the tool is introduced before MELEK');
});

test('runs entirely client-side — no external network/script at runtime', async () => {
  const body = (await get('/')).body;
  assert.ok(!/https?:\/\/[^"']+\.js/i.test(body), 'must not load an external script');
  assert.ok(!/<script src=/i.test(body), 'no external script src at all (inline only)');
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
  assert.match(llms.body, /Flashlight/i);
});

test('SITEMAP_PATHS covers the home page', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> in an echoed param is escaped (no raw payload)', async () => {
  const res = await get('/?label=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  // a hostile colour is likewise neutralised (echoed escaped; the light falls back to white)
  const c = await get('/?color=' + encodeURIComponent('<script>x</script>'));
  assert.ok(!c.body.includes('<script>x</script>'));
});

test('a hostile return URL is neutralised by safeHref (no javascript: href)', async () => {
  const res = await get('/?ret=' + encodeURIComponent('javascript:alert(1)'));
  assert.equal(res.code, 200);
  assert.ok(!/href="javascript:/i.test(res.body), 'javascript: URL must never become an href');
  const ok = await get('/?ret=' + encodeURIComponent('https://example.com/app'));
  assert.match(ok.body, /href="https:\/\/example\.com\/app"/);
});

test('safeColor only accepts a hex colour, else falls back to white', () => {
  assert.equal(safeColor('#00ff88'), '#00ff88');
  assert.equal(safeColor('abcdef'), '#abcdef');
  assert.equal(safeColor('<script>'), '#ffffff');
  assert.equal(safeColor('red'), '#ffffff');
  assert.equal(safeColor(''), '#ffffff');
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
  await handler({ url: '/%%%bad%%', headers: { host: 'flashlight.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('flashlightPage() is a pure string', () => {
  const html = flashlightPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /id=light/);
});
