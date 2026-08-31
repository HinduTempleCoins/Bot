// Offline tests for the Herald launcher (redirected to user acquisition for OUR sites). No disk, no
// network, no env: an in-memory adStore + an in-memory campaign sender. Asserts the /go traffic rail stages
// onto OUR OWN destinations (house, not affiliate) and that NO subscriber list is fabricated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, DESTINATIONS, TEMPLATES, LIST, CAMPAIGN, JOURNEY } from './launch-campaign.mjs';
import { createCampaignSender } from './campaign-sender.mjs';

function memSender() {
  let blob = null;
  let n = 0;
  return createCampaignSender({ fs: { read: () => blob, write: (_p, s) => { blob = s; } }, now: () => 0, genToken: () => `tok-${++n}` });
}

test('Channel 1 — every destination stages LIVE onto the /go rail as a HOUSE campaign', () => {
  const adStore = {};
  const rep = launch({ adStore, sender: memSender() });
  assert.equal(rep.growth.campaigns.length, DESTINATIONS.length);
  assert.equal(rep.growth.live, DESTINATIONS.length, 'all live — no env flip needed for our own sites');
  for (const c of rep.growth.campaigns) {
    assert.equal(c.ok, true, `${c.code} registered`);
    assert.equal(c.live, true, `${c.code} live`);
    assert.ok(c.landingUrl && /^https?:\/\//.test(c.landingUrl), `${c.code} has a landing url`);
  }
  // A /go/{code} campaign is registered in the ad store for each destination, flagged house (ours), no network.
  for (const d of DESTINATIONS) {
    const camp = adStore.campaigns && adStore.campaigns[d.code];
    assert.ok(camp, `${d.code} campaign persisted`);
    assert.equal(camp.house, true, `${d.code} is a house campaign`);
    assert.equal(camp.network, null, `${d.code} has no affiliate network`);
  }
});

test('Channel 1 — destinations point at OUR OWN properties (no third-party brands)', () => {
  const ours = /(melek\.salon|kula\.money|soapbox\.community)/i;
  for (const d of DESTINATIONS) assert.match(d.targetUrl, ours, `${d.code} → our own site`);
  const codes = DESTINATIONS.map((d) => d.code);
  assert.ok(codes.includes('join-melek') && codes.includes('kula-defi') && codes.includes('prana-mine'));
});

test('Channel 2 — email nurture stages fully, all CTAs to our own signup', () => {
  const cs = memSender();
  const rep = launch({ adStore: {}, sender: cs });
  assert.equal(rep.email.list, LIST.id);
  assert.equal(rep.email.templates, TEMPLATES.length);
  assert.equal(rep.email.journey, JOURNEY.id);
  assert.equal(rep.email.campaign, CAMPAIGN.id);
  assert.equal(rep.email.ready, true);
  for (const t of TEMPLATES) assert.match(t.html, /wallet\.melek\.salon\/signup/, `${t.id} CTAs to our signup`);
});

test('Channel 2 — NO subscribers are fabricated', () => {
  const cs = memSender();
  launch({ adStore: {}, sender: cs });
  assert.equal(cs.stats().subscribers, 0, 'zero subscribers — real opt-ins only');
});

test('idempotent — re-running does not error or duplicate lists/templates', () => {
  const cs = memSender();
  const adStore = {};
  launch({ adStore, sender: cs });
  const rep2 = launch({ adStore, sender: cs });     // second run
  assert.equal(rep2.email.ready, true);
  assert.equal(rep2.growth.live, DESTINATIONS.length);
  assert.equal(cs.stats().templates, TEMPLATES.length);
  assert.equal(cs.stats().subscribers, 0);
});

test('soft-fail — never throws on empty input', () => {
  assert.doesNotThrow(() => launch({}));
});
