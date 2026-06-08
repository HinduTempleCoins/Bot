// custody.test.mjs — "did the user save their seed?" gate logic (pure, no DOM).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pickConfirmationPositions,
  checkConfirmation,
  buildBackupText,
  SEED_REVEAL_WARNING,
} from './custody.mjs';

const PHRASE =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima ' +
  'mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee';

test('pickConfirmationPositions: distinct, 1-based, count many, never the 25th word', () => {
  // Deterministic RNG cycling values so we exercise the dedupe loop.
  let i = 0;
  const seq = [0.0, 0.0, 0.5, 0.99, 0.99, 0.1];
  const rng = () => seq[i++ % seq.length];
  const pos = pickConfirmationPositions(25, 3, rng);
  assert.equal(pos.length, 3);
  assert.equal(new Set(pos).size, 3);            // distinct
  for (const p of pos) {
    assert.ok(p >= 1 && p <= 24, `position ${p} must be 1..24 (never the checksum word)`);
  }
  assert.deepEqual(pos, [...pos].sort((a, b) => a - b)); // sorted
});

test('pickConfirmationPositions throws if not enough words', () => {
  assert.throws(() => pickConfirmationPositions(2, 3));
});

test('checkConfirmation: all-correct passes', () => {
  const words = PHRASE.split(/\s+/);
  const positions = [1, 5, 12];
  const answers = { 1: words[0], 5: words[4], 12: words[11] };
  assert.deepEqual(checkConfirmation(PHRASE, positions, answers), { ok: true, wrong: [] });
});

test('checkConfirmation: wrong answers reported by position', () => {
  const positions = [1, 5, 12];
  const answers = { 1: 'alpha', 5: 'WRONG', 12: 'lima' };
  const r = checkConfirmation(PHRASE, positions, answers);
  assert.equal(r.ok, false);
  assert.deepEqual(r.wrong, [5]);
});

test('checkConfirmation: case-insensitive + trims whitespace', () => {
  const positions = [1, 5];
  const answers = { 1: '  ALPHA ', 5: 'Echo' };
  assert.deepEqual(checkConfirmation(PHRASE, positions, answers), { ok: true, wrong: [] });
});

test('checkConfirmation: missing answer counts as wrong (no throw)', () => {
  const r = checkConfirmation(PHRASE, [1, 5], { 1: 'alpha' });
  assert.equal(r.ok, false);
  assert.deepEqual(r.wrong, [5]);
});

test('checkConfirmation: accepts a Map of answers', () => {
  const m = new Map([[1, 'alpha'], [5, 'echo']]);
  assert.deepEqual(checkConfirmation(PHRASE, [1, 5], m), { ok: true, wrong: [] });
});

test('buildBackupText: mnemonic wallet includes phrase + address + loud warning', () => {
  const txt = buildBackupText({
    name: 'Monero', symbol: 'XMR', address: '4Addr', mnemonic: PHRASE,
  });
  assert.match(txt, /XMR/);
  assert.match(txt, /4Addr/);
  assert.ok(txt.includes(PHRASE));
  assert.match(txt, /WARNING/);
});

test('buildBackupText: EVM wallet includes the private key', () => {
  const txt = buildBackupText({
    name: 'Ethereum Classic', symbol: 'ETC', address: '0xabc', privateKey: '0xdeadbeef',
  });
  assert.ok(txt.includes('0xdeadbeef'));
  assert.match(txt, /EVM chain/);
});

test('SEED_REVEAL_WARNING warns against screenshot/paste/email', () => {
  assert.match(SEED_REVEAL_WARNING, /screenshot/i);
  assert.match(SEED_REVEAL_WARNING, /paste/i);
  assert.match(SEED_REVEAL_WARNING, /email/i);
});
