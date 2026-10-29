// soapbox-delegation-relayer.test.mjs — OFFLINE. Injected fetch, no network, no keys, BigInt only.
import { test } from 'node:test';
import assert from 'node:assert';
import {
  vestsUnits, toDmpWei, dmpIntents, listInboundDelegations, plan, __setFetch, SCALE,
} from './soapbox-delegation-relayer.mjs';

/** A fake RPC that serves pages of delegations. */
function fakeChain(rows, { pageSize = 1000, fail = false } = {}) {
  return async (_url, init) => {
    if (fail) throw new Error('network down');
    const body = JSON.parse(init.body);
    const { start, limit } = body.params;
    const l = Math.min(limit, pageSize);
    let i = 0;
    if (start && start[0]) {
      i = rows.findIndex((r) => r.delegator === start[0] && r.delegatee === start[1]);
      i = i < 0 ? rows.length : i + 1;
    }
    return { json: async () => ({ jsonrpc: '2.0', id: 1, result: { delegations: rows.slice(i, i + l) } }) };
  };
}
const row = (delegator, delegatee, vests) => ({ delegator, delegatee, vesting_shares: vests });

test('VESTS strings, objects and odd precision all become integer units', () => {
  assert.equal(vestsUnits('12.345678 VESTS'), 12345678n);
  assert.equal(vestsUnits('0.050000 VESTS'), 50000n);
  assert.equal(vestsUnits('5 VESTS'), 5000000n);
  assert.equal(vestsUnits({ amount: '50000', precision: 6 }), 50000n);
  assert.equal(vestsUnits({ amount: '50000000', precision: 9 }), 50000n, 'higher precision scaled down');
  assert.equal(vestsUnits({ amount: '50', precision: 3 }), 50000n, 'lower precision scaled up');
  // garbage and negatives are refused, not thrown
  for (const bad of [null, undefined, '', 'abc', '-5 VESTS', {}, NaN]) assert.equal(vestsUnits(bad), 0n);
});

test('VESTS units scale to dMP wei without float', () => {
  assert.equal(SCALE, 10n ** 12n);
  assert.equal(toDmpWei(12345678n), 12345678n * 10n ** 12n);
  assert.equal(toDmpWei(0n), 0n);
  // a big delegation stays exact — the thing a float would ruin
  assert.equal(toDmpWei(123456789012345n), 123456789012345n * 10n ** 12n);
});

test('only delegations pointed at the target account are picked up', async () => {
  __setFetch(fakeChain([
    row('alice', 'kula', '10.000000 VESTS'),
    row('bob', 'someoneelse', '99.000000 VESTS'),
    row('carol', 'kula', '2.500000 VESTS'),
    row('dave', 'KULA', '1.000000 VESTS'),          // case-insensitive delegatee
  ]));
  const m = await listInboundDelegations('kula');
  assert.deepEqual([...m.keys()].sort(), ['alice', 'carol', 'dave']);
  assert.equal(m.get('alice'), 10000000n);
  assert.equal(m.get('carol'), 2500000n);
  __setFetch(null);
});

test('pagination walks every page and does not loop forever', async () => {
  const rows = [];
  for (let i = 0; i < 250; i += 1) rows.push(row(`acct${String(i).padStart(3, '0')}`, 'kula', '1.000000 VESTS'));
  __setFetch(fakeChain(rows, { pageSize: 100 }));
  const m = await listInboundDelegations('kula', { pageLimit: 100 });
  assert.equal(m.size, 250);
  __setFetch(null);
});

test('a zero delegation is not a delegator', async () => {
  __setFetch(fakeChain([row('alice', 'kula', '0.000000 VESTS'), row('bob', 'kula', '1.000000 VESTS')]));
  const m = await listInboundDelegations('kula');
  assert.deepEqual([...m.keys()], ['bob']);
  __setFetch(null);
});

