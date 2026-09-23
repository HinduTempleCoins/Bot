import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateVideo, __setFetch, __resetState, VIDEO_PROVIDERS, BYOK_INSTRUCTIONS, serverConfigured } from './genai-video-providers.mjs';

test('catalog + BYOK instructions are present and honest', () => {
  assert.ok(VIDEO_PROVIDERS.find((p) => p.id === 'fal' && p.browser));
  assert.ok(VIDEO_PROVIDERS.find((p) => p.id === 'selfhost' && p.byok === false));
  assert.ok(Array.isArray(BYOK_INSTRUCTIONS.fal) && BYOK_INSTRUCTIONS.fal.length);
});

test('no server keys → needsKey with BYOK providers (empty-prompt guarded)', async () => {
  __resetState();
  for (const p of VIDEO_PROVIDERS) if (p.keyEnv) delete process.env[p.keyEnv];
  assert.deepEqual(serverConfigured(), []);
  assert.equal((await generateVideo({ prompt: '' })).error, 'empty-prompt');
  const r = await generateVideo({ prompt: 'a temple at dawn' });
  assert.equal(r.ok, false);
  assert.equal(r.needsKey, true);
  assert.ok(r.providers.includes('fal'));
});

test('with a FAL_KEY + stubbed fetch it returns a video url', async () => {
  __resetState();
  process.env.FAL_KEY = 'test-key';
  __setFetch(async () => ({ ok: true, json: async () => ({ video: { url: 'https://x/clip.mp4' } }) }));
  const r = await generateVideo({ prompt: 'a temple' });
  assert.equal(r.ok, true); assert.equal(r.provider, 'fal'); assert.match(r.url, /clip\.mp4/);
  delete process.env.FAL_KEY; __setFetch(null);
});
