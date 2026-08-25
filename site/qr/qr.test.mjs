// qr.test.mjs — OFFLINE tests for SoapBox QR (drives `handler` with a mock req/res; no port bound, no
// network). Mirrors site/diagram/diagram.test.mjs. Verifies: the generator renders with the input + QR
// preview + PNG/SVG download, /health is ok JSON, robots/sitemap/sitemap-index/llms serve, the vendored
// qrcode asset serves locally (no CDN), a hostile <script> in an echoed param is escaped, a hostile
// return/text URL is neutralised by safeHref, no crypto pitch up front, and unknown path → 404 (never 500).

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, generatorPage, esc, safeHref, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'qr.test', ...headers } }, res);
  return res;
}

test('home 200 renders the generator (input + QR preview + PNG/SVG download)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=in-text/);            // the text/URL input
  assert.match(res.body, /id=qr/);                 // the live QR preview
  assert.match(res.body, /id=dl-png/);             // download PNG
  assert.match(res.body, /id=dl-svg/);             // download SVG
  assert.match(res.body, /data-tab=wifi/);         // the Wi-Fi mode
  assert.match(res.body, /Free QR code generator/i);   // reads like a normal free tool
});

test('generation is client-side from a LOCALLY vendored qrcode — no external CDN script', async () => {
  const body = (await get('/')).body;
  assert.match(body, /<script src="\/www\/qrcode\.min\.js">/);   // local path, not a CDN URL
  assert.ok(!/https?:\/\/[^"']*qrcode/i.test(body), 'must not reference an external qrcode CDN');
});

test('the vendored qrcode asset serves locally with a JS content-type + MIT license', async () => {
  const res = await get('/www/qrcode.min.js');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.ok(res.body.length > 5000, 'expected the full vendored qrcode build');
  assert.match(res.body, /QRCode/);                // the exposed global
  const lic = await get('/www/qrcode.LICENSE.txt');
  assert.equal(lic.code, 200);
  assert.match(lic.body, /MIT License/i);
});

test('the MELEK unlock is understated and opt-in — no crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Save (&amp; organise )?your codes/i);   // the understated unlock CTA
  assert.match(body, /free MELEK account/i);                  // revealed only inside the panel
  assert.ok(!/\b(crypto|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto pitch up front');
  const first = body.indexOf('Free QR code generator');
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
  assert.match(llms.body, /QR/i);
});

test('SITEMAP_PATHS covers the generator home', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> in the text param is escaped (no raw payload)', async () => {
  const res = await get('/?text=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('a hostile javascript: text URL never becomes a clickable href', async () => {
  const res = await get('/?text=' + encodeURIComponent('javascript:alert(1)'));
  assert.equal(res.code, 200);
  assert.ok(!/href="javascript:/i.test(res.body), 'javascript: URL must never become an href');
  // a real http(s) URL, by contrast, is echoed as a safe "open link"
  const ok = await get('/?text=' + encodeURIComponent('https://example.com/x'));
  assert.match(ok.body, /href="https:\/\/example\.com\/x"/);
});

test('a hostile return URL is neutralised by safeHref', async () => {
  const res = await get('/?ret=' + encodeURIComponent('javascript:alert(1)'));
  assert.equal(res.code, 200);
  assert.ok(!/href="javascript:/i.test(res.body), 'javascript: URL must never become an href');
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
  const bad = await get('/www/../server.mjs');
  assert.ok(bad.code === 404 || bad.code === 200, 'no 500 on odd static path');
});

test('never throws on a garbage URL', async () => {
  const res = mockRes();
  await handler({ url: '/%%%bad%%', headers: { host: 'qr.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('generatorPage() is a pure string with the three input modes', () => {
  const html = generatorPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /data-tab=text/);
  assert.match(html, /data-tab=wifi/);
  assert.match(html, /data-tab=contact/);
});
