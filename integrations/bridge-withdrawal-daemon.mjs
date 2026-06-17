// bridge-withdrawal-daemon.mjs — production entry for the PRANA->MELEK withdrawal relayer.
//
// Wraps the pure watcher (bridge-withdrawal-runner.mjs) with its two impure edges:
//   1. the real fetch (global) for the PRANA eth_getLogs read, and
//   2. a dhive broadcaster that RELEASES native MELEK from the bridge custody account.
// The custody active key is derived JIT from the master password (env, never logged) exactly like the
// witness modules. Run K of these (one per custody co-signer) for a K-of-N release federation; the runner
// is idempotent per nonce so an instance never double-releases.
//
// Env: PRANA_RPC_URL, GRAPHENE_BRIDGE_ADDRESS, MELEK_BRIDGE_CUSTODY, BRIDGE_NATIVE_TOKEN_ID (keccak256
//   "MELEK"), MELEK_NATIVE_SYMBOL (default TESTS), CONFIRMATIONS, MELEK_RPC_URL, MELEK_CHAIN_ID,
//   MELEK_ADDRESS_PREFIX, MELEK_BRIDGE_CUSTODY_MASTER (or CUSTODY_MASTER_PASSWORD), TICK_MS.
//
// dhive lives ONLY here, at the edge.

import { fileURLToPath } from 'node:url';
import { Client, PrivateKey } from '@hiveio/dhive';
import { makeRunner, loadConfig } from './bridge-withdrawal-runner.mjs';

/** Build the dhive custody broadcaster: async (op, {keyType}) => result. Holds the JIT-derived key. */
export function makeMelekBroadcaster({ rpc, chainId, prefix, account, master }) {
  const client = new Client(rpc, { chainId, addressPrefix: prefix, timeout: 20000 });
  const keyFor = (keyType) => PrivateKey.fromLogin(account, master, keyType === 'posting' ? 'posting' : 'active');
  return async (op, { keyType = 'active' } = {}) => client.broadcast.sendOperations([op], keyFor(keyType));
}

async function main() {
  const cfg = loadConfig();
  // Accept either name so systemd can just include the existing custody envfile (CUSTODY_MASTER_PASSWORD).
  const master = process.env.MELEK_BRIDGE_CUSTODY_MASTER || process.env.CUSTODY_MASTER_PASSWORD;
  const rpc = process.env.MELEK_RPC_URL;
  if (!cfg.pranaRpc || !cfg.bridgeAddress || !cfg.custody || !cfg.nativeTokenId || !master || !rpc) {
    process.stderr.write('[withdrawal-daemon] missing env (PRANA_RPC_URL/GRAPHENE_BRIDGE_ADDRESS/MELEK_BRIDGE_CUSTODY/BRIDGE_NATIVE_TOKEN_ID/MELEK_BRIDGE_CUSTODY_MASTER/MELEK_RPC_URL)\n');
    process.exit(1);
  }
  const broadcast = makeMelekBroadcaster({
    rpc, chainId: process.env.MELEK_CHAIN_ID, prefix: process.env.MELEK_ADDRESS_PREFIX || 'TST',
    account: cfg.custody, master,
  });
  const runner = makeRunner(broadcast, cfg);
  const tickMs = Math.max(10000, +(process.env.TICK_MS || 60000));
  process.stdout.write(`[withdrawal-daemon] releasing from custody ${cfg.custody} (native ${cfg.nativeSymbol}) every ${tickMs}ms\n`);
  const loop = async () => {
    try {
      const r = await runner.tick();
      if (r && r.released && r.released.length) {
        for (const s of r.released) process.stdout.write(`[withdrawal-daemon] released #${s.nonce} -> ${s.to} ${s.amount}\n`);
      }
      if (r && r.failed && r.failed.length) process.stderr.write(`[withdrawal-daemon] ${r.failed.length} failed this tick (will retry)\n`);
      if (r && !r.ok) process.stderr.write(`[withdrawal-daemon] tick not ok: ${r.reason}\n`);
    } catch (e) { process.stderr.write(`[withdrawal-daemon] tick error: ${e.message}\n`); }
  };
  await loop();
  setInterval(loop, tickMs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
