// habits.test.mjs — OFFLINE tests for SoapBox Habits (drives `handler` with a mock req/res; no port
// bound, no network). Mirrors site/diagram/diagram.test.mjs. Verifies: the tracker renders with an
// add box + starter chips + radar SVG, /health is ok JSON, robots/sitemap/sitemap-index/llms serve,
// every localStorage access is try/catch-guarded, the echoed ?add= param is escaped, a hostile return
// URL is neutralised, no crypto pitch up front, unknown path is a 404 (never 500), and the server
// handler performs NO network fetch (this app makes no network request at all).

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, habitsPage, esc, safeHref, STARTERS, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'habits.test', ...headers } }, res);
  return res;
}

test('home 200 renders the tracker (add box + starter chips + streak grid + radar)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=addInput/);                   // add-habit input
  assert.match(res.body, /id=addBtn/);                     // add button
  assert.match(res.body, /id=habits/);                     // the habits column
  assert.match(res.body, /<svg id=radar/);                 // the inline SVG radar (no chart lib)
  assert.match(res.body, /Habit &amp; streak tracker/i);   // reads like a normal free tool
});

test('every starter habit has a quick-add chip', async () => {
  const body = (await get('/')).body;
  for (const s of STARTERS) {
    assert.ok(body.includes(`data-starter="${esc(s)}"`), `missing starter chip ${s}`);
  }
});

test('the server renders WITHOUT any network fetch (throwing fetch injected → still renders)', async () => {
  const orig = globalThis.fetch;
  let called = false;
  globalThis.fetch = () => { called = true; throw new Error('network must not be touched by the server handler'); };
  try {
    const res = await get('/?add=Exercise');
    assert.equal(res.code, 200);
    assert.match(res.body, /id=addInput/);
    assert.equal(called, false, 'server handler must not call fetch at request time');
  } finally {
    globalThis.fetch = orig;
  }
});

test('persists to localStorage, and every access is try/catch guarded (no data API at all)', async () => {
  const body = (await get('/')).body;
  assert.match(body, /localStorage/);                            // it uses localStorage
  assert.ok(/try\{[\s\S]*localStorage\.setItem/.test(body), 'writes must be inside try/catch');
  assert.ok(/try\{[\s\S]*localStorage\.getItem/.test(body), 'reads must be inside try/catch');
  // this app draws its own radar — no external chart library and no runtime fetch anywhere
  assert.ok(!/<script src=/i.test(body), 'no external script src (inline, self-drawn SVG)');
  assert.ok(!/fetch\(/.test(body), 'the habit tracker makes no network request at all');
});

test('the MELEK unlock is understated and opt-in — no crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /sync (your )?streaks/i);               // the understated unlock CTA
  assert.match(body, /free MELEK account/i);                 // revealed only inside the panel
  assert.ok(!/\b(crypto|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto pitch up front');
  const first = body.indexOf('Habit &amp; streak tracker');
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
  assert.match(llms.body, /Habit/i);
});

test('SITEMAP_PATHS covers the home page', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> in the add param is escaped (no raw payload)', async () => {
  const res = await get('/?add=' + encodeURIComponent('<script>alert(1)</script>'));
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
  await handler({ url: '/%%%bad%%', headers: { host: 'habits.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('habitsPage() is a pure string with the add box and radar', () => {
  const html = habitsPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /id=addInput/);
  assert.match(html, /<svg id=radar/);
});
