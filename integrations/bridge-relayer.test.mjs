// bridge-relayer.test.mjs — offline tests for the MELEK->PRANA relayer logic (BI8).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isPranaAddress, scaleAmount, parseDestination, parseDepositIntent, deriveDeposit,
  scanDeposits, isFinal, attestationCall, planAttestation, parseWithdrawal, planRelease,
  relayerManifest,
} from './bridge-relayer.mjs';

const ADDR = '0x1234567890abcdef1234567890abcdef12345678';
const CUSTODY = 'melek-bridge';

test('isPranaAddress accepts only 0x+40hex', () => {
  assert.equal(isPranaAddress(ADDR), true);
  assert.equal(isPranaAddress('0x1234'), false);
  assert.equal(isPranaAddress('1234567890abcdef1234567890abcdef12345678'), false);
  assert.equal(isPranaAddress(null), false);
  assert.equal(isPranaAddress(ADDR + 'ff'), false);
});

test('scaleAmount converts 3->18 decimals 1:1 with no float loss', () => {
  assert.equal(scaleAmount('1.234'), '1234000000000000000');
  assert.equal(scaleAmount('1'), '1000000000000000000');
  assert.equal(scaleAmount('0.001'), '1000000000000000');
  assert.equal(scaleAmount('1000000.5'), '1000000500000000000000000');
  assert.equal(scaleAmount('0'), '0');
});

test('scaleAmount rejects garbage and lossy down-scaling', () => {
  assert.equal(scaleAmount('abc'), null);
  assert.equal(scaleAmount(''), null);
  assert.equal(scaleAmount(null), null);
  assert.equal(scaleAmount('1.5', 18, 3), null); // refuse lossy direction
});

test('parseDestination reads memo and custom_json; rejects bad/missing dst', () => {
  assert.deepEqual(parseDestination({ memo: ADDR }), { ok: true, recipient: ADDR, tokenId: undefined });
  assert.equal(parseDestination({ memo: `send ${ADDR} TOKEN=MELEK now` }).tokenId, 'MELEK');
  assert.deepEqual(
    parseDestination({ json: { dst: ADDR, token: 'GOLD' } }),
    { ok: true, recipient: ADDR, tokenId: 'GOLD' },
  );
  assert.equal(parseDestination({ json: JSON.stringify({ to: ADDR }) }).recipient, ADDR);
  assert.equal(parseDestination({ memo: 'no address here' }).ok, false);
  assert.equal(parseDestination({ memo: '0xdeadbeef' }).ok, false); // too short -> invalid
});

test('parseDepositIntent: transfer with memo destination', () => {
  const r = parseDepositIntent({ type: 'transfer', payload: { to: CUSTODY, amount: '2.500 MELEK', memo: ADDR } });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'transfer');
  assert.equal(r.recipient, ADDR);
  assert.equal(r.amount, '2500000000000000000');
  assert.equal(r.asset, 'MELEK');
});

test('parseDepositIntent: custom_json deposit op', () => {
  const r = parseDepositIntent({
    type: 'custom_json',
    payload: { json: JSON.stringify({ dst: ADDR, symbol: 'MELEK', amount: '10', custody: CUSTODY }) },
  });
  assert.equal(r.ok, true);
  assert.equal(r.source, 'custom_json');
  assert.equal(r.amount, '10000000000000000000');
  assert.equal(r.tokenId, undefined); // the asset symbol is NOT the tokenId (it's the `asset`)
  assert.equal(r.asset, 'MELEK');
});

test('parseDepositIntent rejects unsupported ops and bad amounts', () => {
  assert.equal(parseDepositIntent({ type: 'vote', payload: {} }).ok, false);
  assert.equal(parseDepositIntent({ type: 'transfer', payload: { to: CUSTODY, amount: 'lots MELEK', memo: ADDR } }).ok, false);
  assert.equal(parseDepositIntent(null).ok, false);
});

