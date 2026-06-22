// prana-arcade.test.mjs — OFFLINE. A throwaway ethers Wallet signs locally; no network, no real key.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ethers } from 'ethers';

process.env.PRANA_CHAIN_ID = '108369';
process.env.ARCADE_LEADERBOARD_ADDRESS = '0x' + 'ab'.repeat(20);
process.env.SEASON_PASS_ADDRESS = '0x' + 'cd'.repeat(20);

const {
  gameId, currentSeason, buildVoucher, scoreDigest, signScore, recoverAttester,
  recordScore, addXpCall, readBoard, __setReader, freshNonce,
} = await import('./prana-arcade.mjs');

const PLAYER = '0x' + '11'.repeat(20);

test('gameId: keccak of a name, deterministic; a bytes32 passes through', () => {
  const a = gameId('pentecaust-arena');
  assert.match(a, /^0x[0-9a-f]{64}$/);
  assert.equal(gameId('pentecaust-arena'), a);
  assert.notEqual(gameId('other'), a);
  const raw = '0x' + 'ff'.repeat(32);
  assert.equal(gameId(raw), raw);
});

test('currentSeason: floor(now/seasonLength); 0 on bad length', () => {
  assert.equal(currentSeason(86400, 86400 * 3 + 50), 3);
  assert.equal(currentSeason(0, 100), 0);
  assert.equal(currentSeason(-5, 100), 0);
});

test('buildVoucher normalizes to the exact hashed field types', () => {
  const v = buildVoucher({ player: PLAYER.toLowerCase(), game: 'g', season: 2, score: 100, nonce: 5, deadline: 9 });
  assert.equal(v.player, ethers.getAddress(PLAYER));   // checksummed
  assert.match(v.gameId, /^0x[0-9a-f]{64}$/);
  assert.equal(typeof v.season, 'bigint');
  assert.equal(v.score, 100n);
});

test('scoreDigest is deterministic and sensitive to every field', () => {
  const base = { player: PLAYER, game: 'g', season: 1, score: 10, nonce: 1, deadline: 100 };
  const d = scoreDigest(base);
  assert.match(d, /^0x[0-9a-f]{64}$/);
  assert.equal(scoreDigest(base), d);                          // stable
  assert.notEqual(scoreDigest({ ...base, score: 11 }), d);     // score changes it
  assert.notEqual(scoreDigest({ ...base, nonce: 2 }), d);      // nonce changes it
});

test('signScore + recoverAttester round-trip identifies the attester', async () => {
  const wallet = ethers.Wallet.createRandom();
  const voucher = buildVoucher({ player: PLAYER, game: 'g', season: 1, score: 42, nonce: 7, deadline: 1000 });
  const signed = await signScore(voucher, wallet);
  assert.equal(signed.ok, true);
  assert.equal(recoverAttester(voucher, signed.signature), wallet.address);
  // a tampered score no longer recovers to the attester (the on-chain check would reject it)
  assert.notEqual(recoverAttester({ ...voucher, score: 43n }, signed.signature), wallet.address);
});

test('signScore soft-fails without a signer', async () => {
  const r = await signScore(buildVoucher({ player: PLAYER, game: 'g', season: 1, score: 1, nonce: 1, deadline: 1 }), null);
  assert.equal(r.ok, false); assert.match(r.reason, /signer/);
});

test('recordScore: signs + builds the postScore call; posts when a post fn is given', async () => {
  const wallet = ethers.Wallet.createRandom();
  // no post fn → returns the unsigned-tx call descriptor for the edge
  const dry = await recordScore({ game: 'g', player: PLAYER, score: 500, seasonLength: 86400, nonce: 1, deadline: 2000 }, { signer: wallet });
  assert.equal(dry.ok, true); assert.equal(dry.posted, false);
  assert.equal(dry.call.fn, 'postScore');
  assert.equal(dry.call.args[0], ethers.getAddress(PLAYER));
  assert.equal(dry.call.args.length, 7);                       // player,gameId,season,score,nonce,deadline,signature
  assert.equal(dry.call.args[6], dry.signature);

  // with a post fn → it's invoked and the result returned
  let posted = null;
  const wet = await recordScore({ game: 'g', player: PLAYER, score: 500, seasonLength: 86400, nonce: 2, deadline: 2000 },
    { signer: wallet, post: async (c) => { posted = c; return '0xtxhash'; } });
  assert.equal(wet.ok, true); assert.equal(wet.posted, true); assert.equal(wet.result, '0xtxhash');
  assert.equal(posted.fn, 'postScore');
});

test('recordScore soft-fails on a bad player address', async () => {
  const r = await recordScore({ game: 'g', player: 'not-an-address', score: 1, seasonLength: 86400 }, { signer: ethers.Wallet.createRandom() });
  assert.equal(r.ok, false); assert.match(r.reason, /bad-voucher/);
});

test('addXpCall targets SeasonPass.addXp', () => {
  const c = addXpCall(PLAYER, 250);
  assert.equal(c.fn, 'addXp'); assert.equal(c.args[0], ethers.getAddress(PLAYER)); assert.equal(c.args[1], 250n);
});

test('reads go through the injected reader (soft-null without one)', async () => {
  assert.equal(await readBoard('g', 1), null);                 // no reader set
  __setReader(async (fn, args) => ({ fn, args }));
  const b = await readBoard('g', 3);
  assert.equal(b.fn, 'getBoard'); assert.equal(b.args[1], 3n);
  __setReader(null);
});

test('freshNonce yields distinct values', () => {
  assert.notEqual(freshNonce(), freshNonce());
});
