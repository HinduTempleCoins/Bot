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

/**
 * Build a SIGNER-backed submit(call). Same contract as makeEthersSubmit, but the attester holds no
 * key: it encodes the calldata and asks MELEK-Signer to send the transaction from the account whose
 * 'evm'-role key the signer custodies.
 *
 * This works because attestDeposit is a TRANSACTION, not a detached signature — the bridge counts
 * distinct attester transactions reaching a threshold, so there is no digest for an EIP-191 prefix
 * to spoil. /v1/evm is sufficient exactly as it is.
 *
 * `fetchImpl` is injectable so this is testable offline with no network and no key.
 */
export function makeSignerSubmit({ signerUrl, signerToken, bridgeAddress, fetchImpl = (...a) => fetch(...a) }) {
  const base = String(signerUrl || '').replace(/\/+$/, '');
  const iface = new ethers.Interface(BRIDGE_ABI);
  return async (call) => {
    const [ref, tokenId, recipient, amount] = call.args;
    const data = iface.encodeFunctionData('attestDeposit', [ref, tokenId, recipient, amount]);
    const res = await fetchImpl(`${base}/v1/evm`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${signerToken}` },
      body: JSON.stringify({ tx: { to: bridgeAddress, data, value: '0x0' } }),
    });
    const j = await res.json().catch(() => null);
    // A refusal must throw, so the runner records it as a failure with a reason rather than
    // counting a phantom attestation — the bug that hid this whole outage for 22 hours.
    if (!j || !j.ok) throw new Error(`signer refused: ${(j && j.error) || `HTTP ${res.status}`}`);
    return (j.result && (j.result.hash || j.result.transactionHash)) || String(j.result);
  };
}

async function main() {
  const cfg = loadConfig();
  // Prefer the signer: no key in this process, no key in the env file. Fall back to a local key
  // only when the signer is not configured, so existing deployments keep working unchanged.
  const signerUrl = process.env.MELEK_SIGNER_URL;
  const signerToken = process.env.MELEK_SIGNER_TOKEN;
  const useSigner = Boolean(signerUrl && signerToken);
  const attesterKey = process.env.PRANA_ATTESTER_KEY;
  // In signer mode a local key is not merely unnecessary, it is the thing we are removing — so do
  // not demand one. Only the legacy path needs PRANA_ATTESTER_KEY.
  if (!cfg.melekRpc || !cfg.pranaRpc || !cfg.bridgeAddress || !cfg.custody || (!useSigner && !attesterKey)) {
    process.stderr.write('[bridge-daemon] missing env: need MELEK_RPC_URL/PRANA_RPC_URL/GRAPHENE_BRIDGE_ADDRESS/MELEK_BRIDGE_CUSTODY, plus either MELEK_SIGNER_URL+MELEK_SIGNER_TOKEN (preferred) or PRANA_ATTESTER_KEY\n');
    process.exit(1);
  }
  const submit = useSigner
    ? makeSignerSubmit({ signerUrl, signerToken, bridgeAddress: cfg.bridgeAddress })
    : makeEthersSubmit({ pranaRpc: cfg.pranaRpc, bridgeAddress: cfg.bridgeAddress, attesterKey });
  const runner = makeRunner(submit, cfg);
  const tickMs = Math.max(5000, +(process.env.TICK_MS || 30000));
  // Identify the attester without constructing a Wallet — in signer mode there is no key here to
  // construct one from, and asking the signer keeps the log honest about which address will act.
  let who = 'via signer';
  if (useSigner) {
    try {
      const r = await fetch(`${String(signerUrl).replace(/\/+$/, '')}/v1/evm/address`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${signerToken}` },
        body: '{}',
      });
      const j = await r.json().catch(() => null);
      who = (j && j.ok && j.address) ? `${j.address} (signer-held)` : `signer: ${(j && j.error) || 'address unavailable'}`;
    } catch (e) { who = `signer unreachable: ${String(e.message).slice(0, 60)}`; }
  } else {
    who = `${new ethers.Wallet(attesterKey).address} (local key)`;
  }
  process.stdout.write(`[bridge-daemon] attester ${who} watching custody ${cfg.custody} every ${tickMs}ms\n`);
  const loop = async () => {
    try {
      const r = await runner.tick();
      if (r && r.submitted && r.submitted.length) {
        for (const s of r.submitted) process.stdout.write(`[bridge-daemon] attested ref=${(s.depositRef || '').slice(0, 14)} -> ${(s.txHash || '').slice(0, 14)}\n`);
      }
      if (r && r.failed && r.failed.length) {
        // Print WHY, not just how many. The runner has recorded a reason per item all along;
        // logging only the count meant a bridge could retry-fail every 20s for a day and leave
        // nothing in the journal to diagnose it with. Distinct reasons only, so a stuck item
        // does not flood the log with the same line forever.
        const byReason = new Map();
        for (const f of r.failed) {
          const why = String((f && f.reason) || 'unknown').slice(0, 300);
          if (!byReason.has(why)) byReason.set(why, []);
          byReason.get(why).push(String((f && f.ref) != null ? f.ref : '?').slice(0, 16));
        }
        process.stderr.write(`[bridge-daemon] ${r.failed.length} failed this tick (will retry)\n`);
        for (const [why, items] of byReason) {
          process.stderr.write(`[bridge-daemon]   ${items.length}x ${why} (${items.slice(0, 3).join(', ')})\n`);
        }
      }
    } catch (e) { process.stderr.write(`[bridge-daemon] tick error: ${e.message}\n`); }
  };
  await loop();
  setInterval(loop, tickMs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
