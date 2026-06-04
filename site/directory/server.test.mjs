// server.test.mjs — Directory.SoapBox route smoke test. Fully offline: inject a fake fetch into the
// domain-insights layer (Tranco/RDAP/SEO) and call the exported `handler` directly with a mock
// req/res. No socket is bound (CLI guard) and no network is touched. Covers: /health, home (with the
// Top-Sites leaderboard), a category route (/?top=Crypto), a domain-insights lookup, and a 404→/.
// Run: node --test site/directory/server.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { handler } from './server.mjs';
import { __setFetch as setInsightsFetch } from '../../integrations/soapbox/domain-insights.mjs';

// Fake the keyless lookups the directory makes. Tranco rank API returns a small rank; everything else
// resolves empty-but-ok so the page soft-fails that block rather than throwing.
function fakeFetch(url) {
  const u = String(url);
  if (u.includes('tranco')) return jsonRes({ ranks: [{ date: '2026-06-01', rank: 42 }] });
  return jsonRes({});
}
const jsonRes = (obj) => Promise.resolve({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });

function mockReqRes(pathAndQuery, method = 'GET') {
  const req = { url: pathAndQuery, method };
  let resolve; const done = new Promise((r) => (resolve = r));
  const res = {
    statusCode: 200, headers: {}, body: '',
    writeHead(code, h) { this.statusCode = code; if (h) Object.assign(this.headers, h); return this; },
    end(chunk) { if (chunk != null) this.body += chunk; resolve(); },
  };
  return { req, res, done };
}
async function call(pathAndQuery, method) {
  const { req, res, done } = mockReqRes(pathAndQuery, method);
  await handler(req, res);
  await done;
  return res;
}

before(() => { setInsightsFetch((url) => fakeFetch(url)); });

test('GET /health → 200 ok', async () => {
  const r = await call('/health');
  assert.equal(r.statusCode, 200);
  assert.equal(r.body, 'ok');
});

test('GET / (home) → 200 with the directory + Top-Sites leaderboard', async () => {
  const r = await call('/');
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.includes('SoapBox'), 'brand rendered');
  assert.ok(r.body.includes('Site Rankings'), 'the hero rankings box rendered');
  assert.ok(r.body.includes('Crypto Resources Directory'), 'the curated directory rendered');
  assert.ok(r.body.includes('Resource Center'), 'the resource-center catalog sections rendered');
});

test('GET /?top=Crypto (category tab) → 200 with the Crypto leaderboard active', async () => {
  const r = await call('/?top=Crypto');
  assert.equal(r.statusCode, 200);
  // the active tab carries class=on; the Crypto tab should be marked active
  assert.ok(/\/\?top=Crypto#top" class=on/.test(r.body), 'the Crypto tab is the active leaderboard tab');
});

test('GET /robots.txt → 200 text with a Sitemap line', async () => {
  const r = await call('/robots.txt');
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.includes('Sitemap:'), 'robots advertises the sitemap');
});

test('unknown route → 302 redirect to /', async () => {
  const r = await call('/nope');
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, '/');
});
