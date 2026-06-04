// token-factory.test.mjs — OFFLINE node:test for the INTENT-ONLY token-minting tooling.
// No network, no keys, no broadcast. Proves: spec validation (good + rejected), deployIntent dormant
// vs configured (toggling PRANA_RPC_URL), mint schedule respects period + cap (incl. the cap boundary
// where minting stops), mintIntent defaults to dry-run and NEVER calls an injected signer in dry-run
// (but DOES call it only when `sign` is provided), and non-mintable rejection.
//
//   node --test integrations/token-factory.test.mjs

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  defineToken,
  deployIntent,
  makeMintSchedule,
  nextMint,
  mintIntent,
  makeSpySigner,
  TokenSpecError,
} from './token-factory.mjs';

// ---- 1. spec validation ----------------------------------------------------

test('defineToken: accepts a good spec and freezes it', () => {
  const spec = defineToken({ name: 'Prana', symbol: 'PRANA', decimals: 18, initialSupply: 1000, mintable: false });
  assert.equal(spec.kind, 'token-spec');
  assert.equal(spec.symbol, 'PRANA');
  assert.equal(spec.decimals, 18);
  assert.equal(spec.initialSupply, '1000');
  assert.equal(spec.mintable, false);
  assert.equal(spec.cap, null);
  assert.ok(Object.isFrozen(spec));
});

test('defineToken: decimals default to 18 and big string supply is lossless', () => {
  const big = '123456789012345678901234567890';
  const spec = defineToken({ name: 'Big', symbol: 'BIG', initialSupply: big });
  assert.equal(spec.decimals, 18);
  assert.equal(spec.initialSupply, big);
});

test('defineToken: rejects bad symbols', () => {
  assert.throws(() => defineToken({ name: 'X', symbol: 'has space', initialSupply: 1 }), TokenSpecError);
  assert.throws(() => defineToken({ name: 'X', symbol: '1ABC', initialSupply: 1 }), TokenSpecError); // leading digit
  assert.throws(() => defineToken({ name: 'X', symbol: 'A', initialSupply: 1 }), TokenSpecError); // too short
  assert.throws(() => defineToken({ name: 'X', symbol: 'TOOLONGSYMBOL', initialSupply: 1 }), TokenSpecError); // too long
});

test('defineToken: rejects bad decimals and negative/invalid supply', () => {
  assert.throws(() => defineToken({ name: 'X', symbol: 'ABC', decimals: -1, initialSupply: 1 }), TokenSpecError);
  assert.throws(() => defineToken({ name: 'X', symbol: 'ABC', decimals: 99, initialSupply: 1 }), TokenSpecError);
  assert.throws(() => defineToken({ name: 'X', symbol: 'ABC', decimals: 1.5, initialSupply: 1 }), TokenSpecError);
  assert.throws(() => defineToken({ name: 'X', symbol: 'ABC', initialSupply: -5 }), TokenSpecError);
  assert.throws(() => defineToken({ name: 'X', symbol: 'ABC', initialSupply: 'not-a-number' }), TokenSpecError);
  assert.throws(() => defineToken({ name: 'X', symbol: 'ABC' /* no supply */ }), TokenSpecError);
});

test('defineToken: cap must be >= initialSupply and only valid with mintable', () => {
  // cap < initial → reject
  assert.throws(
    () => defineToken({ name: 'X', symbol: 'ABC', initialSupply: 1000, mintable: true, cap: 500 }),
    TokenSpecError,
  );
  // cap on a fixed-supply token → reject (incoherent)
  assert.throws(
    () => defineToken({ name: 'X', symbol: 'ABC', initialSupply: 1000, mintable: false, cap: 2000 }),
    TokenSpecError,
  );
  // cap >= initial + mintable → ok
  const ok = defineToken({ name: 'X', symbol: 'ABC', initialSupply: 1000, mintable: true, cap: 2000 });
  assert.equal(ok.cap, '2000');
});

// ---- 2. deployIntent: dormant vs configured --------------------------------

test('deployIntent: dormant when PRANA_RPC_URL is unset, never broadcasts', () => {
  const saved = process.env.PRANA_RPC_URL;
  delete process.env.PRANA_RPC_URL;
  try {
    const spec = defineToken({ name: 'P', symbol: 'PRANA', initialSupply: 1, mintable: false });
    const intent = deployIntent(spec);
    assert.equal(intent.action, 'deploy');
    assert.equal(intent.chain, 'prana');
    assert.equal(intent.rpcConfigured, false);
    assert.equal(intent.broadcast, null);
    assert.equal(intent.dryRun, true);
    assert.ok(intent.chainId, 'chainId resolves to placeholder when env unset');
  } finally {
    if (saved === undefined) delete process.env.PRANA_RPC_URL;
    else process.env.PRANA_RPC_URL = saved;
  }
});

