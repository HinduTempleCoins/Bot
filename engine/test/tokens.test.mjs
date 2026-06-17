/**
 * tokens.test.mjs (sibling, contracts/) — offline unit test for the
 * Melek-Engine tokens contract `tokens.mjs`.
 *
 * Fully offline + deterministic: no network, no clock, no randomness. Uses the
 * real engine State + genesis bootstrap (in-memory) which mints 1,000,000 APIS
 * and 1,000,000 DRONE to the genesis issuer `hathor`. Each exported action gets
 * a happy path and an edge/empty case; soft-fail handlers are asserted to NOT
 * throw and to return { ok: false, error }.
 *
 * Run: node --test engine/contracts/tokens.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { State } from '../lib/state.mjs';
import { bootstrapGenesis } from '../lib/genesis.mjs';
import { tokens, burnFee } from '../contracts/tokens.mjs';
import { fromBaseUnits } from '../lib/decimal.mjs';

function fresh() {
  const s = new State(null);
  bootstrapGenesis(s);
  return s;
}

function ctx(sender, blockNum = 1) {
  return { sender, blockNum, blockId: 'b', txId: 't', authLevel: 'active' };
}

const balOf = (s, account, symbol, precision = 3) => {
  const row = s.findOne('balances', { account, symbol });
  return row ? fromBaseUnits(BigInt(row.balance), precision) : null;
};

// Give `account` enough APIS to cover the 100-APIS creation fee + extras.
function fundAPIS(s, account, quantity = '500') {
  const r = tokens.transfer(s, ctx('hathor'), { symbol: 'APIS', to: account, quantity });
  assert.ok(r.ok, r.error);
}

test('a transfer to the bridge custody is captured as a bridge deposit (with memo)', async () => {
  const s = fresh();
  const { config } = await import('../config.mjs');
  const custody = config.bridge.custody;
  const recipient = '0x' + '1'.repeat(40);
  const c = { sender: 'hathor', blockNum: 7, blockId: 'b', txId: 'deposit-tx-1', authLevel: 'active' };
  const r = tokens.transfer(s, c, { symbol: 'APIS', to: custody, quantity: '12.5', memo: recipient });
  assert.ok(r.ok, r.error);
  const dep = s.findOne('bridgeDeposits', { txId: 'deposit-tx-1' });
  assert.ok(dep, 'deposit recorded');
  assert.equal(dep.symbol, 'APIS');
  assert.equal(dep.to, custody);
  assert.equal(dep.memo, recipient);
  assert.equal(dep.quantity, '12.500');
  assert.equal(dep.attested, false);
  // a normal transfer (not to custody) records NO deposit
  tokens.transfer(s, { ...c, txId: 'normal-tx' }, { symbol: 'APIS', to: 'bob', quantity: '1' });
  assert.equal(s.findOne('bridgeDeposits', { txId: 'normal-tx' }), null);
});

test('genesis bootstrap minted the native tokens to hathor', () => {
  const s = fresh();
  assert.equal(balOf(s, 'hathor', 'APIS'), '1000000.000');
  assert.equal(balOf(s, 'hathor', 'DRONE'), '1000000.000');
  assert.equal(s.findOne('tokens', { symbol: 'APIS' }).issuer, 'hathor');
});

test('create: happy path registers token + burns fee; edge cases rejected', () => {
  const s = fresh();
  fundAPIS(s, 'alice', '500');

  const before = BigInt(s.findOne('balances', { account: 'alice', symbol: 'APIS' }).balance);
  const r = tokens.create(s, ctx('alice'), {
    symbol: 'TRIBE',
    name: 'My Tribe',
    precision: 3,
    maxSupply: '1000000',
    url: 'https://x',
  });
  assert.ok(r.ok, r.error);
  assert.equal(r.created, 'TRIBE');
  const tok = s.findOne('tokens', { symbol: 'TRIBE' });
  assert.equal(tok.issuer, 'alice');
  assert.equal(tok.supply, '0');
  assert.equal(tok.maxSupply, '1000000000'); // 1,000,000 @ precision 3
  // the 100 APIS creation fee was burned from alice's balance
  const after = BigInt(s.findOne('balances', { account: 'alice', symbol: 'APIS' }).balance);
  assert.equal(before - after, 100000n);

  // edge: invalid symbol
  assert.equal(tokens.create(s, ctx('alice'), { symbol: 'bad-sym', precision: 0, maxSupply: '1' }).ok, false);
  // edge: duplicate
  const dup = tokens.create(s, ctx('alice'), { symbol: 'TRIBE', precision: 3, maxSupply: '1' });
  assert.equal(dup.ok, false);
  assert.match(dup.error, /already exists/);
  // edge: bad precision
  assert.equal(tokens.create(s, ctx('alice'), { symbol: 'PREC', precision: 9, maxSupply: '1' }).ok, false);
  // edge: maxSupply must be > 0
  assert.equal(tokens.create(s, ctx('alice'), { symbol: 'ZERO', precision: 0, maxSupply: '0' }).ok, false);
});

test('create: insufficient fee balance soft-fails (no token created)', () => {
  const s = fresh();
  // poor has no APIS; the 100 APIS fee burn must fail
  const r = tokens.create(s, ctx('poor'), { symbol: 'POOR', precision: 0, maxSupply: '10' });
  assert.equal(r.ok, false);
  assert.match(r.error, /insufficient APIS/);
  assert.equal(s.findOne('tokens', { symbol: 'POOR' }), null);
});

test('issue: issuer-only mint respects maxSupply + writes issuance log', () => {
  const s = fresh();
  fundAPIS(s, 'alice');
  tokens.create(s, ctx('alice'), { symbol: 'TRIBE', precision: 3, maxSupply: '1000' });

  const r = tokens.issue(s, ctx('alice'), { symbol: 'TRIBE', to: 'bob', quantity: '100' });
  assert.ok(r.ok, r.error);
  assert.equal(r.issued, '100.000');
  assert.equal(balOf(s, 'bob', 'TRIBE'), '100.000');
  assert.equal(s.findOne('tokens', { symbol: 'TRIBE' }).supply, '100000');
  const log = s.findOne('issuanceLog', { symbol: 'TRIBE', to: 'bob' });
  assert.ok(log);
  assert.equal(log.issuer, 'alice');

  // edge: non-issuer cannot issue
  const notIssuer = tokens.issue(s, ctx('mallory'), { symbol: 'TRIBE', to: 'bob', quantity: '1' });
  assert.equal(notIssuer.ok, false);
  assert.match(notIssuer.error, /only issuer/);

  // edge: no such token
  assert.equal(tokens.issue(s, ctx('alice'), { symbol: 'NOPE', to: 'bob', quantity: '1' }).ok, false);
  // edge: missing recipient
  assert.equal(tokens.issue(s, ctx('alice'), { symbol: 'TRIBE', to: '', quantity: '1' }).ok, false);
  // edge: would exceed maxSupply (1000 cap, 100 already issued)
  const over = tokens.issue(s, ctx('alice'), { symbol: 'TRIBE', to: 'bob', quantity: '1000' });
  assert.equal(over.ok, false);
  assert.match(over.error, /maxSupply/);
});

test('issue: immutable cap on DRONE can never be exceeded', () => {
  const s = fresh();
  // DRONE is supplyCapImmutable and already fully minted (1,000,000) at genesis
  const r = tokens.issue(s, ctx('hathor'), { symbol: 'DRONE', to: 'hathor', quantity: '1' });
  assert.equal(r.ok, false);
  assert.match(r.error, /immutable/);
});

test('transfer: happy path moves balance; edges rejected', () => {
  const s = fresh();
  fundAPIS(s, 'alice');
  tokens.create(s, ctx('alice'), { symbol: 'TRIBE', precision: 3, maxSupply: '1000000' });
  tokens.issue(s, ctx('alice'), { symbol: 'TRIBE', to: 'bob', quantity: '100' });

  const r = tokens.transfer(s, ctx('bob'), { symbol: 'TRIBE', to: 'carol', quantity: '40' });
  assert.ok(r.ok, r.error);
  assert.equal(r.transferred, '40.000');
  assert.equal(balOf(s, 'bob', 'TRIBE'), '60.000');
  assert.equal(balOf(s, 'carol', 'TRIBE'), '40.000');

  // edge: no such token
  assert.equal(tokens.transfer(s, ctx('bob'), { symbol: 'NOPE', to: 'carol', quantity: '1' }).ok, false);
  // edge: self transfer
  assert.equal(tokens.transfer(s, ctx('bob'), { symbol: 'TRIBE', to: 'bob', quantity: '1' }).ok, false);
  // edge: missing recipient
  assert.equal(tokens.transfer(s, ctx('bob'), { symbol: 'TRIBE', to: '', quantity: '1' }).ok, false);
  // edge: insufficient balance
  const broke = tokens.transfer(s, ctx('bob'), { symbol: 'TRIBE', to: 'carol', quantity: '1000' });
  assert.equal(broke.ok, false);
  assert.match(broke.error, /insufficient balance/);
});

test('stake / unstake: move between liquid and stake buckets; edges rejected', () => {
  const s = fresh();
  fundAPIS(s, 'alice');
  tokens.create(s, ctx('alice'), { symbol: 'TRIBE', precision: 3, maxSupply: '1000000' });
  tokens.issue(s, ctx('alice'), { symbol: 'TRIBE', to: 'bob', quantity: '100' });

  const st = tokens.stake(s, ctx('bob'), { symbol: 'TRIBE', quantity: '60' });
  assert.ok(st.ok, st.error);
  assert.equal(st.staked, '60.000');
  let row = s.findOne('balances', { account: 'bob', symbol: 'TRIBE' });
  assert.equal(row.balance, '40000');
  assert.equal(row.stake, '60000');

  // edge: cannot stake more than liquid balance
  const overStake = tokens.stake(s, ctx('bob'), { symbol: 'TRIBE', quantity: '1000' });
  assert.equal(overStake.ok, false);
  assert.match(overStake.error, /insufficient liquid/);

  const un = tokens.unstake(s, ctx('bob'), { symbol: 'TRIBE', quantity: '60' });
  assert.ok(un.ok, un.error);
  assert.equal(un.unstaked, '60.000');
  row = s.findOne('balances', { account: 'bob', symbol: 'TRIBE' });
  assert.equal(row.balance, '100000');
  assert.equal(row.stake, '0');

  // edge: unstake with nothing staked
  const nothing = tokens.unstake(s, ctx('carol'), { symbol: 'TRIBE', quantity: '1' });
  assert.equal(nothing.ok, false);
  assert.match(nothing.error, /nothing staked/);
  // edge: unstake more than staked
  tokens.stake(s, ctx('bob'), { symbol: 'TRIBE', quantity: '10' });
  const overUn = tokens.unstake(s, ctx('bob'), { symbol: 'TRIBE', quantity: '50' });
  assert.equal(overUn.ok, false);
  assert.match(overUn.error, /insufficient staked/);
  // edge: stake/unstake unknown token never throw
  assert.equal(tokens.stake(s, ctx('bob'), { symbol: 'NOPE', quantity: '1' }).ok, false);
  assert.equal(tokens.unstake(s, ctx('bob'), { symbol: 'NOPE', quantity: '1' }).ok, false);
});

test('burnFee: deducts fee + reduces circulating supply; insufficient soft-fails', () => {
  const s = fresh();
  fundAPIS(s, 'alice', '10');
  const before = BigInt(s.findOne('tokens', { symbol: 'APIS' }).circulatingSupply);

  const r = burnFee(s, 'alice', '5');
  assert.ok(r.ok, r.error);
  assert.equal(balOf(s, 'alice', 'APIS'), '5.000');
  const after = BigInt(s.findOne('tokens', { symbol: 'APIS' }).circulatingSupply);
  assert.equal(before - after, 5000n); // 5 APIS @ precision 3 burned
  assert.ok(s.findOne('burnLog', { account: 'alice' }));

  // edge: a zero fee is a no-op ok()
  assert.equal(burnFee(s, 'alice', '0').ok, true);

  // edge: insufficient balance soft-fails
  const broke = burnFee(s, 'alice', '100');
  assert.equal(broke.ok, false);
  assert.match(broke.error, /insufficient APIS/);
});
