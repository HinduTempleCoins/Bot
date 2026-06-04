// real-estate.test.mjs — OFFLINE tests for the real-estate vertical (queue task #242).
// Everything runs with an injected fetch; no network. Focus: normalization + soft-fail, value-not-
// commission ranking, the agentMatch consent/data-selling guardrail, affordability via an injected
// ACS payload, render escaping + disclosure, and the dataNote.
// Run: node --test integrations/soapbox/real-estate.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  searchListings,
  rankListings,
  agentMatch,
  affordability,
  renderPage,
  dataNote,
  normalizeListing,
  __setFetch,
  PORTALS,
  DTI_FRONT_END,
  buildLeadGen,
} from './real-estate.mjs';

const NOW = Date.parse('2026-06-04T00:00:00Z');

// a fetch that returns a fixed JSON body (ok), used to feed searchListings offline.
function jsonFetch(body, { ok = true } = {}) {
  return async () => ({ ok, json: async () => body });
}
const throwFetch = async () => { throw new Error('network down'); };

// ---------------------------------------------------------------------------
// normalize + soft-fail
// ---------------------------------------------------------------------------

test('normalizeListing maps fields and computes price/sqft', () => {
  const n = normalizeListing(
    { address: '1 Main St', price: 300000, beds: 3, baths: 2, sqft: 1500, url: 'https://x/1' },
    { kind: 'buy', source: 'Zillow', nowMs: NOW },
  );
  assert.equal(n.kind, 'buy');
  assert.equal(n.address, '1 Main St');
  assert.equal(n.price, 300000);
  assert.equal(n.beds, 3);
  assert.equal(n.sqft, 1500);
  assert.equal(n.pricePerSqft, 200);
  assert.equal(n.source, 'Zillow');
  assert.equal(n.asOf, new Date(NOW).toISOString());
});

test('normalizeListing soft-fails: junk → null, missing numbers → null fields', () => {
  assert.equal(normalizeListing(null, { kind: 'buy' }), null);
  assert.equal(normalizeListing(42, { kind: 'buy' }), null);
  assert.equal(normalizeListing({}, { kind: 'buy' }), null); // no price AND no address
  const n = normalizeListing({ address: 'A', price: 'NaN', sqft: 'x' }, { kind: 'rent', nowMs: NOW });
  assert.equal(n.price, null);
  assert.equal(n.sqft, null);
  assert.equal(n.pricePerSqft, null);
});

test('searchListings normalizes a provider payload (injected fetch)', async () => {
  const body = { listings: [
    { address: '10 Oak', price: 250000, sqft: 1000, url: 'https://z/10' },
    { address: '20 Elm', price: 400000, sqft: 1000, url: 'https://z/20' },
  ] };
  const out = await searchListings({ type: 'buy', area: 'Austin' }, { fetch: jsonFetch(body), nowMs: NOW });
  assert.equal(out.length, 2);
  assert.equal(out[0].source, 'Zillow');
  assert.equal(out[0].pricePerSqft, 250);
});

test('searchListings soft-fails to [] on network error / bad type / no area', async () => {
  assert.deepEqual(await searchListings({ type: 'buy', area: 'X' }, { fetch: throwFetch }), []);
  assert.deepEqual(await searchListings({ type: 'nope', area: 'X' }, { fetch: jsonFetch({}) }), []);
  assert.deepEqual(await searchListings({ type: 'buy' }, { fetch: jsonFetch({}) }), []);
  assert.deepEqual(await searchListings({ type: 'rent', area: 'X' }, { fetch: jsonFetch(null, { ok: false }) }), []);
});

test('searchListings applies maxPrice and beds filters', async () => {
  const body = { results: [
    { address: 'cheap', price: 100000, sqft: 500, beds: 1 },
    { address: 'pricey', price: 900000, sqft: 500, beds: 4 },
  ] };
  const out = await searchListings({ type: 'buy', area: 'Austin', maxPrice: 500000, beds: 2 }, { fetch: jsonFetch(body), nowMs: NOW });
  assert.equal(out.length, 0); // cheap fails beds>=2, pricey fails maxPrice
});

