// melek-scot-token.test.mjs — offline. `node --test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MELEK_SCOT, createOp, hathorStakeOp, issueOp, launchBundle, announcement, status } from './melek-scot-token.mjs';

test('createOp builds a MELEK-Engine createTribe with NO tag (universal, no hashtag needed)', () => {
  const r = createOp('hathor');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.envelope.contractName, 'scot');
  assert.equal(r.envelope.contractAction, 'createTribe');
  assert.equal(r.envelope.contractPayload.tag, undefined);     // THE point: no tag → distributes universally
  assert.equal(r.envelope.contractPayload.symbol, 'FIAT');
  assert.equal(r.envelope.contractPayload.authorBps, 6500);
  assert.equal(r.op[0], 'custom_json');
});

test('Hathor stakes it — a stake op on the token (founding curator)', () => {
  const r = hathorStakeOp('500000', 'hathor');
  assert.equal(r.ok, true, r.error);
  // engine stake op is a custom_json; symbol + quantity present in the envelope/payload
  assert.equal(r.op[0], 'custom_json');
  assert.match(JSON.stringify(r), /FIAT/);
  assert.match(JSON.stringify(r), /500000/);
});

test('issueOp issues more of the token (issuer-only)', () => {
  const r = issueOp('alice', '1000', 'hathor');
  assert.equal(r.ok, true, r.error);
  assert.equal(r.envelope.contractPayload.symbol, 'FIAT');
  assert.equal(r.envelope.contractPayload.to, 'alice');
});

test('launchBundle = create + Hathor stake + announcement', () => {
  const b = launchBundle({ account: 'hathor', stakeAmount: '500000' });
  assert.equal(b.create.ok, true);
  assert.equal(b.hathorStake.ok, true);
  assert.match(b.announcement, /no hashtag/i);
  assert.equal(b.token.chain, 'MELEK-Engine');
});

test('announcement: distributes alongside MELEK, no tag, stake to curate, Hathor stakes', () => {
  const a = announcement({ issuer: 'hathor' });
  assert.match(a, /alongside \*\*MELEK\*\*|alongside MELEK/);
  assert.match(a, /no hashtag/i);
  assert.match(a, /Stake/);
  assert.match(a, /@hathor stakes it/i);
});

test('FIAT rarity sits between CURE (20M) and VKBT (500M) — less rare than CURE, more rare than VKBT', () => {
  const cap = BigInt(MELEK_SCOT.maxSupply);
  assert.ok(cap > 20000000n, 'FIAT cap must exceed CURE (20M) → less rare than CURE');
  assert.ok(cap < 500000000n, 'FIAT cap must be under VKBT (500M) → more rare than VKBT');
});

test('status flags it as SCOT/MELEK-Engine, universal, and name PROVISIONAL', () => {
  const s = status();
  assert.equal(s.kind, 'SCOT');
  assert.equal(s.chain, 'MELEK-Engine');
  assert.equal(s.universal, true);
  assert.equal(s.distributesAlongside, 'MELEK');
  assert.equal(s.provisionalName, false);
});
