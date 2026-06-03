/**
 * commands/menu.test.mjs — OFFLINE tests for the deterministic command menu.
 *
 * No network, no RPC: every handler is exercised through `handle()` with
 * stubbed `deps` async functions. Run with:
 *
 *   node --test commands/menu.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCommand, normalizeAccount, handle, COMMANDS } from './menu.mjs';

// ---- parseCommand ----------------------------------------------------------

test('parseCommand: basic command, no args', () => {
  assert.deepEqual(parseCommand('!help'), { cmd: 'help', args: [] });
});

test('parseCommand: command with one arg', () => {
  assert.deepEqual(parseCommand('!balance @alice'), {
    cmd: 'balance',
    args: ['@alice'],
  });
});

test('parseCommand: hyphenated command name', () => {
  assert.deepEqual(parseCommand('!post-count bob'), {
    cmd: 'post-count',
    args: ['bob'],
  });
});

test('parseCommand: leading whitespace tolerated, name lowercased', () => {
  assert.deepEqual(parseCommand('   !PRICE BTC'), {
    cmd: 'price',
    args: ['BTC'],
  });
});

test('parseCommand: multiple args split on whitespace', () => {
  assert.deepEqual(parseCommand('!help balance extra'), {
    cmd: 'help',
    args: ['balance', 'extra'],
  });
});

test('parseCommand: only the first line is used for args', () => {
  assert.deepEqual(parseCommand('!balance @alice\nsome trailing note'), {
    cmd: 'balance',
    args: ['@alice'],
  });
});

test('parseCommand: non-command text returns null', () => {
  assert.equal(parseCommand('hello there'), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand(null), null);
  assert.equal(parseCommand(undefined), null);
  assert.equal(parseCommand('not a !command mid-string'), null);
});

// ---- normalizeAccount ------------------------------------------------------

test('normalizeAccount: strips @, lowercases', () => {
  assert.equal(normalizeAccount('@Alice'), 'alice');
});

test('normalizeAccount: rejects invalid names', () => {
  assert.equal(normalizeAccount(''), null);
  assert.equal(normalizeAccount('ab'), null); // too short
  assert.equal(normalizeAccount('-leadinghyphen'), null);
  assert.equal(normalizeAccount('has space'), null);
  assert.equal(normalizeAccount(42), null);
});

test('normalizeAccount: accepts dotted segments', () => {
  assert.equal(normalizeAccount('alice.bob'), 'alice.bob');
});

// ---- help handler ----------------------------------------------------------

test('handle: !help lists all commands alphabetically', async () => {
  const reply = await handle('!help');
  assert.match(reply, /Available commands:/);
  for (const c of COMMANDS) {
    assert.ok(reply.includes(`!${c.name}`), `help should mention !${c.name}`);
  }
  // alphabetical: balance before witness in the body
  assert.ok(reply.indexOf('!balance') < reply.indexOf('!witness'));
});

test('handle: !help <command> shows that command detail', async () => {
  const reply = await handle('!help price');
  assert.match(reply, /^!price \[symbol\]/);
  assert.match(reply, /USD price/);
});

test('handle: !help <unknown> points back to !help', async () => {
  const reply = await handle('!help nope');
  assert.match(reply, /Unknown command: !nope/);
});

// ---- balance handler -------------------------------------------------------

test('handle: !balance formats account fields from stubbed deps', async () => {
  const deps = {
    getAccount: async (name) => {
      assert.equal(name, 'alice');
      return {
        balance: '12.345 MELEK',
        vesting_shares: '1000.0 VESTS',
        savings_balance: '5.000 MELEK',
      };
    },
  };
  const reply = await handle('!balance @Alice', deps);
  assert.equal(
    reply,
    '@alice\nLiquid: 12.345 MELEK\nVesting: 1000.0 VESTS\nSavings: 5.000 MELEK'
  );
});

test('handle: !balance omits savings line when absent', async () => {
  const deps = {
    getAccount: async () => ({ balance: '1.000 MELEK', vesting_shares: '0 VESTS' }),
  };
  const reply = await handle('!balance bob', deps);
  assert.equal(reply, '@bob\nLiquid: 1.000 MELEK\nVesting: 0 VESTS');
});

test('handle: !balance with no arg returns usage', async () => {
  assert.equal(await handle('!balance', {}), 'Usage: !balance @account');
});

test('handle: !balance not-found message', async () => {
  const deps = { getAccount: async () => null };
  assert.equal(await handle('!balance ghost', deps), '@ghost not found on this chain.');
});

test('handle: !balance with missing dep degrades gracefully', async () => {
  assert.equal(await handle('!balance alice', {}), 'Balance lookup is unavailable right now.');
});

test('handle: !balance swallows data-source error', async () => {
  const deps = { getAccount: async () => { throw new Error('boom'); } };
  assert.match(await handle('!balance alice', deps), /Could not look up @alice/);
});

// ---- witness handler -------------------------------------------------------

test('handle: !witness formats witness record', async () => {
  const deps = {
    getWitness: async (name) => {
      assert.equal(name, 'hathor');
      return {
        url: 'https://melek.example',
        signing_key: 'MLK1abc',
        last_confirmed_block_num: 4242,
        total_missed: 3,
      };
    },
  };
  const reply = await handle('!witness hathor', deps);
  assert.equal(
    reply,
    '@hathor witness record\nURL: https://melek.example\nBlock-signing key: MLK1abc\nLast confirmed: block 4242\nMissed: 3'
  );
});

test('handle: !witness not-a-witness message', async () => {
  const deps = { getWitness: async () => null };
  assert.equal(await handle('!witness alice', deps), '@alice is not a witness.');
});

test('handle: !witness no arg returns usage', async () => {
  assert.equal(await handle('!witness', {}), 'Usage: !witness @account');
});

// ---- post-count handler ----------------------------------------------------

test('handle: !post-count formats count + reputation', async () => {
  const deps = {
    getAccount: async () => ({ post_count: 87, reputation: '72.1' }),
  };
  const reply = await handle('!post-count @alice', deps);
  assert.equal(reply, '@alice has 87 posts/comments total. Reputation: 72.1.');
});

test('handle: !post-count without reputation', async () => {
  const deps = { getAccount: async () => ({ post_count: 0 }) };
  assert.equal(await handle('!post-count bob', deps), '@bob has 0 posts/comments total.');
});

test('handle: !post-count no arg returns usage', async () => {
  assert.equal(await handle('!post-count', {}), 'Usage: !post-count @account');
});

// ---- price handler ---------------------------------------------------------

test('handle: !price formats a >=1 USD price with sources', async () => {
  const deps = {
    getPrice: async (symbol) => {
      assert.equal(symbol, 'bitcoin'); // alias resolved from "btc"
      return { usd: 65000, sources: 3, confident: true };
    },
  };
  assert.equal(await handle('!price btc', deps), 'BTC: $65000.00 (3 sources)');
});

test('handle: !price defaults to HIVE and formats sub-$1 with 6 decimals', async () => {
  const deps = {
    getPrice: async (symbol) => {
      assert.equal(symbol, 'hive');
      return { usd: 0.25, sources: 1 };
    },
  };
  assert.equal(await handle('!price', deps), 'HIVE: $0.250000 (1 source)');
});

test('handle: !price marks unconfident', async () => {
  const deps = { getPrice: async () => ({ usd: 2, sources: 2, confident: false }) };
  assert.match(await handle('!price eth', deps), /unconfirmed/);
});

test('handle: !price no price found', async () => {
  const deps = { getPrice: async () => ({ usd: null }) };
  assert.match(await handle('!price wat', deps), /No confident price found for "wat"/);
});

test('handle: !price missing dep degrades gracefully', async () => {
  assert.equal(await handle('!price btc', {}), 'Price lookup is unavailable right now.');
});

// ---- routing / unknown -----------------------------------------------------

test('handle: non-command returns empty string', async () => {
  assert.equal(await handle('just chatting'), '');
});

test('handle: unknown command points to !help', async () => {
  assert.match(await handle('!frobnicate'), /Unknown command: !frobnicate\. Try !help/);
});

// ---- registry shape --------------------------------------------------------

test('COMMANDS registry has the expected commands with handlers', () => {
  const names = COMMANDS.map((c) => c.name).sort();
  assert.deepEqual(names, ['balance', 'help', 'post-count', 'price', 'witness']);
  for (const c of COMMANDS) {
    assert.equal(typeof c.handler, 'function');
    assert.equal(typeof c.help, 'string');
  }
});
