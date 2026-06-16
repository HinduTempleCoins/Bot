// bridge-relayer-daemon.mjs — production entry for ONE bridge attester instance.
//
// Wraps the pure, tested runner (bridge-relayer-runner.mjs) with the only two impure edges:
//   1. the real fetch (global, for the MELEK read), and
//   2. an ethers signer `submit(call)` that broadcasts THIS attester's attestDeposit to PRANA.
// Run K of these (one per attester private key) to satisfy the K-of-N bridge quorum. Each instance
// signs ONLY with its own key; the runner is idempotent so an instance never double-attests a ref.
//
// Env (see bridge-relayer-runner loadConfig): MELEK_RPC_URL, PRANA_RPC_URL, GRAPHENE_BRIDGE_ADDRESS,
//   MELEK_BRIDGE_CUSTODY, PRANA_ATTESTER_KEY (this instance's key), BRIDGE_TOKEN_ID, CONFIRMATIONS,
//   plus TICK_MS (poll interval, default 30000).
//
// This is a CLI daemon (no exports needed beyond the runner's). ethers lives ONLY here, at the edge.

import { fileURLToPath } from 'node:url';
import { ethers } from 'ethers';
import { makeRunner, loadConfig } from './bridge-relayer-runner.mjs';

const BRIDGE_ABI = ['function attestDeposit(bytes32 depositRef, bytes32 tokenId, address recipient, uint256 amount)'];

/** Build the ethers-backed submit(call) for one attester. call = attestationCall descriptor. */
export function makeEthersSubmit({ pranaRpc, bridgeAddress, attesterKey }) {
  const provider = new ethers.JsonRpcProvider(pranaRpc);
  const wallet = new ethers.Wallet(attesterKey, provider);
  const bridge = new ethers.Contract(bridgeAddress, BRIDGE_ABI, wallet);
  return async (call) => {
    const [ref, tokenId, recipient, amount] = call.args;
    const tx = await bridge.attestDeposit(ref, tokenId, recipient, amount);
    await tx.wait();
    return tx.hash;
  };
}

async function main() {
  const cfg = loadConfig();
  const attesterKey = process.env.PRANA_ATTESTER_KEY;
  if (!cfg.melekRpc || !cfg.pranaRpc || !cfg.bridgeAddress || !cfg.custody || !attesterKey) {
    process.stderr.write('[bridge-daemon] missing env (MELEK_RPC_URL/PRANA_RPC_URL/GRAPHENE_BRIDGE_ADDRESS/MELEK_BRIDGE_CUSTODY/PRANA_ATTESTER_KEY)\n');
    process.exit(1);
  }
  const submit = makeEthersSubmit({ pranaRpc: cfg.pranaRpc, bridgeAddress: cfg.bridgeAddress, attesterKey });
  const runner = makeRunner(submit, cfg);
  const tickMs = Math.max(5000, +(process.env.TICK_MS || 30000));
  const wallet = new ethers.Wallet(attesterKey);
  process.stdout.write(`[bridge-daemon] attester ${wallet.address} watching custody ${cfg.custody} every ${tickMs}ms\n`);
  const loop = async () => {
    try {
      const r = await runner.tick();
      if (r && r.submitted && r.submitted.length) {
        for (const s of r.submitted) process.stdout.write(`[bridge-daemon] attested ref=${(s.depositRef || '').slice(0, 14)} -> ${(s.txHash || '').slice(0, 14)}\n`);
      }
      if (r && r.failed && r.failed.length) process.stderr.write(`[bridge-daemon] ${r.failed.length} failed this tick (will retry)\n`);
    } catch (e) { process.stderr.write(`[bridge-daemon] tick error: ${e.message}\n`); }
  };
  await loop();
  setInterval(loop, tickMs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
