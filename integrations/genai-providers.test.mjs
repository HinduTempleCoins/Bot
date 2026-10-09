// genai-providers.test.mjs — NATIVE-ONLY image generation (operator rule: no external AI, ever).
// These tests assert the chain is our CPU worker and nothing else, and that no path ever contacts an
// external API — if the worker is down, generateImage() fails rather than phoning out.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generateImage, PROVIDERS, providerConfigured, __setFetch, __setNow, __resetState } from './genai-providers.mjs';

process.env.GENAI_CPU_SD_POLL_MS = '1';
process.env.GENAI_CPU_SD_HEALTH_MS = '50';
const WORKER = 'http://127.0.0.1:8510';

function okWorker() {
  const calls = [];
  __setFetch(async (url) => {
    const u = String(url); calls.push(u);
    if (u.endsWith('/health')) return { ok: true, json: async () => ({ ok: true, queued: 0 }) };
    if (u.endsWith('/jobs')) return { ok: true, status: 200, json: async () => ({ ok: true, id: 'j1' }) };
    if (u.includes('/jobs/')) return { ok: true, status: 200, json: async () => ({ ok: true, status: 'done', result: { ok: true, base64: 'QUJD', mime: 'image/png', ms: 1200, mode: 'txt2img' } }) };
    throw new Error('UNEXPECTED external call to ' + u);
  });
  return calls;
}

test('registry is NATIVE-ONLY — cpusd and nothing else', () => {
  assert.deepEqual(PROVIDERS.map((p) => p.id), ['cpusd']);
  for (const bad of ['cloudflare', 'gemini', 'pollinations', 'hfspace', 'aihorde']) {
    assert.ok(!PROVIDERS.find((p) => p.id === bad), `${bad} must NOT be in the image chain`);
  }
});

test('renders on our CPU worker, and only the worker is ever contacted', async () => {
  __resetState(); process.env.GENAI_CPU_SD_URL = WORKER;
  const calls = okWorker();
  const r = await generateImage({ prompt: 'an egyptian temple at dawn', size: '512x512' });
  assert.equal(r.ok, true);
  assert.equal(r.provider, 'cpusd');
  assert.ok(r.base64);
  for (const u of calls) assert.ok(u.startsWith(WORKER), `only the worker should be called, saw ${u}`);
});

test('worker down → ok:false, and NEVER a fallback to any external API', async () => {
  __resetState(); process.env.GENAI_CPU_SD_URL = WORKER;
  const seen = [];
  __setFetch(async (url) => {
    const u = String(url); seen.push(u);
    if (u.endsWith('/health')) throw new Error('worker unreachable');
    if (u.endsWith('/jobs')) return { ok: false, status: 503, json: async () => ({ ok: false, error: 'down' }) };
    throw new Error('UNEXPECTED external call to ' + u);
  });
  const r = await generateImage({ prompt: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.error, /exhausted/);
  for (const u of seen) assert.ok(u.startsWith(WORKER), `must never call an external host, saw ${u}`);
});

test('no worker configured → cpusd skipped, ok:false, zero network calls', async () => {
  __resetState(); delete process.env.GENAI_CPU_SD_URL;
  let called = false;
  __setFetch(async (u) => { called = true; throw new Error('should not fetch ' + u); });
  const r = await generateImage({ prompt: 'x' });
  assert.equal(r.ok, false);
  assert.equal(called, false, 'with no worker URL, no API is contacted');
});

test('providerConfigured reflects the worker URL only', () => {
  process.env.GENAI_CPU_SD_URL = WORKER;
  assert.equal(providerConfigured('cpusd'), true);
  delete process.env.GENAI_CPU_SD_URL;
  assert.equal(providerConfigured('cpusd'), false);
});