test('deployIntent: configured when PRANA_RPC_URL is set, still never broadcasts', () => {
  const savedRpc = process.env.PRANA_RPC_URL;
  const savedId = process.env.PRANA_CHAIN_ID;
  process.env.PRANA_RPC_URL = 'https://rpc.prana.example';
  process.env.PRANA_CHAIN_ID = '424242';
  try {
    const spec = defineToken({ name: 'P', symbol: 'PRANA', initialSupply: 1, mintable: false });
    const intent = deployIntent(spec, { deployer: '0xabc' });
    assert.equal(intent.rpcConfigured, true);
    assert.equal(intent.chainId, '424242');
    assert.equal(intent.broadcast, null); // configured does NOT mean broadcast
    assert.equal(intent.deployer, '0xabc');
    assert.equal(intent.deployerCaip, 'eip155:424242:0xabc');
  } finally {
    if (savedRpc === undefined) delete process.env.PRANA_RPC_URL; else process.env.PRANA_RPC_URL = savedRpc;
    if (savedId === undefined) delete process.env.PRANA_CHAIN_ID; else process.env.PRANA_CHAIN_ID = savedId;
  }
});

test('deployIntent: rejects a non-spec and a non-prana chain', () => {
  assert.throws(() => deployIntent({ not: 'a spec' }), TokenSpecError);
  const spec = defineToken({ name: 'P', symbol: 'PRANA', initialSupply: 1, mintable: false });
  assert.throws(() => deployIntent(spec, { chain: 'ethereum' }), TokenSpecError);
});

// ---- 3. mint schedule: period + cap ----------------------------------------

test('makeMintSchedule: rejects non-mintable token', () => {
  const fixed = defineToken({ name: 'F', symbol: 'FIX', initialSupply: 1000, mintable: false });
  assert.throws(() => makeMintSchedule({ token: fixed, perPeriodAmount: 10, periodSeconds: 100 }), TokenSpecError);
});

test('nextMint: respects the start gate and the period gate', () => {
  const token = defineToken({ name: 'M', symbol: 'MNT', initialSupply: 0, mintable: true, cap: 1000 });
  const sched = makeMintSchedule({ token, perPeriodAmount: 100, periodSeconds: 60, startTs: 1000 });

  // before start
  assert.deepEqual(nextMint(sched, 999, { mintedSoFar: '0' }).reason, 'before-start');

  // exactly at start, never minted → first mint allowed
  const first = nextMint(sched, 1000, { mintedSoFar: '0' });
  assert.equal(first.shouldMint, true);
  assert.equal(first.amount, '100');
  assert.equal(first.reason, 'period-elapsed');

  // just minted at t=1000; only 30s later → period not elapsed
  const tooSoon = nextMint(sched, 1030, { mintedSoFar: '100', lastMintTs: 1000 });
  assert.equal(tooSoon.shouldMint, false);
  assert.equal(tooSoon.reason, 'period-not-elapsed');

  // a full period later → mint allowed again
  const next = nextMint(sched, 1060, { mintedSoFar: '100', lastMintTs: 1000 });
  assert.equal(next.shouldMint, true);
  assert.equal(next.amount, '100');
});

test('nextMint: respects the cap, trims the final mint, then stops at the cap boundary', () => {
  const token = defineToken({ name: 'C', symbol: 'CAP', initialSupply: 0, mintable: true, cap: 250 });
  const sched = makeMintSchedule({ token, perPeriodAmount: 100, periodSeconds: 60, startTs: 0 });

  // minted 200 so far, room is 50 < per(100) → trimmed final mint of exactly 50
  const trimmed = nextMint(sched, 600, { mintedSoFar: '200', lastMintTs: 0 });
  assert.equal(trimmed.shouldMint, true);
  assert.equal(trimmed.amount, '50');
  assert.equal(trimmed.reason, 'final-partial-mint-to-cap');

  // at the cap (250 minted, initial 0) → stop entirely
  const done = nextMint(sched, 1200, { mintedSoFar: '250', lastMintTs: 600 });
  assert.equal(done.shouldMint, false);
  assert.equal(done.reason, 'cap-reached');

  // over-minted (defensive) → still stops, never negative
  const over = nextMint(sched, 1800, { mintedSoFar: '300', lastMintTs: 1200 });
  assert.equal(over.shouldMint, false);
  assert.equal(over.reason, 'cap-reached');
});

