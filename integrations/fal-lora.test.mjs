// fal-lora.test.mjs — offline tests for the Fal.ai FLUX-LoRA training adapter.
// No network: submit/status/result soft-skip with no key; with an injected key + mock fetch they
// POST/GET the queue API and parse request_id / lora url. Pure helpers need no key at all.

import { test } from 'node:test';
import assert from 'node:assert';
import * as fal from './fal-lora.mjs';

// ── buildTrainingRequest (PURE, no network, no key) ──────────────────────────────────────────────────
test('buildTrainingRequest shapes the Fal payload with trigger + steps', () => {
  const r = fal.buildTrainingRequest({ imagesUrl: 'https://x.test/hathor.zip', triggerWord: 'h4thor', steps: 1200 });
  assert.equal(r.ok, true);
  assert.equal(r.body.images_data_url, 'https://x.test/hathor.zip');
  assert.equal(r.body.trigger_word, 'h4thor');
  assert.equal(r.body.steps, 1200);
});

test('buildTrainingRequest defaults the trigger word + sane steps', () => {
  const r = fal.buildTrainingRequest({ imagesUrl: 'data:application/zip;base64,AAAA' });
  assert.equal(r.ok, true);
  assert.equal(r.body.trigger_word, 'h4thor');
  assert.equal(r.body.steps, fal.DEFAULT_STEPS);
});

test('buildTrainingRequest clamps out-of-range steps', () => {
  assert.equal(fal.buildTrainingRequest({ imagesUrl: 'https://x/z.zip', steps: 99999 }).body.steps, 4000);
  assert.equal(fal.buildTrainingRequest({ imagesUrl: 'https://x/z.zip', steps: 5 }).body.steps, 100);
});

test('buildTrainingRequest soft-fails on missing/bad imagesUrl (never throws)', () => {
  const a = fal.buildTrainingRequest({});
  assert.equal(a.ok, false);
  assert.match(a.reason, /imagesUrl/);
  const b = fal.buildTrainingRequest({ imagesUrl: 'ftp://nope/x.zip' });
  assert.equal(b.ok, false);
});

test('buildTrainingRequest passes captions through, esc-cleaned', () => {
  const r = fal.buildTrainingRequest({ imagesUrl: 'https://x/z.zip', captions: ['h4thor, wings\nand horns', ''] });
  assert.deepEqual(r.body.captions, ['h4thor, wings and horns']);
});

// ── captionFor (PURE) ────────────────────────────────────────────────────────────────────────────────
test('captionFor embeds trigger word + signature invariants + style', () => {
  const c = fal.captionFor('on a lowrider at golden hour, lavender skin');
  assert.match(c, /^h4thor,/);                       // trigger first
  assert.match(c, /VR headset/);
  assert.match(c, /ram horns/);
  assert.match(c, /wesekh collar/);
  assert.match(c, /wings/);
  assert.match(c, /Vaporwave/);
  assert.match(c, /lowrider at golden hour/);
});

test('captionFor honors a custom trigger word', () => {
  assert.match(fal.captionFor('temple', { triggerWord: 'zzz' }), /^zzz,/);
});

// ── dataNote (PURE) ──────────────────────────────────────────────────────────────────────────────────
test('dataNote mentions upload-first + FAL_KEY', () => {
  const n = fal.dataNote();
  assert.match(n, /upload/i);
  assert.match(n, /FAL_KEY/);
});

// ── network calls SOFT-SKIP with no key ──────────────────────────────────────────────────────────────
test('submit/status/result soft-skip (shaped ok:false) when no FAL_KEY', async () => {
  fal.__setKey('');
  let called = false;
  fal.__setFetch(() => { called = true; throw new Error('must not fetch'); });

  const built = fal.buildTrainingRequest({ imagesUrl: 'https://x/z.zip' });
  const s = await fal.submitTraining(built);
  assert.equal(s.ok, false);
  assert.equal(s.reason, 'FAL_KEY not set');

  const st = await fal.trainingStatus('req-1');
  assert.equal(st.ok, false);
  assert.equal(st.reason, 'FAL_KEY not set');

  const rr = await fal.trainingResult('req-1');
  assert.equal(rr.ok, false);
  assert.equal(rr.reason, 'FAL_KEY not set');

  assert.equal(called, false, 'network must NOT be touched without a key');
  fal.__setFetch(null);
});

