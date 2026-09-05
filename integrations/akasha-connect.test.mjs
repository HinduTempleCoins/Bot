// akasha-connect.test.mjs — OFFLINE tests. No network, no keys, no PRANA mutation.
// Run: node --test integrations/akasha-connect.test.mjs

import { test } from 'node:test';
import assert from 'node:assert';

import {
  chainRegistry,
  chainDescriptor,
  resolveTrack,
  isLive,
  poolLinkage,
  bridgeLinkage,
  connectionManifest,
  PRANA_RPC_ENV,
  PRANA_CHAIN_ID_ENV,
  __setWizard,
  __setPoolStats,
} from './akasha-connect.mjs';

// ---- chain registry --------------------------------------------------------

test('chainRegistry has the three ecosystem chains with correct tracks', () => {
  const reg = chainRegistry();
  assert.equal(reg.prana.track, 'evm');
  assert.equal(reg.melek.track, 'graphene');
  assert.equal(reg.soap.track, 'graphene');
});

test('melek descriptor carries MELEK mainnet + TST testnet twin and standard symbols', () => {
  const d = chainDescriptor('melek');
  assert.equal(d.caip2, 'hive:melek');
  assert.equal(d.prefix, 'MELEK');
  assert.equal(d.symbol, 'MELEK');
  assert.equal(d.feeSymbol, 'MBD');
  assert.equal(d.testnet.prefix, 'TST');
  assert.equal(d.testnet.symbol, 'TESTS');
  assert.equal(d.testnet.feeSymbol, 'TBD');
  assert.deepEqual(d.roles, ['posting', 'active', 'owner', 'memo']);
  assert.equal(d.addressFormat, 'graphene-pubkey');
});

test('melek accountId builds a CAIP-10 hive:melek account, stripping @', () => {
  const d = chainDescriptor('melek');
  assert.equal(d.accountId('hathor'), 'hive:melek:hathor');
  assert.equal(d.accountId('@hathor'), 'hive:melek:hathor');
});

test('prana descriptor uses the eip155 placeholder chain id and 0x address format', () => {
  const prev = process.env[PRANA_CHAIN_ID_ENV];
  delete process.env[PRANA_CHAIN_ID_ENV];
  const d = chainDescriptor('prana');
  assert.equal(d.namespace, 'eip155');
  assert.equal(d.reference, '712217');         // PRANA MAINNET
  assert.equal(d.caip2, 'eip155:712217');
  assert.equal(d.addressFormat, 'evm-0x');
  assert.equal(d.rpcEnv, PRANA_RPC_ENV);
  if (prev !== undefined) process.env[PRANA_CHAIN_ID_ENV] = prev;
});

test('prana chain id is env-overridable per-access', () => {
  const prev = process.env[PRANA_CHAIN_ID_ENV];
  process.env[PRANA_CHAIN_ID_ENV] = '424242';
  const d = chainDescriptor('prana');
  assert.equal(d.reference, '424242');
  assert.equal(d.caip2, 'eip155:424242');
  if (prev === undefined) delete process.env[PRANA_CHAIN_ID_ENV];
  else process.env[PRANA_CHAIN_ID_ENV] = prev;
});

test('chainDescriptor returns null for an unknown chain', () => {
  assert.equal(chainDescriptor('dogecoin'), null);
  assert.equal(chainDescriptor(''), null);
  assert.equal(chainDescriptor(undefined), null);
});

// ---- resolveTrack (the resolveSignerFor core) ------------------------------

test('resolveTrack handles logical names AND CAIP-2 ids', () => {
  assert.equal(resolveTrack('prana'), 'evm');
  assert.equal(resolveTrack('melek'), 'graphene');
  assert.equal(resolveTrack('soap'), 'graphene');
  assert.equal(resolveTrack('eip155:1'), 'evm');
  assert.equal(resolveTrack('hive:melek'), 'graphene');
  assert.equal(resolveTrack('blurt:main'), 'graphene');
  assert.equal(resolveTrack('nonsense'), null);
  assert.equal(resolveTrack(undefined), null);
});

// ---- isLive: PRANA dormant until PRANA_RPC_URL -----------------------------

test('graphene chains are live; PRANA is dormant until PRANA_RPC_URL is set', () => {
  const prev = process.env[PRANA_RPC_ENV];
  delete process.env[PRANA_RPC_ENV];
  assert.equal(isLive('melek'), true);
  assert.equal(isLive('soap'), true);
  assert.equal(isLive('prana'), false, 'PRANA dormant with RPC unset');

  process.env[PRANA_RPC_ENV] = 'https://rpc.example.invalid';
  assert.equal(isLive('prana'), true, 'PRANA live once RPC set');

  if (prev === undefined) delete process.env[PRANA_RPC_ENV];
  else process.env[PRANA_RPC_ENV] = prev;
  assert.equal(isLive('unknown-chain'), false);
});

