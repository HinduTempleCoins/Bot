// bridge-withdrawal-daemon.test.mjs — offline. The daemon wraps the pure withdrawal runner with two
// impure edges (PRANA eth_getLogs read + a dhive custody broadcaster). We test the broadcaster
// FACTORY shape and the key-custody boundary from source; the release logic itself is covered
// exhaustively by bridge-withdrawal-runner.test.mjs. No network, no key material.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { makeMelekBroadcaster } from './bridge-withdrawal-daemon.mjs';

const SRC = readFileSync('integrations/bridge-withdrawal-daemon.mjs', 'utf8');

test('makeMelekBroadcaster returns a broadcaster fn without touching the network on construction', () => {
  const fn = makeMelekBroadcaster({
    rpc: 'http://melek.local/rpc', chainId: 'ab'.repeat(32), prefix: 'TST',
    account: 'wmelek-bridge', master: 'not-a-real-master',
  });
  assert.equal(typeof fn, 'function'); // key is derived JIT inside the call, not at construction
});

test('the custody key is derived JIT and never logged (source boundary)', () => {
  // dhive imported only at this edge module
  assert.match(SRC, /from '@hiveio\/dhive'/);
  // JIT key derivation from the master password (mirrors the witness JIT-key rule)
  assert.match(SRC, /PrivateKey\.fromLogin\(account, master/);
  // the master is read from env, never hard-coded
  assert.match(SRC, /MELEK_BRIDGE_CUSTODY_MASTER \|\| process\.env\.CUSTODY_MASTER_PASSWORD/);
  // the master VALUE is never interpolated into a log/output line (env NAMEs in messages are fine)
  assert.equal(/\$\{\s*master\s*\}/.test(SRC), false);
  assert.equal(/\$\{\s*keyFor\b/.test(SRC), false);
});

test('the daemon refuses to start without the full custody env (fails safe, stays down)', () => {
  // main() exits 1 when any required env is missing — the redeem leg is DOWN, not half-configured.
  assert.match(SRC, /process\.exit\(1\)/);
  assert.match(SRC, /!cfg\.pranaRpc \|\| !cfg\.bridgeAddress \|\| !cfg\.custody \|\| !cfg\.nativeTokenId \|\| !master \|\| !rpc/);
});

test('importing the module has no side effects (CLI guarded)', () => {
  assert.match(SRC, /fileURLToPath\(import\.meta\.url\) === process\.argv\[1\]/);
});
