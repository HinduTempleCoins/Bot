// auto-marketplace.test.mjs — OFFLINE tests for the Auto aggregator (queue #243). No real network:
// fetch is injected per-test. Covers: searchCars normalize + soft-fail [] + maxPrice filter; valueCheck
// flagging overpriced vs an injected fair value AND delegating to the value module; parts/repair/tires
// normalization; rankByValue ranks by value not commission; renderPage escapes a malicious title and
// always carries a disclosure; dataNote. Run: node --test integrations/soapbox/auto-marketplace.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchCars, valueCheck, parts, repairEstimate, tires, rankByValue, renderPage, dataNote, esc, __setFetch,
} from './auto-marketplace.mjs';

// run a body with a controlled env, restoring originals afterward
function withEnv(vars, fn) {
  const saved = {};
  for (const k of Object.keys(vars)) saved[k] = process.env[k];
  for (const [k, val] of Object.entries(vars)) {
    if (val === undefined) delete process.env[k]; else process.env[k] = val;
  }
  return Promise.resolve(fn()).finally(() => {
    for (const [k, val] of Object.entries(saved)) {
      if (val === undefined) delete process.env[k]; else process.env[k] = val;
    }
  });
}

// a fake fetch returning a fixed JSON body, ok:true
const jsonFetch = (body) => async () => ({ ok: true, json: async () => body });
const failFetch = () => async () => ({ ok: false, status: 500, json: async () => ({}) });
const throwFetch = () => async () => { throw new Error('network down'); };

// ── searchCars ────────────────────────────────────────────────────────────────────────────────────────

test('searchCars: normalizes MarketCheck listings into a stable shape', () =>
  withEnv({ MARKETCHECK_KEY: 'k' }, async () => {
    const fetch = jsonFetch({
      listings: [
        { heading: '2020 Honda Civic LX', price: 18000, miles: 30000, vin: 'ABC', build: { year: 2020, make: 'Honda', model: 'Civic', trim: 'LX' }, dealer: { name: 'Acme', zip: '90210' }, vdp_url: 'https://x/1' },
        { price: 21000, build: { year: 2021, make: 'Honda', model: 'Civic' } },
      ],
    });
    const out = await searchCars({ make: 'Honda', model: 'Civic', zip: '90210' }, { fetch });
    assert.equal(out.length, 2);
    assert.equal(out[0].title, '2020 Honda Civic LX');
    assert.equal(out[0].price, 18000);
    assert.equal(out[0].miles, 30000);
    assert.equal(out[0].vin, 'ABC');
    assert.equal(out[0].dealer, 'Acme');
    assert.equal(out[0].source, 'MarketCheck');
    // second listing builds a title from the build fields
    assert.ok(out[1].title.includes('Honda') && out[1].title.includes('Civic'));
  }));

test('searchCars: soft-fails to [] with no key, no make/model, dead fetch, and throwing fetch', async () => {
  await withEnv({ MARKETCHECK_KEY: undefined }, async () => {
    assert.deepEqual(await searchCars({ make: 'Honda' }, { fetch: jsonFetch({ listings: [] }) }), []);
  });
  await withEnv({ MARKETCHECK_KEY: 'k' }, async () => {
    assert.deepEqual(await searchCars({}, { fetch: jsonFetch({ listings: [{ price: 1 }] }) }), []); // no make/model
    assert.deepEqual(await searchCars({ make: 'Honda' }, { fetch: failFetch() }), []);
    assert.deepEqual(await searchCars({ make: 'Honda' }, { fetch: throwFetch() }), []);
  });
});

test('searchCars: applies maxPrice filter even if the source ignores it', () =>
  withEnv({ MARKETCHECK_KEY: 'k' }, async () => {
    const fetch = jsonFetch({
      listings: [
        { heading: 'cheap', price: 9000, build: { make: 'Honda', model: 'Civic' } },
        { heading: 'mid', price: 15000, build: { make: 'Honda', model: 'Civic' } },
        { heading: 'pricey', price: 30000, build: { make: 'Honda', model: 'Civic' } },
        { heading: 'no-price', build: { make: 'Honda', model: 'Civic' } },
      ],
    });
    const out = await searchCars({ make: 'Honda', model: 'Civic', maxPrice: 16000 }, { fetch });
    assert.deepEqual(out.map((l) => l.title), ['cheap', 'mid']);
    assert.ok(out.every((l) => l.price <= 16000));
  }));

