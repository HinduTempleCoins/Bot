// discord-chain-bridge.test.mjs — offline tests for the Discord ↔ MELEK-testnet bridge.
// node --test, fully offline: no live Discord, no live chain. Stubs injected throughout.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseCommand,
  toChainOp,
  fromChainEvent,
  runCommand,
  makeBridge,
  makeTipLedger,
  esc,
  BRIDGE_DEFAULTS,
  SYMBOL,
} from './discord-chain-bridge.mjs';

// ── parseCommand: each command ───────────────────────────────────────────────────────────────────

test('parseCommand parses !tip @user <amt> (prefix and slash forms)', () => {
  assert.deepEqual(parseCommand('!tip @alice 5'), { cmd: 'tip', to: 'alice', amount: 5, raw: ['@alice', '5'] });
  assert.deepEqual(parseCommand('/tip @bob 12'), { cmd: 'tip', to: 'bob', amount: 12, raw: ['@bob', '12'] });
  // tolerant of a trailing TESTS symbol and leading whitespace
  const p = parseCommand('   !tip @carol 7 TESTS');
  assert.equal(p.cmd, 'tip');
  assert.equal(p.to, 'carol');
  assert.equal(p.amount, 7);
});

test('parseCommand parses !balance / !witness / !price / !welcome', () => {
  assert.deepEqual(parseCommand('!balance @hathor'), { cmd: 'balance', account: 'hathor', raw: ['@hathor'] });
  assert.deepEqual(parseCommand('!witness @hathor'), { cmd: 'witness', account: 'hathor', raw: ['@hathor'] });
  assert.equal(parseCommand('!price btc').symbol, 'btc');
  assert.equal(parseCommand('!price').symbol, 'hive'); // default
  assert.deepEqual(parseCommand('!welcome @newbie'), { cmd: 'welcome', to: 'newbie', raw: ['@newbie'] });
});

test('parseCommand returns null for non-commands', () => {
  assert.equal(parseCommand('hello there'), null);
  assert.equal(parseCommand(''), null);
  assert.equal(parseCommand(null), null);
});

// ── !tip → correct transfer op, with the cap enforced ─────────────────────────────────────────────

test('!tip maps to a correct transfer op (from the tipper, TESTS, 3 decimals)', () => {
  const cmd = parseCommand('!tip @alice 5');
  const plan = toChainOp(cmd, { from: 'tipper' });
  assert.equal(plan.ok, true);
  assert.equal(plan.ops.length, 1);
  const [type, body] = plan.ops[0];
  assert.equal(type, 'transfer');
  assert.equal(body.from, 'tipper');
  assert.equal(body.to, 'alice');
  assert.equal(body.amount, `5.000 ${SYMBOL}`);
  assert.match(body.memo, /Hathor bridge/);
  assert.deepEqual(plan.needs, ['tipper']); // host signs with the tipper's key
});

test('!tip enforces the per-tip max-amount cap (hard floor without a ledger)', () => {
  const cmd = parseCommand('!tip @bob 999');
  const plan = toChainOp(cmd, { from: 'tipper' });
  assert.equal(plan.ok, false);
  assert.equal(plan.capped, true);
  assert.equal(plan.ops.length, 0);
  assert.match(plan.error, /per-tip cap/);
});

test('!tip refuses self-tips and non-positive amounts', () => {
  assert.equal(toChainOp(parseCommand('!tip @tipper 5'), { from: 'tipper' }).ok, false);
  assert.equal(toChainOp(parseCommand('!tip @alice 0'), { from: 'tipper' }).ok, false);
  assert.equal(toChainOp(parseCommand('!tip @alice -3'), { from: 'tipper' }).ok, false);
});

test('!tip requires a linked from-account', () => {
  const plan = toChainOp(parseCommand('!tip @alice 5'), {}); // no `from`
  assert.equal(plan.ok, false);
  assert.match(plan.error, /from-account/);
});

// ── rate-limit blocks a flood ─────────────────────────────────────────────────────────────────────

