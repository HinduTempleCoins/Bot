// hathor-widget.test.mjs — OFFLINE. The widget's transport is pure with an injected fetch; esc()
// escapes everything; mount soft-fails without a DOM. No network, no real document.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { esc, sendChat, respond, mountHathorWidget, DEFAULT_ENDPOINT } from './hathor-widget.mjs';
import * as brain from './hathor-brain.mjs';

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

// ── LOCAL mode: Hathor answers client-side from the vendored brain (no server, no chain) ──────────
test('respond (local) answers a signup question straight from the in-browser brain — no network', async () => {
  let fetched = false;
  const out = await respond('how do I sign up?', null, { mode: 'local', fetch: async () => { fetched = true; return {}; } });
  assert.equal(fetched, false, 'local mode must NOT touch the network');
  assert.ok(out.reply && out.reply.length > 0);
});

test('respond (local) drives the deterministic signup walkthrough with round-tripped state', async () => {
  const first = await respond('I have no idea what I am doing', null, { mode: 'local' });
  assert.equal(first.kind, 'signup');
  assert.ok(first.state, 'walkthrough state is returned to carry forward');
  const second = await respond('ok', first.state, { mode: 'local' });
  assert.equal(second.kind, 'signup', 'the walkthrough continues from prior state');
});

test('respond (local) soft-fails if the brain is missing', async () => {
  const out = await respond('hi', null, { mode: 'local', brain: {} });   // brain with no handleMessage
  assert.match(out.reply, /sign(ing)? up|keys|pool/i);
});

test('respond (remote) POSTs to the server instead of the local brain', async () => {
  const calls = [];
  const fakeFetch = async (u, init) => { calls.push(u); return { ok: true, json: async () => ({ reply: 'remote', state: null }) }; };
  const out = await respond('hi', null, { mode: 'remote', endpoint: 'https://x/chat', fetch: fakeFetch });
  assert.equal(out.reply, 'remote');
  assert.equal(calls.length, 1, 'remote mode hits the endpoint');
});

test('the vendored brain runs in a plain JS context (no node-only deps leak in)', async () => {
  const out = await brain.handleMessage({ user: 'u', text: 'what is a key?', state: null }, {});
  assert.ok(typeof out.reply === 'string' && out.reply.length > 0);
});

test('mountHathorWidget returns null when there is no DOM (safe import in tests/SSR)', () => {
  assert.equal(mountHathorWidget({ doc: null }), null);
  assert.equal(mountHathorWidget({ doc: {} }), null, 'a doc with no body → no mount, no throw');
});

test('DEFAULT_ENDPOINT points at the chat server, not a relative path (cross-origin embed)', () => {
  assert.match(DEFAULT_ENDPOINT, /^https:\/\/.+\/chat$/);
});