test('nextMint: cap accounts for initialSupply, not just schedule mints', () => {
  const token = defineToken({ name: 'I', symbol: 'INI', initialSupply: 900, mintable: true, cap: 1000 });
  const sched = makeMintSchedule({ token, perPeriodAmount: 100, periodSeconds: 60, startTs: 0 });
  // initial 900 + room 100 == per 100 → full mint lands exactly on cap
  const d = nextMint(sched, 0, { mintedSoFar: '0' });
  assert.equal(d.shouldMint, true);
  assert.equal(d.amount, '100');
  assert.equal(d.reason, 'period-elapsed');
  // now total would be 1000 → next attempt stops
  const stop = nextMint(sched, 60, { mintedSoFar: '100', lastMintTs: 0 });
  assert.equal(stop.shouldMint, false);
  assert.equal(stop.reason, 'cap-reached');
});

// ---- 4. mintIntent: dry-run default + injected signer ----------------------

test('mintIntent: defaults to dry-run, never broadcasts, never calls a signer', async () => {
  const token = defineToken({ name: 'D', symbol: 'DRY', initialSupply: 0, mintable: true });
  const spy = makeSpySigner();
  // NOTE: spy is intentionally NOT passed — dry-run must not reach any signer.
  const intent = await mintIntent(token, 100, '0xrecipient');
  assert.equal(intent.status, 'ok');
  assert.equal(intent.dryRun, true);
  assert.equal(intent.broadcast, null);
  assert.equal(spy.calls.length, 0, 'no signer was provided, so none could be called');
});

test('mintIntent: calls the injected signer ONLY when sign is provided', async () => {
  const token = defineToken({ name: 'S', symbol: 'SIG', initialSupply: 0, mintable: true });
  const spy = makeSpySigner();
  const intent = await mintIntent(token, 100, '0xrecipient', { sign: spy });
  assert.equal(spy.calls.length, 1, 'the injected signer was called exactly once');
  assert.equal(intent.status, 'signed');
  assert.equal(intent.dryRun, false);
  assert.deepEqual(intent.broadcast, { simulated: true, blocked: 'token-factory: real signer lives elsewhere' });
  // the signer received the intent, NOT a key
  assert.equal(spy.calls[0][0].action, 'mint');
  assert.equal(spy.calls[0][0].amount, '100');
});

// ---- 5. guardrails ---------------------------------------------------------

test('mintIntent: HARD-rejects a non-mintable token and never calls the signer', async () => {
  const fixed = defineToken({ name: 'F', symbol: 'FIX', initialSupply: 1000, mintable: false });
  const spy = makeSpySigner();
  const intent = await mintIntent(fixed, 100, '0xrecipient', { sign: spy });
  assert.equal(intent.status, 'rejected');
  assert.equal(intent.reason, 'not-mintable');
  assert.equal(intent.broadcast, null);
  assert.equal(spy.calls.length, 0, 'a rejected mint must never reach the signer');
});

test('mintIntent: HARD-rejects a mint that would exceed cap, signer untouched', async () => {
  const token = defineToken({ name: 'C', symbol: 'CAP', initialSupply: 900, mintable: true, cap: 1000 });
  const spy = makeSpySigner();
  // already minted 50; initial 900 + 50 + 100 = 1050 > cap 1000 → reject
  const intent = await mintIntent(token, 100, '0xrecipient', { sign: spy, mintedSoFar: 50 });
  assert.equal(intent.status, 'rejected');
  assert.equal(intent.reason, 'cap-exceeded');
  assert.equal(intent.broadcast, null);
  assert.equal(spy.calls.length, 0);
});

test('mintIntent: a mint landing exactly on cap is allowed', async () => {
  const token = defineToken({ name: 'E', symbol: 'EXACT', initialSupply: 900, mintable: true, cap: 1000 });
  const intent = await mintIntent(token, 100, '0xrecipient'); // 900 + 0 + 100 == cap
  assert.equal(intent.status, 'ok');
  assert.equal(intent.dryRun, true);
});

test('mintIntent: rejects bad amount/recipient shapes', async () => {
  const token = defineToken({ name: 'B', symbol: 'BAD', initialSupply: 0, mintable: true });
  await assert.rejects(() => mintIntent(token, 0, '0xr'), TokenSpecError);
  await assert.rejects(() => mintIntent(token, -5, '0xr'), TokenSpecError);
  await assert.rejects(() => mintIntent(token, 100, ''), TokenSpecError);
});
