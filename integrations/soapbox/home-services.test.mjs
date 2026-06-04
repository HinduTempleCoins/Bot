// home-services.test.mjs — OFFLINE guards for the SoapBox home-services / solar / broadband comparison
// (queue #239). Fake fetch + injected fcc reader only; asserts honest-speed reuse, soft-fail, the
// documented solar payback formula, rank-by-rating (NOT commission), the no-data-selling quote refusal,
// HTML escaping, and disclosure. No network.
// Run: node --test integrations/soapbox/home-services.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SERVICES, __setFetch, broadbandOptions, solarEstimate, providerCompare,
  requestQuote, buildLeadGen, renderPage, dataNote, isService,
} from './home-services.mjs';

const res = (body, ok = true) => ({
  ok,
  status: ok ? 200 : 500,
  json: async () => body,
  text: async () => JSON.stringify(body),
});

test('SERVICES catalog covers the expected verticals', () => {
  const ids = SERVICES.map((s) => s.id);
  for (const id of ['contractors', 'movers', 'solar', 'broadband', 'cell-plans', 'home-security', 'storage']) {
    assert.ok(ids.includes(id), `missing vertical ${id}`);
  }
  assert.ok(isService('solar'));
  assert.ok(!isService('nonsense'));
});

test('broadbandOptions() returns honest-speed plans via injected fcc source', async () => {
  // Inject a fake fcc reader (defensive-import substitute) — no network, no duplication.
  const fakeFcc = {
    broadbandAt: async () => ([
      { provider: 'AcmeFiber', technology: 'Fiber', downMbps: 1000, upMbps: 1000, source: 'FCC Broadband Data' },
      { provider: 'OldCable', technology: 'Cable', downMbps: 200, upMbps: 10, source: 'FCC Broadband Data' },
      { provider: '', technology: 'Other', downMbps: 5 }, // dropped: no isp
    ]),
  };
  const rows = await broadbandOptions({ lat: 37.6, lon: -97.3 }, { fcc: fakeFcc });
  assert.equal(rows.length, 2);
  assert.equal(rows[0].isp, 'AcmeFiber');
  assert.equal(rows[0].downMbps, 1000);
  // honest-speed caveat present on every plan
  assert.match(rows[0].speedNote, /advertised maximum/i);
  assert.ok(rows.every((r) => /advertised/i.test(r.speedNote)));
});

test('broadbandOptions() soft-fails to [] when the fcc reader is missing or throws', async () => {
  assert.deepEqual(await broadbandOptions({ lat: 1, lon: 2 }, { fcc: null }), []);
  assert.deepEqual(await broadbandOptions({}, { fcc: { broadbandAt: async () => { throw new Error('boom'); } } }), []);
  assert.deepEqual(await broadbandOptions({}, { fcc: {} }), []); // no broadbandAt fn
});

test('solarEstimate() computes a payback from the documented formula', () => {
  const est = solarEstimate({ zip: '67000', billMonthly: 150 }); // zip leading '6' → sunFactor 1.0
  assert.ok(est && est.estimate === true);
  // Recompute the documented formula and assert it matches.
  const a = est.assumptions;
  const annualBill = 150 * 12;
  const systemKw = annualBill / (a.avgRatePerKwh * a.kwhPerKwPerYear * 1.0);
  const grossCost = systemKw * a.costPerWatt * 1000;
  const netCost = grossCost * (1 - a.federalCreditRate);
  const payback = netCost / annualBill;
  assert.ok(Math.abs(est.paybackYears - payback) < 0.05, `payback ${est.paybackYears} vs ${payback}`);
  assert.equal(est.annualSavings, annualBill);
  assert.ok(est.netCost < est.grossCost, 'federal credit reduces cost');
  assert.match(est.note, /estimate/i);
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(est.asOf));
});

test('solarEstimate() soft-fails to null on bad input', () => {
  assert.equal(solarEstimate({ zip: '', billMonthly: 100 }), null);
  assert.equal(solarEstimate({ zip: '90210', billMonthly: 0 }), null);
  assert.equal(solarEstimate({ zip: '90210', billMonthly: -5 }), null);
  assert.equal(solarEstimate({}), null);
});

