// Tests for the seed-custody confirmation logic (pool/www/walletgen/custody.mjs).
// Run: node --test pool/www/custody.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickConfirmationPositions, checkConfirmation, buildBackupText, SEED_REVEAL_WARNING,
} from './walletgen/custody.mjs';

const MN =
  'fewest lipstick auburn cocoa macro circle hurried impel macro hatchet jeopardy swung ' +
  'aloof spiders gags jaws abducts buying alpine athlete junk patio academy loudly academy';

test('pickConfirmationPositions returns distinct, sorted, in-range positions (not the checksum word)', () => {
  // Deterministic RNG.
  let i = 0;
  const seq = [0.0, 0.5, 0.95, 0.95, 0.1];
  const rng = () => seq[i++ % seq.length];
  const pos = pickConfirmationPositions(25, 3, rng);
  assert.equal(pos.length, 3);
  assert.deepEqual([...pos].sort((a, b) => a - b), pos); // sorted
  assert.equal(new Set(pos).size, 3); // distinct
  for (const p of pos) { assert.ok(p >= 1 && p <= 24, `pos ${p} excludes checksum word 25`); }
});

test('checkConfirmation passes only when all quizzed words are correct', () => {
  const words = MN.split(/\s+/);
  const positions = [1, 16, 24];
  const good = { 1: words[0], 16: words[15], 24: words[23] };
  assert.deepEqual(checkConfirmation(MN, positions, good), { ok: true, wrong: [] });

  const bad = { 1: words[0], 16: 'WRONG', 24: words[23] };
  const r = checkConfirmation(MN, positions, bad);
  assert.equal(r.ok, false);
  assert.deepEqual(r.wrong, [16]);
});

test('checkConfirmation is case/space tolerant on the typed answer', () => {
  const words = MN.split(/\s+/);
  const answers = new Map([[3, '  AUBURN  ']]);
  assert.equal(checkConfirmation(MN, [3], answers).ok, true);
  assert.equal(words[2], 'auburn');
});

test('buildBackupText includes address + secret and a loud warning (cryptonote)', () => {
  const txt = buildBackupText({ name: 'Zephyr', symbol: 'ZEPH', address: 'ZEPHxxx', mnemonic: MN });
  assert.match(txt, /ZEPHxxx/);
  assert.match(txt, /Recovery phrase/);
  assert.match(txt, /cannot recover it/);
  assert.ok(txt.includes(MN));
});

test('buildBackupText handles the EVM private-key case', () => {
  const txt = buildBackupText({ name: 'Ethereum Classic', symbol: 'ETC', address: '0xabc', privateKey: '0xdead' });
  assert.match(txt, /Private key/);
  assert.match(txt, /every EVM chain/);
  assert.match(txt, /0xdead/);
});

test('SEED_REVEAL_WARNING is honest about non-recoverability', () => {
  assert.match(SEED_REVEAL_WARNING, /never stores it/);
  assert.match(SEED_REVEAL_WARNING, /can never recover/);
});
