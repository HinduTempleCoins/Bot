// lawyers.test.mjs — offline tests for the Lawyers vertical (drives `handler` with a mock req/res;
// no port bound, no network). The state-bar transport is INJECTED (searchAttorneys' fetcher via
// __setBarFetcher). Verifies routes, verified-bar-facts + sources render, the structural NO-RATING
// guarantee, honest empty results, the clearly-labeled sponsored listing, robots/sitemap, and XSS
// escaping.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  handler, homePage, searchView, attorneyView, esc, SITEMAP_PATHS, __setBarFetcher,
} from './server.mjs';
import * as directory from '../../integrations/soapbox/lawyer-directory.mjs';

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
  await handler({ url: path, headers: { host: 'lawyers.test', ...headers } }, res);
  return res;
}

// A canned state-bar fetcher — verified public facts, discipline WITH a source, no quality field.
function fakeBar() {
  return async (query, { state } = {}) => ({
    results: [
      {
        name: 'Jane Q. Public', barNumber: '123456', status: 'Active in Good Standing',
        admitted: '2008-11-14', state: state || 'CA', practiceAreas: ['Family Law', 'Estate Planning'],
        discipline: [{ date: '2015-03-02', action: 'Public reprimand', source: 'https://calbar.example.gov/d/123456' }],
      },
      {
        name: 'John Barred', barNumber: '654321', status: 'disbarred', state: state || 'CA',
        discipline: [{ date: '2019-06-01', action: 'Disbarment', source: 'https://calbar.example.gov/d/654321' }],
      },
    ],
  });
}
// A hostile fetcher — proves server/engine escape reflected bar text.
function xssBar() {
  return async () => ([{ name: '<script>alert(1)</script>', barNumber: '<img src=x>', status: 'active', discipline: [] }]);
}

test('home 200 — search box + verified-bar-facts-only note, no rating language', async () => {
  const res = await get('/');
  assert.equal(res.code, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  assert.match(res.body, /verified bar facts only/i);
  assert.match(res.body, /no ratings, scores, or recommendations/i);
  assert.match(res.body, /action="\/search"/);
  // never any actual star/rating scaffolding (the "no ratings…" disclaimers are the only mentions)
  assert.ok(!/★|⭐|rating[:=]|score[:=]|"rating"|data-rating|\b\d(\.\d)?\s*(\/\s*5|stars?)\b/i.test(res.body));
});

test('/search renders bar facts WITH sources for injected results', async () => {
  __setBarFetcher(fakeBar());
  try {
    const res = await get('/search?q=Jane%20Public&state=CA');
    assert.equal(res.code, 200);
    assert.match(res.body, /Jane Q\. Public/);
    assert.match(res.body, /Bar #123456/);
    assert.match(res.body, /Public reprimand/);
    assert.match(res.body, /calbar\.example\.gov\/d\/123456/); // the source link is present
    assert.match(res.body, /\[source\]/);
    assert.match(res.body, /Discipline history/);
  } finally { __setBarFetcher(null); }
});

test('NO rating / score / star anywhere in a rendered results page', async () => {
  __setBarFetcher(fakeBar());
  try {
    const res = await get('/search?q=Jane&state=CA');
    const html = res.body;
    // The only permitted occurrence of "rating"/"recommend" is in the not-a-recommendation notes.
    const stripped = html
      .replace(/no ratings, scores, or recommendations/ig, '')
      .replace(/not a referral or recommendation/ig, '')
      .replace(/not legal advice[^<]*/ig, '');
    assert.ok(!/\b\d(\.\d)?\s*(\/\s*5|stars?|out of)\b/i.test(stripped), 'no star/N-of-5 rating');
    assert.ok(!/★|⭐|rating[:=]|score[:=]|"rating"|data-rating/i.test(stripped), 'no rating/score markup');
    assert.ok(!/\brecommended\b|\btop[- ]rated\b|\bbest lawyer\b/i.test(stripped), 'no recommendation language');
  } finally { __setBarFetcher(null); }
});

test('empty honest — no transport configured → honest "no matching records", never fabricated', async () => {
  __setBarFetcher(null);
  const res = await get('/search?q=Nobody%20Here&state=CA');
  assert.equal(res.code, 200);
  assert.match(res.body, /No matching public bar records/i);
  assert.ok(!/Bar #/.test(res.body), 'must not invent a bar record when no transport is set');
});

test('searchView with an empty query returns an honest empty directory (no throw)', async () => {
  const view = await searchView('', {});
  assert.deepEqual(view.results, []);
  assert.match(view.html, /No matching public bar records/i);
});

test('sponsored listing is surfaced only as clearly-labeled flat-fee advertising, never pay-to-rank', async () => {
  const html = homePage();
  assert.match(html, /Sponsored listing/);
  assert.match(html, /paid advertising/i);
  assert.match(html, /flat-fee/i);
  assert.match(html, /can\s*<b>never<\/b>\s*buy rank|never.{0,20}buy rank/i);
  // the sponsored block must not carry any ranking/recommendation claim
  assert.ok(!/top result|rank #1|recommended attorney/i.test(html));
});

test('a paid-tier profile shows the "paid advertising" disclosure (engine tag), still no rating', () => {
  // A surfaced paid listing must self-label as advertising and STILL carry no rating/score.
  const html = directory.renderProfile({ name: 'Ada Advertiser', barNumber: '777', status: 'active', listingTier: 'featured', discipline: [] });
  assert.match(html, /Ada Advertiser/);
  assert.match(html, /paid advertising/i); // renderProfile's paid-ad-disclosure
  assert.ok(!/★|rating[:=]|score[:=]/i.test(html));
});

test('/attorney/<slug> renders a single profile with its source, honest empty when unfound', async () => {
  __setBarFetcher(fakeBar());
  try {
    const res = await get('/attorney/jane-q-public?state=CA');
    assert.equal(res.code, 200);
    assert.match(res.body, /Jane Q\. Public/);
    assert.match(res.body, /calbar\.example\.gov/);
  } finally { __setBarFetcher(null); }
  const empty = await get('/attorney/ghost-person');
  assert.equal(empty.code, 200);
  assert.match(empty.body, /No matching public bar records/i);
});

test('reflected bar text is HTML-escaped — no script injection from a hostile fetcher', async () => {
  __setBarFetcher(xssBar());
  try {
    const res = await get('/search?q=%3Cscript%3E');
    assert.equal(res.code, 200);
    assert.ok(!res.body.includes('<script>alert(1)</script>'), 'raw script tag must not appear');
    assert.match(res.body, /&lt;script&gt;/);
  } finally { __setBarFetcher(null); }
  // the esc() helper itself is sound
  assert.equal(esc('<b>"x"</b>'), '&lt;b&gt;&quot;x&quot;&lt;/b&gt;');
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
  assert.match(llms.body, /bar records/i);
  assert.match(llms.body, /no ratings/i);
});

test('SITEMAP_PATHS covers home + search; health probe returns ok', async () => {
  assert.ok(SITEMAP_PATHS.includes('/'));
  assert.ok(SITEMAP_PATHS.includes('/search'));
  const res = await get('/health');
  assert.equal(res.code, 200);
  assert.equal(res.body, 'ok');
});

test('unknown path → redirect home (never a 500)', async () => {
  const res = await get('/nonsense/path');
  assert.equal(res.code, 302);
  assert.equal(res.headers.location, '/');
});

test('homePage() is a pure string carrying the not-advice line and public-interest set', () => {
  const html = homePage();
  assert.equal(typeof html, 'string');
  assert.match(html, /not legal advice/i);
  assert.match(html, /Legal aid|public-interest/i);
});