// ── valueCheck ────────────────────────────────────────────────────────────────────────────────────────

test('valueCheck: flags overpriced vs an injected fair value', async () => {
  const r = await valueCheck({ price: 25000 }, { fairValue: { median: 20000 } });
  assert.equal(r.verdict, 'overpriced');
  assert.equal(r.delta, 5000);
  assert.equal(r.deltaPct, 25);
  assert.equal(r.fair.median, 20000);
  assert.equal(r.source, 'injected');
});

test('valueCheck: good-deal and fair tiers around the injected median', async () => {
  assert.equal((await valueCheck({ price: 18000 }, { fairValue: 20000 })).verdict, 'good-deal'); // -10%
  assert.equal((await valueCheck({ price: 20000 }, { fairValue: 20000 })).verdict, 'fair');       // 0%
  assert.equal((await valueCheck({ price: 20500 }, { fairValue: 20000 })).verdict, 'fair');       // +2.5%
});

test('valueCheck: DELEGATES to an injected value module (valueByVin), not local math', async () => {
  let called = null;
  const vehicleValue = {
    async valueByVin(vin) { called = vin; return { source: 'marketcheck', median: 22000, low: 20000, high: 24000 }; },
    fairMarketRange() { throw new Error('should not be used when valueByVin resolves'); },
  };
  const r = await valueCheck({ price: 30000, vin: 'VIN123' }, { vehicleValue });
  assert.equal(called, 'VIN123', 'valueByVin must be the delegated path');
  assert.equal(r.verdict, 'overpriced');
  assert.equal(r.fair.median, 22000);
  assert.equal(r.source, 'vehicle-value:marketcheck');
});

test('valueCheck: delegates to fairMarketRange over injected comps when no VIN value', async () => {
  const vehicleValue = {
    fairMarketRange(comps) { assert.ok(Array.isArray(comps)); return { median: 19000, low: 18000, high: 20000 }; },
  };
  const r = await valueCheck({ price: 17000, comps: [18000, 19000, 20000] }, { vehicleValue });
  assert.equal(r.verdict, 'good-deal');
  assert.equal(r.source, 'vehicle-value:comps');
});

test('valueCheck: soft-fails to a shaped unknown verdict (no price, no value)', async () => {
  const noPrice = await valueCheck({}, { fairValue: 20000 });
  assert.equal(noPrice.verdict, 'unknown');
  assert.equal(noPrice.fair, null);
  const noValue = await valueCheck({ price: 20000 }, { vehicleValue: {} });
  assert.equal(noValue.verdict, 'unknown');
});

// ── parts / repair / tires ────────────────────────────────────────────────────────────────────────────

test('parts: normalizes and soft-fails', () =>
  withEnv({ PARTS_API_KEY: 'k' }, async () => {
    const fetch = jsonFetch({ results: [
      { name: 'Brake Pad Set', brand: 'Akebono', part_number: 'AK-1', price: 45.5, vendor: 'RockAuto', url: 'https://x' },
      { title: 'no price part' },
    ] });
    const out = await parts({ partQuery: 'brake pads' }, { fetch });
    assert.equal(out.length, 1);
    assert.equal(out[0].name, 'Brake Pad Set');
    assert.equal(out[0].partNumber, 'AK-1');
    assert.equal(out[0].price, 45.5);
    // soft-fails
    assert.deepEqual(await parts({}, { fetch }), []);
    await withEnv({ PARTS_API_KEY: undefined }, async () => {
      assert.deepEqual(await parts({ partQuery: 'x' }, { fetch }), []);
    });
  }));

test('repairEstimate: normalizes a low/avg/high band and soft-fails', () =>
  withEnv({ REPAIR_ESTIMATE_KEY: 'k' }, async () => {
    const fetch = jsonFetch({ estimate: { low: 200, high: 400, currency: 'USD' } });
    const r = await repairEstimate({ job: 'brake pads', zip: '90210' }, { fetch });
    assert.equal(r.low, 200);
    assert.equal(r.high, 400);
    assert.equal(r.avg, 300); // derived midpoint
    assert.equal(r.estimate, true);
    assert.equal(r.job, 'brake pads');
    // soft-fails
    assert.equal(await repairEstimate({}, { fetch }), null);
    assert.equal(await repairEstimate({ job: 'x' }, { fetch: throwFetch() }), null);
    await withEnv({ REPAIR_ESTIMATE_KEY: undefined }, async () => {
      assert.equal(await repairEstimate({ job: 'x' }, { fetch }), null);
    });
  }));

