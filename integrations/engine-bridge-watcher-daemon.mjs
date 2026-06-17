// engine-bridge-watcher-daemon.mjs — production entry for ONE engine→PRANA attester instance.
//
// Wraps the pure watcher (engine-bridge-watcher.mjs) with the only impure edges: the real fetch (for the
// engine read) and an ethers signer that broadcasts THIS attester's attestDeposit to PRANA. Run K of these
// (one per attester key) for the K-of-N quorum on the SAME GrapheneDepositBridge as the wMELEK leg; the
// watcher is idempotent so an instance never double-attests a txId.
//
// Env: ENGINE_API_URL, PRANA_RPC_URL, GRAPHENE_BRIDGE_ADDRESS, BRIDGE_SYMBOLS (e.g. "APIS,DRONE"),
//   PRANA_ATTESTER_KEY (this instance's key), TICK_MS (default 30000). The symbol→bytes32 tokenId map is
//   computed here as keccak256(symbol) (ethers.id) unless BRIDGE_TOKEN_IDS overrides it.

import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { makeRunner, loadConfig } from './engine-bridge-watcher.mjs';
import { makeEthersSubmit } from './bridge-relayer-daemon.mjs';

function main() {
  const symbols = (process.env.BRIDGE_SYMBOLS || 'APIS').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
  // symbol -> keccak256(symbol) bytes32 tokenId (matches how wAPIS was registered: keccak256("APIS")).
  const tokenIds = {};
  for (const s of symbols) tokenIds[s] = ethers.id(s);
  const env = { ...process.env, BRIDGE_TOKEN_IDS: JSON.stringify(tokenIds) };

  const cfg = loadConfig(env);
  const attesterKey = process.env.PRANA_ATTESTER_KEY;
  if (!cfg.engineApi || !cfg.pranaRpc || !cfg.bridgeAddress || !attesterKey) {
    process.stderr.write('[engine-watcher] missing env (ENGINE_API_URL/PRANA_RPC_URL/GRAPHENE_BRIDGE_ADDRESS/PRANA_ATTESTER_KEY)\n');
    process.exit(1);
  }
  const submit = makeEthersSubmit({ pranaRpc: cfg.pranaRpc, bridgeAddress: cfg.bridgeAddress, attesterKey });
  const runner = makeRunner(submit, cfg);
  const tickMs = Math.max(5000, +(process.env.TICK_MS || 30000));
  const who = new ethers.Wallet(attesterKey).address;
  process.stdout.write(`[engine-watcher] attester ${who} bridging ${symbols.join(',')} (${cfg.engineApi}) every ${tickMs}ms\n`);
  const loop = async () => {
    try {
      const r = await runner.tick();
      for (const s of (r.submitted || [])) process.stdout.write(`[engine-watcher] attested ${s.symbol} ${s.txId} -> ${s.recipient}\n`);
      if (r.failed && r.failed.length) process.stderr.write(`[engine-watcher] ${r.failed.length} failed this tick (will retry)\n`);
    } catch (e) { process.stderr.write(`[engine-watcher] tick error: ${e.message}\n`); }
  };
  loop();
  setInterval(loop, tickMs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
