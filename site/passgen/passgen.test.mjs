// passgen.test.mjs — OFFLINE tests for SoapBox Password Generator (drives `handler` with a mock
// req/res; no port bound, no network). Mirrors site/diagram/diagram.test.mjs. Verifies: the generator
// renders with length + class toggles + strength meter + copy, /health is ok JSON, robots/sitemap/
// sitemap-index/llms serve, the RNG is the browser cryptographic RNG (client-side), a hostile <script>
// in the echoed len param is escaped, a hostile return URL is neutralised, there is no crypto-CURRENCY
// pitch up front, and an unknown path is a 404 (never a 500).
//
// NOTE on the crypto-pitch check: this tool legitimately uses CRYPTOGRAPHY (crypto.getRandomValues), so
// the bare word "crypto" appears in the client RNG code by necessity. The stealth-funnel rule is about
// no crypto-CURRENCY pitch, so we assert the absence of the currency words (cryptocurrency / token /
// blockchain / wallet address / coin) rather than the diagram maker's bare "crypto".

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, passgenPage, esc, safeHref, safeLen, CLASSES, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'passgen.test', ...headers } }, res);
  return res;
}

test('home 200 renders the generator (output + length + class toggles + strength + copy)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /id=pw/);                        // the generated-password output
  assert.match(res.body, /id=len/);                       // the length slider
  assert.match(res.body, /id=bar/);                       // the strength meter
  assert.match(res.body, /id=copy/);                      // the copy button
  assert.match(res.body, /Strong password generator/i);   // reads like a normal free tool
});

test('every character-class toggle has a checkbox on the page', async () => {
  const body = (await get('/')).body;
  for (const [id] of CLASSES) {
    assert.ok(body.includes(`id="c-${id}"`), `missing class toggle ${id}`);
  }
});

test('randomness is the browser cryptographic RNG, client-side — never Math.random', async () => {
  const body = (await get('/')).body;
  assert.match(body, /crypto\.getRandomValues/);          // the cryptographic RNG
  assert.ok(!/Math\.random/.test(body), 'must not use Math.random for passwords');
  assert.ok(!/<script src=/i.test(body), 'no external script src (inline only)');
});

test('the MELEK unlock is understated and opt-in — no crypto-CURRENCY pitch up front', async () => {
  const body = (await get('/')).body;
  assert.match(body, /vault/i);                           // the understated unlock CTA
  assert.match(body, /free MELEK account/i);              // revealed only inside the panel
  // no crypto-currency pitch (cryptography words like "cryptographic" are legitimately allowed here)
  assert.ok(!/\b(cryptocurrency|token|blockchain|wallet address|coins?)\b/i.test(body), 'no crypto-currency pitch up front');
  const first = body.indexOf('Strong password generator');
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
  assert.match(llms.body, /password/i);
});

test('SITEMAP_PATHS covers the home page', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('a hostile <script> in the len param is escaped (no raw payload)', async () => {
  const res = await get('/?len=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('safeLen clamps to a sane numeric range, else falls back', () => {
  assert.equal(safeLen('24'), 24);
  assert.equal(safeLen('9999'), 128);
  assert.equal(safeLen('1'), 4);
  assert.equal(safeLen('<script>'), 16);
  assert.equal(safeLen(''), 16);
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
  await handler({ url: '/%%%bad%%', headers: { host: 'passgen.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('passgenPage() is a pure string', () => {
  const html = passgenPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /id=pw/);
});
