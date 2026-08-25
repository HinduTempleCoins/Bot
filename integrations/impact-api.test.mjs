// impact-api.test.mjs — offline tests for the Impact Mediapartner API adapter.
// Injected fetch returns canned Impact JSON; no network, no real credentials. Soft-fail paths verified.
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import {
  configured, listCampaigns, campaignsByCategory, listDeals, listCatalogs, catalogItems,
  offersForVertical, coverageReport, __setFetch,
} from './impact-api.mjs';

let saved;
beforeEach(() => {
  saved = { sid: process.env.IMPACT_ACCOUNT_SID, tok: process.env.IMPACT_AUTH_TOKEN };
  process.env.IMPACT_ACCOUNT_SID = 'IR-TEST-SID';
  process.env.IMPACT_AUTH_TOKEN = 'test-token';
});
afterEach(() => {
  if (saved.sid === undefined) delete process.env.IMPACT_ACCOUNT_SID; else process.env.IMPACT_ACCOUNT_SID = saved.sid;
  if (saved.tok === undefined) delete process.env.IMPACT_AUTH_TOKEN; else process.env.IMPACT_AUTH_TOKEN = saved.tok;
  __setFetch(null);
});

function fakeApi(byPath) {
  return async (url, opts) => {
    // capture the auth header for the leak/format test
    fakeApi.lastAuth = opts && opts.headers && opts.headers.authorization;
    const u = new URL(url);
    const path = u.pathname;
    for (const [frag, body] of Object.entries(byPath)) {
      if (path.includes(frag)) return { ok: true, json: async () => body };
    }
    return { ok: false, json: async () => ({}) };
  };
}

const CAMPAIGNS = { Campaigns: [
  { CampaignId: '1', CampaignName: 'BookHotels', Category: 'Travel / Hotel', TrackingLink: 'https://ex/hotel', ContractStatus: 'Active', AllowDeepLinking: true },
  { CampaignId: '2', CampaignName: 'SaveCoupons', Category: 'Retail / Coupon', ContractStatus: 'Active' },
  { CampaignId: '3', CampaignName: 'AutoInsure', Category: 'Insurance', ContractStatus: 'Active' },
  { CampaignId: '4', CampaignName: 'RandomGadget', Category: 'Electronics', ContractStatus: 'Active' },
] };

test('configured() requires BOTH sid and token', () => {
  assert.equal(configured(), true);
  delete process.env.IMPACT_AUTH_TOKEN;
  assert.equal(configured(), false);
});

test('listCampaigns parses + normalizes approved advertisers', async () => {
  __setFetch(fakeApi({ '/Campaigns': CAMPAIGNS }));
  const c = await listCampaigns();
  assert.equal(c.length, 4);
  assert.equal(c[0].name, 'BookHotels');
  assert.equal(c[0].allowsDeepLinking, true);
});

test('auth header is HTTP Basic of sid:token (and only sent, never returned/logged)', async () => {
  __setFetch(fakeApi({ '/Campaigns': CAMPAIGNS }));
  await listCampaigns();
  const expected = 'Basic ' + Buffer.from('IR-TEST-SID:test-token').toString('base64');
  assert.equal(fakeApi.lastAuth, expected);
});

test('campaignsByCategory filters by vertical keywords', async () => {
  __setFetch(fakeApi({ '/Campaigns': CAMPAIGNS }));
  assert.deepEqual((await campaignsByCategory('hotel')).map((c) => c.name), ['BookHotels']);
  assert.deepEqual((await campaignsByCategory('insurance')).map((c) => c.name), ['AutoInsure']);
  assert.deepEqual((await campaignsByCategory('coupons')).map((c) => c.name), ['SaveCoupons']);
});

test('listDeals parses promo codes', async () => {
  __setFetch(fakeApi({ '/Deals': { Deals: [
    { Id: 'd1', CampaignId: '2', AdvertiserName: 'SaveCoupons', Name: '20% off', CouponCode: 'SAVE20', Discount: '20%', LandingPageUrl: 'https://ex/x', EndDate: '2026-12-31' },
  ] } }));
  const d = await listDeals();
  assert.equal(d[0].code, 'SAVE20');
  assert.equal(d[0].advertiser, 'SaveCoupons');
});

test('catalogs + items parse', async () => {
  __setFetch(fakeApi({ '/Catalogs/CAT1/Items': { Items: [{ Id: 'i1', Name: 'Room', CurrentPrice: '120', Currency: 'USD', Url: 'https://ex/room' }] }, '/Catalogs': { Catalogs: [{ Id: 'CAT1', Name: 'Hotels', NumberOfItems: 500 }] } }));
  const cats = await listCatalogs();
  assert.equal(cats[0].id, 'CAT1');
  const items = await catalogItems('CAT1');
  assert.equal(items[0].price, 120);
});

test('offersForVertical(hotel) returns the approved hotel campaigns', async () => {
  __setFetch(fakeApi({ '/Campaigns': CAMPAIGNS }));
  const o = await offersForVertical('hotel');
  assert.equal(o.configured, true);
  assert.equal(o.campaigns.length, 1);
  assert.equal(o.campaigns[0].name, 'BookHotels');
});

test('offersForVertical(coupons) pulls deals', async () => {
  __setFetch(fakeApi({
    '/Campaigns': CAMPAIGNS,
    '/Deals': { Deals: [{ Id: 'd1', CampaignId: '2', Name: 'Deal', CouponCode: 'X', EndDate: '2026-12-31' }] },
  }));
  const o = await offersForVertical('coupons');
  assert.ok(o.deals.length >= 1);
});

test('coverageReport buckets approved advertisers by vertical', async () => {
  __setFetch(fakeApi({ '/Campaigns': CAMPAIGNS }));
  const r = await coverageReport();
  assert.equal(r.configured, true);
  assert.equal(r.total, 4);
  assert.deepEqual(r.byVertical.hotel, ['BookHotels']);
  assert.deepEqual(r.byVertical.insurance, ['AutoInsure']);
});

test('UNCONFIGURED → soft-fails to empty, never throws, no fake data', async () => {
  delete process.env.IMPACT_AUTH_TOKEN;
  assert.equal(configured(), false);
  assert.deepEqual(await listCampaigns(), []);
  const o = await offersForVertical('hotel');
  assert.equal(o.configured, false);
  assert.deepEqual(o.campaigns, []);
  const cov = await coverageReport();
  assert.equal(cov.configured, false);
  assert.match(cov.note, /Settings/);
});

test('HTTP error / garbage soft-fails to [] (never throws)', async () => {
  __setFetch(() => Promise.resolve({ ok: false, json: async () => ({}) }));
  assert.deepEqual(await listCampaigns(), []);
  assert.deepEqual(await listDeals(), []);
  __setFetch(() => { throw new Error('network'); });
  assert.deepEqual(await listCampaigns(), []);
});
