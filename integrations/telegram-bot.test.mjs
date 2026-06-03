// telegram-bot.test.mjs — offline tests for the Telegram bot scaffold (Tasks #106 / #107).
// node:test. NEVER hits api.telegram.org: the transport AND the dispatcher are injected.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleUpdate,
  isOperator,
  claimOperator,
  resetOperator,
  operatorCommands,
  publicCommands,
  run,
  tokenName,
  parseUpdate,
  redactForLog,
  __setTransport,
  __resetTransport,
  __setDispatcher,
  __resetDispatcher,
} from './telegram-bot.mjs';

// A canned dispatcher that records what it received and echoes a public-surface reply.
function fakeDispatcher() {
  const calls = [];
  const fn = async (msg, ctx) => {
    calls.push({ msg, ctx });
    return { reply: `[public] you said: ${msg.text}`, route: 'persona', platform: msg.platform };
  };
  fn.calls = calls;
  return fn;
}

// Build a minimal Telegram update.
function update(id, chatId, text, from = {}) {
  return { update_id: id, message: { chat: { id: chatId }, from, text } };
}

function reset() {
  resetOperator();
  __resetTransport();
  __resetDispatcher();
}

test('handleUpdate routes a public user message through the injected dispatcher and returns a reply', async () => {
  reset();
  const disp = fakeDispatcher();
  __setDispatcher(disp);
  const now = () => 1000;

  const action = await handleUpdate(update(1, 555, 'what is the price of gold?'), { now });

  assert.ok(action, 'an action is returned');
  assert.equal(action.chatId, '555');
  assert.equal(action.mode, 'public');
  assert.equal(action.reply, '[public] you said: what is the price of gold?');
  assert.equal(disp.calls.length, 1);
  assert.equal(disp.calls[0].msg.platform, 'telegram');
  reset();
});

test('the operator chat (after claimOperator) gets operator mode and CAN run an operator command', async () => {
  reset();
  __setDispatcher(fakeDispatcher());
  const claim = claimOperator(999);
  assert.equal(claim.ok, true);
  assert.equal(isOperator(999), true);
  assert.equal(isOperator('999'), true, 'number/string chat ids compare equal');

  const action = await handleUpdate(update(2, 999, '/status'), { now: () => 0 });
  assert.ok(action);
  assert.equal(action.mode, 'operator');
  assert.equal(action.route, 'operator-command');
  assert.match(action.reply, /operator mode/i);
  reset();
});

test('a non-operator is REFUSED an operator command', async () => {
  reset();
  const disp = fakeDispatcher();
  __setDispatcher(disp);
  claimOperator(999); // operator is someone else

  const action = await handleUpdate(update(3, 111, '/status'), {});
  assert.ok(action);
  assert.equal(action.mode, 'public');
  assert.equal(action.route, 'refused');
  assert.match(action.reply, /operator only/i);
  // Crucially: a refused operator command is NOT routed to the dispatcher.
  assert.equal(disp.calls.length, 0, 'refused command did not reach the dispatcher');
  reset();
});

test('claimOperator locks to the FIRST id; a different id cannot claim', async () => {
  reset();
  const first = claimOperator(100);
  assert.equal(first.ok, true);
  assert.equal(first.chatId, '100');

  const second = claimOperator(200);
  assert.equal(second.ok, false);
  assert.equal(second.reason, 'already-claimed');

  // Re-claiming with the same id is idempotent success.
  const again = claimOperator(100);
  assert.equal(again.ok, true);

  assert.equal(isOperator(100), true);
  assert.equal(isOperator(200), false);
  reset();
});

