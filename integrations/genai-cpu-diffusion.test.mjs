import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normJob, generate, handler, status, __setPipelineLoader, __setSharp } from './genai-cpu-diffusion.mjs';

// fake tensor chain: mul().round().clipByValue().transpose() -> { data } of a 2x2 RGB image
function fakeTensor() {
  const t = { data: new Uint8Array([255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9]) };
  const chain = { mul: () => chain, round: () => chain, clipByValue: () => chain, transpose: async () => t };
  return chain;
}
let lastInput = null;
__setPipelineLoader(async () => ({ run: async (input) => { lastInput = input; return [fakeTensor()]; } }));
__setSharp(async () => (buf, opts) => ({
  png: () => ({ toBuffer: async () => Buffer.from('PNGDATA') }),
  removeAlpha: () => ({ resize: () => ({ raw: () => ({ toBuffer: async () => ({ data: Buffer.alloc(512 * 512 * 3, 128) }) }) }) }),
}));

test('normJob clamps and defaults', () => {
  const j = normJob({ prompt: '  a   goddess ', steps: 999, guidance: 99, strength: 5 });
  assert.equal(j.prompt, 'a goddess');
  assert.equal(j.steps, 20);
  assert.equal(j.guidance, 7.5);
  assert.equal(j.strength, 0.65);
  assert.equal(j.image, null);
});

test('empty prompt soft-fails, never throws', async () => {
  const r = await generate({ prompt: '' });
  assert.equal(r.ok, false);
});

test('txt2img returns base64 png', async () => {
  const r = await generate({ prompt: 'Hathor with ram horns', steps: 8, seed: 7 });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'txt2img');
  assert.equal(Buffer.from(r.base64, 'base64').toString(), 'PNGDATA');
  assert.equal(lastInput.numInferenceSteps, 8);
  assert.equal(lastInput.seed, '7');
  assert.equal(lastInput.img2imgFlag, undefined);
});

test('img2img passes a [-1,1] reference tensor and strength', async () => {
  const r = await generate({ prompt: 'goddess in a temple', image: { base64: Buffer.from('x').toString('base64') }, strength: 0.5 });
  assert.equal(r.mode, 'img2img');
  assert.equal(lastInput.img2imgFlag, true);
  assert.equal(lastInput.strength, 0.5);
  assert.equal(lastInput.inputImage.length, 3 * 512 * 512);
  assert.ok(Math.abs(lastInput.inputImage[0] - (128 / 127.5 - 1)) < 1e-6);
});

test('handler: health + generate + 404', async () => {
  const mk = (method, url, body) => {
    const req = { method, url, on(ev, fn) { if (ev === 'data' && body) fn(Buffer.from(body)); if (ev === 'end') setImmediate(fn); } };
    const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
    return { req, res };
  };
  let { req, res } = mk('GET', '/health');
  await handler(req, res); assert.equal(res.code, 200); assert.equal(JSON.parse(res.body).ok, true);
  ({ req, res } = mk('POST', '/generate', JSON.stringify({ prompt: 'x' })));
  await handler(req, res); assert.equal(res.code, 200); assert.equal(JSON.parse(res.body).ok, true);
  ({ req, res } = mk('GET', '/nope'));
  await handler(req, res); assert.equal(res.code, 404);
  assert.equal(status().busy, false);
});

test('handler: token gate rejects missing/wrong bearer, accepts the right one', async () => {
  process.env.CPU_SD_TOKEN = 's3cret';
  const mk = (headers) => ({ req: { method: 'POST', url: '/generate', headers, on(ev, fn) { if (ev === 'data') fn(Buffer.from('{"prompt":"x"}')); if (ev === 'end') setImmediate(fn); } },
    res: { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } } });
  let t = mk({}); await handler(t.req, t.res); assert.equal(t.res.code, 401);
  t = mk({ authorization: 'Bearer nope' }); await handler(t.req, t.res); assert.equal(t.res.code, 401);
  t = mk({ authorization: 'Bearer s3cret' }); await handler(t.req, t.res); assert.equal(t.res.code, 200);
  delete process.env.CPU_SD_TOKEN;
});

test('async jobs: submit returns an id at once, status goes queued/running -> done with the image', async () => {
  const { submitJob, jobStatus } = await import('./genai-cpu-diffusion.mjs');
  const sub = submitJob({ prompt: 'Hathor at the pyramids', steps: 4 });
  assert.equal(sub.ok, true); assert.ok(sub.id);
  assert.ok(['queued', 'running', 'done'].includes(jobStatus(sub.id).status));
  let st; for (let i = 0; i < 50; i++) { st = jobStatus(sub.id); if (st.status === 'done') break; await new Promise((r) => setTimeout(r, 5)); }
  assert.equal(st.status, 'done'); assert.equal(st.result.ok, true);
  assert.equal(jobStatus('nope').ok, false);
  assert.equal(submitJob({ prompt: '' }).ok, false);
});
