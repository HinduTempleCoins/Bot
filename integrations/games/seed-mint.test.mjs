// seed-mint.test.mjs — OFFLINE. The off-chain Seed Mint op-builder: register-all from the catalog, mint, plant.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRegisterOp, buildRegisterAllOps, buildMintOp, buildPlantOp, supplyForSeed, SIDECHAIN_ID } from './seed-mint.mjs';
import { seedCatalog } from './seed-tokens.mjs';

function parse(op) { return { name: op[0], payload: op[1], json: JSON.parse(op[1].json) }; }

test('buildRegisterAllOps: one valid custom_json per seed, kind + cap carried', () => {
  const ops = buildRegisterAllOps('hathor');
  const cat = seedCatalog();
  assert.equal(ops.length, cat.length);
  for (const r of ops) {
    assert.ok(r.ok);
    const { name, payload, json } = parse(r.op);
    assert.equal(name, 'custom_json');
    assert.equal(payload.id, SIDECHAIN_ID);
    assert.deepEqual(payload.required_auths, ['hathor']);
    assert.equal(json.contractName, 'seeds');
    assert.equal(json.contractAction, 'register');
    assert.ok(['token', 'nft'].includes(json.contractPayload.kind));
    assert.ok(/^\d+$/.test(json.contractPayload.maxSupply));
  }
});

test('register op: token-kind has no collection/traits; nft-kind carries them', () => {
  const cat = seedCatalog();
  const tokenSeed = cat.find((s) => s.kind === 'token');
  const nftSeed = cat.find((s) => s.kind === 'nft');
  const t = parse(buildRegisterOp('hathor', tokenSeed).op).json.contractPayload;
  assert.equal(t.kind, 'token');
  assert.equal(t.collection, undefined);
  assert.equal(t.traits, undefined);
  const n = parse(buildRegisterOp('hathor', nftSeed).op).json.contractPayload;
  assert.equal(n.kind, 'nft');
  assert.ok(n.traits && n.traits.rarity);
});

test('supplyForSeed: abundant tokens get a big cap, scarce NFTs a small one', () => {
  assert.equal(supplyForSeed({ kind: 'token', growTier: 'day' }), '100000000');
  assert.equal(supplyForSeed({ kind: 'token', growTier: 'year' }), '100000');
  assert.equal(supplyForSeed({ kind: 'nft', rarity: 'legendary' }), '500');
  assert.equal(supplyForSeed({ kind: 'nft', rarity: 'rare' }), '5000');
  assert.ok(BigInt(supplyForSeed({ kind: 'token', growTier: 'day' })) > BigInt(supplyForSeed({ kind: 'nft', rarity: 'legendary' })));
});

test('buildMintOp + buildPlantOp build valid seeds ops; validate inputs', () => {
  const m = buildMintOp('hathor', { to: 'bob', symbol: 'vankush', quantity: '3' });
  assert.ok(m.ok, m.error);
  const mj = parse(m.op).json;
  assert.equal(mj.contractAction, 'mint');
  assert.equal(mj.contractPayload.symbol, 'VANKUSH');
  assert.equal(mj.contractPayload.to, 'bob');
  assert.equal(mj.contractPayload.quantity, '3');

  const p = buildPlantOp('bob', { symbol: 'AUTOSOUR', quantity: '1' });
  assert.ok(p.ok);
  assert.equal(parse(p.op).json.contractAction, 'plant');

  // validation
  assert.equal(buildMintOp('hathor', { to: 'BAD UPPER', symbol: 'X', quantity: '1' }).ok, false);
  assert.equal(buildMintOp('hathor', { to: 'bob', symbol: 'toolongsymbol', quantity: '1' }).ok, false);
  assert.equal(buildMintOp('hathor', { to: 'bob', symbol: 'X', quantity: '0' }).ok, false);
  assert.equal(buildMintOp('hathor', { to: 'bob', symbol: 'X', quantity: '1.5' }).ok, false);
  assert.equal(buildPlantOp('bob', { symbol: 'X', quantity: 'abc' }).ok, false);
});
