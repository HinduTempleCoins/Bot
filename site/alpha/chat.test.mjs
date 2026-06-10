// chat.test.mjs — offline tests for the browser chat widget logic. Injected fetch, no DOM, no network.
// Run: node --test site/alpha/chat.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { esc, bubbleHtml, sendChat, DEFAULT_ENDPOINT } from './chat.mjs';

test('esc escapes all the dangerous characters', () => {
  assert.equal(esc('<b>&"\'x'), '&lt;b&gt;&amp;&quot;&#39;x');
  assert.equal(esc(null), '');
  assert.equal(esc(42), '42');
});

test('bubbleHtml escapes the message text (no XSS via a reply)', () => {
  const html = bubbleHtml('hathor', '<img src=x onerror=alert(1)>');
  assert.ok(!html.includes('<img'), 'raw tag must not survive');
  assert.match(html, /&lt;img/);
  assert.match(html, /class="msg hathor"/);
});

test('bubbleHtml labels the speaker', () => {
  assert.match(bubbleHtml('me', 'hi'), /class="msg me"/);
  assert.match(bubbleHtml('me', 'hi'), />You</);
  assert.match(bubbleHtml('hathor', 'hi'), />Hathor</);
});

test('sendChat posts the message + state and returns the parsed reply', async () => {
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return { json: async () => ({ ok: true, reply: 'step one', kind: 'signup', done: false, state: { signup: { step: 'name' } } }) };
  };
  const out = await sendChat('make me an account', null, { fetch: fakeFetch });
  assert.equal(captured.url, DEFAULT_ENDPOINT);
  assert.equal(captured.body.message, 'make me an account');
  assert.equal(out.reply, 'step one');
  assert.equal(out.kind, 'signup');
  assert.deepEqual(out.state, { signup: { step: 'name' } });
});

test('sendChat round-trips state on the next turn', async () => {
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    // Echo the step it received so we can assert it was forwarded.
    return { json: async () => ({ ok: true, reply: 'next step', kind: 'signup', state: { signup: { step: 'keys' } } }) };
  };
  let sentState = null;
  const fakeFetch2 = async (url, opts) => { sentState = JSON.parse(opts.body).state; return fakeFetch(url, opts).then((r) => r); };
  await sendChat('next', { signup: { step: 'name' } }, { fetch: fakeFetch2 });
  assert.deepEqual(sentState, { signup: { step: 'name' } });
});

test('sendChat soft-fails to a friendly fallback on network error', async () => {
  const out = await sendChat('hi', null, { fetch: async () => { throw new Error('offline'); } });
  assert.equal(out.kind, 'nudge');
  assert.match(out.reply, /try again/i);
});

test('sendChat soft-fails when the server returns not-ok', async () => {
  const out = await sendChat('hi', null, { fetch: async () => ({ json: async () => ({ ok: false, reason: 'rate-limited' }) }) });
  assert.equal(out.kind, 'nudge');
});
