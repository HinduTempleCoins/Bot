// timer.test.mjs — OFFLINE tests for SoapBox Timer (drives `handler` with a mock req/res; no port bound,
// no network). Mirrors site/notes/notes.test.mjs. Verifies: the timer renders with the three modes + a
// display + controls, /health is ok JSON, robots/sitemap/sitemap-index/llms serve, no external library
// (inline script only), a hostile <script> in an echoed param is neutralised, a hostile return URL is
// neutralised, no crypto pitch up front, and an unknown path is a 404 (never 500). Also checks the app
// deliberately avoids the "Pomodoro" trademark.

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, timerPage, sanitizeMinutes, esc, safeHref, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'timer.test', ...headers } }, res);
  return res;
}

test('home 200 renders the timer (display + start/reset + three modes)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=display/);              // the big time display
  assert.match(res.body, /id=startstop/);            // start/stop control
  assert.match(res.body, /data-tab=focus/);          // focus timer mode
  assert.match(res.body, /data-tab=stopwatch/);      // stopwatch mode
  assert.match(res.body, /data-tab=countdown/);      // countdown mode
  assert.match(res.body, /Free focus timer/i);       // reads like a normal free tool
});

test('runs entirely client-side with no external library — inline script only', async () => {
  const body = (await get('/')).body;
  assert.ok(!/<script src=/i.test(body), 'no external script src (no library, inline only)');
});

test('avoids the "Pomodoro" trademark in name and copy', async () => {
  const body = (await get('/')).body;
  assert.ok(!/pomodoro/i.test(body), 'must not use the Pomodoro trademark');
  assert.match(body, /Focus [Tt]imer/);              // uses the generic name instead
});

test('the MELEK unlock is understated and opt-in — no crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Log your (focus )?sessions/i);   // the understated unlock CTA
  assert.match(body, /free MELEK account/i);           // revealed only inside the panel
  assert.ok(!/\b(crypto|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto pitch up front');
  const first = body.indexOf('Free focus timer');
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
  assert.match(llms.body, /timer/i);
});

test('SITEMAP_PATHS covers the timer home', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> in the mins param is neutralised (clamped to a safe integer, no raw payload)', async () => {
  const res = await get('/?mins=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  // a hostile / non-numeric mins falls back to the default 25 — never markup
  assert.match(res.body, /id=work-min[^>]*value="25"/);
  assert.equal(sanitizeMinutes('<script>alert(1)</script>'), 25);
  assert.equal(sanitizeMinutes('45'), 45);
  assert.equal(sanitizeMinutes('9999'), 180);   // clamped to the max
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
  await handler({ url: '/%%%bad%%', headers: { host: 'timer.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('timerPage() is a pure string with the three modes', () => {
  const html = timerPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /data-tab=focus/);
  assert.match(html, /data-tab=stopwatch/);
  assert.match(html, /data-tab=countdown/);
});
