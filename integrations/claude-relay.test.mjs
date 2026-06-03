// claude-relay.test.mjs — offline tests for the admin↔Server-4 Claude relay (task #204).
// node --test integrations/claude-relay.test.mjs
//
// Fully offline: transport, clock, and logger are injected. No network, no real vault secret —
// the token capability resolves from process.env (set/cleared per test).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  relayStatus,
  sendToClaude,
  history,
  renderPanel,
  escapeHtml,
  redactString,
  RATE,
  __setTransport,
  __setClock,
  __setLogger,
  __reset,
} from './claude-relay.mjs';

const ENV_URL = 'CLAUDE_RELAY_URL';
const ENV_TOKEN = ['CLAUDE', 'RELAY', 'TOKEN'].join('_');

function configure() {
  process.env[ENV_URL] = 'https://server4.example/claude';
  process.env[ENV_TOKEN] = 'tok-deadbeef-not-real';
}
function deconfigure() {
  delete process.env[ENV_URL];
  delete process.env[ENV_TOKEN];
}

function setup() {
  __reset();
  deconfigure();
}

test('not-configured → honest error, message not sent', async () => {
  setup();
  let called = false;
  __setTransport(() => { called = true; return Promise.resolve({ reply: 'x' }); });
  const r = await sendToClaude({ message: 'hello', sessionId: 's1' });
  assert.deepEqual(r, { ok: false, error: 'not-configured' });
  assert.equal(called, false, 'transport must not be called when not configured');
  const st = await relayStatus();
  assert.equal(st.configured, false);
  assert.equal(st.reachable, null);
});

test('empty message → no-message before any config check', async () => {
  setup();
  const r = await sendToClaude({ message: '   ', sessionId: 's1' });
  assert.deepEqual(r, { ok: false, error: 'no-message' });
});

test('configured + transport reply → ok + bounded history grows', async () => {
  setup();
  configure();
  let t = 1000;
  __setClock(() => t);
  __setTransport(async (payload) => ({ reply: `echo:${payload.message}`, sessionId: payload.sessionId }));

  const st = await relayStatus();
  assert.equal(st.configured, true);

  for (let i = 0; i < 60; i++) {
    t += 5000; // jump past min-interval AND keep the per-minute window from filling
    const r = await sendToClaude({ message: `m${i}`, sessionId: 'grow', from: 'admin' });
    assert.equal(r.ok, true, `send ${i} ok`);
    assert.equal(r.reply, `echo:m${i}`);
    assert.equal(r.sessionId, 'grow');
  }

  const h = history('grow');
  assert.equal(h.length, 50, 'history is a bounded ring (last 50 turns)');
  // last turn should be the assistant reply to m59
  assert.equal(h[h.length - 1].role, 'assistant');
  assert.equal(h[h.length - 1].text, 'echo:m59');
  assert.equal(h[h.length - 2].role, 'user');
  assert.equal(h[h.length - 2].text, 'm59');

  deconfigure();
});

test('transport throw → unreachable soft-fail (never throws)', async () => {
  setup();
  configure();
  __setTransport(() => { throw new Error('boom ECONNREFUSED'); });
  const r = await sendToClaude({ message: 'ping', sessionId: 'down' });
  assert.deepEqual(r, { ok: false, error: 'unreachable' });
  // no successful turn recorded
  assert.equal(history('down').length, 0);
  deconfigure();
});

test('relayStatus ping → reachable false on transport throw, true on success', async () => {
  setup();
  configure();
  __setTransport(() => { throw new Error('nope'); });
  let st = await relayStatus({ ping: true });
  assert.equal(st.configured, true);
  assert.equal(st.reachable, false);

  __setTransport(async () => ({ reply: 'pong' }));
  st = await relayStatus({ ping: true });
  assert.equal(st.reachable, true);
  deconfigure();
});

