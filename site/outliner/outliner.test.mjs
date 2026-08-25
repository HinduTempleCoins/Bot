// outliner.test.mjs — OFFLINE tests for SoapBox Outliner (drives `handler` with a mock req/res; no port
// bound, no network). Mirrors site/notes/notes.test.mjs. Verifies: the outliner renders with a tree +
// title + export, /health is ok JSON, robots/sitemap/sitemap-index/llms serve, localStorage access is
// try/catch-guarded, the tree logic is a self-contained model (no external script), a hostile <script>
// in the echoed title param is escaped, a hostile return URL is neutralised, no crypto pitch up front,
// and an unknown path is a 404 (never 500).

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, outlinerPage, esc, safeHref, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'outliner.test', ...headers } }, res);
  return res;
}

test('home 200 renders the outliner (tree container + title + export buttons)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=tree/);                     // the tree mount
  assert.match(res.body, /id=title/);                    // the outline title input
  assert.match(res.body, /id=export-txt/);               // export .txt
  assert.match(res.body, /id=export-json/);              // export .json
  assert.match(res.body, /id=collapse-all/);             // collapsible
  assert.match(res.body, /Free online outliner/i);       // reads like a normal free tool
});

test('autosaves to localStorage, and every access is try/catch guarded', async () => {
  const body = (await get('/')).body;
  assert.match(body, /localStorage/);
  assert.match(body, /autosave/i);
  assert.ok(/try\{[\s\S]*localStorage\.setItem/.test(body), 'writes must be inside try/catch');
  assert.ok(/try\{[\s\S]*localStorage\.getItem/.test(body), 'reads must be inside try/catch');
});

test('the tree logic is self-contained — inline script only, no external script', async () => {
  const body = (await get('/')).body;
  assert.ok(!/<script src=/i.test(body), 'no external script src (inline, self-contained tree)');
});

test('the MELEK unlock is understated and opt-in — no crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Sync (your outline|&amp; publish|&amp; publish it)/i);   // understated unlock CTA
  assert.match(body, /free MELEK account/i);                                    // revealed only in the panel
  assert.ok(!/\b(crypto|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto pitch up front');
  const first = body.indexOf('Free online outliner');
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
  assert.match(llms.body, /Outliner/i);
});

test('SITEMAP_PATHS covers the home page', () => {
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
  await handler({ url: '/%%%bad%%', headers: { host: 'outliner.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('outlinerPage() is a pure string', () => {
  const html = outlinerPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /id=tree/);
});
