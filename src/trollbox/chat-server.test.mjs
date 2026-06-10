// src/trollbox/chat-server.test.mjs — offline tests for the browser chat HTTP surface.
// Run: node --test src/trollbox/chat-server.test.mjs
//
// Fully offline: no network, no chain. We drive handler(req,res) with a tiny fake req/res and assert
// on the JSON it writes. Covers: POST /chat happy path, multi-turn walkthrough state, bad input,
// CORS lock to the alpha origin, health, and the rate limit.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { handler, ALLOWED_ORIGIN, __setLimiter } from './chat-server.mjs';
import { RateLimiter } from './index.mjs';

// ── tiny fake req/res ──────────────────────────────────────────────────────────────────────────────
function makeReq({ method = 'GET', url = '/', headers = {}, body } = {}) {
  const handlers = {};
  const req = {
    method,
    url,
    headers,
    socket: { remoteAddress: '203.0.113.7' },
    on(ev, fn) { handlers[ev] = fn; return req; },
    destroy() { handlers.error && handlers.error(new Error('destroyed')); },
  };
  // Schedule the body emit on next tick so handler can attach listeners first.
  queueMicrotask(() => {
    if (body !== undefined && handlers.data) handlers.data(Buffer.from(body));
    handlers.end && handlers.end();
  });
  return req;
}

function makeRes() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers || {}; },
    end(chunk) { if (chunk) this.body += chunk; this._ended = true; },
    json() { try { return JSON.parse(this.body); } catch { return null; } },
  };
}

async function call(reqOpts) {
  const req = makeReq(reqOpts);
  const res = makeRes();
  await handler(req, res);
  return res;
}

const ORIGIN = ALLOWED_ORIGIN; // https://alpha.melek.salon
const post = (body, headers = {}) =>
  call({ method: 'POST', url: '/chat', headers: { origin: ORIGIN, ...headers }, body: JSON.stringify(body) });

// Reset to a fresh, generous limiter before each test that posts (so the rate-limit test is isolated).
function freshLimiter() { __setLimiter(new RateLimiter({ capacity: 50, windowMs: 60000 })); }

// ── health ───────────────────────────────────────────────────────────────────────────────────────
test('GET /chat/health returns ok', async () => {
  const res = await call({ method: 'GET', url: '/chat/health', headers: { origin: ORIGIN } });
  assert.equal(res.statusCode, 200);
  assert.equal(res.body, 'ok');
});

// ── happy path ─────────────────────────────────────────────────────────────────────────────────────
test('POST /chat answers a signup question (happy path)', async () => {
  freshLimiter();
  const res = await post({ message: 'how do i sign up' });
  assert.equal(res.statusCode, 200);
  const j = res.json();
  assert.equal(j.ok, true);
  assert.equal(j.kind, 'faq');
  assert.match(j.reply, /never (see|ask)/i);
  assert.ok(Array.isArray(j.steps), 'exposes the step list');
});

// ── multi-turn walkthrough state ─────────────────────────────────────────────────────────────────
test('POST /chat carries walkthrough state across turns to the end', async () => {
  freshLimiter();
  const script = ['make me an account', 'next', 'next', 'i saved them', 'done'];
  let state = null;
  let last;
  for (const message of script) {
    const res = await post({ message, state });
    const j = res.json();
    assert.equal(j.ok, true);
    assert.equal(j.kind, 'signup', `turn "${message}" is a signup step`);
    state = j.state;
    last = j;
  }
  assert.match(last.reply, /welcome aboard/i);
  assert.equal(last.done, true, 'reaches the done end state');
});

test('POST /chat ignores a tampered state.step (restarts the walkthrough)', async () => {
  freshLimiter();
  // A forged step id must be dropped — not advance the walkthrough from a fake position.
  const res = await post({ message: 'what is melek', state: { signup: { step: 'totally-fake' } } });
  const j = res.json();
  assert.equal(j.ok, true);
  // With no valid state and not a signup intent, this is just the FAQ — not a signup step.
  assert.equal(j.kind, 'faq');
  assert.equal(j.state, null);
});

// ── bad input ────────────────────────────────────────────────────────────────────────────────────
test('POST /chat rejects an empty message', async () => {
  freshLimiter();
  const res = await post({ message: '   ' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().reason, 'empty-message');
});

test('POST /chat rejects malformed JSON', async () => {
  freshLimiter();
  const res = await call({ method: 'POST', url: '/chat', headers: { origin: ORIGIN }, body: '{not json' });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().reason, 'bad-json');
});

// ── CORS lock ────────────────────────────────────────────────────────────────────────────────────
test('CORS: allowed origin gets the grant', async () => {
  freshLimiter();
  const res = await post({ message: 'hello' });
  assert.equal(res.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
});

test('CORS: a disallowed origin gets NO cross-origin grant', async () => {
  freshLimiter();
  const res = await call({
    method: 'POST', url: '/chat',
    headers: { origin: 'https://evil.example' },
    body: JSON.stringify({ message: 'hello' }),
  });
  assert.equal(res.headers['access-control-allow-origin'], undefined);
});

test('CORS: OPTIONS preflight from the allowed origin returns 204 with the grant', async () => {
  const res = await call({ method: 'OPTIONS', url: '/chat', headers: { origin: ORIGIN } });
  assert.equal(res.statusCode, 204);
  assert.equal(res.headers['access-control-allow-origin'], ALLOWED_ORIGIN);
});

// ── rate limit ───────────────────────────────────────────────────────────────────────────────────
test('POST /chat rate-limits when the bucket is exhausted', async () => {
  // capacity 1: first allowed, second blocked (same client key).
  __setLimiter(new RateLimiter({ capacity: 1, windowMs: 60000 }));
  const ok = await post({ message: 'hi' });
  assert.equal(ok.statusCode, 200);
  const blocked = await post({ message: 'hi again' });
  assert.equal(blocked.statusCode, 429);
  assert.equal(blocked.json().reason, 'rate-limited');
  freshLimiter();
});

// ── unknown route ────────────────────────────────────────────────────────────────────────────────
test('unknown route 404s', async () => {
  freshLimiter();
  const res = await call({ method: 'GET', url: '/nope', headers: { origin: ORIGIN } });
  assert.equal(res.statusCode, 404);
});
