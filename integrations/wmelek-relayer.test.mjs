// wmelek-relayer.test.mjs — offline. Pure derivation: deposit detection, depositRef
// determinism, recipient/memo handling, amount precision (3dp L1 == 3dp WMELEK), the
// custom_json mint-op shape, idempotency/replay planning, and soft-fail. No network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseDepositIntent, deriveDeposit, scanDeposits, buildMintOp, planMint,
  normalizeAmount, parseRecipient, isFinal, isValidAccount,
  MELEK_NATIVE_DECIMALS, WMELEK_DECIMALS, DEFAULT_CUSTODY_ACCOUNT,
} from './wmelek-relayer.mjs';

const CUSTODY = 'wmelek-bridge';
const SIDECHAIN = 'mse-mainnet-melek';
const BRIDGE = 'hathor';

// Build a normalized history entry. `over` may set trxId/block and/or a full `op`.
const entry = (over = {}) => ({
  trxId: over.trxId || 'tx-deadbeef',
  block: over.block ?? 10,
  op: over.op || { type: 'transfer', from: 'alice', to: CUSTODY, amount: '1.234 MELEK', memo: 'bob' },
});

// ---- precision: L1 native 3dp == WMELEK 3dp, 1:1 no scaling -----------------

test('precision constants match the wrapper (both 3dp, no scaling)', () => {
  assert.equal(MELEK_NATIVE_DECIMALS, 3);
  assert.equal(WMELEK_DECIMALS, 3);
});

test('normalizeAmount passes valid 3dp amounts unchanged (1:1)', () => {
  assert.deepEqual(normalizeAmount('1.234'), { ok: true, amount: '1.234' });
  assert.deepEqual(normalizeAmount('5'), { ok: true, amount: '5' });
  assert.deepEqual(normalizeAmount('0.001'), { ok: true, amount: '0.001' });
});

test('normalizeAmount rejects >3dp precision (would truncate on the engine)', () => {
  const r = normalizeAmount('1.2345');
  assert.equal(r.ok, false);
  assert.match(r.reason, /precision/);
});

test('normalizeAmount rejects zero, negative, and junk', () => {
  assert.equal(normalizeAmount('0').ok, false);
  assert.equal(normalizeAmount('0.000').ok, false);
  assert.equal(normalizeAmount('-1').ok, false);
  assert.equal(normalizeAmount('abc').ok, false);
  assert.equal(normalizeAmount(null).ok, false);
});

// ---- recipient / memo convention -------------------------------------------

test('parseRecipient: memo names the engine recipient', () => {
  assert.deepEqual(parseRecipient('bob', 'alice'), { ok: true, recipient: 'bob' });
  assert.deepEqual(parseRecipient('@bob', 'alice'), { ok: true, recipient: 'bob' }); // strips leading @
});

test('parseRecipient: blank memo credits the depositor', () => {
  assert.deepEqual(parseRecipient('', 'alice'), { ok: true, recipient: 'alice' });
  assert.deepEqual(parseRecipient('   ', 'alice'), { ok: true, recipient: 'alice' });
});

test('parseRecipient: a non-blank invalid memo fails closed (no silent fallback)', () => {
  const r = parseRecipient('not a valid acct!', 'alice');
  assert.equal(r.ok, false);
});

test('isValidAccount accepts the default custody name and rejects junk', () => {
  assert.equal(isValidAccount(DEFAULT_CUSTODY_ACCOUNT), true);
  assert.equal(isValidAccount('hathor'), true);
  assert.equal(isValidAccount('AB'), false);
  assert.equal(isValidAccount('0x1234'), false);
  assert.equal(isValidAccount(''), false);
});

// ---- parseDepositIntent -----------------------------------------------------

test('parseDepositIntent: a native transfer is a valid deposit', () => {
  const r = parseDepositIntent({ type: 'transfer', from: 'alice', to: CUSTODY, amount: '1.234 MELEK', memo: 'bob' });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'transfer');
  assert.equal(r.to, CUSTODY);
  assert.equal(r.from, 'alice');
  assert.equal(r.recipient, 'bob');
  assert.equal(r.amount, '1.234');
  assert.equal(r.asset, 'MELEK');
});

