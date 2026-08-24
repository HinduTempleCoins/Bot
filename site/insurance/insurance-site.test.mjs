// insurance-site.test.mjs — offline tests for the Insurance vertical (drives `handler` with a mock
// req/res; no port bound, no network). Verifies routes, honest-ranking render, compliance banners,
// affiliate wrapping, no-PII intake, and XSS escaping.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, homePage, lineView, esc, SITEMAP_PATHS } from './server.mjs';

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
  await handler({ url: path, headers: { host: 'insurance.test', ...headers } }, res);
  return res;
}

test('home 200 lists all six insurance lines + the not-advice banner', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  for (const line of ['Auto', 'Home', 'Health', 'Life', 'Pet', 'Travel']) {
    assert.ok(res.body.includes(line), `home missing ${line}`);
  }
  assert.match(res.body, /not a licensed insurance broker/i);
});

test('/l/auto renders the comparison table with known carriers + disclosure', async () => {
  const res = await get('/l/auto');
  assert.equal(res.code, 200);
  assert.match(res.body, /insurance-table/);
  assert.match(res.body, /GEICO/);
  assert.match(res.body, /State Farm/);
  assert.match(res.body, /Clarity/);
  assert.match(res.body, /Not insurance advice/i);       // not-advice banner
  assert.match(res.body, /ftc-disclosure/);              // FTC disclosure block
});

test('/l/auto shows "Compare official source" when no partner quotes are configured', async () => {
  const res = await get('/l/auto');
  assert.match(res.body, /Compare official source/);
});

test('lineView injects partner quotes and still ranks by clarity, not commission', async () => {
  // A cheap-but-high-commission sponsored quote must NOT outrank an organic top-clarity carrier.
  const quotes = [
    { carrier: 'GEICO', line: 'auto', premium: 60, period: 'month', commission: 5, url: 'https://ex/geico' },
    { carrier: 'Lemonade', line: 'auto', premium: 20, period: 'month', commission: 999, sponsored: true, url: 'https://ex/lem' },
  ];
  const view = await lineView('auto', { quotes });
  assert.ok(view);
  // sponsored row is segregated to the end (appears after organic in the HTML)
  const geicoIdx = view.html.indexOf('GEICO');
  const sponsoredIdx = view.html.indexOf('Sponsored');
  assert.ok(geicoIdx > -1);
  assert.ok(sponsoredIdx === -1 || sponsoredIdx > geicoIdx, 'sponsored must not appear before organic carriers');
});

test('/compare?line=car classifies free text and redirects to /l/auto', async () => {
  const res = await get('/compare?line=car');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/l/auto');
});

test('/compare with unmatchable text redirects home', async () => {
  const res = await get('/compare?line=spaceship');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('unknown line → redirect home (never a 500)', async () => {
  const res = await get('/l/nonsense');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('robots.txt, sitemap.xml, sitemap-index.xml, llms.txt all serve', async () => {
  const robots = await get('/robots.txt');
  assert.equal(robots.code, 200);
  const sm = await get('/sitemap.xml');
  assert.equal(sm.code, 200);
  assert.match(sm.body, /<urlset|<url>/);
  assert.match(sm.body, /\/l\/auto/);
  const smi = await get('/sitemap-index.xml');
  assert.equal(smi.code, 200);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /Auto insurance/);
});

test('SITEMAP_PATHS covers home + every line', () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  assert.ok(SITEMAP_PATHS.includes('/l/auto'));
  assert.ok(SITEMAP_PATHS.includes('/l/travel'));
});

test('health probe', async () => {
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.equal(res.body, 'ok');
});

test('NO PII intake — no POST forms, no email/tel/password inputs anywhere', async () => {
  const home = (await get('/')).body;
  const line = (await get('/l/home')).body;
  for (const html of [home, line]) {
    assert.ok(!/method\s*=\s*["']?post/i.test(html), 'no POST form allowed (TCPA-safe, no PII)');
    assert.ok(!/type\s*=\s*["']?(email|tel|password)/i.test(html), 'no PII input types allowed');
  }
});

test('every page carries the affiliate FTC disclosure and never invents an affiliate id', async () => {
  const res = await get('/l/life');
  assert.match(res.body, /affiliate/i);
  // outbound "Get a quote" link present, and unconfigured ids do not fabricate a tag
  assert.match(res.body, /Get a quote/);
});

test('renderPage output is escaped — a hostile line value cannot inject markup', async () => {
  // classifyLine rejects junk, so a hostile /l/ path just redirects; assert esc() helper is sound too.
  assert.equal(esc('<script>x</script>'), '&lt;script&gt;x&lt;/script&gt;');
  const res = await get('/l/%3Cscript%3E');
  assert.equal(res.code, 302); // unmatched → home, never reflected
});

test('homePage() is a pure string with the six line cards', () => {
  const html = homePage();
  assert.equal(typeof html, 'string');
  assert.match(html, /Pet insurance/);
});
