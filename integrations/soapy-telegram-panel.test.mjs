// soapy-telegram-panel.test.mjs — offline tests for the web replacement of the Telegram Soapy surface.
// node:test. Fully OFFLINE: no Telegram, no network. The handlers migrated here (from telegram-bot.mjs)
// are pure/deterministic string handlers, so nothing to inject beyond the auth predicate.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { publicCommands, operatorCommands } from './telegram-bot.mjs';
import {
  COMMANDS,
  runCommand,
  handler,
  esc,
  __setAuth,
} from './soapy-telegram-panel.mjs';

// ── a tiny mock response (captures writeHead/end) ────────────────────────────────────────────────
function mockRes() {
  return {
    statusCode: 0,
    headers: null,
    body: '',
    writeHead(code, headers) { this.statusCode = code; this.headers = headers; },
    end(body) { this.body = body == null ? '' : String(body); },
  };
}

test('COMMANDS is non-empty and matches the REAL Telegram capabilities (public + operator)', () => {
  assert.ok(Array.isArray(COMMANDS) && COMMANDS.length > 0, 'COMMANDS non-empty');

  const ids = new Set(COMMANDS.map((c) => c.id));
  const real = [...Object.keys(publicCommands), ...Object.keys(operatorCommands)];
  assert.equal(COMMANDS.length, real.length, 'one entry per real Telegram command');
  for (const id of real) assert.ok(ids.has(id), `${id} is migrated`);

  // shape
  for (const c of COMMANDS) {
    assert.equal(typeof c.id, 'string');
    assert.equal(typeof c.label, 'string');
    assert.equal(typeof c.describe, 'string');
  }
});

test('runCommand — a known public id returns { ok:true, text }', async () => {
  const r = await runCommand('/start', {}, {});
  assert.equal(r.ok, true);
  assert.ok(typeof r.text === 'string' && r.text.length > 0);
  assert.match(r.text, /Hathor/);
});

test('runCommand — a known operator id runs the same handler (with injected clock)', async () => {
  const r = await runCommand('/status', {}, { now: () => 0 });
  assert.equal(r.ok, true);
  assert.match(r.text, /operator mode/i);
  // deterministic timestamp from the injected clock (offline)
  assert.match(r.text, /1970-01-01T00:00:00\.000Z/);
});

test('runCommand — unknown id → { ok:false }, never throws', async () => {
  const r = await runCommand('/not-a-command', {}, {});
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'unknown command');
});

test('handler GET /soapy — 401 when unauthed', async () => {
  __setAuth(() => false);
  const req = { url: '/soapy', method: 'GET' };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 401);
  __setAuth(() => false);
});

test('handler GET /soapy — 200 when authed, renders a command label, escapes injected script', async () => {
  __setAuth(() => true);
  const req = { url: '/soapy', method: 'GET' };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Type'], /text\/html/);

  // a real command label is rendered as a button
  const first = COMMANDS[0];
  assert.ok(res.body.includes(first.label), 'a command label is present');
  assert.ok(res.body.includes(esc(first.id)), 'the command id is rendered');

  // esc() proof: an injected <script> must appear escaped, never as a live tag
  const evil = '<script>alert(1)</script>';
  assert.equal(esc(evil), '&lt;script&gt;alert(1)&lt;/script&gt;');
  assert.ok(!res.body.includes(evil), 'no raw injected <script> tag in the page');

  __setAuth(() => false);
});

test('handler POST /soapy/run — returns the command result as JSON', async () => {
  __setAuth(() => true);
  const req = { url: '/soapy/run', method: 'POST', body: { id: '/about', args: {} } };
  const res = mockRes();
  await handler(req, res);
  assert.equal(res.statusCode, 200);
  const out = JSON.parse(res.body);
  assert.equal(out.ok, true);
  assert.match(out.text, /MELEK/);

  // unknown id round-trips as ok:false without throwing
  const res2 = mockRes();
  await handler({ url: '/soapy/run', method: 'POST', body: { id: '/nope' } }, res2);
  const out2 = JSON.parse(res2.body);
  assert.equal(out2.ok, false);

  __setAuth(() => false);
});

test('handler POST /soapy/run — 401 when unauthed (elevated surface stays gated)', async () => {
  __setAuth(() => false);
  const res = mockRes();
  await handler({ url: '/soapy/run', method: 'POST', body: { id: '/status' } }, res);
  assert.equal(res.statusCode, 401);
});
