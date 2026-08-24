// software-reviews-site.test.mjs — offline tests for the Software Reviews vertical (drives `handler` with
// a mock req/res; no port bound, no network). Verifies routes, honest rank-by-rating (never commission),
// affiliate wrapping, the no-pay-to-rank guarantee + FTC disclosure, sponsored segregation, and XSS
// escaping. Vendor data is INJECTED into categoryView (the engine soft-fails to [] offline with no source).
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, homePage, categoryView, matchCategory, esc, SITEMAP_PATHS } from './server.mjs';
import { CATEGORIES } from '../../integrations/soapbox/software-reviews.mjs';

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
  await handler({ url: path, headers: { host: 'software-reviews.test', ...headers } }, res);
  return res;
}

test('home 200 lists every category + the no-pay-to-rank guarantee', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  for (const key of Object.keys(CATEGORIES)) {
    assert.ok(res.body.includes(CATEGORIES[key].label), `home missing category ${key}`);
    assert.ok(res.body.includes(`/c/${key}`), `home missing link to ${key}`);
  }
  assert.match(res.body, /No pay-to-rank/i);
  assert.match(res.body, /never sell your data/i);
});

test('home has a search box posting to /compare', async () => {
  const res = await get('/');
  assert.match(res.body, /action="\/compare"/);
  assert.match(res.body, /name="q"/);
});

test('category page ranks by rating: a 4.8 outranks a 4.2 regardless of commission', async () => {
  // The low-rated vendor pays a huge commission and has more reviews — it must STILL rank below the 4.8.
  const vendors = [
    { name: 'PayaLot', rating: 4.2, reviews: 99999, commission: 999, url: 'https://ex/payalot' },
    { name: 'TopRated', rating: 4.8, reviews: 12, commission: 0, url: 'https://ex/toprated' },
  ];
  const view = await categoryView('software-saas', { vendors });
  assert.ok(view);
  const topIdx = view.html.indexOf('TopRated');
  const payIdx = view.html.indexOf('PayaLot');
  assert.ok(topIdx > -1 && payIdx > -1, 'both vendors render');
  assert.ok(topIdx < payIdx, 'the 4.8 must appear before the 4.2 despite higher commission + review count');
});

test('sponsored rows are labeled and segregated to the end', async () => {
  const vendors = [
    { name: 'OrganicHost', rating: 4.5, reviews: 500, url: 'https://ex/organic' },
    { name: 'PaidHost', rating: 4.9, reviews: 900, sponsored: true, url: 'https://ex/paid' },
  ];
  const view = await categoryView('web-hosting', { vendors });
  assert.ok(view);
  const organicIdx = view.html.indexOf('OrganicHost');
  const paidIdx = view.html.indexOf('PaidHost');
  // Even with a higher rating, the sponsored row is pushed below the organic one.
  assert.ok(organicIdx > -1 && paidIdx > organicIdx, 'sponsored must not appear before organic');
  assert.match(view.html, /Sponsored/);
});

test('every outbound vendor link is affiliate-wrapped (plain url when id unset) + safe rel', async () => {
  const vendors = [{ name: 'Acme', rating: 4.4, reviews: 100, url: 'https://acme.example/plan' }];
  const view = await categoryView('vpn', { vendors });
  assert.ok(view);
  assert.match(view.html, /href="https:\/\/acme\.example\/plan"/); // plain url preserved when id unset
  assert.match(view.html, /rel="sponsored nofollow noopener"/);
});

test('FTC disclosure + provenance note present on a category page', async () => {
  const vendors = [{ name: 'Acme', rating: 4.4, reviews: 100, url: 'https://acme.example' }];
  const view = await categoryView('domains', { vendors });
  assert.match(view.html, /ftc-disclosure/);
  assert.match(view.html, /No pay-to-rank/i);
  assert.match(view.html, /never sell your data/i);
});

test('/c/<category> route renders 200 with the comparison table', async () => {
  const res = await get('/c/software-saas');
  assert.equal(res.code, 200);
  assert.match(res.body, /software-reviews-table/);
  assert.match(res.body, /Software \/ B2B SaaS/);
});

test('unknown category → 302 redirect home', async () => {
  const res = await get('/c/not-a-real-category');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('/compare matches free text to a category and redirects', async () => {
  const res = await get('/compare?q=vpn');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/c/vpn');
});

test('/compare with an unmatched query redirects home', async () => {
  const res = await get('/compare?q=zzznope');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('matchCategory resolves keys, labels, and substrings; null on no match', () => {
  assert.equal(matchCategory('web-hosting'), 'web-hosting');
  assert.equal(matchCategory('hosting'), 'web-hosting');
  assert.equal(matchCategory('VPN'), 'vpn');
  assert.equal(matchCategory('saas'), 'software-saas');
  assert.equal(matchCategory('   '), null);
  assert.equal(matchCategory('quantum-toaster'), null);
});

test('vendor names are XSS-escaped in the rendered table', async () => {
  const vendors = [{ name: '<script>alert(1)</script>', rating: 4.1, reviews: 5, url: 'https://x/y' }];
  const view = await categoryView('software-saas', { vendors });
  assert.ok(view);
  assert.ok(!view.html.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
  assert.match(view.html, /&lt;script&gt;/);
});

test('esc() escapes the dangerous HTML metacharacters', () => {
  assert.equal(esc('<a href="x">&'), '&lt;a href=&quot;x&quot;&gt;&amp;');
});

test('/health returns ok', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.equal(res.body, 'ok');
});

test('/robots.txt is served as text', async () => {
  const res = await get('/robots.txt');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/plain/);
  assert.match(res.body, /User-agent|Sitemap/i);
});

test('/sitemap.xml lists home + every category path', async () => {
  const res = await get('/sitemap.xml');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /application\/xml/);
  for (const p of SITEMAP_PATHS) assert.ok(res.body.includes(p), `sitemap missing ${p}`);
});

test('/sitemap-index.xml and /llms.txt are served', async () => {
  const idx = await get('/sitemap-index.xml');
  assert.equal(idx.code, 200);
  assert.match(idx.headers['content-type'], /application\/xml/);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /Software Reviews/);
});

test('homePage() renders without throwing and includes the honest-ranking explainer', () => {
  const html = homePage();
  assert.match(html, /How this stays honest/);
  assert.match(html, /a 4\.8[\s\S]*outranks a 4\.2/);
});

test('category page soft-fails to an empty table when no vendors are injected (no source configured)', async () => {
  const view = await categoryView('domains');
  assert.ok(view);
  assert.equal(view.count, 0);
  assert.match(view.html, /software-reviews-table/); // table shell still renders, just empty
});