test('deriveDeposit binds custody + depositRef and rejects wrong custody', () => {
  const entry = { trxId: 'abc123', blockNum: 100, op: { type: 'transfer', payload: { to: CUSTODY, amount: '1.000 MELEK', memo: ADDR } } };
  const r = deriveDeposit(entry, { custodyAccount: CUSTODY });
  assert.equal(r.ok, true);
  assert.equal(r.deposit.depositRef, '0x' + 'abc123'.padStart(64, '0')); // tx id left-padded to bytes32
  assert.equal(r.deposit.tokenId, 'MELEK'); // no defaultTokenId here -> asset is the last-resort fallback
  assert.equal(r.deposit.recipient, ADDR);
  assert.equal(r.deposit.amount, '1000000000000000000');

  const wrong = deriveDeposit({ ...entry, op: { type: 'transfer', payload: { to: 'someone-else', amount: '1.000 MELEK', memo: ADDR } } }, { custodyAccount: CUSTODY });
  assert.equal(wrong.ok, false);
  assert.match(wrong.reason, /custody/);
});

test('SECURITY: a forged custom_json deposit cannot inject a fake wrapped mint (wLEO class)', () => {
  // Attack: a custom_json is a FREE op that moves no value; the attacker writes the custody account + a
  // huge amount into the JSON they fully control. It must NOT become an attestable deposit.
  const forged = {
    trxId: 'deadbeef', blockNum: 200,
    op: { type: 'custom_json', payload: { json: JSON.stringify({ dst: ADDR, symbol: 'MELEK', amount: '1000000', custody: CUSTODY }) } },
  };
  const r = deriveDeposit(forged, { custodyAccount: CUSTODY, defaultTokenId: 'MELEK' });
  assert.equal(r.ok, false, 'forged custom_json deposit must be rejected');
  assert.match(r.reason, /custom_json/);
  // scanDeposits drops it to the skip log, never the deposits list...
  const { deposits, skipped } = scanDeposits([forged], { custodyAccount: CUSTODY, defaultTokenId: 'MELEK' });
  assert.equal(deposits.length, 0);
  assert.ok(skipped.some((s) => /custom_json/.test(s.reason)));
  // ...while a REAL native transfer to custody still mints (the live wMELEK path is unaffected).
  const real = scanDeposits(
    [{ trxId: 't', blockNum: 10, op: { type: 'transfer', payload: { to: CUSTODY, amount: '1.000 MELEK', memo: ADDR } } }],
    { custodyAccount: CUSTODY },
  );
  assert.equal(real.deposits.length, 1);
});

test('deriveDeposit requires a depositRef and a tokenId', () => {
  assert.equal(deriveDeposit({ blockNum: 1, op: { type: 'transfer', payload: { to: CUSTODY, amount: '1.000 MELEK', memo: ADDR } } }, { custodyAccount: CUSTODY }).ok, false);
  // transfer asset supplies tokenId, so to test the missing-token path use a custom_json with no symbol/token
  const noTok = deriveDeposit(
    { trxId: 'x', blockNum: 1, op: { type: 'custom_json', payload: { json: { dst: ADDR, amount: '1', custody: CUSTODY } } } },
    { custodyAccount: CUSTODY },
  );
  assert.equal(noTok.ok, false);
  assert.match(noTok.reason, /token/);
});

test('scanDeposits splits valid deposits from skips', () => {
  const hist = [
    { trxId: 't1', blockNum: 10, op: { type: 'transfer', payload: { to: CUSTODY, amount: '1.000 MELEK', memo: ADDR } } },
    { trxId: 't2', blockNum: 11, op: { type: 'vote', payload: {} } },
    { trxId: 't3', blockNum: 12, op: { type: 'transfer', payload: { to: 'nope', amount: '1.000 MELEK', memo: ADDR } } },
  ];
  const { deposits, skipped } = scanDeposits(hist, { custodyAccount: CUSTODY });
  assert.equal(deposits.length, 1);
  assert.equal(deposits[0].depositRef, 't1');
  assert.equal(skipped.length, 2);
  assert.equal(scanDeposits(null, {}).deposits.length, 0);
});