// ── with an injected key + mock fetch ────────────────────────────────────────────────────────────────
test('submitTraining POSTs to the queue with auth + returns requestId', async () => {
  fal.__setKey('test-key');
  const calls = [];
  fal.__setFetch(async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ request_id: 'abc123', status: 'IN_QUEUE' }) };
  });

  const built = fal.buildTrainingRequest({ imagesUrl: 'https://x/z.zip', steps: 800 });
  const r = await fal.submitTraining(built);
  assert.equal(r.ok, true);
  assert.equal(r.requestId, 'abc123');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.method, 'POST');
  assert.match(calls[0].url, /queue\.fal\.run\/fal-ai\/flux-lora/);
  assert.equal(calls[0].opts.headers.authorization, 'Key test-key');
  assert.deepEqual(JSON.parse(calls[0].opts.body).images_data_url, 'https://x/z.zip');

  fal.__setKey('');
  fal.__setFetch(null);
});

test('trainingStatus GETs the status endpoint and parses status', async () => {
  fal.__setKey('test-key');
  const calls = [];
  fal.__setFetch(async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, json: async () => ({ status: 'IN_PROGRESS', queue_position: 3 }) };
  });

  const r = await fal.trainingStatus('abc123');
  assert.equal(r.ok, true);
  assert.equal(r.status, 'IN_PROGRESS');
  assert.equal(r.queuePosition, 3);
  assert.equal(calls[0].opts.method, 'GET');
  assert.match(calls[0].url, /requests\/abc123\/status$/);

  fal.__setKey('');
  fal.__setFetch(null);
});

test('trainingResult GETs the result endpoint and parses the LoRA url', async () => {
  fal.__setKey('test-key');
  fal.__setFetch(async () => ({
    ok: true,
    json: async () => ({ diffusers_lora_file: { url: 'https://fal/out/hathor.safetensors' }, config_file: { url: 'https://fal/out/cfg.json' } }),
  }));

  const r = await fal.trainingResult('abc123');
  assert.equal(r.ok, true);
  assert.equal(r.loraUrl, 'https://fal/out/hathor.safetensors');
  assert.equal(r.configUrl, 'https://fal/out/cfg.json');

  fal.__setKey('');
  fal.__setFetch(null);
});

test('submitTraining soft-fails on a bad HTTP response (never throws)', async () => {
  fal.__setKey('test-key');
  fal.__setFetch(async () => ({ ok: false, status: 422, json: async () => ({}) }));
  const r = await fal.submitTraining({ body: { images_data_url: 'https://x/z.zip' } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'http-422');
  fal.__setKey('');
  fal.__setFetch(null);
});

test('submitTraining soft-fails when the queue returns no request id', async () => {
  fal.__setKey('test-key');
  fal.__setFetch(async () => ({ ok: true, json: async () => ({ status: 'IN_QUEUE' }) }));
  const r = await fal.submitTraining({ body: { images_data_url: 'https://x/z.zip' } });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-request-id');
  fal.__setKey('');
  fal.__setFetch(null);
});

test('trainingResult soft-fails when no lora url is present', async () => {
  fal.__setKey('test-key');
  fal.__setFetch(async () => ({ ok: true, json: async () => ({ status: 'COMPLETED' }) }));
  const r = await fal.trainingResult('abc123');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no-lora-url');
  fal.__setKey('');
  fal.__setFetch(null);
});

test('submitTraining passes a build error straight through', async () => {
  fal.__setKey('test-key');
  let called = false;
  fal.__setFetch(() => { called = true; throw new Error('must not fetch'); });
  const bad = fal.buildTrainingRequest({});   // { ok:false }
  const r = await fal.submitTraining(bad);
  assert.equal(r.ok, false);
  assert.match(r.reason, /imagesUrl/);
  assert.equal(called, false);
  fal.__setKey('');
  fal.__setFetch(null);
});

// ── network error is caught (soft-fail) ──────────────────────────────────────────────────────────────
test('a thrown fetch is caught and returns a shaped failure', async () => {
  fal.__setKey('test-key');
  fal.__setFetch(async () => { throw new Error('boom'); });
  const r = await fal.trainingStatus('abc123');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'network');
  fal.__setKey('');
  fal.__setFetch(null);
});
