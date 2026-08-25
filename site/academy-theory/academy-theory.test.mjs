// academy-theory.test.mjs — offline tests for the Theory-strand index surface.
// Drives `handler` with a mock req/res (no port bound, no network). Verifies the index lists all four
// Theory topics, each links its Library article, links out to Witness School / Economics 101 / Token
// Academy, robots/sitemap/llms serve, esc() escaping is sound, the educational / not-investment-advice
// framing is in the copy, and no route ever throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, homePage, esc, TOPICS, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return {
    code: null, headers: null, body: '',
    writeHead(code, headers) { this.code = code; this.headers = headers || {}; return this; },
    end(s) { this.body = s == null ? '' : String(s); return this; },
  };
}
async function get(path, headers = {}) {
  const res = mockRes();
  await handler({ url: path, headers: { host: 'academy-theory.test', ...headers } }, res);
  return res;
}

test('home 200 lists all four Theory topics', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.equal(TOPICS.length, 4);
  for (const t of TOPICS) {
    assert.ok(res.body.includes(esc(t.title)), `home missing topic: ${t.title}`);
  }
});

test('home names each of the four expected Theory subjects', async () => {
  const res = await get('/');
  const html = res.body;
  assert.match(html, /What a Witness Is and Does/);
  assert.match(html, /Curation Theory/);
  assert.match(html, /Proof of Work, Proof of Stake, and DPoS/);
  assert.match(html, /Two-Token Economy/);
});

test('every topic links its Library article by slug', async () => {
  const res = await get('/');
  assert.match(res.body, /wiki\.soapbox\.community\/wiki\//);
  for (const t of TOPICS) {
    assert.ok(res.body.includes(esc(`/wiki/${t.slug}`)), `home missing link for slug: ${t.slug}`);
  }
});

test('links to Witness School, Economics 101, and Token Academy are present', async () => {
  const res = await get('/');
  const html = res.body;
  assert.match(html, /witness\.melek\.salon/);
  assert.match(html, /academy-econ\.alpha\.melek\.salon/);
  assert.match(html, /academy\.alpha\.melek\.salon/);
});

test('COMPLIANCE: not investment advice, no price prediction, reward rules not a yield, no buy/sell signal', async () => {
  const res = await get('/');
  const html = res.body;
  assert.match(html, /Not investment advice/i);
  assert.match(html, /financial, legal, or investment advice/i);
  assert.match(html, /predicts a price|no price prediction/i);
  assert.match(html, /never a signal to buy or sell|signal to buy\s*\n?\s*or sell/i);
  assert.match(html, /never as a promised yield|reward rules are described as rules/i);
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
  // the llms summary carries the compliance framing and lists the topics
  assert.match(llms.body, /not investment advice/i);
  assert.match(llms.body, /never a buy\/sell signal/i);
  assert.match(llms.body, /witness|curation|DPoS/i);
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

test('homePage() is a pure string carrying the Alpha badge and the strand lead', () => {
  const html = homePage();
  assert.equal(typeof html, 'string');
  assert.match(html, /Theory strand/);
  assert.match(html, /Alpha/); // the alpha badge convention
});
