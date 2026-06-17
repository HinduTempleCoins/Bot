// apis-paymaster-daemon.mjs — production entry for the APIS token-paymaster coordinator.
//
// Wraps the pure coordinator (apis-paymaster.mjs) with its ONE impure edge: the verifying-signer.
// The signer reproduces VerifyingPaymaster.sponsorshipHash exactly:
//   raw   = keccak256(abi.encodePacked(chainId, paymaster, user, maxCost, nonce))   // the packed hex we build
//   digest= toEthSignedMessageHash(raw)                                             // EIP-191 personal_sign
//   sig   = sign(digest) with PAYMASTER_SIGNER_KEY (must equal the contract's verifyingSigner)
// ECDSA.recover(digest, sig) on-chain then yields verifyingSigner -> sponsor() accepts it.
//
// Env: PRANA_RPC_URL, PRANA_CHAIN_ID, VERIFYING_PAYMASTER_ADDRESS, APIS_TOKEN_ADDRESS, APIS_PER_PRANA_WEI,
//   PAYMASTER_MARGIN_BPS, CONFIRMATIONS, PAYMASTER_SIGNER_KEY (this signer's key), PORT.
// ethers lives ONLY here, at the edge.

import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { ethers } from 'ethers';
import { handler, loadConfig, __setSigner } from './apis-paymaster.mjs';

/** Build the verifying-signer: async (packedHex) => signatureHex, matching the contract's digest. */
export function makeSigner(signerKey) {
  const wallet = new ethers.Wallet(signerKey);
  return async (packedHex) => {
    const raw = ethers.keccak256(packedHex);               // bytes32 keccak of abi.encodePacked(...)
    return wallet.signMessage(ethers.getBytes(raw));        // toEthSignedMessageHash(raw) + sign
  };
}

function main() {
  const cfg = loadConfig();
  const key = process.env.PAYMASTER_SIGNER_KEY;
  if (!cfg.pranaRpc || !cfg.paymaster || !cfg.apisToken || !key) {
    process.stderr.write('[apis-paymaster] missing env (PRANA_RPC_URL/VERIFYING_PAYMASTER_ADDRESS/APIS_TOKEN_ADDRESS/PAYMASTER_SIGNER_KEY)\n');
    process.exit(1);
  }
  __setSigner(makeSigner(key));
  const signer = new ethers.Wallet(key).address;
  const PORT = +(process.env.PORT || 8147);
  http.createServer((req, res) => handler(req, res)).listen(PORT, () => {
    process.stdout.write(`[apis-paymaster] signer ${signer} serving on :${PORT} (paymaster ${cfg.paymaster})\n`);
  });
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
