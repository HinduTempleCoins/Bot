import { test } from 'node:test';
import assert from 'node:assert';
import {
  Tracer, Span, wrap, redact, redactString, __setFetch, __setClock,
} from './langfuse-tracer.mjs';

test('span timing is recorded from start to end', async () => {
  let t = 1000;
  __setClock(() => t);
  const tracer = new Tracer();              // no endpoint → soft-fail buffer
  const span = tracer.trace('chat').start();
  assert.equal(span.startedAt, 1000);
  t = 1350;                                  // 350ms elapse
  const rec = await span.end({ model: 'gpt-4o', tokens: { in: 5, out: 9 }, cost: 0.01 });
  assert.equal(rec.durationMs, 350, 'duration = end - start');
  assert.equal(rec.name, 'chat');
  assert.equal(rec.model, 'gpt-4o');
  assert.deepEqual(rec.tokens, { in: 5, out: 9 });
  assert.equal(rec.cost, 0.01);
  assert.ok(rec.id, 'has a trace id');
  __setClock(null);
});

test('events are logged and ordered within a span', async () => {
  const tracer = new Tracer();
  const span = tracer.trace('flow').start();
  span.log('prompt.sent', { model: 'x' });
  span.log('tokens.received');
  const rec = await span.end();
  assert.equal(rec.events.length, 2);
  assert.equal(rec.events[0].event, 'prompt.sent');
  assert.equal(rec.events[1].event, 'tokens.received');
});

test('wrap() auto-traces a successful call and captures usage/model/cost', async () => {
  const tracer = new Tracer();
  const fn = async ({ q }) => ({ model: 'm1', usage: { in: 1, out: 2 }, cost: 0.5, answer: q });
  const traced = wrap(fn, 'my.call', { tracer });
  const out = await traced({ q: 'hello' });
  assert.equal(out.answer, 'hello', 'original return value passes through');
  assert.equal(tracer.buffer.length, 1, 'one trace buffered (no endpoint)');
  const rec = tracer.buffer[0];
  assert.equal(rec.name, 'my.call');
  assert.equal(rec.model, 'm1');
  assert.deepEqual(rec.tokens, { in: 1, out: 2 });
  assert.equal(rec.cost, 0.5);
  assert.ok(rec.events.some((e) => e.event === 'call.ok'));
});

test('wrap() traces errors and re-throws', async () => {
  const tracer = new Tracer();
  const boom = wrap(async () => { throw new Error('model down'); }, 'fail.call', { tracer });
  await assert.rejects(() => boom(), /model down/);
  assert.equal(tracer.buffer.length, 1, 'errored call still produces a trace');
  const rec = tracer.buffer[0];
  assert.ok(rec.error, 'error captured on record');
  assert.match(rec.error.message, /model down/);
  assert.ok(rec.events.some((e) => e.event === 'call.error'));
});

test('secret redaction scrubs secret-named fields and secret-shaped values', () => {
  const out = redact({
    api_key: 'sk-' + 'A'.repeat(22), // fake key assembled at runtime (no key-shape literal in source)
    password: 'hunter2',
    nested: { authorization: 'Bearer abcdefabcdefabcdef', ok: 'fine' },
    note: 'token ' + ('sk-' + 'Z'.repeat(18)) + ' in text',
    count: 42,
  });
  assert.equal(out.api_key, '[REDACTED]');
  assert.equal(out.password, '[REDACTED]');
  assert.equal(out.nested.authorization, '[REDACTED]');
  assert.equal(out.nested.ok, 'fine');
  assert.equal(out.count, 42);
  assert.match(out.note, /\[REDACTED\]/, 'secret-shaped value inside a normal field is scrubbed');
  assert.ok(!out.note.includes('sk-ZZ'), 'raw key not present');
});

test('redaction applies to logged event payloads (no prompt secrets stored)', async () => {
  const tracer = new Tracer();
  const span = tracer.trace('s').start();
  span.log('prompt', { api_key: 'sk-' + 'S'.repeat(19), prompt: 'hi' });
  const rec = await span.end();
  const payload = rec.events[0].payload;
  assert.equal(payload.api_key, '[REDACTED]');
  assert.equal(payload.prompt, 'hi');
  const serialized = JSON.stringify(rec);
  assert.ok(!serialized.includes('SECRETSECRET'), 'no secret anywhere in the record');
});

test('redactString scrubs JWT and WIF shapes', () => {
  const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcDEF_-123';
  assert.match(redactString(`tok ${jwt}`), /\[REDACTED\]/);
  assert.ok(!redactString(`tok ${jwt}`).includes('eyJhbGci'));
});

test('exporter soft-fails without an endpoint (buffers, never throws)', async () => {
  const tracer = new Tracer({ url: null, key: null });
  const span = tracer.trace('noendpoint').start();
  const rec = await span.end({ model: 'm' });   // must not throw
  assert.ok(rec, 'end() resolves');
  assert.equal(tracer.exported, 0);
  assert.equal(tracer.buffer.length, 1, 'record buffered locally');
});

test('exporter soft-fails when fetch throws (buffers, never throws)', async () => {
  __setFetch(async () => { throw new Error('network gone'); });
  const tracer = new Tracer({ url: 'https://lf.example', key: 'k' });
  const rec = await tracer.trace('neterr').start().end();
  assert.ok(rec);
  assert.equal(tracer.buffer.length, 1, 'buffered after network failure');
  assert.equal(tracer.exported, 0);
  __setFetch(null);
});

test('exporter POSTs to the endpoint on success and flush drains buffer', async () => {
  const calls = [];
  __setFetch(async (url, opts) => {
    calls.push({ url, opts });
    return { ok: true, status: 200 };
  });
  const tracer = new Tracer({ url: 'https://lf.example/', key: 'k' });
  await tracer.trace('good').start().end({ model: 'm' });
  assert.equal(tracer.exported, 1);
  assert.equal(tracer.buffer.length, 0, 'nothing buffered on success');
  assert.match(calls[0].url, /\/api\/public\/ingestion$/);
  assert.match(calls[0].opts.headers.Authorization, /^Bearer k$/);
  // body must not carry secrets and must be a batch
  const body = JSON.parse(calls[0].opts.body);
  assert.ok(Array.isArray(body.batch));
  __setFetch(null);
});

test('flush re-sends buffered records once an endpoint is reachable', async () => {
  // buffer first with no endpoint
  const tracer = new Tracer({ url: null, key: null });
  await tracer.trace('a').start().end();
  await tracer.trace('b').start().end();
  assert.equal(tracer.buffer.length, 2);
  // now point at a working endpoint and flush
  tracer.url = 'https://lf.example';
  tracer.key = 'k';
  __setFetch(async () => ({ ok: true, status: 200 }));
  const r = await tracer.flush();
  assert.equal(r.sent, 2);
  assert.equal(r.remaining, 0);
  assert.equal(tracer.buffer.length, 0);
  __setFetch(null);
});