test('tires: normalizes by size and soft-fails', () =>
  withEnv({ TIRES_API_KEY: 'k' }, async () => {
    const fetch = jsonFetch({ products: [
      { model: 'CrossClimate2', brand: 'Michelin', size: '225/45R17', price: 189.99, vendor: 'TireRack' },
      { brand: 'noname' },
    ] });
    const out = await tires({ size: '225/45R17' }, { fetch });
    assert.equal(out.length, 1);
    assert.equal(out[0].model, 'CrossClimate2');
    assert.equal(out[0].size, '225/45R17');
    assert.equal(out[0].price, 189.99);
    assert.deepEqual(await tires({}, { fetch }), []);
    await withEnv({ TIRES_API_KEY: undefined }, async () => {
      assert.deepEqual(await tires({ size: '1' }, { fetch }), []);
    });
  }));

// ── rankByValue ───────────────────────────────────────────────────────────────────────────────────────

test('rankByValue: ranks by value verdict then price, NEVER by commission', () => {
  const items = [
    { title: 'overpriced cheap',  price: 5000,  verdict: 'overpriced', commission: 999 },
    { title: 'good deal pricey',  price: 30000, verdict: 'good-deal',  commission: 0 },
    { title: 'fair mid',          price: 15000, verdict: 'fair',       commission: 500 },
    { title: 'good deal cheaper', price: 25000, verdict: 'good-deal',  commission: 0 },
  ];
  const ranked = rankByValue(items);
  // good-deals first (cheaper of the two leads), then fair, then overpriced — commission ignored entirely.
  assert.deepEqual(ranked.map((x) => x.title), [
    'good deal cheaper', 'good deal pricey', 'fair mid', 'overpriced cheap',
  ]);
  // the highest-commission item must NOT be first
  assert.notEqual(ranked[0].commission, 999);
});

test('rankByValue: does not mutate input and handles missing verdict/price', () => {
  const input = [{ title: 'b', price: 100 }, { title: 'a', price: 100 }, { title: 'c' }];
  const copy = JSON.parse(JSON.stringify(input));
  const ranked = rankByValue(input);
  assert.deepEqual(input, copy, 'input not mutated');
  // equal price → alphabetical; no-price sorts last
  assert.deepEqual(ranked.map((x) => x.title), ['a', 'b', 'c']);
  assert.deepEqual(rankByValue(null), []);
});

// ── renderPage / dataNote ─────────────────────────────────────────────────────────────────────────────

test('renderPage: escapes a malicious listing title and always carries a disclosure', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({ cars: [{ title: evil, price: 1000, verdict: 'fair' }] });
  assert.ok(!html.includes('<script>'), 'raw script tag must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'title must be escaped');
  assert.ok(/disclosure/i.test(html), 'a disclosure must always be present');
  assert.ok(html.includes('affiliate'), 'fallback disclosure mentions affiliate');
});

test('renderPage: renders parts/tires/repair sections and uses a provided disclosure', () => {
  const html = renderPage({
    parts: [{ name: 'Pad', price: 40, vendor: 'V' }],
    tires: [{ model: 'T', size: '1', price: 100, vendor: 'V' }],
    repair: { job: 'brakes', low: 200, high: 400, avg: 300, note: 'estimate' },
    disclosure: 'CUSTOM-DISCLOSURE-LINE',
  });
  assert.ok(html.includes('Pad'));
  assert.ok(html.includes('CrossClimate') === false); // sanity
  assert.ok(html.includes('brakes'));
  assert.ok(html.includes('CUSTOM-DISCLOSURE-LINE'));
});

test('renderPage: empty data still produces a section with disclosure + note', () => {
  const html = renderPage({});
  assert.ok(html.includes('auto-marketplace'));
  assert.ok(/disclosure/i.test(html));
  assert.ok(html.includes('never by commission'));
});

test('dataNote: non-empty string mentioning value-not-commission ranking', () => {
  const d = dataNote();
  assert.equal(typeof d, 'string');
  assert.ok(d.length > 0);
  assert.ok(/value/i.test(d) && /commission/i.test(d));
});

test('esc: escapes the five HTML-significant characters', () => {
  assert.equal(esc(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
  assert.equal(esc(null), '');
});

test('__setFetch is exported and callable', () => {
  assert.equal(typeof __setFetch, 'function');
  __setFetch(null); // resets to default without throwing
});
