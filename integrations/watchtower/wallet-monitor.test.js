// wallet-monitor.test.js — the outflow detector (pure). Proves it catches native transfers,
// HIVE-Engine token sends, and market sells OUT of the watched account, and ignores inbound.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { detectNewOutflows } from './wallet-monitor.mjs';

const H = (i, op) => [i, { timestamp: '2026-06-01T00:00:00', op }];

test('catches a native transfer OUT of the account', () => {
  const hist = [H(10, ['transfer', { from: 'angelicalist', to: 'thief', amount: '5.000 HIVE' }])];
  const out = detectNewOutflows(hist, 'angelicalist', 9);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'transfer');
  assert.match(out[0].detail, /thief/);
});

test('catches a HIVE-Engine token transfer OUT (the real drain vector)', () => {
  const json = JSON.stringify({ contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol: 'VKBT', to: 'thief', quantity: '86147' } });
  const hist = [H(11, ['custom_json', { id: 'ssc-mainnet-hive', required_auths: ['angelicalist'], json }])];
  const out = detectNewOutflows(hist, 'angelicalist', 10);
  assert.equal(out.length, 1);
  assert.equal(out[0].type, 'token-transfer');
  assert.match(out[0].detail, /86147 VKBT/);
});

test('ignores INBOUND transfers (someone sending TO the account)', () => {
  const hist = [H(12, ['transfer', { from: 'friend', to: 'angelicalist', amount: '1.000 HIVE' }])];
  assert.equal(detectNewOutflows(hist, 'angelicalist', 11).length, 0);
});

test('only reports ops newer than lastIndex (no duplicate alerts)', () => {
  const hist = [
    H(20, ['transfer', { from: 'angelicalist', to: 'x', amount: '1.000 HIVE' }]),
    H(21, ['transfer', { from: 'angelicalist', to: 'y', amount: '2.000 HIVE' }]),
  ];
  assert.equal(detectNewOutflows(hist, 'angelicalist', 20).length, 1); // only index 21
});

test('catches a market sell signed by the account', () => {
  const json = JSON.stringify({ contractName: 'market', contractAction: 'sell', contractPayload: { symbol: 'VKBT', quantity: '1000', price: '0.001' } });
  const hist = [H(13, ['custom_json', { id: 'ssc-mainnet-hive', required_auths: ['angelicalist'], json }])];
  const out = detectNewOutflows(hist, 'angelicalist', 12);
  assert.equal(out[0].type, 'market-sell');
});
