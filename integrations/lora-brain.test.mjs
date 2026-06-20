import { test } from 'node:test';
import assert from 'node:assert/strict';
import { generate, makeLoraRunner, __setFetch } from './lora-brain.mjs';
import { createGpuScheduler } from './gpu-scheduler.mjs';

const HOUR = 3600e3;
const DAY0 = 1_700_000_000_000 - (1_700_000_000_000 % (24 * HOUR));
const at = (h) => DAY0 + h * HOUR;
const okFetch = (body) => async () => ({ ok: true, status: 200, json: async () => body });

test('generate soft-fails with no URL', async () => {
  __setFetch(okFetch({ text: 'x' }));
  const r = await generate('hi', { url: '', token: 't' });
  assert.equal(r.ok, false);
});

test('generate returns text from the endpoint', async () => {
  __setFetch(okFetch({ ok: true, text: 'Indeed, seeker.' }));
  const r = await generate('hello', { url: 'https://x.modal.run', token: 't' });
  assert.equal(r.ok, true);
  assert.match(r.text, /Indeed/);
});

test('generate soft-fails on http error / empty', async () => {
  __setFetch(async () => ({ ok: false, status: 500 }));
  assert.equal((await generate('hi', { url: 'https://x', token: 't' })).ok, false);
  __setFetch(okFetch({ ok: true, text: '' }));
  assert.equal((await generate('hi', { url: 'https://x', token: 't' })).reason, 'empty');
});

test('makeLoraRunner maps a batch to per-id results', async () => {
  __setFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ ok: true, results: body.batch.map((j) => ({ id: j.id, text: `built ${j.payload.prompt}` })) }) };
  });
  const runner = makeLoraRunner({ url: 'https://x.modal.run', token: 't' });
  const out = await runner([{ id: 'a', payload: { prompt: 'one' } }, { id: 'b', payload: { prompt: 'two' } }]);
  assert.equal(out.length, 2);
  assert.deepEqual(out.map((r) => r.text), ['built one', 'built two']);
  assert.ok(out.every((r) => r.ok));
});

test('makeLoraRunner soft-fails per item on transport error', async () => {
  __setFetch(async () => { throw new Error('cold start'); });
  const runner = makeLoraRunner({ url: 'https://x', token: 't' });
  const out = await runner([{ id: 'a', payload: { prompt: 'x' } }]);
  assert.equal(out[0].ok, false);
  assert.match(out[0].reason, /cold start/);
});

test('the LoRA runner drains a gpu-scheduler batch window end-to-end', async () => {
  __setFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    return { ok: true, status: 200, json: async () => ({ ok: true, results: body.batch.map((j) => ({ id: j.id, text: `deep:${j.payload.q}` })) }) };
  });
  const sched = createGpuScheduler({ windows: [8], perWindowMax: 10 });
  sched.submit({ q: 'why' }, { ts: at(9) });
  sched.submit({ q: 'how' }, { ts: at(9) });
  const runner = makeLoraRunner({ url: 'https://x.modal.run', token: 't' });
  const r = await sched.runWindow(runner, { ts: at(9) });
  assert.equal(r.ran, true);
  assert.equal(r.processed, 2);
  assert.deepEqual(r.results.map((x) => x.text).sort(), ['deep:how', 'deep:why']);
  assert.equal(r.remaining, 0);
});
