/**
 * src/chain/caip.test.mjs — OFFLINE unit tests for CAIP universal addressing.
 *
 * Pure functions only: no network, no RPC, no I/O. Run with:
 *
 *   node --test src/chain/caip.test.mjs
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  CaipError,
  parseChainId,
  formatChainId,
  parseAccountId,
  formatAccountId,
  parseAssetId,
  formatAssetId,
  isEvm,
  isGraphene,
  forHive,
  buildScopes,
  parseScopes,
  scopeAllows,
} from './caip.mjs';

// ---- CAIP-2: chainId -------------------------------------------------------

test('parseChainId: eip155:1', () => {
  assert.deepEqual(parseChainId('eip155:1'), { namespace: 'eip155', reference: '1' });
});

test('parseChainId: solana mainnet', () => {
  assert.deepEqual(parseChainId('solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ'), {
    namespace: 'solana',
    reference: '4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ',
  });
});

test('parseChainId: hive/graphene namespace', () => {
  assert.deepEqual(parseChainId('hive:melek'), { namespace: 'hive', reference: 'melek' });
});

test('formatChainId: round-trips', () => {
  for (const id of ['eip155:1', 'solana:abcDEF123', 'hive:melek', 'blurt:main']) {
    assert.equal(formatChainId(parseChainId(id)), id);
  }
});

test('parseChainId: malformed rejected', () => {
  for (const bad of ['', 'eip155', 'EIP155:1', 'ab:1', ':1', 'eip155:', 'a'.repeat(9) + ':1']) {
    assert.throws(() => parseChainId(bad), CaipError, `expected throw for "${bad}"`);
  }
});

test('parseChainId: reference too long rejected', () => {
  assert.throws(() => parseChainId('eip155:' + 'x'.repeat(33)), CaipError);
});

test('parseChainId: soft mode returns null on malformed', () => {
  assert.equal(parseChainId('nope', { soft: true }), null);
  assert.equal(parseChainId(undefined, { soft: true }), null);
});

test('formatChainId: malformed parts rejected', () => {
  assert.throws(() => formatChainId({ namespace: 'AB', reference: '1' }), CaipError);
  assert.throws(() => formatChainId({ namespace: 'eip155', reference: '' }), CaipError);
  assert.equal(formatChainId({ namespace: 'AB', reference: '1' }, { soft: true }), null);
});

// ---- CAIP-10: accountId ----------------------------------------------------

test('parseAccountId: EVM account', () => {
  const got = parseAccountId('eip155:1:0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb');
  assert.deepEqual(got, {
    chainId: 'eip155:1',
    namespace: 'eip155',
    reference: '1',
    address: '0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb',
  });
});

test('parseAccountId: Hive/Graphene account', () => {
  const got = parseAccountId('hive:melek:hathor');
  assert.deepEqual(got, {
    chainId: 'hive:melek',
    namespace: 'hive',
    reference: 'melek',
    address: 'hathor',
  });
});

test('formatAccountId: round-trips both styles', () => {
  for (const id of ['eip155:1:0xABCdef', 'hive:melek:hathor', 'solana:abc:somebase58Addr']) {
    const parsed = parseAccountId(id);
    assert.equal(formatAccountId(parsed), id);
    assert.equal(
      formatAccountId({ chainId: parsed.chainId, address: parsed.address }),
      id
    );
  }
});

test('formatAccountId: from namespace/reference/address', () => {
  assert.equal(
    formatAccountId({ namespace: 'hive', reference: 'melek', address: 'hathor' }),
    'hive:melek:hathor'
  );
});

test('parseAccountId: malformed rejected', () => {
  for (const bad of ['', 'eip155:1', 'hive:hathor', 'eip155:1:', 'BAD:1:addr']) {
    assert.throws(() => parseAccountId(bad), CaipError, `expected throw for "${bad}"`);
  }
});

test('parseAccountId: soft mode', () => {
  assert.equal(parseAccountId('garbage', { soft: true }), null);
});

// ---- CAIP-19: assetId ------------------------------------------------------

test('parseAssetId: ERC-20 (fungible)', () => {
  const got = parseAssetId('eip155:1/erc20:0xa0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48');
  assert.deepEqual(got, {
    chainId: 'eip155:1',
    namespace: 'eip155',
    reference: '1',
    assetNamespace: 'erc20',
    assetReference: '0xa0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  });
});

test('parseAssetId: ERC-721 with tokenId', () => {
  const got = parseAssetId('eip155:1/erc721:0x06012c8cf97BEaD5deAe237070F9587f8E7A266d/771769');
  assert.deepEqual(got, {
    chainId: 'eip155:1',
    namespace: 'eip155',
    reference: '1',
    assetNamespace: 'erc721',
    assetReference: '0x06012c8cf97BEaD5deAe237070F9587f8E7A266d',
    tokenId: '771769',
  });
});

test('parseAssetId: Hive/Graphene token', () => {
  const got = parseAssetId('hive:melek/token:MELEK');
  assert.deepEqual(got, {
    chainId: 'hive:melek',
    namespace: 'hive',
    reference: 'melek',
    assetNamespace: 'token',
    assetReference: 'MELEK',
  });
});

test('formatAssetId: round-trips with and without tokenId', () => {
  for (const id of [
    'eip155:1/erc20:0xa0b86991',
    'eip155:1/erc721:0xabc/771769',
    'hive:melek/token:MELEK',
  ]) {
    assert.equal(formatAssetId(parseAssetId(id)), id);
  }
});

test('formatAssetId: from namespace/reference parts', () => {
  assert.equal(
    formatAssetId({
      namespace: 'hive',
      reference: 'melek',
      assetNamespace: 'token',
      assetReference: 'MELEK',
    }),
    'hive:melek/token:MELEK'
  );
});

test('parseAssetId: malformed rejected', () => {
  for (const bad of [
    '',
    'eip155:1',
    'eip155:1/erc20',
    'eip155:1/ER:x',
    'BAD:1/erc20:x',
    'eip155:1/erc20:',
  ]) {
    assert.throws(() => parseAssetId(bad), CaipError, `expected throw for "${bad}"`);
  }
});

test('parseAssetId: soft mode', () => {
  assert.equal(parseAssetId('no-slash-here', { soft: true }), null);
});

// ---- helpers: isEvm / isGraphene -------------------------------------------

test('isEvm: detects eip155', () => {
  assert.equal(isEvm('eip155:1'), true);
  assert.equal(isEvm('eip155:137'), true);
  assert.equal(isEvm({ namespace: 'eip155', reference: '1' }), true);
});

test('isEvm: non-EVM and garbage are false', () => {
  assert.equal(isEvm('solana:abc'), false);
  assert.equal(isEvm('hive:melek'), false);
  assert.equal(isEvm('garbage'), false);
  assert.equal(isEvm(null), false);
});

test('isGraphene: detects hive family', () => {
  for (const id of ['hive:melek', 'steem:main', 'blurt:main', 'graphene:x', 'melek:testnet']) {
    assert.equal(isGraphene(id), true, `expected graphene for "${id}"`);
  }
});

test('isGraphene: non-graphene false', () => {
  assert.equal(isGraphene('eip155:1'), false);
  assert.equal(isGraphene('solana:abc'), false);
  assert.equal(isGraphene('bogus'), false);
});

// ---- helper: forHive -------------------------------------------------------

test('forHive: default melek network', () => {
  assert.equal(forHive('hathor'), 'hive:melek:hathor');
});

test('forHive: strips leading @', () => {
  assert.equal(forHive('@hathor'), 'hive:melek:hathor');
});

test('forHive: custom network', () => {
  assert.equal(forHive('punicwax', { network: 'main' }), 'hive:main:punicwax');
});

test('forHive: output round-trips through parseAccountId', () => {
  const id = forHive('hathor');
  assert.deepEqual(parseAccountId(id), {
    chainId: 'hive:melek',
    namespace: 'hive',
    reference: 'melek',
    address: 'hathor',
  });
});

test('forHive: throws on empty', () => {
  assert.throws(() => forHive(''), CaipError);
});

// ---- CAIP-25 idea: scopes --------------------------------------------------

test('buildScopes: builds a scope set', () => {
  const scopes = buildScopes([
    { chainId: 'eip155:1', methods: ['eth_sendTransaction', 'personal_sign'] },
    { chainId: 'hive:melek', methods: ['comment', 'vote', 'vote'], notifications: ['block'] },
  ]);
  assert.deepEqual(scopes, {
    'eip155:1': { methods: ['eth_sendTransaction', 'personal_sign'], notifications: [] },
    'hive:melek': { methods: ['comment', 'vote'], notifications: ['block'] },
  });
});

test('buildScopes -> parseScopes round-trips through JSON', () => {
  const scopes = buildScopes([{ chainId: 'hive:melek', methods: ['transfer'] }]);
  const json = JSON.parse(JSON.stringify(scopes));
  assert.deepEqual(parseScopes(json), scopes);
});

test('buildScopes: invalid chainId rejected', () => {
  assert.throws(() => buildScopes([{ chainId: 'BAD', methods: [] }]), CaipError);
});

test('buildScopes: soft mode', () => {
  assert.equal(buildScopes('not-an-array', { soft: true }), null);
});

test('scopeAllows: grant checks', () => {
  const scopes = buildScopes([{ chainId: 'hive:melek', methods: ['comment', 'vote'] }]);
  assert.equal(scopeAllows(scopes, 'hive:melek', 'vote'), true);
  assert.equal(scopeAllows(scopes, 'hive:melek', 'transfer'), false);
  assert.equal(scopeAllows(scopes, 'eip155:1', 'vote'), false);
  assert.equal(scopeAllows(null, 'hive:melek', 'vote'), false);
});

test('parseScopes: rejects non-object and bad keys', () => {
  assert.throws(() => parseScopes([]), CaipError);
  assert.throws(() => parseScopes({ BAD: { methods: [] } }), CaipError);
});
