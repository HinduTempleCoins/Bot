import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildMarketingPost, selectBatch, loadManifest, TESTING } from './shilpa-marketing.mjs';

const sample = [
  { id: 's000-writing-ig-square-vaporwave', product: 'writing', format: 'ig-square', theme: 'vaporwave', slogan: 'Earn for Blogging.', surface: 'write.soapbox.community', url: 'https://hathor.soapbox.community/remakes/img/mktg/s000-writing-ig-square-vaporwave.jpg' },
  { id: 's001-music-story-reel-fantasy', product: 'music', format: 'story-reel', theme: 'fantasy', slogan: 'Make Music. Get Paid.', surface: 'tunein.soapbox.community', url: 'https://hathor.soapbox.community/remakes/img/mktg/s001-music-story-reel-fantasy.jpg' },
  { id: 's002-chain-web-hero-melek', product: 'chain', format: 'web-hero', theme: 'melek', slogan: 'The Future Came to Us.', surface: 'melek.salon', url: 'https://hathor.soapbox.community/remakes/img/mktg/s002-chain-web-hero-melek.jpg' },
];

test('selectBatch returns only unposted, capped at batch size', () => {
  const b = selectBatch(sample, ['s000-writing-ig-square-vaporwave'], 5);
  assert.equal(b.length, 2);
  assert.ok(!b.find((c) => c.id === 's000-writing-ig-square-vaporwave'));
  assert.equal(selectBatch(sample, [], 2).length, 2);
});

test('selectBatch drops items missing id or url', () => {
  const b = selectBatch([...sample, { id: 'x' }, { url: 'y' }, null], [], 10);
  assert.equal(b.length, 3);
});

test('buildMarketingPost embeds every image, labels it test marketing, links products', () => {
  const p = buildMarketingPost(sample, 7);
  assert.equal(p.permlink, 'shilpa-shastra-test-marketing-set-7');
  assert.ok(p.title.includes('Set 7'));
  assert.ok(p.title.toLowerCase().includes('test'));
  assert.deepEqual(p.tags[0], 'shilpashastra');
  assert.ok(p.tags.includes('marketing'));
  // one markdown image per creative
  assert.equal((p.body.match(/!\[/g) || []).length, sample.length);
  for (const c of sample) assert.ok(p.body.includes(c.url), `body has ${c.url}`);
  // the test-marketing disclaimer is present
  assert.ok(p.body.includes(TESTING));
  assert.ok(p.body.includes('test marketing'));
});

test('buildMarketingPost title never exceeds the chain limit', () => {
  const big = Array.from({ length: 12 }, (_, i) => ({ id: `s${i}`, product: 'writing', format: 'ig-square', theme: 'vaporwave', slogan: 'x', surface: 'melek.salon', url: `https://x/${i}.jpg` }));
  const p = buildMarketingPost(big, 123);
  assert.ok(p.title.length <= 250);
});

test('loadManifest soft-fails to empty on a bad path', () => {
  const m = loadManifest('/no/such/manifest.json');
  assert.deepEqual(m, { creatives: [] });
});
