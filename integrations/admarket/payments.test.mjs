// payments.test.mjs — offline, no network. Unsigned token-payment intents; zero-WIF discipline.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildFundingIntent, buildRefundIntent, resolveEscrow, erc20TransferData,
  ERC20_TRANSFER_SELECTOR, memoMatchesCampaign, isAccount, isEvmAddress,
} from './payments.mjs';

const ENV = {
  AD_ESCROW_ACCOUNT: 'melek.ads',
  AD_ESCROW_EVM: '0x' + '1'.repeat(40),
  PRANA_TOKEN_ADDRESS: '0x' + '2'.repeat(40),
  KULA_TOKEN_ADDRESS: '0x' + '3'.repeat(40),
  PRANA_CHAIN_ID: '108369',
};

test('resolveEscrow reads env by name; nothing hardcoded, missing → null', () => {
  assert.deepEqual(resolveEscrow('MELEK', ENV), { kind: 'graphene', to: 'melek.ads' });
  assert.equal(resolveEscrow('MELEK', {}), null);
  const evm = resolveEscrow('PRANA', ENV);
  assert.equal(evm.kind, 'evm');
  assert.equal(evm.chainId, 108369);
  assert.equal(resolveEscrow('PRANA', { AD_ESCROW_EVM: ENV.AD_ESCROW_EVM }), null); // no token addr
});

test('MELEK funding → unsigned graphene transfer with binding memo', () => {
  const r = buildFundingIntent({ id: 'camp_1', advertiser: 'acmecorp', token: 'MELEK', requestedBudget: '50000' }, { env: ENV, amount: '50.000' });
  assert.ok(r.ok);
  assert.equal(r.kind, 'graphene');
  assert.deepEqual(r.intent, ['transfer', { from: 'acmecorp', to: 'melek.ads', amount: '50.000 MELEK', memo: 'adcampaign:camp_1' }]);
  assert.equal(r.requiresSignature, true);
  assert.ok(memoMatchesCampaign(r.intent[1].memo, 'camp_1'));
});

test('APIS funding → engine custom_json tokens.transfer envelope', () => {
  const r = buildFundingIntent({ id: 'camp_2', advertiser: 'acmecorp', token: 'APIS', requestedBudget: '100' }, { env: { ...ENV, MELEK_ENGINE_ID: 'mse-testnet-melek' }, amount: '100.000' });
  assert.ok(r.ok);
  assert.equal(r.intent[0], 'custom_json');
  assert.equal(r.intent[1].id, 'mse-testnet-melek');
  assert.deepEqual(r.intent[1].required_auths, ['acmecorp']);
  const env = JSON.parse(r.intent[1].json);
  assert.equal(env.contractName, 'tokens');
  assert.equal(env.contractAction, 'transfer');
  assert.deepEqual(env.contractPayload, { symbol: 'APIS', to: 'melek.ads', quantity: '100.000', memo: 'adcampaign:camp_2' });
});

test('PRANA/KULA funding → ERC-20 transfer calldata intent', () => {
  const r = buildFundingIntent({ id: 'camp_3', advertiser: '0x' + 'a'.repeat(40), token: 'PRANA', requestedBudget: '1' }, { env: ENV, amount: '25' });
  assert.ok(r.ok);
  assert.equal(r.kind, 'evm');
  assert.equal(r.intent.to, ENV.PRANA_TOKEN_ADDRESS);
  assert.equal(r.intent.chainId, 108369);
  assert.equal(r.intent.value, '0x0');
  assert.ok(r.intent.data.startsWith(ERC20_TRANSFER_SELECTOR));
  // calldata encodes the escrow address + amount (25e18)
  const amtHex = (25n * 10n ** 18n).toString(16);
  assert.ok(r.intent.data.endsWith(amtHex.padStart(64, '0')));
  assert.ok(r.intent.data.includes('1'.repeat(40)));
});

test('erc20TransferData shape + validation', () => {
  const d = erc20TransferData('0x' + 'b'.repeat(40), 1000n);
  assert.equal(d.length, 10 + 64 + 64); // 0x + selector(8) ... = '0x'+8 + 128
  assert.equal(erc20TransferData('not-addr', 1n), null);
  assert.equal(erc20TransferData('0x' + 'b'.repeat(40), -1), null);
});

test('funding fails cleanly when escrow unset or payer type mismatched', () => {
  assert.equal(buildFundingIntent({ id: 'x', advertiser: 'acmecorp', token: 'MELEK', requestedBudget: '1000' }, { env: {} }).ok, false);
  // MELEK payer given an 0x address
  assert.equal(buildFundingIntent({ id: 'x', advertiser: '0x' + 'a'.repeat(40), token: 'MELEK', requestedBudget: '1000' }, { env: ENV }).ok, false);
  // PRANA payer given a bare account
  assert.equal(buildFundingIntent({ id: 'x', advertiser: 'acmecorp', token: 'PRANA', requestedBudget: '1' }, { env: ENV }).ok, false);
  assert.equal(buildFundingIntent({ id: 'x', advertiser: 'acmecorp', token: 'DOGE', requestedBudget: '1' }, { env: ENV }).ok, false);
});

test('refund intent: unspent budget, operator-gated (from = escrow)', () => {
  const r = buildRefundIntent({ id: 'camp_9', advertiser: 'acmecorp', token: 'MELEK', budget: '50000', spent: '10000' }, { env: ENV });
  assert.ok(r.ok);
  assert.equal(r.intent[0], 'transfer');
  assert.equal(r.intent[1].from, 'melek.ads');   // escrow pays out
  assert.equal(r.intent[1].to, 'acmecorp');
  assert.equal(r.intent[1].amount, '40.000 MELEK');
  assert.match(r.signedBy, /operator|MELEK-Signer/i);
  assert.equal(buildRefundIntent({ id: 'x', advertiser: 'acmecorp', token: 'MELEK', budget: '50000', spent: '50000' }, { env: ENV }).ok, false); // nothing left
});

test('ZERO-WIF: no intent output ever contains a key/seed field', () => {
  const outs = [
    buildFundingIntent({ id: 'k1', advertiser: 'acmecorp', token: 'MELEK', requestedBudget: '1000' }, { env: ENV }),
    buildFundingIntent({ id: 'k2', advertiser: '0x' + 'a'.repeat(40), token: 'KULA', requestedBudget: '1' }, { env: ENV }),
    buildRefundIntent({ id: 'k3', advertiser: 'acmecorp', token: 'MELEK', budget: '2000', spent: '0' }, { env: ENV }),
  ];
  for (const o of outs) {
    const j = JSON.stringify(o).toLowerCase();
    // note: 'requiresSignature'/'signedBy' are the intended zero-WIF markers (defer signing), not leaks.
    for (const bad of ['wif', 'privatekey', 'private_key', 'posting_key', 'active_key', 'seed', 'mnemonic']) {
      assert.equal(j.includes(bad), false, `intent leaked "${bad}"`);
    }
    assert.equal(o.requiresSignature, true); // always defers signing
  }
});

test('helpers + soft-fail', () => {
  assert.equal(isAccount('acmecorp'), true);
  assert.equal(isEvmAddress('0x' + 'a'.repeat(40)), true);
  assert.doesNotThrow(() => buildFundingIntent(null));
  assert.doesNotThrow(() => buildRefundIntent(undefined));
});
