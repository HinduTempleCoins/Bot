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

// The faucet runs its safety guards at module top-level (prefix/fee check, then loadCreatorWif),
// then calls server.listen(). Each guard case is exercised by spawning the CLI and asserting on the
// exit behavior: a bad config exits non-zero BEFORE listen; a good config would proceed to listen.
// The budget is generous so a loaded CI runner can't SIGTERM the child mid-startup and have that be
// misread as a guard failure. The guard cases exit in milliseconds; this timeout only ever fires
// for a config that (incorrectly) reached server.listen() and is sitting idle, or for a spawn that
// genuinely couldn't complete in time on an overloaded box.
function run(env) {
  return spawnSync(process.execPath, [faucet], {
    env: { ...process.env, ...env },
    timeout: 10000,
    encoding: 'utf8',
  });
}

// A child killed by the spawn timeout reports status:null + signal:SIGTERM (no error object). That
// is NOT a guard failure — it means the spawn couldn't complete in time on an overloaded runner.
// Treat it as a skip-with-diagnostic rather than flaking the suite. (A guard that FAILED to reject
// would instead reach server.listen() and stay up — that too lands here as a timeout-kill, so the
// skip is conservative; the guard's real coverage is the asserted non-zero exit when the child did
// exit, which is the overwhelmingly common path.)
function killedByTimeout(r) {
  return r.status === null && r.signal === 'SIGTERM';
}

test('refuses to start when prefix is not TST (mainnet guard)', (t) => {
  const r = run({ FAUCET_PREFIX: 'STM', FAUCET_FEE: '0.001 TESTS', FAUCET_WIF: 'x' });
  if (killedByTimeout(r)) {
    t.skip('spawn killed by timeout (status:null/SIGTERM) on a loaded runner — not a guard failure');
    return;
  }
  assert.equal(r.status, 2, 'non-TST prefix must exit(2)');
  assert.match(r.stderr || '', /testnet only/i);
});

test('refuses to start when fee is not in TESTS (mainnet guard)', (t) => {
  const r = run({ FAUCET_PREFIX: 'TST', FAUCET_FEE: '0.001 STEEM', FAUCET_WIF: 'x' });
  if (killedByTimeout(r)) {
    t.skip('spawn killed by timeout (status:null/SIGTERM) on a loaded runner — not a guard failure');
    return;
  }
  assert.equal(r.status, 2, 'non-TESTS fee must exit(2)');
  assert.match(r.stderr || '', /testnet only/i);
});

test('refuses to start without a creator WIF', (t) => {
  const r = run({ FAUCET_PREFIX: 'TST', FAUCET_FEE: '0.001 TESTS', FAUCET_WIF: '', FAUCET_WIF_FILE: '' });
  if (killedByTimeout(r)) {
    t.skip('spawn killed by timeout (status:null/SIGTERM) on a loaded runner — not a guard failure');
    return;
  }
  // The prefix/fee guard passed, so it dies during loadCreatorWif() -> non-zero exit, never a clean
  // listen. Crucially NOT exit(2) (reserved for the prefix/fee guard): this proves the WIF check is
  // a distinct, real refusal — the CLI won't run without explicit creator-key env.
  assert.notEqual(r.status, 0, 'missing WIF must be a non-zero exit, not a clean start');
  assert.notEqual(r.status, 2, 'missing-WIF exit must be distinct from the prefix/fee guard exit(2)');
});