test('parseDepositIntent: custom_json is REJECTED (value not provable from the op — wLEO hazard)', () => {
  const r = parseDepositIntent({ type: 'custom_json', from: 'alice', amount: '999', memo: 'bob' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /only native transfer/);
});

test('parseDepositIntent: junk soft-fails', () => {
  assert.equal(parseDepositIntent(null).ok, false);
  assert.equal(parseDepositIntent({ type: 'transfer', amount: 'bad' }).ok, false);
});

// ---- deriveDeposit: custody binding + depositRef determinism ----------------

test('deriveDeposit binds custody and uses the L1 tx id as depositRef', () => {
  const r = deriveDeposit(entry(), { custodyAccount: CUSTODY });
  assert.equal(r.ok, true);
  assert.equal(r.deposit.depositRef, 'tx-deadbeef');
  assert.equal(r.deposit.recipient, 'bob');
  assert.equal(r.deposit.amount, '1.234');
  assert.equal(r.deposit.blockNum, 10);
});

test('deriveDeposit is DETERMINISTIC — same entry yields the same depositRef', () => {
  const a = deriveDeposit(entry(), { custodyAccount: CUSTODY });
  const b = deriveDeposit(entry(), { custodyAccount: CUSTODY });
  assert.equal(a.deposit.depositRef, b.deposit.depositRef);
});

test('deriveDeposit rejects a transfer NOT addressed to custody', () => {
  const r = deriveDeposit(entry({ op: { type: 'transfer', from: 'alice', to: 'someoneelse', amount: '1.000 MELEK', memo: 'bob' } }), { custodyAccount: CUSTODY });
  assert.equal(r.ok, false);
  assert.match(r.reason, /custody/);
});

test('deriveDeposit needs a custody account configured', () => {
  const r = deriveDeposit(entry(), {});
  assert.equal(r.ok, false);
  assert.match(r.reason, /custody/);
});

test('deriveDeposit needs a tx id', () => {
  const r = deriveDeposit({ block: 10, op: { type: 'transfer', from: 'alice', to: CUSTODY, amount: '1.000 MELEK' } }, { custodyAccount: CUSTODY });
  assert.equal(r.ok, false);
  assert.match(r.reason, /deposit-ref/);
});

// ---- scanDeposits -----------------------------------------------------------

test('scanDeposits separates good deposits from a skip log', () => {
  const history = [
    entry({ trxId: 'a', op: { type: 'transfer', from: 'alice', to: CUSTODY, amount: '1.000 MELEK', memo: 'bob' } }),
    entry({ trxId: 'b', op: { type: 'transfer', from: 'x', to: 'other', amount: '1.000 MELEK', memo: 'bob' } }), // wrong custody
    entry({ trxId: 'c', op: { type: 'custom_json', from: 'x', amount: '1' } }),                                   // not a transfer
  ];
  const { deposits, skipped } = scanDeposits(history, { custodyAccount: CUSTODY });
  assert.equal(deposits.length, 1);
  assert.equal(deposits[0].depositRef, 'a');
  assert.equal(skipped.length, 2);
});

test('scanDeposits soft-handles non-array', () => {
  const { deposits, skipped } = scanDeposits(null, { custodyAccount: CUSTODY });
  assert.deepEqual(deposits, []);
  assert.deepEqual(skipped, []);
});

// ---- isFinal ----------------------------------------------------------------

test('isFinal gates on confirmation depth', () => {
  assert.equal(isFinal({ blockNum: 10 }, 100, 20), true);
  assert.equal(isFinal({ blockNum: 99 }, 100, 20), false);
  assert.equal(isFinal({ blockNum: 10 }, null, 20), false);
  assert.equal(isFinal({}, 100, 20), false);
});

// ---- buildMintOp: the custom_json mint op shape -----------------------------

test('buildMintOp produces the exact bridge.mintWrapped custom_json', () => {
  const dep = { depositRef: 'tx-deadbeef', recipient: 'bob', amount: '1.234' };
  const r = buildMintOp(dep, { bridgeAccount: BRIDGE, sidechainId: SIDECHAIN });
  assert.equal(r.ok, true);
  assert.equal(r.unsigned, true);
  const [kind, payload] = r.op;
  assert.equal(kind, 'custom_json');
  assert.deepEqual(payload.required_auths, [BRIDGE]);
  assert.deepEqual(payload.required_posting_auths, []);
  assert.equal(payload.id, SIDECHAIN);
  const env = JSON.parse(payload.json);
  assert.equal(env.contractName, 'bridge');
  assert.equal(env.contractAction, 'mintWrapped');
  assert.deepEqual(env.contractPayload, { to: 'bob', amount: '1.234', depositRef: 'tx-deadbeef' });
});

test('buildMintOp rejects a bad recipient / amount / bridge account', () => {
  assert.equal(buildMintOp({ depositRef: 't', recipient: '0xbad', amount: '1.0' }, { bridgeAccount: BRIDGE, sidechainId: SIDECHAIN }).ok, false);
  assert.equal(buildMintOp({ depositRef: 't', recipient: 'bob', amount: '1.2345' }, { bridgeAccount: BRIDGE, sidechainId: SIDECHAIN }).ok, false);
  assert.equal(buildMintOp({ depositRef: 't', recipient: 'bob', amount: '1.0' }, { bridgeAccount: 'X', sidechainId: SIDECHAIN }).ok, false);
  assert.equal(buildMintOp({ recipient: 'bob', amount: '1.0' }, { bridgeAccount: BRIDGE, sidechainId: SIDECHAIN }).ok, false);
});

// ---- planMint: idempotency / replay guard -----------------------------------

test('planMint builds a mint op for a fresh deposit', () => {
  const dep = { depositRef: 'tx1', recipient: 'bob', amount: '1.000' };
  const p = planMint(dep, { bridgeAccount: BRIDGE, sidechainId: SIDECHAIN });
  assert.equal(p.action, 'mint');
  assert.ok(p.op);
});

test('planMint SKIPS a deposit already minted on the engine (replay guard)', () => {
  const dep = { depositRef: 'tx1', recipient: 'bob', amount: '1.000' };
  const p = planMint(dep, { minted: true, bridgeAccount: BRIDGE, sidechainId: SIDECHAIN });
  assert.equal(p.action, 'skip');
  assert.match(p.reason, /already-minted/);
});

test('planMint SKIPS a deposit this instance already broadcast', () => {
  const dep = { depositRef: 'tx1', recipient: 'bob', amount: '1.000' };
  const p = planMint(dep, { seenByMe: true, bridgeAccount: BRIDGE, sidechainId: SIDECHAIN });
  assert.equal(p.action, 'skip');
  assert.match(p.reason, /already-broadcast/);
});

test('planMint soft-fails on an invalid deposit', () => {
  assert.equal(planMint(null).action, 'skip');
  assert.equal(planMint({}).action, 'skip');
});
