// hathor-chain-deps.test.mjs — the shared read-only data sources for Hathor's !commands are wired
// the same way on every surface. Offline: we only assert the SHAPE of what chainDeps() returns, never
// the network behind it (those modules have their own offline tests).

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { chainDeps, rpcConfigured } from './hathor-chain-deps.mjs';

test('chainDeps always exposes getPrice + getHolders (RPC-independent)', () => {
  const d = chainDeps();
  assert.equal(typeof d.getPrice, 'function');
  assert.equal(typeof d.getHolders, 'function');
});

test('chainDeps with requireRpc:false always attaches the MELEK readers', () => {
  const d = chainDeps({ requireRpc: false });
  assert.equal(typeof d.getAccount, 'function');
  assert.equal(typeof d.getWitness, 'function');
  assert.equal(typeof d.getPrice, 'function');
  assert.equal(typeof d.getHolders, 'function');
});

test('chainDeps with requireRpc:true gates the MELEK readers on rpcConfigured()', () => {
  const d = chainDeps({ requireRpc: true });
  if (rpcConfigured()) {
    assert.equal(typeof d.getAccount, 'function');
    assert.equal(typeof d.getWitness, 'function');
  } else {
    assert.equal(d.getAccount, undefined);
    assert.equal(d.getWitness, undefined);
  }
  // getPrice/getHolders are present either way.
  assert.equal(typeof d.getPrice, 'function');
  assert.equal(typeof d.getHolders, 'function');
});

test('getHolders + getPrice soft-fail to null (never throw at the menu edge)', async () => {
  // No network in tests; the underlying modules soft-fail. We assert these resolve without throwing.
  const d = chainDeps({ requireRpc: false });
  await assert.doesNotReject(async () => { await d.getHolders('___nope___'); });
  await assert.doesNotReject(async () => { await d.getPrice('___nope___'); });
});
