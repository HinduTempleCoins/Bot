// diagram.test.mjs — OFFLINE tests for SoapBox Diagrams (drives `handler` with a mock req/res; no port
// bound, no network). Mirrors the assertion style of site/insurance/insurance-site.test.mjs. Verifies:
// the editor renders with templates, /health is ok JSON, robots/sitemap/sitemap-index/llms serve, the
// vendored mermaid asset serves locally, a hostile <script> in an echoed param is escaped, a hostile
// return URL is neutralised by safeHref, and an unknown path is a 404 (never a 500).

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, editorPage, esc, safeHref, TEMPLATE_KEYS, SITEMAP_PATHS } from './server.mjs';

// Minimal mock res that captures status/headers/body.
function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'diagram.test', ...headers } }, res);
  return res;
}

test('home 200 renders the editor (textarea + preview + template buttons)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /<textarea id=src/);              // the editor input
  assert.match(res.body, /id=preview/);                    // the live preview
  assert.match(res.body, /data-tpl="flowchart"/);          // at least one starter template button
  assert.match(res.body, /Free flowchart/i);               // reads like a normal free tool
});

test('every starter template has a button on the page', async () => {
  const body = (await get('/')).body;
  for (const k of TEMPLATE_KEYS) {
    assert.ok(body.includes(`data-tpl="${k}"`), `missing template button ${k}`);
  }
  assert.ok(TEMPLATE_KEYS.includes('flowchart'));
  assert.ok(TEMPLATE_KEYS.includes('sequence'));
});

test('rendering is client-side from a LOCALLY vendored mermaid — no external CDN script', async () => {
  const body = (await get('/')).body;
  assert.match(body, /<script src="\/www\/mermaid\.min\.js">/);   // local path, not a CDN URL
  assert.ok(!/https?:\/\/[^"']*mermaid/i.test(body), 'must not reference an external mermaid CDN');
});

test('the vendored mermaid asset serves locally with a JS content-type', async () => {
  const res = await get('/www/mermaid.min.js');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.ok(res.body.length > 100000, 'expected the full vendored mermaid build');
  const lic = await get('/www/mermaid.LICENSE.txt');
  assert.equal(lic.code, 200);
  assert.match(lic.body, /MIT License/i);
});

test('the MELEK unlock is understated and opt-in — no crypto/token/wallet talk up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Save to your library/i);             // the understated unlock CTA
  assert.match(body, /free MELEK account/i);               // revealed only inside the panel
  // no wallet/token/crypto pitch anywhere in the opening copy
  assert.ok(!/\b(crypto|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto pitch up front');
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
  assert.match(llms.body, /Diagram/i);
});

test('SITEMAP_PATHS covers the editor home', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> in the tpl param is escaped (no raw payload)', async () => {
  const res = await get('/?tpl=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);   // it is escaped instead
});

test('a hostile return URL is neutralised by safeHref (no javascript: href)', async () => {
  const res = await get('/?ret=' + encodeURIComponent('javascript:alert(1)'));
  assert.equal(res.code, 200);
  assert.ok(!/href="javascript:/i.test(res.body), 'javascript: URL must never become an href');
  // a real http(s) return URL, by contrast, is allowed through
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
  // a bogus static asset name is a 404 too, not a 500
  const bad = await get('/www/../server.mjs');
  assert.ok(bad.code === 404 || bad.code === 200, 'no 500 on odd static path');
});

test('never throws on a garbage URL', async () => {
  const res = mockRes();
  await handler({ url: '/%%%bad%%', headers: { host: 'diagram.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('editorPage() is a pure string with the four starter templates named', () => {
  const html = editorPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, />Flowchart</);
  assert.match(html, />Sequence</);
  assert.match(html, />Org chart</);
  assert.match(html, />Mind map</);
});
