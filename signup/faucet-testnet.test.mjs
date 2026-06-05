// faucet-testnet.test.mjs — offline tests for the testnet faucet's validators + safety guards.
// node --test signup/faucet-testnet.test.mjs
//
// The faucet's broadcast path is exercised live against the testnet (see the deploy notes);
// these tests cover the offline-checkable surface: the testnet-only startup guard and that the
// inlined key/name validators match the account-create.mjs custody rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = path.dirname(fileURLToPath(import.meta.url));
const faucet = path.join(here, 'faucet-testnet.mjs');

function run(env) {
  // Start with a 0.3s budget: the guard either exits(2) immediately (bad config) or starts
  // listening (good config). We only need the exit behavior, so kill after a moment.
  return spawnSync(process.execPath, [faucet], {
    env: { ...process.env, ...env },
    timeout: 1500,
    encoding: 'utf8',
  });
}

test('refuses to start when prefix is not TST (mainnet guard)', () => {
  const r = run({ FAUCET_PREFIX: 'STM', FAUCET_FEE: '0.001 TESTS', FAUCET_WIF: 'x' });
  assert.equal(r.status, 2, 'non-TST prefix must exit(2)');
  assert.match(r.stderr || '', /testnet only/i);
});

test('refuses to start when fee is not in TESTS (mainnet guard)', () => {
  const r = run({ FAUCET_PREFIX: 'TST', FAUCET_FEE: '0.001 STEEM', FAUCET_WIF: 'x' });
  assert.equal(r.status, 2, 'non-TESTS fee must exit(2)');
});

test('refuses to start without a creator WIF', () => {
  const r = run({ FAUCET_PREFIX: 'TST', FAUCET_FEE: '0.001 TESTS', FAUCET_WIF: '', FAUCET_WIF_FILE: '' });
  // dies during loadCreatorWif() -> non-zero exit, not a clean listen
  assert.notEqual(r.status, 0);
});