// ---- pool linkage (delegates the stagenet-twin rule to wizard.mjs) ---------

test('poolLinkage soft-fails clean when pool modules are absent', async () => {
  __setWizard({}); // no COINS / no poolLoginAddress
  __setPoolStats({});
  const pl = await poolLinkage();
  assert.equal(pl.statsApiPath, '/api/pools');
  assert.equal(pl.loginRule, 'stagenet-twin');
  assert.deepEqual(pl.coins, []);
  assert.deepEqual(pl.stratumFamilies, []);
  // fallback login fn returns address unconverted, never throws
  const r = pl.poolLoginAddress('monero', '4abc');
  assert.equal(r.converted, false);
  assert.equal(r.address, '4abc');
  __setWizard(null);
  __setPoolStats(null);
});

test('poolLinkage surfaces coins, families, host and delegates the twin rule', async () => {
  __setWizard({
    COINS: {
      monero: { symbol: 'XMR', family: 'cryptonote', phoneReady: true },
      etc: { symbol: 'ETC', family: 'ethereum', phoneReady: false },
    },
    poolLoginAddress: (_c, addr) => ({ address: addr + '-twin', converted: true }),
  });
  __setPoolStats({ POOL_STRATUM_HOST: 'pool.test.invalid' });
  const pl = await poolLinkage();
  assert.equal(pl.stratumHost, 'pool.test.invalid');
  assert.deepEqual(pl.stratumFamilies.sort(), ['cryptonote', 'ethereum']);
  assert.equal(pl.coins.length, 2);
  assert.equal(pl.coins[0].symbol, 'XMR');
  const r = pl.poolLoginAddress('monero', '4abc');
  assert.equal(r.converted, true);
  assert.equal(r.address, '4abc-twin');
  __setWizard(null);
  __setPoolStats(null);
});

test('poolLinkage uses the REAL wizard stagenet-twin rule when not injected', async () => {
  __setWizard(null);
  __setPoolStats(null);
  const pl = await poolLinkage();
  // real wizard exports cryptonote+ethereum families and a working poolLoginAddress
  assert.ok(pl.stratumFamilies.includes('cryptonote'));
  assert.equal(typeof pl.poolLoginAddress, 'function');
  // a non-monero / garbage input never throws (returns unconverted)
  const r = pl.poolLoginAddress('zephyr', 'ZEPHsabc');
  assert.equal(r.converted, false);
});

// ---- bridge linkage --------------------------------------------------------

test('bridgeLinkage names both routes and is initiate-only / wallet-never-signs', () => {
  const b = bridgeLinkage();
  assert.equal(b.initiatesOnly, true);
  assert.equal(b.routes.evm.contract, 'CanonicalLockMintBridge');
  assert.equal(b.routes.evm.completionEvent, 'Minted');
  assert.equal(b.routes.graphene.contract, 'GrapheneDepositBridge');
  assert.equal(b.routes.graphene.completionEvent, 'DepositMinted');
  assert.ok(b.walletNeverSigns.includes('mint'));
  assert.ok(b.walletNeverSigns.includes('attestDeposit'));
  assert.ok(b.walletNeverSigns.includes('validatorSigs'));
});

// ---- connection manifest ---------------------------------------------------

test('connectionManifest assembles chains + pool + bridge and never throws', async () => {
  __setWizard(null);
  __setPoolStats(null);
  const prev = process.env[PRANA_RPC_ENV];
  delete process.env[PRANA_RPC_ENV];
  const m = await connectionManifest();
  assert.ok(m.chains.prana && m.chains.melek && m.chains.soap);
  assert.equal(m.live.melek, true);
  assert.equal(m.live.prana, false);
  assert.equal(m.pranaRpcSet, false);
  assert.ok(m.pool && m.pool.loginRule === 'stagenet-twin');
  assert.ok(m.bridge && m.bridge.initiatesOnly === true);
  assert.match(m.boundary, /holds NO key/);
  assert.ok(typeof m.generatedAt === 'string');
  if (prev !== undefined) process.env[PRANA_RPC_ENV] = prev;
});

test('manifest reflects PRANA going live when PRANA_RPC_URL is set', async () => {
  const prev = process.env[PRANA_RPC_ENV];
  process.env[PRANA_RPC_ENV] = 'https://rpc.example.invalid';
  const m = await connectionManifest();
  assert.equal(m.live.prana, true);
  assert.equal(m.pranaRpcSet, true);
  if (prev === undefined) delete process.env[PRANA_RPC_ENV];
  else process.env[PRANA_RPC_ENV] = prev;
});