test('rate-limit blocks a flood from the same tipper, allows after the window', () => {
  const ledger = makeTipLedger();
  const t0 = 1_000_000_000_000;
  const first = toChainOp(parseCommand('!tip @alice 5'), { from: 'spammer', ledger, now: t0 });
  assert.equal(first.ok, true); // first tip goes through (and is recorded)

  // immediate second tip → rate-limited
  const second = toChainOp(parseCommand('!tip @bob 5'), { from: 'spammer', ledger, now: t0 + 1000 });
  assert.equal(second.ok, false);
  assert.match(second.error, /rate-limited/);

  // after the rate-limit window → allowed again
  const later = toChainOp(parseCommand('!tip @carol 5'), { from: 'spammer', ledger, now: t0 + (BRIDGE_DEFAULTS.rateLimitSec + 1) * 1000 });
  assert.equal(later.ok, true);
});

test('daily per-user cap blocks once the day total is exceeded', () => {
  const ledger = makeTipLedger();
  const rules = { rateLimitSec: 0, maxTip: 100, dailyCapPerUser: 30 };
  const t0 = 2_000_000_000_000;
  assert.equal(toChainOp(parseCommand('!tip @alice 20'), { from: 'user', ledger, rules, now: t0 }).ok, true);
  // 20 + 20 = 40 > 30 → blocked
  const over = toChainOp(parseCommand('!tip @bob 20'), { from: 'user', ledger, rules, now: t0 + 1000 });
  assert.equal(over.ok, false);
  assert.match(over.error, /daily cap/);
});

// ── !welcome → delegate + grant + ping ────────────────────────────────────────────────────────────

test('!welcome maps to delegate + grant (+ ping when a welcome post is set), all from hathor', () => {
  const cmd = parseCommand('!welcome @newbie');
  const plan = toChainOp(cmd, { rules: { welcomePostPermlink: 'welcome-to-melek' } });
  assert.equal(plan.ok, true);
  assert.equal(plan.ops.length, 3);
  assert.equal(plan.ops[0][0], 'delegate_vesting_shares');
  assert.equal(plan.ops[0][1].delegator, 'hathor');
  assert.equal(plan.ops[0][1].delegatee, 'newbie');
  assert.equal(plan.ops[1][0], 'transfer');
  assert.equal(plan.ops[1][1].amount, `10.000 ${SYMBOL}`);
  assert.equal(plan.ops[2][0], 'comment');
  assert.equal(plan.ops[2][1].parent_permlink, 'welcome-to-melek');
  assert.deepEqual(plan.needs, ['hathor']);
});

test('!welcome without a welcome-post permlink omits the ping comment', () => {
  const plan = toChainOp(parseCommand('!welcome @newbie'), {});
  assert.equal(plan.ok, true);
  assert.equal(plan.ops.length, 2); // delegate + grant only
  assert.ok(!plan.ops.some((o) => o[0] === 'comment'));
});

// ── read-only commands map to no chain op ─────────────────────────────────────────────────────────

test('!balance / !witness / !price produce no chain op (host answers via menu)', () => {
  for (const c of ['!balance @hathor', '!witness @hathor', '!price btc']) {
    const plan = toChainOp(parseCommand(c), {});
    assert.equal(plan.ok, true);
    assert.equal(plan.readonly, true);
    assert.equal(plan.ops.length, 0);
  }
});

// ── runCommand wires read commands to the deterministic menu ───────────────────────────────────────

test('runCommand answers !balance via the injected menu deps', async () => {
  const deps = {
    getAccount: async (n) => (n === 'hathor' ? { balance: '100.000 TESTS', vesting_shares: '5.000000 VESTS' } : null),
  };
  const res = await runCommand('!balance @hathor', { deps });
  assert.equal(res.kind, 'read');
  assert.match(res.reply, /@hathor/);
  assert.match(res.reply, /100.000 TESTS/);
});

test('runCommand answers !price via the injected menu deps', async () => {
  const deps = { getPrice: async () => ({ usd: 65000, sources: 3 }) };
  const res = await runCommand('!price btc', { deps });
  assert.equal(res.kind, 'read');
  assert.match(res.reply, /BTC: \$65000/);
});

test('runCommand dry-runs a tip when no broadcaster is injected', async () => {
  const res = await runCommand('!tip @alice 5', { from: 'tipper' });
  assert.equal(res.kind, 'dryrun');
  assert.equal(res.dryRun, true);
  assert.equal(res.ops[0][0], 'transfer');
});

test('runCommand calls the injected broadcaster for a tip (write path)', async () => {
  let seen = null;
  const broadcast = async ({ ops, needs }) => { seen = { ops, needs }; return { id: 'tx-deadbeef' }; };
  const res = await runCommand('!tip @alice 5', { from: 'tipper', broadcast });
  assert.equal(res.kind, 'write');
  assert.equal(res.result.id, 'tx-deadbeef');
  assert.equal(seen.ops[0][0], 'transfer');
  assert.deepEqual(seen.needs, ['tipper']);
});

