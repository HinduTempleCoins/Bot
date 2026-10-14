import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBrain } from './decades-brain.mjs';
import { seedSystemMap, siteDoc, repoDoc, estateSummary, loadMap } from './brain-seed-systemmap.mjs';

const FIXTURE = {
  counts: { sites: 2, apps: 2, repos: 1 },
  sites: [
    { host: 'herald.soapbox.community', app: 'herald', purpose: 'The SoapBox press Wire: feeds releases out like a newswire, with categories and distribution.' },
    { host: 'witness.melek.salon', app: 'witness', purpose: 'The mining pool face and Witness School.' },
  ],
  repos: [{ name: 'Bot', lang: 'JavaScript', desc: 'Off-chain operator software for the MELEK AI Witness.', readme: '' }],
};

test('siteDoc/repoDoc shape a retrievable doc + a card answer', () => {
  const d = siteDoc(FIXTURE.sites[0]);
  assert.equal(d.id, 'site:herald.soapbox.community');
  assert.match(d.text, /herald/);
  assert.match(d.answer, /\*\*herald\.soapbox\.community\*\*/);
  const r = repoDoc(FIXTURE.repos[0]);
  assert.equal(r.id, 'repo:Bot');
  assert.match(r.answer, /JavaScript/);
});

test('seedSystemMap teaches the brain so "is there a herald" is found', async () => {
  const brain = createBrain();
  const res = await seedSystemMap(brain, { map: FIXTURE });
  assert.equal(res.ok, true);
  assert.equal(res.sites, 2);
  assert.equal(res.repos, 1);
  const out = await brain.think('is there a herald press wire?');
  assert.ok(out && out.answer, 'brain answered');
  assert.match(out.answer, /herald/i, 'answer names herald');
});

test('estate summary pattern fires on a list-surfaces question', async () => {
  const brain = createBrain();
  await seedSystemMap(brain, { map: FIXTURE });
  const out = await brain.think('how many surfaces do you run?');
  assert.ok(out && out.answer);
  assert.match(out.answer, /surfaces/i);
  assert.match(estateSummary(FIXTURE), /2 live surfaces/);
});

test('loadMap soft-fails to empty on a missing file; seed is a no-op on a bad brain', async () => {
  const m = loadMap({ mapFile: '/no/such/map.json' });
  assert.deepEqual(m.sites, []);
  const res = await seedSystemMap({}, { map: FIXTURE });
  assert.equal(res.ok, false);
});
