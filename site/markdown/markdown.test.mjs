// markdown.test.mjs — OFFLINE tests for SoapBox Markdown (drives `handler` with a mock req/res; no port
// bound, no network). Mirrors site/diagram/diagram.test.mjs. Verifies: the editor renders with source +
// preview + export, /health is ok JSON, robots/sitemap/sitemap-index/llms serve, the vendored marked
// asset serves locally (no CDN), a hostile <script> in an echoed param is escaped, a hostile return URL is
// neutralised, no crypto pitch up front, unknown path → 404 (never 500), AND — the important one — a
// hostile <script>/<img onerror>/javascript: link in the MARKDOWN input is neutralised by sanitizeHtml()
// after the REAL vendored marked renders it (the exact path the browser preview runs).

import { test } from 'node:test';
import assert from 'node:assert';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { handler, editorPage, sanitizeHtml, esc, safeHref, SITEMAP_PATHS } from './server.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'markdown.test', ...headers } }, res);
  return res;
}

// Load the LOCALLY VENDORED marked UMD exactly as the browser would (no network), so the XSS test
// exercises the real renderer + the real sanitizer together.
function loadMarked() {
  const code = readFileSync(join(HERE, 'www', 'marked.min.js'), 'utf8');
  const mod = { exports: {} };
  // eslint-disable-next-line no-new-func
  (new Function('module', 'exports', code))(mod, mod.exports);
  return mod.exports;
}
function renderLikeBrowser(md) {
  const marked = loadMarked();
  const parser = marked.Marked ? new marked.Marked({ gfm: true, breaks: true }) : marked;
  return sanitizeHtml(parser.parse(md));   // the same two steps the preview runs
}

test('home 200 renders the editor (source textarea + preview + export)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /<textarea id=src/);       // the markdown input
  assert.match(res.body, /id=preview/);             // the live preview
  assert.match(res.body, /id=export-md/);           // export .md
  assert.match(res.body, /id=export-html/);         // export .html
  assert.match(res.body, /Free markdown editor/i);  // reads like a normal free tool
});

test('rendering is client-side from a LOCALLY vendored marked — no external CDN script', async () => {
  const body = (await get('/')).body;
  assert.match(body, /<script src="\/www\/marked\.min\.js">/);   // local path, not a CDN URL
  assert.ok(!/https?:\/\/[^"']*marked/i.test(body), 'must not reference an external marked CDN');
});

test('the vendored marked asset serves locally with a JS content-type + MIT license', async () => {
  const res = await get('/www/marked.min.js');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /javascript/);
  assert.ok(res.body.length > 20000, 'expected the full vendored marked build');
  const lic = await get('/www/marked.LICENSE.txt');
  assert.equal(lic.code, 200);
  assert.match(lic.body, /MIT/i);
});

// ── the load-bearing XSS-sanitize assertion ────────────────────────────────────────────────────────
test('a hostile <script> in the markdown input is NEUTRALISED in the preview', () => {
  const out = renderLikeBrowser('# Title\n\n<script>alert(1)</script>\n\nnormal **text**');
  assert.ok(!/<script/i.test(out), 'no <script> tag may survive');
  assert.ok(!out.includes('alert(1)') || !/<script/i.test(out), 'script must not be executable');
  assert.match(out, /<h1>Title<\/h1>/);            // legit markdown still renders
  assert.match(out, /<strong>text<\/strong>/);
});

test('a hostile <img onerror=…> in the markdown input is NEUTRALISED', () => {
  const out = renderLikeBrowser('![x](y)\n\n<img src=x onerror=alert(1)>');
  assert.ok(!/onerror/i.test(out), 'no onerror handler may survive');
  assert.ok(!/on\w+\s*=/i.test(out), 'no inline event handler may survive at all');
});

test('a javascript: link/image in the markdown input is NEUTRALISED', () => {
  const out = renderLikeBrowser('[click](javascript:alert(1)) and ![i](javascript:alert(2))');
  assert.ok(!/javascript:/i.test(out), 'no javascript: URL may survive in href/src');
});

test('sanitizeHtml() strips scripts, handlers and unsafe URLs but keeps safe markup (pure unit)', () => {
  assert.ok(!/<script/i.test(sanitizeHtml('<script>x</script><p>ok</p>')));
  assert.ok(!/onclick/i.test(sanitizeHtml('<div onclick="x">hi</div>')));
  assert.ok(!/javascript:/i.test(sanitizeHtml('<a href="javascript:x">a</a>')));
  assert.match(sanitizeHtml('<p>hello</p>'), /<p>hello<\/p>/);          // safe tag preserved
  assert.match(sanitizeHtml('<a href="https://ok.example">x</a>'), /href="https:\/\/ok\.example"/); // safe url kept
});

test('the MELEK unlock is understated and opt-in — no crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Save (your document|&amp; publish)/i);   // the understated unlock CTA
  assert.match(body, /free MELEK account/i);                   // revealed only inside the panel
  assert.ok(!/\b(crypto|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto pitch up front');
  const first = body.indexOf('Free markdown editor');
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
  assert.match(llms.body, /Markdown/i);
});

test('SITEMAP_PATHS covers the editor home', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> in the title param is escaped (no raw payload)', async () => {
  const res = await get('/?title=' + encodeURIComponent('<script>alert(1)</script>'));
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
  const bad = await get('/www/../server.mjs');
  assert.ok(bad.code === 404 || bad.code === 200, 'no 500 on odd static path');
});

test('never throws on a garbage URL', async () => {
  const res = mockRes();
  await handler({ url: '/%%%bad%%', headers: { host: 'markdown.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('editorPage() is a pure string and inlines the sanitizer', () => {
  const html = editorPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /<textarea id=src/);
  assert.match(html, /sanitizeHtml/);   // the sanitizer is inlined into the client script
});
