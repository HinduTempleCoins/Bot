// model.test.mjs — offline, no network, no disk (except the explicit persistence test via a fake fs).
// Campaign lifecycle, budget drawdown, exhaustion, serving/pick, validation, persistence.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createStore, createCampaign, reviewCampaign, confirmFunding, recordServe, pickAd,
  pauseCampaign, resumeCampaign, endCampaign, getCampaign, listCampaigns, listActiveAds,
  remaining, isValidAdvertiser, isValidPlacement, isValidUrl, normalizeCreative,
  serializeStore, saveStore, loadStore,
} from './model.mjs';
import { fromBaseUnits } from './pricing.mjs';

const CRE = { headline: 'Acme Legal', body: 'Fast lookup', url: 'https://example.com' };
function freshStore() { let t = 1_700_000_000_000; return createStore({ now: () => (t += 1000) }); }
function activeCampaign(store, over = {}) {
  const r = createCampaign(store, { advertiser: 'acmecorp', token: 'MELEK', model: 'cpm', rate: '2.000', budget: '10.000', placement: 'law-top', creative: CRE, ...over });
  assert.ok(r.ok, r.error);
  reviewCampaign(store, r.campaign.id, 'approve');
  confirmFunding(store, r.campaign.id, { ref: '0xdep', amount: over.budget || '10.000' });
  return r.campaign.id;
}

test('validators', () => {
  assert.equal(isValidAdvertiser('acmecorp'), true);
  assert.equal(isValidAdvertiser('0x' + 'a'.repeat(40)), true);
  assert.equal(isValidAdvertiser('X'), false);
  assert.equal(isValidPlacement('law-top'), true);
  assert.equal(isValidPlacement('bad slot'), false);
  assert.equal(isValidUrl('https://x.com'), true);
  assert.equal(isValidUrl('javascript:alert(1)'), false);
  assert.equal(normalizeCreative({ headline: 'h', url: 'ftp://x' }).ok, false);
});

test('createCampaign validates token/model/rate/budget/creative', () => {
  const s = freshStore();
  assert.equal(createCampaign(s, { advertiser: 'acmecorp', token: 'USD', model: 'cpm', rate: '1', budget: '2', placement: 'law-top', creative: CRE }).ok, false);
  assert.equal(createCampaign(s, { advertiser: 'acmecorp', token: 'MELEK', model: 'x', rate: '1', budget: '2', placement: 'law-top', creative: CRE }).ok, false);
  assert.equal(createCampaign(s, { advertiser: 'acmecorp', token: 'MELEK', model: 'cpm', rate: '0', budget: '2', placement: 'law-top', creative: CRE }).ok, false);
  assert.equal(createCampaign(s, { advertiser: 'acmecorp', token: 'MELEK', model: 'cpm', rate: '5.000', budget: '2.000', placement: 'law-top', creative: CRE }).ok, false); // budget < rate
  const ok = createCampaign(s, { advertiser: 'acmecorp', token: 'MELEK', model: 'cpm', rate: '2.000', budget: '10.000', placement: 'law-top', creative: CRE });
  assert.ok(ok.ok);
  assert.equal(ok.campaign.status, 'pending_review');
  assert.equal(ok.campaign.rate, '2000');       // base units, string
  assert.equal(ok.campaign.spent, '0');
});

test('full lifecycle: review → confirm → active; a campaign cannot skip gates', () => {
  const s = freshStore();
  const r = createCampaign(s, { advertiser: 'acmecorp', token: 'MELEK', model: 'cpm', rate: '2.000', budget: '10.000', placement: 'law-top', creative: CRE });
  const id = r.campaign.id;
  // cannot confirm before approval
  assert.equal(confirmFunding(s, id, { ref: '0x1' }).ok, false);
  assert.equal(reviewCampaign(s, id, 'approve').campaign.status, 'approved');
  // confirm requires a ref (proof of real deposit)
  assert.equal(confirmFunding(s, id, {}).ok, false);
  assert.equal(confirmFunding(s, id, { ref: '0xdep', amount: '10.000' }).campaign.status, 'active');
  assert.equal(getCampaign(s, id).escrowRef, '0xdep');
  // reject path is terminal
  const r2 = createCampaign(s, { advertiser: 'acmecorp', token: 'APIS', model: 'cpc', rate: '0.100', budget: '5.000', placement: 'wiki-top', creative: CRE });
  assert.equal(reviewCampaign(s, r2.campaign.id, 'reject', { note: 'off-policy' }).campaign.status, 'rejected');
  assert.equal(getCampaign(s, r2.campaign.id).reviewNote, 'off-policy');
});

