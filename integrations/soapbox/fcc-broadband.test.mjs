// fcc-broadband.test.mjs — OFFLINE guards for the SoapBox "what internet can I get here" reader. Fake
// fetch only; asserts normalization + soft-fail + escaping + the honest-speeds caveat. No network.
// Run: node --test integrations/soapbox/fcc-broadband.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { invalidate } from './cache.mjs';
import {
  __setFetch, broadbandAt, areaLookup, complaints, summary, renderPage, dataNote,
} from './fcc-broadband.mjs';

// minimal Response-like stub
const res = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
  text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
});

// route a fake fetch by URL substring; reset cache each time so calls actually hit the stub.
function route(map) {
  invalidate();
  __setFetch(async (url) => {
    const u = String(url);
    for (const [needle, body] of Object.entries(map)) {
      if (u.includes(needle)) return typeof body === 'function' ? body(u) : res(body);
    }
    return res({}, false); // unmatched → not-ok → source soft-fails
  });
}

const restore = () => { __setFetch(null); invalidate(); delete process.env.FCC_API_KEY; };

test('areaLookup() returns census block + county', async () => {
  route({
    'geo.fcc.gov': {
      Block: { FIPS: '201234567890123' },
      County: { name: 'Sedgwick', FIPS: '20173' },
      State: { code: 'KS', FIPS: '20' },
    },
  });
  const a = await areaLookup({ lat: 37.6, lon: -97.3 });
  assert.equal(a.blockFips, '201234567890123');
  assert.equal(a.county, 'Sedgwick');
  assert.equal(a.state, 'KS');
  assert.equal(a.source, 'FCC Area API');
  restore();
});

test('areaLookup() soft-fails to null on bad coords / bad response', async () => {
  route({}); // everything unmatched → not-ok
  assert.equal(await areaLookup({ lat: 1, lon: 2 }), null);
  assert.equal(await areaLookup({}), null, 'missing coords → null, no network');
  restore();
});

test('broadbandAt() normalizes providers (by blockFips)', async () => {
  route({
    'broadbandmap.fcc.gov': {
      data: [
        { brandName: 'AcmeFiber', techCode: '50', maxAdDown: 1000, maxAdUp: 1000 },
        { providerName: 'OldTel DSL', techCode: '10', maxAdDown: 25, maxAdUp: 3 },
        { name: '', techCode: '40', maxAdDown: 100, maxAdUp: 10 }, // no provider → dropped
      ],
    },
  });
  const p = await broadbandAt({ blockFips: '201234567890123' });
  assert.equal(p.length, 2, 'rows without a provider name are dropped');
  assert.equal(p[0].provider, 'AcmeFiber');
  assert.equal(p[0].technology, 'Fiber');
  assert.equal(p[0].downMbps, 1000);
  assert.equal(p[0].upMbps, 1000);
  assert.equal(p[1].technology, 'Copper / DSL');
  assert.equal(p[0].source, 'FCC Broadband Data');
  restore();
});

test('broadbandAt() resolves coords via the Area API then reads providers', async () => {
  route({
    'geo.fcc.gov': { Block: { FIPS: '999' }, County: { name: 'X' }, State: { code: 'NV' } },
    'broadbandmap.fcc.gov': { results: [{ brandName: 'CoordCo', techCode: '70', maxAdDown: 50, maxAdUp: 5 }] },
  });
  const p = await broadbandAt({ lat: 36.0, lon: -115.0 });
  assert.equal(p.length, 1);
  assert.equal(p[0].provider, 'CoordCo');
  assert.match(p[0].technology, /Fixed Wireless/);
  restore();
});

test('broadbandAt() soft-fails to [] on bad response and on no block', async () => {
  route({ 'geo.fcc.gov': { Block: { FIPS: '5' }, County: {}, State: {} } }); // broadband endpoint unmatched → not-ok
  assert.deepEqual(await broadbandAt({ lat: 1, lon: 2 }), []);
  invalidate();
  assert.deepEqual(await broadbandAt({}), [], 'no coords + no block → [] without network');
  restore();
});

test('complaints() normalizes FCC telecom complaints', async () => {
  route({
    'opendata.fcc.gov': [
      { ticket_no: 'T-1', date_received: '2026-05-01', issue: 'Internet speed', method: 'Phone', state: 'CA' },
      { id: 'T-2', issue: 'Billing' },
    ],
  });
  const c = await complaints({ issue: 'speed', limit: 10 });
  assert.equal(c.length, 2);
  assert.equal(c[0].id, 'T-1');
  assert.equal(c[0].issue, 'Internet speed');
  assert.equal(c[0].state, 'CA');
  assert.equal(c[0].source, 'FCC Consumer Complaints');
  restore();
});

test('complaints() soft-fails to [] on bad response', async () => {
  route({});
  assert.deepEqual(await complaints({ issue: 'whatever' }), []);
  restore();
});

test('summary() picks the best advertised speed + counts providers', () => {
  const s = summary([
    { provider: 'A', technology: 'Cable', downMbps: 100, upMbps: 10 },
    { provider: 'B', technology: 'Fiber', downMbps: 1000, upMbps: 1000 },
    { provider: 'C', technology: 'Satellite', downMbps: 25, upMbps: 3 },
  ]);
  assert.equal(s.providerCount, 3);
  assert.equal(s.bestDownMbps, 1000);
  assert.equal(s.bestUpMbps, 1000);
  assert.equal(s.bestProvider, 'B');
  assert.equal(s.hasFiber, true);
  assert.ok(s.technologies.includes('Fiber'));
});

test('summary() is safe on empty input', () => {
  const s = summary([]);
  assert.equal(s.providerCount, 0);
  assert.equal(s.bestDownMbps, null);
  assert.equal(s.hasFiber, false);
  assert.deepEqual(s.technologies, []);
});

test('renderPage() escapes a malicious provider name', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({ providers: [{ provider: evil, technology: 'Fiber', downMbps: 100, upMbps: 50 }] });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'raw script tag must not survive');
  assert.ok(html.includes('&lt;script&gt;'), 'provider name is HTML-escaped');
  assert.ok(html.includes('Advertised speeds are carrier-reported'), 'note rendered');
});

test('dataNote() carries the source + the advertised-vs-actual caveat', () => {
  const n = dataNote();
  assert.match(n, /FCC Broadband Data/);
  assert.match(n, /advertised speeds.*may differ from actual/i);
  assert.match(n, /as of \d{4}-\d{2}-\d{2}/);
});

test('module is keyless by default — FCC_API_KEY is read by name only when present', async () => {
  // Without the key, no api_key appears in the URL.
  let seen = '';
  invalidate();
  __setFetch(async (url) => { seen = String(url); return res({ Block: { FIPS: '1' }, County: {}, State: {} }); });
  await areaLookup({ lat: 1, lon: 1 });
  assert.ok(!/api_key=/.test(seen), 'no key param when env unset');

  // With the key set, it is attached (read by NAME from env, never hard-coded).
  process.env.FCC_API_KEY = 'unit-test-key';
  invalidate();
  __setFetch(async (url) => { seen = String(url); return res({ Block: { FIPS: '1' }, County: {}, State: {} }); });
  await areaLookup({ lat: 2, lon: 2 });
  assert.match(seen, /api_key=unit-test-key/);
  restore();
});
