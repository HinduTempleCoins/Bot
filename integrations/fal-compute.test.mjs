// fal-compute.test.mjs — offline tests for the Fal.ai visual lane. The suite NEVER hits Fal: an
// injected fetch stands in, and the "not-configured" path must short-circuit BEFORE any fetch.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { configured, generateImage, DEFAULT_MODEL, __setFetch } from './fal-compute.mjs';

// snapshot/restore the env keys this module reads
const KEYS = ['FAL_KEY', 'FAL_ENABLE', 'FAL_LORA_URL', 'FAL_MODEL'];
function withEnv(overrides, fn) {
  const saved = {};
  for (const k of KEYS) saved[k] = process.env[k];
  for (const k of KEYS) delete process.env[k];
  Object.assign(process.env, overrides);
  return Promise.resolve(fn()).finally(() => {
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  });
}

test('configured(): all false when nothing set', () => withEnv({}, () => {
  const c = configured();
  assert.equal(c.key, false);
  assert.equal(c.enabled, false);
  assert.equal(c.ready, false);
  assert.equal(c.model, DEFAULT_MODEL);
}));

test('configured(): ready only when key AND FAL_ENABLE=1', () => withEnv({ FAL_KEY: 'x', FAL_ENABLE: '1', FAL_LORA_URL: 'https://l' }, () => {
  const c = configured();
  assert.equal(c.key, true);
  assert.equal(c.enabled, true);
  assert.equal(c.lora, true);
  assert.equal(c.ready, true);
}));

test('generateImage: not-configured short-circuits WITHOUT any fetch', () => withEnv({}, async () => {
  let called = false;
  __setFetch(() => { called = true; throw new Error('should not be called'); });
  const r = await generateImage('h4thor');
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'not-configured');
  assert.equal(called, false, 'no network while the lane is staged/off');
  __setFetch(null);
}));

test('generateImage: key present but disabled → { ok:false, disabled } and no fetch', () => withEnv({ FAL_KEY: 'x' }, async () => {
  let called = false;
  __setFetch(() => { called = true; throw new Error('nope'); });
  const r = await generateImage('h4thor');
  assert.equal(r.reason, 'disabled');
  assert.equal(called, false);
  __setFetch(null);
}));

test('generateImage: enabled + injected fetch returns images', () => withEnv({ FAL_KEY: 'x', FAL_ENABLE: '1' }, async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ images: [{ url: 'https://img/1.png' }] }) }));
  const r = await generateImage('h4thor, vaporwave angel');
  assert.equal(r.ok, true);
  assert.deepEqual(r.images, ['https://img/1.png']);
  __setFetch(null);
}));

test('generateImage: empty prompt → no-prompt (still no crash)', () => withEnv({ FAL_KEY: 'x', FAL_ENABLE: '1' }, async () => {
  __setFetch(async () => ({ ok: true, json: async () => ({ images: [] }) }));
  const r = await generateImage('   ');
  assert.equal(r.reason, 'no-prompt');
  __setFetch(null);
}));

test('generateImage: http error soft-fails', () => withEnv({ FAL_KEY: 'x', FAL_ENABLE: '1' }, async () => {
  __setFetch(async () => ({ ok: false, status: 500 }));
  const r = await generateImage('h4thor');
  assert.equal(r.ok, false);
  assert.match(r.reason, /^http-500$/);
  __setFetch(null);
}));

test('soft-fail: never throws on bad input', () => withEnv({ FAL_KEY: 'x', FAL_ENABLE: '1' }, async () => {
  __setFetch(async () => { throw new Error('boom'); });
  await assert.doesNotReject(() => generateImage('h4thor'));
  const r = await generateImage('h4thor');
  assert.equal(r.reason, 'network');
  __setFetch(null);
}));
