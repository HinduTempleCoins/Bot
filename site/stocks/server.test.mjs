// server.test.mjs — Stocks.SoapBox route smoke + escaping test. Fully offline: we inject a fake fetch
// into every upstream module (stocks / market-health / company-profiles / scraper) and call the
// exported `handler` directly with a mock req/res. No socket is bound (server.mjs has a CLI guard),
// and no network is touched. Covers: home, a /quote/:symbol profile route, /api/health, a 404 →
// redirect, and that upstream values containing <script> are escaped in the rendered HTML.
// Run: node --test site/stocks/server.test.mjs
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { handler, renderCompanyCard } from './server.mjs';
import { __setFetch as setStocksFetch } from '../../integrations/soapbox/stocks.mjs';
import { __setFetch as setHealthFetch } from '../../integrations/soapbox/market-health.mjs';
import { __setFetch as setProfileFetch } from '../../integrations/soapbox/company-profiles.mjs';
import { __setFetch as setScraperFetch } from '../../integrations/scraper.mjs';

// A hostile upstream exchange name — if the renderer interpolates it raw, the <script> survives.
const EVIL = '<script>alert(1)</script>';

// Minimal Yahoo chart/meta payload for any symbol. `name`/`exchange` carry the EVIL marker.
function yahooChart(sym) {
  const now = Math.floor(Date.now() / 1000);
  const ts = Array.from({ length: 30 }, (_, i) => now - (29 - i) * 86400);
  const close = ts.map((_, i) => 100 + i);
  return {
    chart: { result: [{
      meta: {
        regularMarketPrice: 130, chartPreviousClose: 120, currency: 'USD',
        longName: `Test Corp ${EVIL}`, shortName: 'Test Corp',
        fullExchangeName: `NASDAQ ${EVIL}`, instrumentType: 'EQUITY',
        regularMarketDayHigh: 131, regularMarketDayLow: 129,
        fiftyTwoWeekHigh: 200, fiftyTwoWeekLow: 90, regularMarketVolume: 1234567,
      },
      timestamp: ts,
      indicators: { quote: [{ close }] },
    }] },
  };
}

// Route a faked fetch by URL. Everything upstream is keyless GET JSON; anything we don't recognize
// resolves to an empty-but-ok response so the page soft-fails that block rather than throwing.
function fakeFetch(url) {
  const u = String(url);
  if (u.includes('/v8/finance/chart/')) return jsonRes(yahooChart('TEST'));
  if (u.includes('/v1/finance/search')) return jsonRes({ quotes: [{ symbol: 'TEST', shortname: 'Test Corp', exchDisp: 'NASDAQ', quoteType: 'EQUITY' }] });
  return jsonRes({});
}
const jsonRes = (obj) => Promise.resolve({ ok: true, status: 200, json: async () => obj, text: async () => JSON.stringify(obj) });

// Mock ServerResponse: capture status, headers, body; resolve a promise when end() is called.
function mockReqRes(pathAndQuery) {
  const req = { url: pathAndQuery, method: 'GET' };
  let resolve; const done = new Promise((r) => (resolve = r));
  const res = {
    statusCode: 200, headers: {}, body: '',
    writeHead(code, h) { this.statusCode = code; if (h) Object.assign(this.headers, h); return this; },
    end(chunk) { if (chunk != null) this.body += chunk; resolve(); },
  };
  return { req, res, done };
}
async function call(pathAndQuery) {
  const { req, res, done } = mockReqRes(pathAndQuery);
  await handler(req, res);
  await done;
  return res;
}

before(() => {
  for (const set of [setStocksFetch, setHealthFetch, setProfileFetch, setScraperFetch]) set((url) => fakeFetch(url));
});

test('GET /health → 200 ok', async () => {
  const r = await call('/health');
  assert.equal(r.statusCode, 200);
  assert.equal(r.body, 'ok');
});

test('GET / (home) → 200, renders the Stock Index + escapes the hostile upstream name', async () => {
  const r = await call('/');
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.includes('SoapBox Stocks'), 'home renders the brand/title');
  assert.ok(r.body.includes('the Stock Index'), 'home renders the index heading');
  assert.ok(!r.body.includes(EVIL), 'a raw <script> from upstream must never appear unescaped');
  assert.ok(r.body.includes('&lt;script&gt;'), 'the hostile name is escaped to entities');
});

test('GET /quote/:symbol (profile) → 200 with price, stats, and escaped exchange', async () => {
  const r = await call('/quote/TEST');
  assert.equal(r.statusCode, 200);
  assert.ok(r.body.includes('Test Corp'), 'company name rendered');
  assert.ok(r.body.includes('Key stats'), 'key-stats card rendered');
  assert.ok(r.body.includes('TEST'), 'symbol rendered');
  assert.ok(!r.body.includes(EVIL), 'the exchange/name <script> must be escaped on the profile page');
  assert.ok(r.body.includes('&lt;script&gt;'), 'escaped entities present');
});

test('GET /api/health → 200 JSON envelope', async () => {
  const r = await call('/api/health?tf=1Y');
  assert.equal(r.statusCode, 200);
  assert.match(r.headers['content-type'] || '', /application\/json/);
  const parsed = JSON.parse(r.body);
  assert.equal(parsed.tf, '1Y');
  assert.ok('html' in parsed, 'envelope carries an html field (possibly empty on soft-fail)');
});

test('unknown route → 302 redirect to /', async () => {
  const r = await call('/definitely-not-a-route');
  assert.equal(r.statusCode, 302);
  assert.equal(r.headers.location, '/');
});

test('renderCompanyCard escapes a <script> field value by DEFAULT', () => {
  const html = renderCompanyCard({ industry: EVIL, hq: 'Austin', cik: '0000320193' });
  assert.ok(!html.includes(EVIL), 'industry field must be escaped by default (row default)');
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;'), 'escaped to entities');
});

test('renderCompanyCard renders the Website link as real HTML (rawHtml opt-in)', () => {
  const html = renderCompanyCard({ website: 'https://apple.com', cik: '1' });
  assert.ok(/<a href="https:\/\/apple\.com" rel=noopener target=_blank>apple\.com<\/a>/.test(html), 'website is a real anchor (rawHtml:true caller)');
});
