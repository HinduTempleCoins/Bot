// tools.test.mjs — OFFLINE tests for the SoapBox Tools hub (drives `handler` with a mock req/res; no
// port bound, no network). Mirrors site/diagram + site/flashlight assertion style. Verifies: the
// landing lists every app, /health is ok JSON, robots/sitemap/sitemap-index/llms serve and carry the
// app paths, the landing reads as a plain free-tools directory (NO crypto pitch up front), unknown path
// is a 404 (never a 500), and the handler never throws. Plus: base-path retrofit spot-checks — with
// BASE_PATH set an app emits the prefix on its self-URLs; unset, the output is byte-for-byte unchanged.

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, landingPage, esc, safeHref, UTILITIES, GAMES, APP_PATHS, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'tools.test', ...headers } }, res);
  return res;
}

const ALL_APPS = [...UTILITIES, ...GAMES];
// A crypto PITCH must not appear on the friendly front page. (The bare word "Wallet" is a mundane app
// label and is allowed; these are the words that would read as a crypto/token pitch.)
const CRYPTO_PITCH = /\b(crypto|cryptocurrency|blockchain|token|MELEK|PRANA|bitcoin|ethereum|web3)\b/i;

test('landing 200 lists a card for every app (utilities + games)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  for (const a of ALL_APPS) {
    assert.ok(res.body.includes(`href="/${a.slug}"`), `hub missing card link for /${a.slug}`);
    assert.ok(res.body.includes(esc(a.name)), `hub missing name for ${a.slug}`);
  }
  // the shelves are present
  assert.match(res.body, />Utilities</);
  assert.match(res.body, />Games</);
  assert.match(res.body, />Move</);
});

test('the Move and Wallet/Profile front-door cards render (coming-soon when no URL is set)', async () => {
  const body = (await get('/')).body;
  assert.match(body, /Move/);
  assert.match(body, /Wallet \/ Profile/);
  assert.match(body, /coming soon/i);              // no URL env in tests → calm coming-soon tiles
});

test('the landing reads as a plain free-tools directory — NO crypto pitch up front', async () => {
  const body = (await get('/')).body;
  assert.ok(!CRYPTO_PITCH.test(body), 'no crypto/token/MELEK pitch may appear on the landing');
  assert.match(body, /Free tools for everyday things/);  // the mundane headline leads
  assert.match(body, /no sign-up/i);
});

test('landingPage() is a pure string with the directory headline', () => {
  const html = landingPage();
  assert.equal(typeof html, 'string');
  assert.match(html, /Free tools for everyday things/);
});

test('/health returns {"ok":true}', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.deepEqual(JSON.parse(res.body), { ok: true });
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve and carry the app paths', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  assert.match(robots.body, /User-agent/);

  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  for (const a of ALL_APPS) {
    assert.ok(sm.body.includes(`/${a.slug}</loc>`), `sitemap missing /${a.slug}`);
  }

  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  assert.match(smi.body, /sitemapindex/);

  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /SoapBox Tools/);
  for (const a of ALL_APPS) {
    assert.ok(llms.body.includes(`/${a.slug}`), `llms.txt missing /${a.slug}`);
  }
});

test('SITEMAP_PATHS / APP_PATHS cover the home page and every app', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  assert.strictEqual(SITEMAP_PATHS, APP_PATHS);
  for (const a of ALL_APPS) assert.ok(APP_PATHS.includes(`/${a.slug}`));
});

test('unknown path → 404, never a 500', async () => {
  const res = await get('/this/does/not/exist');
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/i);
});

test('never throws on a garbage URL', async () => {
  const res = mockRes();
  await handler({ url: '/%%%bad%%', headers: { host: 'tools.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('esc() and safeHref() are sound', () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://ok.example/x'), 'https://ok.example/x');
  assert.equal(safeHref(''), '');
});

// ── base-path retrofit spot-checks (STEP 1) ─────────────────────────────────────────────────────────
// Import a fresh copy of an app's module with BASE_PATH set, and confirm the emitted self-URLs carry
// the prefix; then confirm the default (unset) output is unchanged. Fresh imports via a cache-busting
// query so the module-level BASE_PATH is read anew each time.
async function renderApp(slug, env = {}) {
  const saved = {};
  for (const k of Object.keys(env)) { saved[k] = process.env[k]; process.env[k] = env[k]; }
  try {
    const mod = await import(`../${slug}/server.mjs?bp=${encodeURIComponent(JSON.stringify(env))}`);
    const res = mockRes();
    await mod.handler({ url: '/', headers: { host: `${slug}.test` } }, res);
    return res.body;
  } finally {
    for (const k of Object.keys(env)) {
      if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
    }
  }
}

test('BASE_PATH prefixes an app\'s emitted self-URLs (qr) — and unset leaves them unchanged', async () => {
  const withBp = await renderApp('qr', { BASE_PATH: '/qr' });
  assert.ok(withBp.includes('src="/qr/www/'), 'qr asset src must carry the /qr prefix');
  assert.ok(withBp.includes('class=brand href="/qr/"'), 'qr brand link must carry the /qr prefix');

  const plain = await renderApp('qr', {});
  assert.ok(plain.includes('src="/www/'), 'unset: qr asset src stays on /www/');
  assert.ok(plain.includes('class=brand href="/"'), 'unset: qr brand link stays on /');
  assert.ok(!plain.includes('/qr/www/'), 'unset: no /qr prefix leaks');
});

test('BASE_PATH prefixes the calculator brand link — and unset is unchanged', async () => {
  const withBp = await renderApp('calculator', { BASE_PATH: '/calculator' });
  assert.ok(withBp.includes('class=brand href="/calculator/"'), 'calculator brand must carry /calculator');

  const plain = await renderApp('calculator', {});
  assert.ok(plain.includes('class=brand href="/"'), 'unset: calculator brand stays on /');
  assert.ok(!plain.includes('/calculator/"'), 'unset: no /calculator prefix leaks into self-links');
});

test('BASE_PATH prefixes the diagram vendored script + the shared Tools nav appears', async () => {
  const withBp = await renderApp('diagram', { BASE_PATH: '/diagram' });
  assert.ok(withBp.includes('src="/diagram/www/mermaid.min.js"'), 'diagram script must carry /diagram');
  assert.ok(withBp.includes('SoapBox Tools'), 'the shared hub nav header must be present');

  const plain = await renderApp('diagram', {});
  assert.ok(plain.includes('src="/www/mermaid.min.js"'), 'unset: diagram script stays on /www/');
});