test('isFinal enforces the confirmation depth', () => {
  assert.equal(isFinal({ blockNum: 100 }, 119, 20), false);
  assert.equal(isFinal({ blockNum: 100 }, 120, 20), true);
  assert.equal(isFinal({ blockNum: 0 }, 100, 20), false);
  assert.equal(isFinal({}, 100, 20), false);
});

test('attestationCall is an unsigned descriptor with the right args', () => {
  const c = attestationCall({ depositRef: 'r', tokenId: 'MELEK', recipient: ADDR, amount: '5' });
  assert.equal(c.method, 'attestDeposit');
  assert.equal(c.unsigned, true);
  assert.deepEqual(c.args, ['r', 'MELEK', ADDR, '5']);
});

test('planAttestation: idempotency + replay + mismatch', () => {
  const dep = { depositRef: 'r', tokenId: 'MELEK', recipient: ADDR, amount: '5' };
  assert.equal(planAttestation(dep, {}).action, 'attest');
  assert.equal(planAttestation(dep, { processed: true }).action, 'skip');
  assert.equal(planAttestation(dep, { attestedByMe: true }).action, 'skip');
  // same tuple already fixed -> still attest (we agree)
  assert.equal(planAttestation(dep, { fixedTuple: { tokenId: 'MELEK', recipient: ADDR.toUpperCase(), amount: '5' } }).action, 'attest');
  // different tuple fixed -> mismatch
  assert.equal(planAttestation(dep, { fixedTuple: { tokenId: 'MELEK', recipient: ADDR, amount: '6' } }).action, 'mismatch');
  assert.equal(planAttestation(null, {}).action, 'skip');
});

test('parseWithdrawal handles object and array event args', () => {
  const obj = parseWithdrawal({ args: { nonce: 7, tokenId: 'MELEK', from: ADDR, amount: '5', destinationRef: 'melek-user' } });
  assert.equal(obj.ok, true);
  assert.equal(obj.nonce, '7');
  assert.equal(obj.destinationRef, 'melek-user');
  const arr = parseWithdrawal([7, 'MELEK', ADDR, '0xwrapped', '5', 'melek-user']);
  assert.equal(arr.ok, true);
  assert.equal(arr.amount, '5');
  assert.equal(parseWithdrawal({ args: { tokenId: 'x' } }).ok, false);
});

test('planRelease is once-per-nonce and waits for confirmation', () => {
  const ev = { args: { nonce: 9, tokenId: 'MELEK', from: ADDR, amount: '5', destinationRef: 'melek-user' } };
  const ok = planRelease(ev, { confirmed: true });
  assert.equal(ok.action, 'release');
  assert.equal(ok.intent.to, 'melek-user');
  assert.equal(ok.intent.replayKey, 'prana-withdrawal-nonce:9');
  assert.equal(ok.intent.unsigned, true);
  assert.equal(planRelease(ev, { confirmed: false }).action, 'skip');
  assert.equal(planRelease(ev, { releasedNonces: ['9'] }).action, 'skip');
  assert.equal(planRelease(ev, { releasedNonces: new Set(['9']) }).action, 'skip');
});

test('relayerManifest exposes env names + boundary, no secrets', () => {
  const m = relayerManifest();
  assert.equal(m.env.melekRpc.name, 'MELEK_RPC_URL');
  assert.equal(m.env.bridgeAddress.name, 'GRAPHENE_BRIDGE_ADDRESS');
  assert.match(m.boundary, /SIGNS nothing/);
  assert.equal(typeof m.live, 'boolean');
});

import { toBytes32Hex } from './bridge-relayer.mjs';
test('toBytes32Hex: pads a Graphene tx id to bytes32; passes a hash through; rejects non-hex', () => {
  assert.equal(toBytes32Hex('abc123'), '0x' + 'abc123'.padStart(64, '0'));
  assert.equal(toBytes32Hex('0x' + 'ab'.repeat(32)), '0x' + 'ab'.repeat(32)); // 32-byte hash unchanged
  assert.equal(toBytes32Hex('MELEK'), null);   // a plain name is not hex
  assert.equal(toBytes32Hex('0x' + 'a'.repeat(65)), null); // > 32 bytes
});
