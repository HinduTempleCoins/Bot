// academy-token.test.mjs — offline tests for the Token Academy "manage & buyback" how-to surface.
// Drives `handler` with a mock req/res (no port bound, no network). Verifies the action board renders
// the steps, the tool links are present, robots/sitemap/llms serve, esc() escaping is sound, the
// compliance framing (buyback = management, not a price-floor) + not-investment-advice note are in the
// copy, and no route ever throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, homePage, esc, STEPS, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'academy.test', ...headers } }, res);
  return res;
}

test('home 200 lists the how-to steps (create/issue → rewards → burn → buyback → KulaSwap)', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /Manage your token &amp; do a buyback/);
  assert.match(res.body, /Create &amp; issue your token/);
  assert.match(res.body, /rewards \(SCOT\)/i);
  assert.match(res.body, /Burn to reduce supply/);
  assert.match(res.body, /Do a buyback/);
  assert.match(res.body, /KulaSwap/);
  // all seven step titles present
  assert.equal(STEPS.length, 7);
});

test('every step names its exact tool and links the token-manage surface + engine', async () => {
  const res = await get('/');
  // the token-manage surface (engine.alpha.melek.salon/manage) is linked
  assert.match(res.body, /engine\.alpha\.melek\.salon/);
  assert.match(res.body, /\/manage/);
  // named ops / tools appear
  for (const t of ['tokens.create', 'tokens.issue', 'scot.enable', 'tokens.burn', 'Buyback wizard']) {
    assert.ok(res.body.includes(esc(t)) || res.body.includes(t), `home missing tool ${t}`);
  }
  // each STEP object actually carries a tool link
  for (const s of STEPS) assert.match(s.tool, /href=/);
});

test('COMPLIANCE: buyback framed as management/deflation, NEVER a price-floor or appreciation promise', async () => {
  const res = await get('/');
  const html = res.body;
  // the mechanic framing is present
  assert.match(html, /token-management action/i);
  assert.match(html, /supply management and treasury discipline/i);
  // explicitly negated: not a price-floor / not a promise of appreciation
  assert.match(html, /not a price-floor/i);
  assert.match(html, /not a promise your token will go up/i);
  // "PoL floor" is qualified as depth, not a promised price
  assert.match(html, /not a promised price|not a guaranteed value|market <em>depth<\/em>/i);
});

test('a not-investment-advice note is on the page', async () => {
  const res = await get('/');
  assert.match(res.body, /Not investment advice/i);
  assert.match(res.body, /not financial, legal, or investment advice/i);
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  // the llms summary carries the compliance framing too
  assert.match(llms.body, /never a price-floor/i);
});

test('SITEMAP_PATHS covers home', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
});

test('health probe', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.equal(res.body, 'ok');
});

test('esc() escapes hostile markup, and an unknown/hostile path redirects home (never reflected, never 500)', async () => {
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  assert.equal(esc('a"&<b>'), 'a&quot;&amp;&lt;b&gt;');
  const res = await get('/%3Cscript%3Ealert(1)%3C%2Fscript%3E');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
  assert.ok(!/<script>alert/i.test(res.body)); // nothing reflected
});

test('handler never throws — even on a malformed URL it returns a response', async () => {
  const res = mockRes();
  await handler({ url: 'http://[::bad', headers: {} }, res);
  assert.ok(res.code === 200 || res.code === 302 || res.code === 500);
  assert.equal(typeof res.body, 'string');
});

test('homePage() is a pure string carrying the Library theory link', () => {
  const html = homePage();
  assert.equal(typeof html, 'string');
  assert.match(html, /Token_Buybacks__Market_Fees__and_the_UIA_Lineage/);
  assert.match(html, /Alpha/); // the alpha badge convention
});