test('a dead RPC returns an empty ledger rather than throwing', async () => {
  __setFetch(fakeChain([], { fail: true }));
  const m = await listInboundDelegations('kula');
  assert.equal(m.size, 0);
  const p = await plan({ target: 'kula' });
  assert.equal(p.ok, true);
  assert.equal(p.delegators, 0);
  assert.deepEqual(p.mints, []);
  __setFetch(null);
});

test('a new delegation mints exactly its dMP', () => {
  const r = dmpIntents({
    inbound: new Map([['alice', 10000000n]]),
    issued: new Map(),
    wallets: new Map([['alice', '0xAAA']]),
  });
  assert.equal(r.mints.length, 1);
  assert.equal(r.mints[0].to, '0xAAA');
  assert.equal(r.mints[0].amountWei, (10000000n * SCALE).toString());
  assert.equal(r.burns.length, 0);
});

test('an increased delegation mints only the difference', () => {
  const r = dmpIntents({
    inbound: new Map([['alice', 10000000n]]),
    issued: new Map([['alice', (4000000n * SCALE).toString()]]),
    wallets: new Map([['alice', '0xAAA']]),
  });
  assert.equal(r.mints.length, 1);
  assert.equal(r.mints[0].amountWei, (6000000n * SCALE).toString());
});

test('a withdrawn delegation burns the dMP back', () => {
  const r = dmpIntents({
    inbound: new Map(),
    issued: new Map([['alice', (10000000n * SCALE).toString()]]),
    wallets: new Map([['alice', '0xAAA']]),
  });
  assert.equal(r.mints.length, 0);
  assert.equal(r.burns.length, 1);
  assert.equal(r.burns[0].from, '0xAAA');
  assert.equal(r.burns[0].amountWei, (10000000n * SCALE).toString());
});

test('an unchanged delegation produces no transaction at all', () => {
  const r = dmpIntents({
    inbound: new Map([['alice', 10000000n]]),
    issued: new Map([['alice', (10000000n * SCALE).toString()]]),
    wallets: new Map([['alice', '0xAAA']]),
  });
  assert.equal(r.mints.length, 0);
  assert.equal(r.burns.length, 0);
  assert.equal(r.unchanged, 1);
});

test('a delegator with no linked wallet is reported, never silently dropped', () => {
  const r = dmpIntents({
    inbound: new Map([['alice', 10000000n], ['bob', 5000000n]]),
    issued: new Map(),
    wallets: new Map([['alice', '0xAAA']]),
  });
  assert.equal(r.mints.length, 1);
  assert.deepEqual(r.unlinked, ['bob'], 'bob is owed ALTI and must be surfaced');
});

test('the total delegated is reported exactly, in wei', () => {
  const r = dmpIntents({
    inbound: new Map([['alice', 10000000n], ['bob', 2500000n]]),
    issued: new Map(),
    wallets: new Map([['alice', '0xA'], ['bob', '0xB']]),
  });
  assert.equal(r.totalDelegatedWei, ((10000000n + 2500000n) * SCALE).toString());
});

test('a corrupt issued balance is treated as zero rather than throwing', () => {
  const r = dmpIntents({
    inbound: new Map([['alice', 1000000n]]),
    issued: new Map([['alice', 'not-a-number']]),
    wallets: new Map([['alice', '0xAAA']]),
  });
  assert.equal(r.mints.length, 1, 'mints the full amount instead of crashing');
});

test('intents are deterministic in account order', () => {
  const mk = () => dmpIntents({
    inbound: new Map([['zoe', 1000000n], ['alice', 1000000n], ['mike', 1000000n]]),
    issued: new Map(),
    wallets: new Map([['zoe', '0xZ'], ['alice', '0xA'], ['mike', '0xM']]),
  });
  assert.deepEqual(mk().mints.map((m) => m.account), ['alice', 'mike', 'zoe']);
  assert.deepEqual(mk(), mk());
});
