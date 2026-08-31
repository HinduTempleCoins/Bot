// Offline tests for the Herald launcher. No disk, no network, no env: an in-memory adStore + an in-memory
// campaign sender. Asserts both revenue paths stage correctly and that NO list is fabricated.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { launch, OFFERS, TEMPLATES, LIST, CAMPAIGN, JOURNEY } from './launch-campaign.mjs';
import { createCampaignSender } from './campaign-sender.mjs';

function memSender() {
  let blob = null;
  let n = 0;
  return createCampaignSender({ fs: { read: () => blob, write: (_p, s) => { blob = s; } }, now: () => 0, genToken: () => `tok-${++n}` });
}

test('Path B — all crypto offers stage onto the /go rail', () => {
  const adStore = {};
  const rep = launch({ adStore, sender: memSender() });
  assert.equal(rep.adNetwork.campaigns.length, OFFERS.length);
  for (const c of rep.adNetwork.campaigns) {
    assert.equal(c.ok, true, `${c.code} registered`);
    assert.ok(c.landingUrl && /^https?:\/\//.test(c.landingUrl), `${c.code} has a landing url`);
  }
  // A /go/{code} campaign is registered in the ad store for each offer.
  for (const o of OFFERS) assert.ok(adStore.campaigns && adStore.campaigns[o.code], `${o.code} campaign persisted`);
});

test('Path B — flip is surfaced (Impact env) and unconfigured by default in tests', () => {
  const rep = launch({ adStore: {}, sender: memSender() });
  assert.equal(rep.adNetwork.flip.configured, false);         // no env set in the test process
  assert.equal(rep.adNetwork.flip.env, 'IMPACT_PARTNER_ID');
  assert.ok(rep.adNetwork.flip.altEnv);
  assert.equal(rep.adNetwork.pendingFlip, OFFERS.length);      // all staged-pending until the id is set
  assert.equal(rep.adNetwork.live, 0);
});

test('Path A — email nurture stages fully', () => {
  const cs = memSender();
  const rep = launch({ adStore: {}, sender: cs });
  assert.equal(rep.email.list, LIST.id);
  assert.equal(rep.email.templates, TEMPLATES.length);
  assert.equal(rep.email.journey, JOURNEY.id);
  assert.equal(rep.email.campaign, CAMPAIGN.id);
  assert.equal(rep.email.ready, true);
});

test('Path A — NO subscribers are fabricated', () => {
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
  assert.equal(cs.stats().templates, TEMPLATES.length);
  assert.equal(cs.stats().subscribers, 0);
});

test('soft-fail — never throws on empty input', () => {
  assert.doesNotThrow(() => launch({}));            // no stores → sender undefined path is caught? guard:
});
