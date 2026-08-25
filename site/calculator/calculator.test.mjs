// calculator.test.mjs — OFFLINE tests for SoapBox Calculator (drives `handler` with a mock req/res; no
// port bound, no network). Mirrors the assertion style of site/diagram/diagram.test.mjs. Verifies: the
// calculator renders with keypad + scientific keys + history, /health is ok JSON, robots/sitemap/
// sitemap-index/llms serve, NO eval is used, a hostile <script> in the echoed expr param is escaped, a
// hostile return URL is neutralised, no crypto pitch up front, and an unknown path is a 404 (never 500).

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, calculatorPage, esc, safeHref, sanitizeExpr, SCI_KEYS, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'calculator.test', ...headers } }, res);
  return res;
}

test('home 200 renders the calculator (display + keypad + scientific keys + history)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=display/);                  // the display
  assert.match(res.body, /data-k="equals"/);             // the = key
  assert.match(res.body, /id=history/);                  // the running history
  assert.match(res.body, /Free online calculator/i);     // reads like a normal free tool
});

test('every scientific key has a button on the page', async () => {
  const body = (await get('/')).body;
  for (const k of SCI_KEYS) {
    assert.ok(body.includes(`data-k="${esc(k)}"`), `missing sci key ${k}`);
  }
  assert.ok(SCI_KEYS.includes('sin'));
  assert.ok(SCI_KEYS.includes('√'));
});

test('NEVER uses eval or the Function constructor (a safe parser instead)', async () => {
  const body = (await get('/')).body;
  assert.ok(!/\beval\s*\(/.test(body), 'must not call eval()');
  assert.ok(!/new\s+Function\s*\(/.test(body), 'must not use the Function constructor');
  assert.match(body, /shunting-yard|toRPN|evalRPN/);     // the safe evaluator is present
});

test('the MELEK unlock is understated and opt-in — no crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Save (history|your history)/i);    // the understated unlock CTA
  assert.match(body, /free MELEK account/i);             // revealed only inside the panel
  assert.ok(!/\b(crypto|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto pitch up front');
  const first = body.indexOf('Free online calculator');
  const melek = body.indexOf('MELEK');
  assert.ok(first >= 0 && first < melek, 'the tool is introduced before MELEK');
});

test('runs entirely client-side — inline script only, no external script', async () => {
  const body = (await get('/')).body;
  assert.ok(!/<script src=/i.test(body), 'no external script src (inline only)');
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
  assert.match(llms.body, /Calculator/i);
});

test('SITEMAP_PATHS covers the home page', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> in the expr param is escaped (no raw payload)', async () => {
  const res = await get('/?expr=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('sanitizeExpr strips anything a calculator cannot hold', () => {
  assert.equal(sanitizeExpr('<script>alert(1)</script>').includes('<'), false);
  assert.equal(sanitizeExpr('1+2*3'), '1+2*3');
  assert.equal(sanitizeExpr('sin(π)/2'), 'sin(π)/2');
  assert.equal(typeof sanitizeExpr(null), 'string');
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
  await handler({ url: '/%%%bad%%', headers: { host: 'calculator.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('calculatorPage() is a pure string', () => {
  const html = calculatorPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /id=display/);
});
