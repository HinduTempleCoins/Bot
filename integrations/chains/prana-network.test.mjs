import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pranaNet, addChainParams, explorerTx, explorerAddress, explorerToken, chainIdHex, NETWORKS,
} from './prana-network.mjs';

// Keep env clean between assertions.
function clearEnv() {
  for (const k of ['PRANA_NET', 'PRANA_RPC_URL', 'PRANA_CHAIN_ID', 'PRANA_EXPLORER_URL', 'PRANA_WALLET_URL', 'KULA_ADDRESS']) {
    delete process.env[k];
  }
}

test('chainIdHex computes minimal hex and guards bad input', () => {
  assert.equal(chainIdHex(712217), '0xade19');
  assert.equal(chainIdHex(108369), '0x1a751');
  assert.equal(chainIdHex(0), '0x0');
  assert.equal(chainIdHex('nope'), '0x0');
  assert.equal(chainIdHex(-5), '0x0');
});

test('default net is testnet (safe — keeps serving the live testnet)', () => {
  clearEnv();
  const c = pranaNet();
  assert.equal(c.key, 'testnet');
  assert.equal(c.chainId, 108369);
  assert.equal(c.chainIdHex, '0x1a751');
  assert.ok(c.rpcUrl.includes('alpha'));
  assert.ok(c.explorerUrl.includes('alpha'));
});

test('mainnet net carries the fair-launch facts on bare domains', () => {
  clearEnv();
  const c = pranaNet('mainnet');
  assert.equal(c.chainId, 712217);
  assert.equal(c.chainIdHex, '0xade19');
  assert.equal(c.rpcUrl, 'https://rpc.prana.melek.salon');
  assert.equal(c.explorerUrl, 'https://pranascan.soapbox.community');
  assert.equal(c.walletUrl, 'https://akasha.soapbox.community');
  assert.equal(c.alpha, false);
  assert.ok(!c.rpcUrl.includes('alpha'));
});

test('PRANA_NET env selects mainnet', () => {
  clearEnv();
  process.env.PRANA_NET = 'mainnet';
  assert.equal(pranaNet().chainId, 712217);
  clearEnv();
});

test('per-field env overrides win over the base net', () => {
  clearEnv();
  process.env.PRANA_NET = 'mainnet';
  process.env.PRANA_RPC_URL = 'https://custom.rpc/, https://backup.rpc/';
  process.env.PRANA_CHAIN_ID = '999';
  process.env.PRANA_EXPLORER_URL = 'https://exp.example/';
  process.env.KULA_ADDRESS = '0xabc';
  const c = pranaNet();
  assert.equal(c.rpcUrl, 'https://custom.rpc'); // first of the list, trailing slash trimmed
  assert.equal(c.chainId, 999);
  assert.equal(c.chainIdHex, '0x3e7');
  assert.equal(c.explorerUrl, 'https://exp.example');
  assert.equal(c.kula, '0xabc');
  clearEnv();
});

test('unknown net falls back to testnet, never throws', () => {
  clearEnv();
  const c = pranaNet('bogus');
  assert.equal(c.key, 'testnet');
});

test('addChainParams is a valid EIP-3085 payload', () => {
  clearEnv();
  const p = addChainParams('mainnet');
  assert.equal(p.chainId, '0xade19');
  assert.equal(p.nativeCurrency.symbol, 'PRANA');
  assert.equal(p.nativeCurrency.decimals, 18);
  assert.deepEqual(p.rpcUrls, ['https://rpc.prana.melek.salon']);
  assert.deepEqual(p.blockExplorerUrls, ['https://pranascan.soapbox.community']);
});

test('explorer builders make EIP-3091 links and soft-fail on empty', () => {
  clearEnv();
  assert.equal(explorerTx('0xhash', 'mainnet'), 'https://pranascan.soapbox.community/tx/0xhash');
  assert.equal(explorerAddress('0xacc', 'mainnet'), 'https://pranascan.soapbox.community/address/0xacc');
  assert.equal(explorerToken('0xtok', 'mainnet'), 'https://pranascan.soapbox.community/token/0xtok');
  assert.equal(explorerTx('', 'mainnet'), '');
  assert.equal(explorerAddress(null, 'mainnet'), '');
});

test('NETWORKS table is frozen-shape with both nets', () => {
  assert.ok(NETWORKS.testnet && NETWORKS.mainnet);
  assert.equal(NETWORKS.testnet.chainId, 108369);
  assert.equal(NETWORKS.mainnet.chainId, 712217);
});
