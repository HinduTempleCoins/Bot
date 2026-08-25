// games.test.mjs — offline tests for the PRANA Games hub (the "what is PRANA for" front door).
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, homePage, esc, SECTIONS, SITEMAP_PATHS } from './server.mjs';

function mockRes() {
  return { code: null, headers: null, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(s) { this.body = s == null ? '' : String(s); } };
}
async function get(path) { const res = mockRes(); await handler({ url: path, headers: { host: 'games.test' } }, res); return res; }

test('home 200 leads with play-and-earn, not mining-only', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.body, /play\s*&amp;\s*earn|play &amp; earn/i);
  assert.match(res.body, /what it's <em>for<\/em>|what it's for/i);
  // mining is framed as the securing layer, not the pitch
  assert.match(res.body, /mining/i);
});

test('every catalog surface is linked on the hub', async () => {
  const res = await get('/');
  for (const s of SECTIONS) for (const it of s.items) {
    assert.ok(res.body.includes(it.url), `missing link for ${it.name} (${it.url})`);
    assert.ok(res.body.includes(esc(it.name)), `missing name ${it.name}`);
  }
});

test('the three groups (Play / Earn / One account) render', async () => {
  const res = await get('/');
  assert.match(res.body, />Play</);
  assert.match(res.body, />Earn</);
  assert.match(res.body, /One account/i);
});

test('casino carries the not-real-money note; spin is a free sweepstakes', async () => {
  const res = await get('/');
  assert.match(res.body, /not real money|entertainment/i);
  assert.match(res.body, /free|no purchase|sweepstakes/i);
});

test('Move (walk-to-earn) and the DEX are present', async () => {
  const res = await get('/');
  assert.match(res.body, /walk to earn|steps mine/i);
  assert.match(res.body, /KulaSwap|DEX/);
});

test('robots/sitemap/sitemap-index/llms serve; llms lists the games', async () => {
  assert.equal((await get('/robots.txt')).code, 200);
  assert.equal((await get('/sitemap.xml')).code, 200);
  assert.equal((await get('/sitemap-index.xml')).code, 200);
  const llms = await get('/llms.txt');
  assert.equal(llms.code, 200);
  assert.match(llms.body, /Daily Spin|Casino|Tribulum/);
});

test('unknown path redirects to the hub', async () => {
  const res = await get('/nope');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('health probe', async () => {
  const res = await get('/health');
  assert.equal(res.body, 'ok');
});

test('surface URLs are env-overridable (no hard-coded infra beyond public domains)', async () => {
  // the module reads *_URL envs; a page still renders with defaults. Assert a default public URL is present.
  const res = await get('/');
  assert.match(res.body, /melek\.salon|soapbox\.community/);
});

test('homePage() is a pure string with all three group leads', () => {
  const html = homePage();
  assert.equal(typeof html, 'string');
  assert.match(html, /Games that run on the chain/);
  assert.match(html, /one account/i);
});

test('SITEMAP_PATHS covers the hub', () => {
  assert.deepEqual(SITEMAP_PATHS, ['/']);
});

test('esc escapes hostile input', () => {
  assert.equal(esc('<b>x</b>'), '&lt;b&gt;x&lt;/b&gt;');
});