test('run() processes a canned update via the injected transport without real network', async () => {
  reset();
  __setDispatcher(fakeDispatcher());

  const sent = [];
  let pulled = false;
  const transport = {
    async getUpdates() {
      if (pulled) return [];
      pulled = true;
      return [update(42, 777, 'hello there')];
    },
    async sendMessage(payload) {
      sent.push(payload);
    },
  };

  const stats = await run({ transport, now: () => 0, max: 1 });

  assert.equal(stats.polls, 1);
  assert.equal(stats.handled, 1);
  assert.equal(stats.sent, 1);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chatId, '777');
  assert.ok(sent[0].text.length > 0);
  reset();
});

test('run() with no transport does nothing (no network code path exists)', async () => {
  reset();
  const stats = await run({});
  assert.deepEqual(stats, { polls: 0, handled: 0, sent: 0 });
  reset();
});

test('logging redacts content — no raw text or PII in the log line', () => {
  const line = redactForLog({ chatId: 999, user: 'secret_handle', text: 'my private message body', mode: 'operator' });
  assert.match(line, /^\[telegram-bot\]/);
  assert.ok(!line.includes('my private message body'), 'raw text is never in the log');
  assert.ok(!line.includes('secret_handle'), 'raw user handle is never in the log');
  assert.ok(!line.includes('999'), 'raw chat id is never in the log');
  assert.match(line, /len=23/, 'only the message length is recorded');
  assert.match(line, /mode=operator/);
});

test('token is referenced by env NAME only — no literal token anywhere', () => {
  const name = tokenName();
  assert.equal(name, ['TELEGRAM', 'BOT', 'TOKEN'].join('_')); // assembled, no literal in source
  // The module exports no token value; the name is assembled, not a hard-coded secret string.
  assert.equal(typeof name, 'string');
});

test('parseUpdate handles message shapes and rejects non-text/malformed updates', () => {
  assert.equal(parseUpdate(null), null);
  assert.equal(parseUpdate({}), null);
  assert.equal(parseUpdate({ message: { chat: {}, text: 'hi' } }), null, 'no chat id → null');

  const p = parseUpdate(update(1, 5, 'hi', { username: 'alice' }));
  assert.deepEqual(p, { chatId: '5', user: 'alice', text: 'hi' });

  // edited_message shape, user falls back to from.id then chat id
  const e = parseUpdate({ edited_message: { chat: { id: 7 }, from: { id: 12 }, text: 'edit' } });
  assert.deepEqual(e, { chatId: '7', user: '12', text: 'edit' });
});

test('public commands work for anyone; unknown /command falls through to the dispatcher', async () => {
  reset();
  const disp = fakeDispatcher();
  __setDispatcher(disp);

  const start = await handleUpdate(update(1, 5, '/start'), {});
  assert.equal(start.route, 'public-command');
  assert.match(start.reply, /Hathor/);
  assert.equal(disp.calls.length, 0, 'a public command does not hit the dispatcher');

  const unknown = await handleUpdate(update(2, 5, '/somethingelse'), {});
  assert.equal(unknown.route, 'persona', 'unknown /command is routed to the dispatcher');
  assert.equal(disp.calls.length, 1);
  reset();
});

test('soft-fail: a non-text update yields null; a throwing dispatcher yields a graceful fallback', async () => {
  reset();
  // malformed update (no message at all) → null
  const none = await handleUpdate({ update_id: 1 }, {});
  assert.equal(none, null);

  // throwing dispatcher → graceful fallback (no throw at the edge)
  __setDispatcher(async () => { throw new Error('boom'); });
  const action = await handleUpdate(update(2, 5, 'tell me a story'), {});
  assert.ok(action);
  assert.equal(action.route, 'fallback');
  assert.ok(action.reply.length > 0);
  reset();
});

test('command sets are exported and disjoint', () => {
  assert.ok(typeof publicCommands === 'object' && Object.keys(publicCommands).length > 0);
  assert.ok(typeof operatorCommands === 'object' && Object.keys(operatorCommands).length > 0);
  for (const k of Object.keys(operatorCommands)) {
    assert.ok(!Object.prototype.hasOwnProperty.call(publicCommands, k), `${k} is operator-only`);
  }
});
