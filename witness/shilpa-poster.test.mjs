import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildPost, buildVideoPost, collectVideos, TESTING, __setFetch } from './shilpa-poster.mjs';

test('remake sets now carry the testing statement', () => {
  const p = buildPost([{ key: 'k', title: 'Scene', group: 'Egypt', credit: 'c', looks: { '1_real': { egyptian: 'a.jpg' } } }], 3);
  assert.ok(p.body.includes(TESTING));
  assert.match(TESTING, /We are testing these features and looking to develop them/);
});

test('video sets: documentaries first, then maps, then animations; each links to watch; soft-fail per source', async () => {
  __setFetch(async (u) => {
    if (u.endsWith('/documentaries/manifest.json')) return { ok: true, json: async () => ({ films: [{ id: 'kush-nile', title: 'Kush and the Nile', summary: 'Up the Nile', seconds: 588, credits: ['Cliopatria CC BY 4.0'] }] }) };
    if (u.endsWith('/maps/index.json')) return { ok: true, json: async () => ({ clips: [{ id: 'rome', title: 'Rome', fromYear: -509, toYear: 476, duration: 106, credit: 'Cliopatria (Seshat) CC BY 4.0' }] }) };
    if (u.endsWith('/animations/manifest.json')) throw new Error('offline');
    return { ok: false };
  });
  const v = await collectVideos();
  assert.deepEqual(v.map((x) => x.key), ['doc:kush-nile', 'map:rome']);
  assert.equal(v[1].summary, '509 BC → AD 476');
  const p = buildVideoPost(v, 1);
  assert.equal(p.permlink, 'shilpa-shastra-moving-pictures-set-1');
  assert.ok(p.body.includes(TESTING));
  assert.match(p.body, /Watch it here\]\(https:\/\/hathor\.soapbox\.community\/documentaries\/kush-nile\)/);
  assert.match(p.body, /\*Documentary · 9:48\*/);
  assert.match(p.body, /Credits: Cliopatria/);
  __setFetch(null);
});
