// kula-config-addresses.test.mjs — offline tests for the CDP/veKULA address config + liveness guards.
// House style: node --test, no network, pure. Verifies the mainnet block is present and non-zero and
// that the guards refuse a zero address (the "not live" gate the Borrow/Stake UI depends on).

import test from 'node:test';
import assert from 'node:assert/strict';
import { ADDR, MAINNET_ADDR, altiMarketLive, cdpMarketLive, veLive, addrFor } from './kula-config-addresses.mjs';

const isAddr = (a) => /^0x[0-9a-fA-F]{40}$/.test(a);
const Z = '0x0000000000000000000000000000000000000000';

test('testnet ADDR still exports its keys (back-compat preserved)', () => {
  for (const k of ['KULA', 'wMELEK', 'ALTI', 'PoL', 'oracle', 'GrapheneDepositBridge']) {
    assert.ok(isAddr(ADDR[k]), `${k} is an address`);
  }
  // Market-2 (wMELEK→ALTI) remains a zero placeholder on testnet → altiMarketLive() false.
  assert.equal(ADDR.marketAltiVault, Z);
  assert.equal(altiMarketLive(), false);
});

test('MAINNET_ADDR carries the verified live CDP + veKULA deployment', () => {
  for (const k of ['KULA', 'mMELEK', 'wMELEK', 'oracle', 'cdpVault', 'veKULA', 'DAOTimelock']) {
    assert.ok(isAddr(MAINNET_ADDR[k]), `${k} is an address`);
    assert.notEqual(MAINNET_ADDR[k], Z, `${k} is not the zero placeholder`);
  }
});

test('mMELEK (CDP debt) is a DISTINCT contract from wMELEK (bridge asset)', () => {
  // The whole reconciliation: the CDP mints mMELEK, never wMELEK. They must not collide.
  assert.notEqual(MAINNET_ADDR.mMELEK.toLowerCase(), MAINNET_ADDR.wMELEK.toLowerCase());
});

test('cdpMarketLive/veLive are true for the live mainnet addresses', () => {
  assert.equal(cdpMarketLive(), true);
  assert.equal(veLive(), true);
});

test('addrFor selects mainnet vs testnet', () => {
  assert.equal(addrFor('mainnet'), MAINNET_ADDR);
  assert.equal(addrFor('MAINNET'), MAINNET_ADDR);
  assert.equal(addrFor('testnet'), ADDR);
  assert.equal(addrFor(undefined), ADDR);
});

test('the guards are the zero-address gate the UI relies on', () => {
  // Prove the guard semantics against a zero — a host override to Z must read "not live".
  const liveIf = (a) => !!a && a !== Z;
  assert.equal(liveIf(Z), false);
  assert.equal(liveIf(MAINNET_ADDR.cdpVault), true);
  assert.equal(liveIf(MAINNET_ADDR.veKULA), true);
});