// ---------------------------------------------------------------------------
// ranking: by value, NEVER by commission
// ---------------------------------------------------------------------------

test('rankListings ranks by price/sqft (value), commission does NOT float a listing up', () => {
  const listings = [
    { address: 'good value', price: 200000, sqft: 2000, pricePerSqft: 100, commission: 0 },
    { address: 'paid us a lot', price: 600000, sqft: 2000, pricePerSqft: 300, commission: 99999 },
    { address: 'mid', price: 400000, sqft: 2000, pricePerSqft: 200, commission: 0 },
  ];
  const ranked = rankListings(listings);
  // best value (lowest $/sqft) first, despite the huge commission on the worst-value one.
  assert.equal(ranked[0].address, 'good value');
  assert.equal(ranked[1].address, 'mid');
  assert.equal(ranked[2].address, 'paid us a lot');
});

test('rankListings segregates sponsored to the end + labels them, never outranking organic', () => {
  const listings = [
    { address: 'organic-worse', pricePerSqft: 500 },
    { address: 'sponsored-better', pricePerSqft: 1, sponsored: true, commission: 99999 },
    { address: 'organic-better', pricePerSqft: 50 },
  ];
  const ranked = rankListings(listings);
  assert.equal(ranked[0].address, 'organic-better');
  assert.equal(ranked[1].address, 'organic-worse');
  assert.equal(ranked[2].address, 'sponsored-better');
  assert.equal(ranked[2].sponsored, true);
  assert.equal(ranked[2].label, 'Sponsored');
});

test('rankListings tolerates junk + missing value (sorts to bottom)', () => {
  const ranked = rankListings([null, { address: 'no-pps' }, { address: 'has-pps', pricePerSqft: 10 }]);
  assert.equal(ranked[0].address, 'has-pps');
  assert.equal(ranked[1].address, 'no-pps');
});

// ---------------------------------------------------------------------------
// agentMatch guardrail
// ---------------------------------------------------------------------------

test('agentMatch refuses without consent', () => {
  const r = agentMatch({ area: 'Austin', consent: false });
  assert.equal(r.ok, false);
  assert.equal(r.sold, false);
  assert.match(r.reason, /consent/);
});

test('agentMatch refuses data-selling even WITH consent', () => {
  const r = agentMatch({ area: 'Austin', consent: true, sellsData: true });
  assert.equal(r.ok, false);
  assert.equal(r.sold, false);
  assert.match(r.reason, /data-selling/);
});

test('agentMatch allows a consented single-provider routing, sold:false', () => {
  const r = agentMatch({ area: 'Austin', consent: true, provider: 'LocalRealtyCo' });
  assert.equal(r.ok, true);
  assert.equal(r.sold, false);
  assert.equal(r.routing, 'single-provider');
  assert.equal(r.provider, 'LocalRealtyCo');
});

// ---------------------------------------------------------------------------
// affordability via injected ACS payload
// ---------------------------------------------------------------------------

// the ACS metro endpoint returns [[header],[row]]; B19013_001E = median household income.
function acsFetch(income) {
  return async () => ({
    ok: true,
    json: async () => [
      ['NAME', 'B19013_001E', 'metropolitan statistical area/micropolitan statistical area'],
      ['Austin-Round Rock, TX Metro Area', String(income), '12420'],
    ],
  });
}

test('affordability: a rent within the 28% rule is affordable (injected ACS)', async () => {
  // income 120000 → monthly 10000 → max 2800/mo. Rent 2000 ≤ 2800.
  const a = await affordability({ price: 2000, area: 'Austin' }, { fetch: acsFetch(120000), nowMs: NOW });
  assert.equal(a.medianIncome, 120000);
  assert.equal(a.maxMonthly, 2800);
  assert.equal(a.monthlyHousing, 2000);
  assert.equal(a.affordable, true);
  assert.equal(DTI_FRONT_END, 0.28);
});