test('budget drawdown (CPM): spend == rate*impressions/1000, exhausts exactly', () => {
  const s = freshStore();
  const id = activeCampaign(s); // 2 MELEK CPM, 10 MELEK budget → 5000 impressions
  let served = 0;
  for (let i = 0; i < 6000; i++) { const r = recordServe(s, id, { type: 'impression' }); if (r.served) served++; }
  const c = getCampaign(s, id);
  assert.equal(served, 5000);
  assert.equal(c.impressions, 5000);
  assert.equal(fromBaseUnits(c.spent, 3), '10.000');
  assert.equal(c.status, 'exhausted');
  assert.equal(remaining(c), 0n);
  // further serves are a safe no-op
  assert.equal(recordServe(s, id, { type: 'impression' }).served, false);
});

test('budget drawdown (CPC): only clicks bill; impressions are free', () => {
  const s = freshStore();
  const id = activeCampaign(s, { model: 'cpc', rate: '1.000', budget: '3.000' }); // 3 clicks
  assert.equal(recordServe(s, id, { type: 'impression' }).charged, '0');
  assert.equal(getCampaign(s, id).impressions, 1);
  for (let i = 0; i < 5; i++) recordServe(s, id, { type: 'click' });
  const c = getCampaign(s, id);
  assert.equal(c.clicks, 3);                       // stopped at budget
  assert.equal(fromBaseUnits(c.spent, 3), '3.000');
  assert.equal(c.status, 'exhausted');
});

test('recordServe idempotency via eventId', () => {
  const s = freshStore();
  const id = activeCampaign(s);
  recordServe(s, id, { type: 'impression', eventId: 'e1' });
  recordServe(s, id, { type: 'impression', eventId: 'e1' }); // dup
  assert.equal(getCampaign(s, id).impressions, 1);
});

test('only active+funded campaigns serve; pick rotates fairly', () => {
  const s = freshStore();
  const a = activeCampaign(s);
  const b = activeCampaign(s);
  const draft = createCampaign(s, { advertiser: 'zenith', token: 'MELEK', model: 'cpm', rate: '2.000', budget: '10.000', placement: 'law-top', creative: CRE }).campaign.id;
  const active = listActiveAds(s, 'law-top');
  assert.equal(active.length, 2);
  assert.ok(!active.find((c) => c.id === draft));
  assert.equal(pickAd(s, 'law-top', { rotate: 0 }).id, a);
  assert.equal(pickAd(s, 'law-top', { rotate: 1 }).id, b);
  assert.equal(pickAd(s, 'law-top', { rotate: 2 }).id, a); // round-robin
  assert.equal(pickAd(s, 'nosuch-top'), null);
});

test('pause/resume/end transitions', () => {
  const s = freshStore();
  const id = activeCampaign(s);
  assert.equal(pauseCampaign(s, id).campaign.status, 'paused');
  assert.equal(recordServe(s, id, { type: 'impression' }).served, false); // paused → not served
  assert.equal(resumeCampaign(s, id).campaign.status, 'active');
  assert.equal(endCampaign(s, id).campaign.status, 'ended');
  assert.equal(endCampaign(s, id).ok, false); // already ended
});

test('persistence round-trips via injected fs', () => {
  const s = freshStore();
  const id = activeCampaign(s);
  recordServe(s, id, { type: 'impression' });
  const files = {};
  const fakeFs = { writeFileSync: (f, d) => { files[f] = d; }, readFileSync: (f) => { if (!files[f]) throw new Error('nf'); return files[f]; } };
  assert.equal(saveStore(s, { fs: fakeFs, file: 'store.json' }), true);
  const s2 = loadStore({ fs: fakeFs, file: 'store.json' });
  const c = getCampaign(s2, id);
  assert.equal(c.status, 'active');
  assert.equal(c.impressions, 1);
  // _seen (idempotency cache) is dropped from serialization
  assert.equal(JSON.stringify(serializeStore(s)).includes('_seen'), false);
});

test('listCampaigns filters + never throws on bad store use', () => {
  const s = freshStore();
  activeCampaign(s);
  assert.equal(listCampaigns(s, { status: 'active' }).length, 1);
  assert.equal(listCampaigns(s, { advertiser: 'nobody' }).length, 0);
  assert.throws(() => createCampaign(null, {}), TypeError);
});
