// towns.test.mjs — OFFLINE tests for the Crypto-Town Kit (drives `handler` with a mock req/res; no port
// bound, no network). Mirrors the assertion style of site/diagram/diagram.test.mjs. Verifies: the kit
// landing renders every step, each step deep-page renders, /health is ok JSON, robots/sitemap/
// sitemap-index/llms serve, a hostile <script> in an echoed param is escaped, a hostile return URL is
// neutralised by safeHref, the "not legal advice" disclaimer is on the legal step, there is NO price/
// return-promise (shill) language anywhere, BASE_PATH prefixes emitted URLs, and unknown → 404 (never 500).

import { test } from 'node:test';
import assert from 'node:assert';
import { handler, kitPage, stepPage, esc, safeHref, STEPS, STEP_SLUGS, SITEMAP_PATHS } from './server.mjs';

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
  await handler({ url: path, headers: { host: 'towns.test', ...headers } }, res);
  return res;
}

// A promise/shill regex: the language a real-utility community currency must NEVER use.
const SHILL = /\b(guaranteed\s+returns?|guaranteed\s+profits?|profits?\b|\breturns?\s+on\s+investment|\broi\b|get\s+rich|to\s+the\s+moon|moon(?:ing|shot)?|lambo|price\s+will\s+(?:go\s+up|rise|soar|increase|explode)|10x|100x|pump)\b/i;

test('home 200 renders the kit with all six steps', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Start your community/i);
  for (const s of STEPS) {
    assert.ok(res.body.includes(esc(s.title)), `missing step title: ${s.title}`);
    assert.ok(res.body.includes(`data-step="${s.slug}"`), `missing checklist item: ${s.slug}`);
  }
  assert.equal(STEPS.length, 6);
});

test('every step is a real navigable deep page', async () => {
  for (const s of STEPS) {
    const res = await get('/step/' + s.slug);
    assert.equal(res.code, 200, `step ${s.slug} should 200`);
    assert.match(res.body, new RegExp('Step ' + s.n));
    assert.ok(res.body.includes(esc(s.title)), `deep page missing title ${s.title}`);
    // its body prose is present
    assert.ok(res.body.length > 1500, `step ${s.slug} page too thin`);
  }
});

test('each step links its real existing surface (env-configurable, safe hrefs)', async () => {
  const home = (await get('/')).body;
  // token turnkey, pool/pay, governance/DAO, oversight, signup+REN identity all appear as https links
  assert.match(home, /href="https:\/\/tokens\./);          // step 1 token turnkey
  assert.match(home, /href="https:\/\/pool\./);            // step 2 local currency / pay
  assert.match(home, /href="https:\/\/dao\./);             // step 3 governance
  assert.match(home, /href="https:\/\/oversight\./);       // step 4 oversight
  assert.match(home, /href="https:\/\/wallet\./);          // step 5 identity (signup)
  assert.match(home, /href="https:\/\/ren\./);             // step 5 REN name
  // no javascript:/data: ever becomes an href, even from a config value
  assert.ok(!/href="(javascript|data):/i.test(home));
});

test('token framing is real UTILITY, never a price/return/appreciation promise', async () => {
  // whole site: landing + every step page
  let all = (await get('/')).body;
  for (const s of STEPS) all += (await get('/step/' + s.slug)).body;
  assert.ok(!SHILL.test(all), 'shill / return-promise language must not appear');
  // and it positively frames the token as utility + the 65/35 split
  const token = (await get('/step/token')).body;
  assert.match(token, /real\s+utility/i);
  assert.match(token, /65%[^]*35%/);                       // author/curator split
  assert.match(token, /not\b[^]*speculation/i);            // explicitly not a speculation
});

test('the legal step carries a "not legal advice" disclaimer and stays non-advice', async () => {
  const res = await get('/step/legal');
  assert.equal(res.code, 200);
  assert.match(res.body, /not\s+legal\s+advice/i);
  assert.match(res.body, /consult\s+a\s+(licensed|qualified)/i);
  assert.match(res.body, /501\(c\)\(3\)/);
  // the landing also surfaces the disclaimer near the legal callout
  assert.match((await get('/')).body, /not\s+legal\s+advice/i);
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
  // every step is in the sitemap
  for (const slug of STEP_SLUGS) assert.ok(sm.body.includes('/step/' + slug), `sitemap missing ${slug}`);
  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  assert.match(smi.body, /sitemapindex/);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /kit/i);
});

test('SITEMAP_PATHS covers the home and every step', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  for (const slug of STEP_SLUGS) assert.ok(SITEMAP_PATHS.includes('/step/' + slug));
});

test('a hostile <script> in the town param is escaped (no raw payload)', async () => {
  const res = await get('/?town=' + encodeURIComponent('<script>alert(1)</script>'));
  assert.equal(res.code, 200);
  assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw hostile payload must not appear');
  assert.match(res.body, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
});

test('a hostile return URL is neutralised by safeHref (no javascript: href)', async () => {
  const res = await get('/?ret=' + encodeURIComponent('javascript:alert(1)'));
  assert.equal(res.code, 200);
  assert.ok(!/href="javascript:/i.test(res.body), 'javascript: URL must never become an href');
  // a real http(s) return URL, by contrast, is allowed through
  const ok = await get('/?ret=' + encodeURIComponent('https://example.com/hub'));
  assert.match(ok.body, /href="https:\/\/example\.com\/hub"/);
});

test('esc() and safeHref() are sound', () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(safeHref('javascript:alert(1)'), '');
  assert.equal(safeHref('data:text/html,x'), '');
  assert.equal(safeHref('https://ok.example/x'), 'https://ok.example/x');
  assert.equal(safeHref(''), '');
});

test('BASE_PATH prefixes emitted self-URLs (Tools-hub mount)', async () => {
  // Re-import the module fresh with BASE_PATH set, so the const is evaluated with the env.
  process.env.BASE_PATH = '/towns';
  const mod = await import('./server.mjs?bp=1');
  const html = mod.kitPage({});
  assert.ok(html.includes('href="/towns/step/token"'), 'step links should carry the BASE_PATH prefix');
  assert.ok(html.includes('href="/towns/"'), 'the brand/home link should carry the prefix');
  delete process.env.BASE_PATH;
});

test('unknown path → 404, never a 500', async () => {
  const res = await get('/this/does/not/exist');
  assert.equal(res.code, 404);
  assert.match(res.body, /Not found/i);
  // an unknown step slug is a 404 too, not a 500
  const bad = await get('/step/not-a-real-step');
  assert.equal(bad.code, 404);
});

test('never throws on a garbage URL', async () => {
  const res = mockRes();
  await handler({ url: '/%%%bad%%', headers: { host: 'towns.test' } }, res);
  assert.ok(res.code === 404 || res.code === 500 || res.code === 200);
});

test('kitPage() and stepPage() are pure strings; unknown step → null', () => {
  const html = kitPage({});
  assert.equal(typeof html, 'string');
  assert.match(html, /Your community token/);
  assert.equal(typeof stepPage('token'), 'string');
  assert.equal(stepPage('nope'), null);
});