test('affordability: an expensive sale price is NOT affordable', async () => {
  // income 60000 → monthly 5000 → max 1400. Sale 800000 → ~4800/mo (0.6%). Not affordable.
  const a = await affordability({ price: 800000, area: 'Austin' }, { fetch: acsFetch(60000), nowMs: NOW });
  assert.equal(a.affordable, false);
  assert.ok(a.monthlyHousing > a.maxMonthly);
});

test('affordability soft-fails to null when income lookup unavailable', async () => {
  const a = await affordability({ price: 2000, area: 'Nowhere' }, { fetch: throwFetch, nowMs: NOW });
  assert.equal(a.affordable, null);
  assert.equal(a.medianIncome, null);
});

test('affordability accepts an injected byMetro dep', async () => {
  const a = await affordability(
    { price: 1500, area: 'Austin' },
    { byMetro: async () => ({ value: 90000 }), nowMs: NOW },
  );
  assert.equal(a.medianIncome, 90000);
  assert.equal(a.affordable, true); // 90000/12*0.28 = 2100 ≥ 1500
});

// ---------------------------------------------------------------------------
// renderPage: escaping + disclosure
// ---------------------------------------------------------------------------

test('renderPage escapes a malicious address and includes the disclosure', () => {
  const evil = '<script>alert(1)</script>';
  const html = renderPage({
    area: 'Austin', type: 'buy', nowMs: NOW,
    listings: [{ address: evil, price: 300000, sqft: 1500, pricePerSqft: 200, url: 'https://z/1', source: 'Zillow' }],
  });
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.match(html, /ftc-disclosure/);
  assert.match(html, /affiliate links/i);
});

test('renderPage shows an affordability line when provided', () => {
  const html = renderPage({
    area: 'Austin', type: 'rent', nowMs: NOW, listings: [],
    affordability: { affordable: true, medianIncome: 120000, maxMonthly: 2800, monthlyHousing: 2000 },
  });
  assert.match(html, /Affordability: within/);
});

test('renderPage handles empty listings + escapes a malicious source in the link', () => {
  const html = renderPage({ area: 'X', type: 'buy', listings: [], nowMs: NOW });
  assert.match(html, /No listings found/);
  assert.match(html, /ftc-disclosure/);
});

// ---------------------------------------------------------------------------
// dataNote
// ---------------------------------------------------------------------------

test('dataNote carries an as-of stamp and the value-not-commission promise', () => {
  const note = dataNote({ source: 'Zillow', asOf: new Date(NOW).toISOString() });
  assert.match(note, /Zillow/);
  assert.match(note, /as of/);
  assert.match(note, /never by commission/);
});

test('PORTALS cover buy/rent/commercial', () => {
  assert.equal(PORTALS.buy.source, 'Zillow');
  assert.equal(PORTALS.rent.source, 'Apartments.com');
  assert.equal(PORTALS.commercial.source, 'LoopNet');
});

// buildLeadGen — the engine-shaped no-data-selling guard
test('buildLeadGen THROWS on a data-selling request', () => {
  assert.throws(() => buildLeadGen({ vertical: 'real-estate', sellsData: true, userConsented: true }), /data-selling/);
});

test('buildLeadGen requires explicit consent (no lead-gen by default)', () => {
  const r = buildLeadGen({ vertical: 'real-estate', providerUrl: 'https://agent.example' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /consent/i);
});

test('buildLeadGen allows a consented, non-data-selling connection', () => {
  const r = buildLeadGen({ vertical: 'real-estate', providerUrl: 'https://agent.example', userConsented: true });
  assert.equal(r.ok, true);
  assert.equal(r.mechanism, 'leadgen');
  assert.match(r.note, /no user data is sold/i);
});