test('rate-limit: min-interval triggers on rapid sends (injected clock)', async () => {
  setup();
  configure();
  let t = 5000;
  __setClock(() => t);
  __setTransport(async () => ({ reply: 'ok' }));

  const first = await sendToClaude({ message: 'a', sessionId: 'rl' });
  assert.equal(first.ok, true);

  // same instant → under min interval
  const second = await sendToClaude({ message: 'b', sessionId: 'rl' });
  assert.deepEqual(second, { ok: false, error: 'rate-limited' });

  // advance past min interval → allowed again
  t += RATE.minIntervalMs + 1;
  const third = await sendToClaude({ message: 'c', sessionId: 'rl' });
  assert.equal(third.ok, true);
  deconfigure();
});

test('rate-limit: max msgs/min triggers (injected clock)', async () => {
  setup();
  configure();
  let t = 10_000;
  __setClock(() => t);
  __setTransport(async () => ({ reply: 'ok' }));

  // step just past min interval each time but stay within the same 60s window
  for (let i = 0; i < RATE.maxPerMin; i++) {
    t += RATE.minIntervalMs + 1;
    const r = await sendToClaude({ message: `m${i}`, sessionId: 'cap' });
    assert.equal(r.ok, true, `send ${i} within cap`);
  }
  // one more within the window → over the per-minute cap
  t += RATE.minIntervalMs + 1;
  const over = await sendToClaude({ message: 'too-much', sessionId: 'cap' });
  assert.deepEqual(over, { ok: false, error: 'rate-limited' });
  deconfigure();
});

test('outbound log redacts a key-shaped string but the message still goes through', async () => {
  setup();
  configure();
  const logs = [];
  __setLogger((line) => logs.push(line));
  let delivered = null;
  __setTransport(async (payload) => { delivered = payload.message; return { reply: 'got it' }; });

  const leaky = 'here is my key sk-ant-0123456789abcdefABCDEFG please';
  const r = await sendToClaude({ message: leaky, sessionId: 'redact', from: 'admin' });

  assert.equal(r.ok, true);
  // the FULL message (unredacted) was delivered to the endpoint
  assert.equal(delivered, leaky, 'message delivered intact — redaction only touches the log');
  // the OUTBOUND log line redacted the key-shaped substring
  const outLine = logs.find((l) => l.includes('→') && l.includes('redact'));
  assert.ok(outLine, 'an outbound log line was emitted');
  assert.ok(!outLine.includes('sk-ant-0123456789'), 'key-shaped string is redacted from the log');
  assert.ok(outLine.includes('[REDACTED]'), 'redaction marker present in log');
  deconfigure();
});

test('renderPanel escapes a malicious message', async () => {
  setup();
  configure();
  __setClock(() => 1);
  __setTransport(async () => ({ reply: '<img src=x onerror=alert(1)>' }));
  const evil = '<script>alert("xss")</script>';
  await sendToClaude({ message: evil, sessionId: 'panel', from: 'admin' });

  const html = renderPanel({ sessionId: 'panel' });
  assert.ok(!html.includes('<script>alert'), 'raw user script tag must not appear');
  assert.ok(!html.includes('<img src=x onerror'), 'raw assistant img tag must not appear');
  assert.ok(html.includes('&lt;script&gt;'), 'user message is HTML-escaped');
  assert.ok(html.includes('&lt;img'), 'assistant message is HTML-escaped');
  assert.ok(html.includes('action="/claude/send"'), 'form posts to the admin send route');
  deconfigure();
});

test('renderPanel escapes a malicious sessionId in the form fields', () => {
  setup();
  const html = renderPanel({ sessionId: '"><script>x</script>' });
  assert.ok(!html.includes('"><script>'), 'sessionId attribute injection is escaped');
  assert.ok(html.includes('&quot;&gt;&lt;script&gt;'), 'sessionId is HTML-escaped');
});

test('pure helpers: escapeHtml + redactString', () => {
  assert.equal(escapeHtml(`<a href="x">&'`), '&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  assert.equal(redactString('Bearer abcdefabcdefabcdef token'), '[REDACTED] token');
  assert.equal(redactString(null), '');
});
