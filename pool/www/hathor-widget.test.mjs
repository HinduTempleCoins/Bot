// hathor-widget.test.mjs — OFFLINE. The widget's transport is pure with an injected fetch; esc()
// escapes everything; mount soft-fails without a DOM. No network, no real document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, sendChat, mountHathorWidget, DEFAULT_ENDPOINT } from './hathor-widget.mjs';

test('esc() neutralizes HTML so chat text can never inject', () => {
  assert.equal(esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(esc(`"&'<>`), '&quot;&amp;&#39;&lt;&gt;');
  assert.equal(esc(null), '');
});

test('sendChat POSTs the message + state to the endpoint and returns the parsed reply', async () => {
  const calls = [];
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ reply: 'Welcome to MELEK.', kind: 'answer', done: false, state: { step: 1 } }) };
  };
  const out = await sendChat('how do I sign up?', null, { endpoint: 'https://chat.melek.salon/chat', fetch: fakeFetch });
  assert.equal(calls[0].url, 'https://chat.melek.salon/chat');
  assert.equal(calls[0].body.message, 'how do I sign up?');
  assert.equal(out.reply, 'Welcome to MELEK.');
  assert.deepEqual(out.state, { step: 1 });
});

test('sendChat round-trips walkthrough state on the next turn', async () => {
  const seen = [];
  const fakeFetch = async (_u, init) => { seen.push(JSON.parse(init.body).state); return { ok: true, json: async () => ({ reply: 'next', state: { step: 2 } }) }; };
  await sendChat('go', { step: 1 }, { endpoint: 'x', fetch: fakeFetch });
  assert.deepEqual(seen[0], { step: 1 }, 'prior state is sent back so the multi-turn walkthrough continues');
});

test('sendChat soft-fails to a friendly fallback on a network error (never throws)', async () => {
  const boom = async () => { throw new Error('offline'); };
  const out = await sendChat('hi', null, { endpoint: 'x', fetch: boom });
  assert.equal(out.kind, 'error');
  assert.match(out.reply, /try|reach|moment/i);
  assert.equal(out.done, false);
});

test('sendChat soft-fails on a non-ok / malformed response', async () => {
  const bad = async () => ({ ok: false, json: async () => ({}) });
  const out = await sendChat('hi', null, { endpoint: 'x', fetch: bad });
  assert.equal(out.kind, 'error');
});

test('mountHathorWidget returns null when there is no DOM (safe import in tests/SSR)', () => {
  assert.equal(mountHathorWidget({ doc: null }), null);
  assert.equal(mountHathorWidget({ doc: {} }), null, 'a doc with no body → no mount, no throw');
});

test('DEFAULT_ENDPOINT points at the chat server, not a relative path (cross-origin embed)', () => {
  assert.match(DEFAULT_ENDPOINT, /^https:\/\/.+\/chat$/);
});
