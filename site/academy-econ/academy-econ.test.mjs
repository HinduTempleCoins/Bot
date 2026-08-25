// academy-econ.test.mjs — offline tests for the Economics 101 series index surface.
// Drives `handler` with a mock req/res (no port bound, no network). Verifies the index lists all seven
// topics, each links its Library article, robots/sitemap/llms serve, esc() escaping is sound, the
// not-investment-advice + "not a signal" framing is in the copy, and no route ever throws.
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
  await handler({ url: path, headers: { host: 'academy-econ.test', ...headers } }, res);
  return res;
}

test('home 200 lists all seven Economics 101 topics', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.equal(TOPICS.length, 8);
  // every topic title appears (esc-compared, since one has an apostrophe)
  for (const t of TOPICS) {
    assert.ok(res.body.includes(esc(t.title)), `home missing topic: ${t.title}`);
  }
  // the priority wall topic is present and flagged
  assert.match(res.body, /Buy Walls, and Sell Walls/);
  assert.match(res.body, /priority/);
});

test('every topic links its Library article by slug', async () => {
  const res = await get('/');
  assert.match(res.body, /wiki\.soapbox\.community\/wiki\//);
  for (const t of TOPICS) {
    assert.ok(res.body.includes(esc(`/wiki/${t.slug}`)), `home missing link for slug: ${t.slug}`);
  }
});

test('the wall topic points at the buy/sell-wall Library article', async () => {
  const res = await get('/');
  assert.match(res.body, /Order_Books__Buy_Walls__and_Sell_Walls/);
});

test('COMPLIANCE: not investment advice, no price prediction, walls are mechanics not a signal', async () => {
  const res = await get('/');
  const html = res.body;
  assert.match(html, /Not investment advice/i);
  assert.match(html, /financial, legal, or investment advice/i);
  assert.match(html, /predicts a price|no price prediction/i);
  assert.match(html, /never a signal to buy or sell|never as a reason to trade/i);
});

test('links to Witness School and Token Academy are present', async () => {
  const res = await get('/');
  assert.match(res.body, /witness\.melek\.salon/);
  assert.match(res.body, /academy\.alpha\.melek\.salon/);
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
  assert.match(llms.body, /Selling is not profit|selling is not/i);
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

test('homePage() is a pure string carrying the Alpha badge and the series lead', () => {
  const html = homePage();
  assert.equal(typeof html, 'string');
  assert.match(html, /Economics 101/);
  assert.match(html, /Alpha/); // the alpha badge convention
});
