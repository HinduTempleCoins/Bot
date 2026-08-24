// travel.test.mjs — offline tests for travel.soapbox.community, the SoapBox Travel curated directory.
// Fully offline: doorways() reads the shared aggregator-directory (pure, no network) and soft-fails to a
// built-in list. We drive the exported async handler through a mock req/res (no port bound) and assert:
// routes serve, the home page lists the travel doorways with affiliate-routed outbound links + the
// honest-ranking guardrail, the search box is keyless, and health/robots/sitemap/llms/404 behave.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, homePage, doorways, planView } from './server.mjs';

function mockRes() {
  return {
    statusCode: null, headers: null, body: '', ended: false,
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk != null) this.body += String(chunk); this.ended = true; },
  };
}
const req = (urlPath, method = 'GET') => ({ url: urlPath, method, on() {} });
async function drive(urlPath) {
  const res = mockRes();
  await handler(req(urlPath), res);
  return res;
}

test('doorways(): returns the travel comparison doorways (flights/hotels/…)', () => {
  const d = doorways();
  assert.ok(Array.isArray(d) && d.length >= 6);
  const ids = d.map((x) => x.id);
  assert.ok(ids.includes('flights'));
  assert.ok(ids.includes('hotels'));
  assert.ok(ids.includes('car-rentals'));
});

test('home: 200 HTML with the Travel identity and every doorway', async () => {
  const res = await drive('/');
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'], /text\/html/);
  const b = res.body;
  assert.match(b, /SoapBox Travel/);
  assert.match(b, /Flights/);
  assert.match(b, /Hotels/);
  assert.match(b, /Car rentals/);
});

test('home: outbound doorway links route through the affiliate tracker (unmonetized offline)', async () => {
  const b = homePage();
  assert.match(b, /rel="sponsored nofollow noopener"/);
  assert.match(b, /\(unmonetized\)/);
});

test('home: carries the honest-ranking guardrail + FTC disclosure + no data-selling', async () => {
  const b = homePage();
  assert.match(b, /never by\s+commission/i);
  assert.match(b, /never sell your data/i);
});

test('home: Start→Destination planner form posts to /plan (keyless)', async () => {
  const b = homePage();
  assert.match(b, /action="\/plan"/);
  assert.match(b, /Starting city/);
  assert.match(b, /Destination/);
  assert.match(b, /Plan trip/);
  // the curated doorways still deep-link out via google search (keyless)
  assert.match(b, /www\.google\.com\/search/);
});

test('home: canonical + OpenGraph meta present', async () => {
  const b = homePage();
  assert.match(b, /<link rel="canonical"/);
  assert.match(b, /og:title/);
  assert.match(b, /name="robots"/);
});

test('routes: /health, /robots.txt, /sitemap.xml, /llms.txt, 302-on-unknown', async () => {
  const h = await drive('/health');
  assert.equal(h.statusCode, 200);
  assert.equal(h.body, 'ok');

  const r = await drive('/robots.txt');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'], /text\/plain/);

  const s = await drive('/sitemap.xml');
  assert.equal(s.statusCode, 200);
  assert.match(s.headers['content-type'], /xml/);

  const l = await drive('/llms.txt');
  assert.equal(l.statusCode, 200);
  assert.match(l.body, /Travel/);

  const nf = await drive('/nope');
  assert.equal(nf.statusCode, 302);
  assert.equal(nf.headers.location, '/');
});

test('/plan: renders a multimodal itinerary (injected) with affiliate-wrapped Book links', async () => {
  // Inject a fake plan so the test is fully offline (no routing provider hit).
  const plan = {
    source: 'rome2rio', provenance: 'LIVE', totalDuration: 210,
    legs: [
      { mode: 'bus', operator: 'FlixBus', duration: 120, price: { amount: 19, currency: 'USD' } },
      { mode: 'fly', operator: 'TAP', duration: 90, price: { amount: 140, currency: 'USD' } },
    ],
  };
  const html = await planView('Austin', 'Lisbon', { plan });
  assert.ok(html);
  assert.match(html, /Austin → Lisbon/);
  assert.match(html, /FlixBus/);
  assert.match(html, /Flight/);           // fly → "Flight" label
  assert.match(html, /Book .*→/);         // per-leg affiliate book link
  assert.match(html, /rel="sponsored nofollow noopener"/);
  assert.match(html, /hotels in Lisbon/i); // destination hotels affiliate link
});

test('/plan: soft-fails to the curated directory when no route is found', async () => {
  const html = await planView('Nowhere', 'Neverland', { plan: null });
  assert.ok(html);
  assert.match(html, /No live multimodal route/i);
  assert.match(html, /Flights/); // the doorway fallback is shown
});

test('/plan route: missing from/to redirects home; valid renders 200 noindex', async () => {
  const missing = await drive('/plan?from=Austin');
  assert.equal(missing.statusCode, 302);
  assert.equal(missing.headers.location, '/');

  const ok = await drive('/plan?from=Austin&to=Lisbon');
  assert.equal(ok.statusCode, 200);
  assert.match(ok.body, /Austin → Lisbon/);
  assert.match(ok.body, /noindex/); // dynamic query page must not be indexed
});

test('/plan: destination is escaped (no injection via query)', async () => {
  const html = await planView('A', '<script>x</script>', { plan: null });
  assert.ok(!html.includes('<script>x</script>'));
  assert.match(html, /&lt;script&gt;x/);
});
