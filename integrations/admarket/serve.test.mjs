// serve.test.mjs — offline, no network. House/sold rendering, esc safety, serving + click metering.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  renderSoldAd, pickHouseAd, pickForSlot, serveSlot, meterClick, HOUSE_ADS, soldStyles, esc,
} from './serve.mjs';
import { createStore, createCampaign, reviewCampaign, confirmFunding, getCampaign } from './model.mjs';

const CRE = { headline: 'Acme Legal', body: 'Fast lookup', url: 'https://example.com' };
function storeWithActive(over = {}) {
  let t = 1_700_000_000_000; const s = createStore({ now: () => (t += 1000) });
  const r = createCampaign(s, { advertiser: 'acmecorp', token: 'MELEK', model: 'cpm', rate: '2.000', budget: '10.000', placement: 'law-top', creative: CRE, ...over });
  reviewCampaign(s, r.campaign.id, 'approve');
  confirmFunding(s, r.campaign.id, { ref: '0xdep', amount: over.budget || '10.000' });
  return { s, id: r.campaign.id };
}

test('renderSoldAd: sold unit carries tracking attrs, Sponsored label, rel=sponsored', () => {
  const html = renderSoldAd({ id: 'camp_1', creative: CRE }, { placement: 'law-top' });
  assert.match(html, /class="ad-slot ad-slot--sold"/);
  assert.match(html, /data-ad-placement="law-top"/);
  assert.match(html, /data-ad-campaign="camp_1"/);
  assert.match(html, /rel="sponsored nofollow noopener"/);
  assert.match(html, /Sponsored/);
  assert.match(html, /Acme Legal/);
});

test('house ad → MELEK label, house class, points at a real surface', () => {
  const html = renderSoldAd(pickHouseAd({ rotate: 0 }), { placement: 'law-top' });
  assert.match(html, /ad-slot--house/);
  assert.match(html, />MELEK</);
  assert.match(html, /melek\.salon|soapbox\.community/);
});

test('click metering redirect: link routes through clickBase when set', () => {
  const html = renderSoldAd({ id: 'camp_1', creative: CRE }, { placement: 'law-top', clickBase: 'https://ads.melek.salon/click' });
  assert.match(html, /href="https:\/\/ads\.melek\.salon\/click\?c=camp_1&amp;p=law-top"/);
});

test('esc: creative content cannot inject HTML', () => {
  const html = renderSoldAd({ id: '"><img>', creative: { headline: '<script>x</script>', url: 'https://x.com', body: '"><b>' } }, { placement: 'law-top' });
  assert.doesNotMatch(html, /<script>x/);
  assert.doesNotMatch(html, /<img>/);
  assert.match(html, /&lt;script&gt;/);
  assert.equal(esc(`<a "'&>`), '&lt;a &quot;&#39;&amp;&gt;');
});

test('renderSoldAd soft-fails to empty on bad input', () => {
  assert.equal(renderSoldAd(null, {}), '');
  assert.equal(renderSoldAd({ id: 'x', creative: { headline: 'h' } }, {}), ''); // no url
  assert.equal(renderSoldAd({ id: 'x', creative: { url: 'https://x.com' } }, {}), ''); // no headline
});

test('pickForSlot: sold wins; house fallback; house:false → nothing', () => {
  const { s } = storeWithActive();
  assert.equal(pickForSlot(s, 'law-top').sold, true);
  assert.equal(pickForSlot(s, 'empty-top').sold, false);            // → house ad
  assert.ok(pickForSlot(s, 'empty-top').ad.house);
  assert.equal(pickForSlot(s, 'empty-top', { house: false }).ad, null);
});

test('serveSlot: meters a sold impression at serve time; house is free', () => {
  const { s, id } = storeWithActive();
  const out = serveSlot(s, 'law-top');
  assert.equal(out.sold, true);
  assert.equal(out.charged, '2');                                   // 2000/1000 = 2 base units per impression
  assert.equal(getCampaign(s, id).impressions, 1);
  assert.match(out.html, /ad-slot--sold/);
  // an empty slot serves a house ad, no charge
  const h = serveSlot(s, 'empty-top');
  assert.equal(h.sold, false);
  assert.equal(h.charged, '0');
});

test('serveSlot: exhausted campaign falls back to a house ad (slot never empty)', () => {
  const { s, id } = storeWithActive({ rate: '2.000', budget: '2.000' }); // 1000 impressions of headroom
  // burn the budget
  for (let i = 0; i < 1000; i++) serveSlot(s, 'law-top', { meter: true });
  assert.equal(getCampaign(s, id).status, 'exhausted');
  const out = serveSlot(s, 'law-top');
  assert.equal(out.sold, false);
  assert.ok(out.ad.house);
  assert.match(out.html, /ad-slot--house/);
});

test('meterClick: bills a sold click, redirect url returned; house is free no-op', () => {
  const { s, id } = storeWithActive({ model: 'cpc', rate: '1.000', budget: '3.000' });
  const r = meterClick(s, id);
  assert.equal(r.ok, true);
  assert.equal(r.billed, true);
  assert.equal(r.charged, '1000');
  assert.equal(r.url, 'https://example.com');
  assert.equal(getCampaign(s, id).clicks, 1);
  // house ad id → free
  const h = meterClick(s, 'house:signup');
  assert.equal(h.billed, false);
  assert.equal(h.url, HOUSE_ADS.find((a) => a.id === 'house:signup').url);
  // unknown id → not ok
  assert.equal(meterClick(s, 'camp_missing').ok, false);
});

test('soldStyles is CSS', () => {
  assert.match(soldStyles(), /\.ad-slot--sold/);
});
