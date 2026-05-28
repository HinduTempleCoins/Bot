/**
 * commands/index.test.js — parser, registry, dispatcher integration tests.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, normalizeAccount } from './parser.js';
import { Registry, CommandNotFoundError } from './registry.js';
import { dispatch } from './index.js';

// ---- parser -----------------------------------------------------------------

test('parseCommand: simple invocation', () => {
  assert.deepEqual(parseCommand('!help'), { command: 'help', args: [], rest: '', raw: '!help' });
});

test('parseCommand: with args', () => {
  const p = parseCommand('!balance @alice');
  assert.equal(p.command, 'balance');
  assert.deepEqual(p.args, ['@alice']);
});

test('parseCommand: case-insensitive command, leading whitespace tolerated', () => {
  const p = parseCommand('  !WITNESS @hathor');
  assert.equal(p.command, 'witness');
  assert.deepEqual(p.args, ['@hathor']);
});

test('parseCommand: returns null for non-command body', () => {
  assert.equal(parseCommand('hi there, nice post'), null);
  assert.equal(parseCommand(null), null);
  assert.equal(parseCommand(''), null);
  // `!` followed by digit or symbol isn't a command.
  assert.equal(parseCommand('!2 + 2'), null);
});

test('parseCommand: multi-line body captures rest', () => {
  const p = parseCommand('!help balance\n\nextra context line.');
  assert.equal(p.command, 'help');
  assert.deepEqual(p.args, ['balance']);
  assert.equal(p.rest.trim(), 'extra context line.');
});

test('normalizeAccount: handles @-prefix and lowercase', () => {
  assert.equal(normalizeAccount('@Alice'), 'alice');
  assert.equal(normalizeAccount('hathor'), 'hathor');
  assert.equal(normalizeAccount('  bob  '), 'bob');
  assert.equal(normalizeAccount('account.sub'), 'account.sub');
});

test('normalizeAccount: rejects invalid names', () => {
  assert.equal(normalizeAccount(''), null);
  assert.equal(normalizeAccount('ab'), null);                  // too short
  assert.equal(normalizeAccount('1starts-with-digit'), null);
  assert.equal(normalizeAccount('has spaces'), null);
  assert.equal(normalizeAccount('has_underscore'), null);
  assert.equal(normalizeAccount(null), null);
});

// ---- registry --------------------------------------------------------------

test('Registry: register + has + dispatch', async () => {
  const r = new Registry();
  r.register('echo', {
    args: '<text>',
    help: 'Repeat the args.',
    handler: async (p) => ({ ok: true, reply: p.args.join(' ') }),
  });
  assert.equal(r.has('echo'), true);
  assert.equal(r.has('ECHO'), true);
  const out = await r.dispatch({ command: 'echo', args: ['hello', 'world'] });
  assert.equal(out.reply, 'hello world');
});

test('Registry: dispatch unknown command throws CommandNotFoundError', async () => {
  const r = new Registry();
  await assert.rejects(
    () => r.dispatch({ command: 'no-such', args: [] }),
    (err) => err instanceof CommandNotFoundError && err.command === 'no-such',
  );
});

test('Registry: register rejects non-function handler', () => {
  const r = new Registry();
  assert.throws(() => r.register('x', { handler: 'not a function' }), /handler must be a function/);
});

// ---- dispatcher (default-wired) --------------------------------------------

test('dispatch: returns {handled: false} for non-command body', async () => {
  const r = await dispatch('just a normal comment');
  assert.equal(r.handled, false);
});

test('dispatch: !help returns the command list', async () => {
  const r = await dispatch('!help');
  assert.equal(r.handled, true);
  assert.equal(r.command, 'help');
  assert.match(r.reply, /!balance/);
  assert.match(r.reply, /!witness/);
  assert.match(r.reply, /!help/);
});

test('dispatch: !help <cmd> returns one command details', async () => {
  const r = await dispatch('!help balance');
  assert.match(r.reply, /^\*\*!balance\*\*/);
  assert.match(r.reply, /liquid MELEK/i);
});

test('dispatch: !balance with no args prompts for an account', async () => {
  const r = await dispatch('!balance');
  assert.match(r.reply, /Usage:.*!balance/);
});

test('dispatch: !balance with mocked adapter returns balance string', async () => {
  const adapter = {
    client: {
      database: {
        getAccounts: async (names) => [{
          name: names[0],
          balance: '12.345 MELEK',
          vesting_shares: '1000.000000 VESTS',
        }],
      },
    },
  };
  const r = await dispatch('!balance @alice', { adapter });
  assert.match(r.reply, /@alice/);
  assert.match(r.reply, /12.345 MELEK/);
});

test('dispatch: unknown command surfaces a friendly reply', async () => {
  const r = await dispatch('!nonesuch');
  assert.equal(r.handled, true);
  assert.equal(r.ok, false);
  assert.match(r.reply, /Unknown command/);
});