test('providerCompare() ranks by rating, NOT commission', async () => {
  __setFetch(async () => res({
    providers: [
      { name: 'PaysUsMost', rating: 3.1, area: 'TX', url: 'https://a', commission: 999 },
      { name: 'BestRated', rating: 4.9, area: 'TX', url: 'https://b', commission: 0 },
      { name: 'MidRated', rating: 4.0, area: 'TX', url: 'https://c', commission: 500 },
      { name: 'NoRating', area: 'TX', url: 'https://d', commission: 1000 },
    ],
  }));
  const list = await providerCompare({ service: 'movers', area: 'TX' }, {});
  __setFetch(null);
  assert.deepEqual(list.map((p) => p.name), ['BestRated', 'MidRated', 'PaysUsMost', 'NoRating']);
  // commission must never appear on the normalized records
  assert.ok(list.every((p) => !('commission' in p)));
});

test('providerCompare() soft-fails to [] (bad service, dead feed)', async () => {
  assert.deepEqual(await providerCompare({ service: 'nope', area: 'TX' }, {}), []);
  __setFetch(async () => res({}, false));
  assert.deepEqual(await providerCompare({ service: 'movers', area: 'TX' }, {}), []);
  __setFetch(async () => { throw new Error('net'); });
  assert.deepEqual(await providerCompare({ service: 'movers', area: 'TX' }, {}), []);
  __setFetch(null);
});

test('requestQuote() REFUSES a data-selling / no-consent path and ALLOWS a consented one', () => {
  // no consent → refused
  const noConsent = requestQuote({ service: 'solar', provider: 'SunCo', user: { email: 'x@y.z' }, consent: false });
  assert.equal(noConsent.ok, false);
  assert.equal(noConsent.reason, 'no-consent');

  // data-selling intent → refused even with consent
  const selling = requestQuote({ service: 'solar', provider: 'SunCo', user: { email: 'x@y.z' }, consent: true, intent: 'sell my data to networks' });
  assert.equal(selling.ok, false);
  assert.equal(selling.reason, 'refused-data-selling');

  // multi-buyer lead-mill → refused
  const multi = requestQuote({ service: 'solar', provider: 'SunCo', user: { email: 'x@y.z', recipients: ['B', 'C'] }, consent: true });
  assert.equal(multi.ok, false);
  assert.equal(multi.reason, 'refused-multi-buyer');

  // consented single-provider request → allowed, routing record only, never sold
  const ok = requestQuote({ service: 'solar', provider: 'SunCo', user: { name: 'Pat', email: 'pat@ex.com', zip: '90210' }, consent: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.record.sold, false);
  assert.equal(ok.record.routedTo, 'SunCo');
  assert.equal(ok.record.provider, 'SunCo');
  assert.equal(ok.record.contact.email, 'pat@ex.com');
  assert.equal(ok.record.consent, true);
});

test('buildLeadGen() rejects unknown service / missing provider', () => {
  assert.equal(buildLeadGen({ service: 'nope', provider: 'X', consent: true }).reason, 'unknown-service');
  assert.equal(buildLeadGen({ service: 'solar', provider: '', consent: true }).reason, 'no-provider');
});

test('renderPage() escapes a malicious provider name + shows disclosure', () => {
  const html = renderPage({
    service: 'movers',
    providers: [{ name: '<script>alert(1)</script>', rating: 4.2, area: 'TX', url: 'https://x"onmouseover=1' }],
    broadband: [{ isp: '<b>EvilISP</b>', technology: 'Fiber', downMbps: 100, upMbps: 50 }],
    solar: solarEstimate({ zip: '90210', billMonthly: 120 }),
    disclosure: 'Affiliate disclosure here',
  });
  assert.ok(!html.includes('<script>alert(1)</script>'), 'script not raw');
  assert.ok(html.includes('&lt;script&gt;'), 'escaped script present');
  assert.ok(!html.includes('<b>EvilISP</b>'), 'isp not raw');
  assert.ok(html.includes('&lt;b&gt;EvilISP'), 'escaped isp present');
  assert.ok(html.includes('Affiliate disclosure here'), 'disclosure shown');
  assert.match(html, /Ranked by honest rating/i);
  assert.match(html, /advertised maximums/i);
  assert.match(html, /payback/i);
});

test('renderPage() works with empty data (no throw)', () => {
  const html = renderPage({});
  assert.match(html, /home-services/);
  assert.match(html, /as of \d{4}-\d{2}-\d{2}/);
});

test('dataNote() present with honest framing', () => {
  const n = dataNote();
  assert.ok(n.length > 0);
  assert.match(n, /never by what they pay us/i);
  assert.match(n, /never sold or shared/i);
  assert.match(n, /as of \d{4}-\d{2}-\d{2}/);
});