test('runCommand soft-fails a broadcaster error into a friendly reply', async () => {
  const broadcast = async () => { throw new Error('rpc down'); };
  const res = await runCommand('!tip @alice 5', { from: 'tipper', broadcast });
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'broadcast-error');
  assert.match(res.reply, /try again/i);
});

// ── fromChainEvent renders a tip + a welcome event ────────────────────────────────────────────────

test('fromChainEvent renders a tip transfer', () => {
  const line = fromChainEvent(['transfer', { from: 'alice', to: 'bob', amount: '5.000 TESTS', memo: 'Discord tip from @alice via Hathor bridge' }]);
  assert.match(line, /alice tipped/);
  assert.match(line, /@bob/);
  assert.match(line, /5.000 TESTS/);
});

test('fromChainEvent renders a welcome grant and a delegate', () => {
  const grant = fromChainEvent(['transfer', { from: 'hathor', to: 'newbie', amount: '10.000 TESTS', memo: 'Welcome to MELEK' }]);
  assert.match(grant, /granted 10.000 TESTS to @newbie/);
  const deleg = fromChainEvent(['delegate_vesting_shares', { delegator: 'hathor', delegatee: 'newbie', vesting_shares: '200.000000 VESTS' }]);
  assert.match(deleg, /delegated POWER to @newbie/);
});

test('fromChainEvent renders a welcome ping comment', () => {
  const line = fromChainEvent(['comment', {
    parent_author: 'hathor', author: 'hathor', permlink: 'welcome-newbie-12345',
    json_metadata: JSON.stringify({ tags: ['welcome'] }),
  }]);
  assert.match(line, /welcomed @newbie/);
});

test('fromChainEvent accepts a history-row shape and ignores irrelevant ops', () => {
  const row = { op: ['transfer', { from: 'x', to: 'y', amount: '1.000 TESTS', memo: 'tip' }] };
  assert.match(fromChainEvent(row), /tipped/);
  // non-TESTS transfer is ignored
  assert.equal(fromChainEvent(['transfer', { from: 'x', to: 'y', amount: '1.000 HIVE', memo: 'tip' }]), null);
  // vote op is not surfaced
  assert.equal(fromChainEvent(['vote', { voter: 'x' }]), null);
  assert.equal(fromChainEvent(null), null);
  assert.equal(fromChainEvent('garbage'), null);
});

// ── unknown command soft-fails ────────────────────────────────────────────────────────────────────

test('unknown command soft-fails (toChainOp + runCommand)', async () => {
  const plan = toChainOp(parseCommand('!frobnicate now'), {});
  assert.equal(plan.ok, false);
  assert.match(plan.error, /unknown command/);

  const res = await runCommand('!frobnicate now', {});
  assert.equal(res.ok, false);
  assert.equal(res.kind, 'error');
});

// ── esc / makeBridge smoke ────────────────────────────────────────────────────────────────────────

test('esc escapes HTML-significant characters', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
});

test('makeBridge routes a message through to a reply, never throwing', async () => {
  const replies = [];
  const broadcast = async () => ({ id: 'tx1' });
  const bridge = makeBridge({ broadcast, resolveAccount: async () => 'tipper' });
  const res = await bridge.onMessage({ content: '!tip @alice 5', authorId: 'd1', reply: async (t) => replies.push(t) });
  assert.equal(res.kind, 'write');
  assert.equal(replies.length, 1);
  assert.match(replies[0], /alice/);
});

test('makeBridge onChainEvent posts a surfaced line to the injected discord client', async () => {
  const sent = [];
  const discord = { send: async (ch, t) => sent.push({ ch, t }) };
  const bridge = makeBridge({ discord, channelId: 'C1' });
  const line = await bridge.onChainEvent(['transfer', { from: 'a', to: 'b', amount: '2.000 TESTS', memo: 'tip' }]);
  assert.match(line, /tipped/);
  assert.equal(sent[0].ch, 'C1');
});

test('makeBridge ignores non-command messages', async () => {
  const bridge = makeBridge({});
  const res = await bridge.onMessage({ content: 'just chatting', authorId: 'd1', reply: async () => {} });
  assert.equal(res, null);
});
