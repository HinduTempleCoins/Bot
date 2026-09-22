// modal-client.test.mjs — OFFLINE tests for the PRIVATE-DATA Modal inference client.
//
// No network: fetch is injected via __setFetch; cold-start backoff sleep is stubbed via __setSleep so
// the suite stays fast. Asserts the contract shape ({messages,system,max_tokens} → {text}), soft-fail,
// cold-start retry/backoff, the compute-gated (unconfigured) state, and that NO external URL is used.
//
//   node --test integrations/modal-client.test.mjs

import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import { askModal, askModalJson, extractJson, modalReady, modalInfo, __setFetch, __setSleep } from './modal-client.mjs';

const URL_ENV = 'MODAL_INFERENCE_URL';
beforeEach(() => {
  process.env[URL_ENV] = 'https://ourteam--melek-inference.modal.run';
  process.env.MODAL_BACKOFF_MS = '0';
  __setSleep(async () => {}); // never actually wait in tests
});

function fakeModal({ text = 'modal reply', ok = true, httpOk = true } = {}) {
  const calls = [];
  __setFetch(async (url, opts) => {
    calls.push({ url, body: JSON.parse(opts.body), headers: opts.headers });
    return { ok: httpOk, json: async () => ({ text: ok ? text : '' }) };
  });
  return calls;
}

test('askModal: posts the {messages,system,max_tokens} contract to the Modal url only', async () => {
  const calls = fakeModal({ text: 'the answer' });
  const out = await askModal({ prompt: 'hi', system: 'sys', context: ['c1'], maxTokens: 500 });
  assert.equal(out, 'the answer');
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /modal\.run/, 'uses the configured Modal endpoint');
  assert.equal(calls[0].body.system, 'sys');
  assert.equal(calls[0].body.max_tokens, 500);
  assert.ok(Array.isArray(calls[0].body.messages));
  assert.match(calls[0].body.messages[0].content, /c1/);
  assert.match(calls[0].body.messages[0].content, /hi/);
});

test('askModal: explicit messages are passed through', async () => {
  const calls = fakeModal();
  await askModal({ messages: [{ role: 'user', content: 'q1' }, { role: 'assistant', content: 'a1' }, { role: 'user', content: 'q2' }] });
  assert.equal(calls[0].body.messages.length, 3);
  assert.equal(calls[0].body.messages[2].content, 'q2');
});

test('COMPUTE-GATED: no MODAL_INFERENCE_URL → null, no fetch (never falls back to an external API)', async () => {
  delete process.env[URL_ENV];
  let called = false;
  __setFetch(async () => { called = true; return { ok: true, json: async () => ({ text: 'x' }) }; });
  assert.equal(modalReady(), false);
  assert.equal(await askModal({ prompt: 'q' }), null);
  assert.equal(called, false, 'must not make any network call when unconfigured');
});

test('askModal: soft-fail — thrown fetch returns null, never throws', async () => {
  __setFetch(async () => { throw new Error('ECONNREFUSED'); });
  assert.equal(await askModal({ prompt: 'q', retries: 0 }), null);
});

test('askModal: HTTP not-ok (503 scaling) → retried; empty text → null', async () => {
  fakeModal({ httpOk: false });
  assert.equal(await askModal({ prompt: 'q', retries: 0 }), null);
  fakeModal({ ok: false });
  assert.equal(await askModal({ prompt: 'q', retries: 0 }), null);
});

test('cold start: rides out early 503s and succeeds on a later attempt', async () => {
  let n = 0;
  __setFetch(async () => {
    n++;
    if (n < 3) return { ok: false, json: async () => ({}) }; // spinning up from zero
    return { ok: true, json: async () => ({ text: 'warm now' }) };
  });
  const out = await askModal({ prompt: 'q', coldStart: true });
  assert.equal(out, 'warm now');
  assert.ok(n >= 3, 'kept retrying through the cold start');
});

test('optional bearer only sent when a token env is set', async () => {
  let hdrs;
  __setFetch(async (_url, opts) => { hdrs = opts.headers; return { ok: true, json: async () => ({ text: 'x' }) }; });
  await askModal({ prompt: 'q' });
  assert.equal(hdrs.authorization, undefined);
  process.env.MODAL_INFERENCE_TOKEN = 'modal-token-not-real';
  await askModal({ prompt: 'q' });
  assert.match(hdrs.authorization, /^Bearer /);
  delete process.env.MODAL_INFERENCE_TOKEN;
});

test('extractJson + askModalJson', async () => {
  assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
  fakeModal({ text: 'result: {"pct_completed": 55, "hallucination_tier": "none"}' });
  const o = await askModalJson({ prompt: 'grade' });
  assert.equal(o.pct_completed, 55);
});

test('modalInfo: reports configured/endpoint, never a token value', () => {
  const info = modalInfo();
  assert.equal(info.configured, true);
  assert.equal(typeof info.url, 'string');
  assert.equal(JSON.stringify(info).includes('Bearer'), false);
});
