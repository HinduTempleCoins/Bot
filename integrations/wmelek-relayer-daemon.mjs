// wmelek-relayer-daemon.mjs — production entry for the MELEK L1 -> engine WMELEK relayer.
//
// Wraps the pure, tested runner (wmelek-relayer-runner.mjs) with the only two impure edges:
//   1. the real fetch (global, for the MELEK L1 read), and
//   2. the MELEK-Signer client `broadcast([op])` that signs the bridge.mintWrapped custom_json
//      as the bridge account (@hathor) with a SCOPED, REVOCABLE bearer token and broadcasts it.
//
// KEY CUSTODY (HARD rule "all witness tx via MELEK-Signer" + BRIEF.md §7 "Zero WIF in Bot repo"):
// this daemon holds NO WIF. @hathor's active key lives ONLY inside MELEK-Signer; the daemon holds
// ONLY the scoped token (MELEK_SIGNER_TOKEN), which the signer's policy engine can revoke. The
// token is scoped to `custom_json` (and, on the signer side, to the bridge sidechain id / active
// role). createSignerClient refuses a token that looks like a raw key (belt-and-braces).
//
// STAGED — NOT LIVE. Going live is gated on all three:
//   (a) the MELEK-Signer keepAlive fix (auto-system signer),
//   (b) the custody account `wmelek-bridge` existing (operator creates it 3-of-5), and
//   (c) the mainnet engine being deployed (so the mint actually lands).
// The daemon self-checks its env and refuses to start until MELEK_SIGNER_URL/MELEK_SIGNER_TOKEN/
// MELEK_RPC_URL are present — a missing token keeps it in a safe, do-nothing state.
//
// Env: MELEK_RPC_URL, WMELEK_BRIDGE_CUSTODY (default wmelek-bridge), MELEK_SIGNER_URL,
//   MELEK_SIGNER_TOKEN, CONFIRMATIONS, WMELEK_HISTORY_LIMIT, plus TICK_MS (poll interval, default 30000).
//
// The MELEK-Signer client lives ONLY here, at the edge, behind the runner's injectable submit.

import { fileURLToPath } from 'node:url';
import { existsSync, readFileSync } from 'node:fs';
import { createSignerClient } from '../src/chain/melek-signer-client.mjs';
import { makeRunner, loadConfig } from './wmelek-relayer-runner.mjs';

/**
 * Resolve the scoped MELEK-Signer bearer token. Supports the systemd-creds pattern
 * (MELEK_SIGNER_TOKEN points at a tmpfs credential FILE — token never on persistent disk)
 * as well as a plain env value (dev). Returns the trimmed token, or '' if unset. The token
 * value is never logged.
 */
export function resolveSignerToken(raw = process.env.MELEK_SIGNER_TOKEN) {
  const v = raw != null ? String(raw).trim() : '';
  if (!v) return '';
  // an absolute path to a readable file => read the token from it (systemd LoadCredentialEncrypted)
  if (v.startsWith('/') && existsSync(v)) {
    try { return readFileSync(v, 'utf8').trim(); } catch { return ''; }
  }
  return v;
}

/**
 * Build the submit(op, deposit) the runner calls per finalized deposit. It broadcasts the ONE
 * unsigned custom_json mint op through MELEK-Signer with an auditable client_ref keyed on the
 * depositRef (so the signer's audit log ties each broadcast to its L1 deposit).
 */
export function makeSignerSubmit({ signerUrl, signerToken }) {
  const signer = createSignerClient({ url: signerUrl, token: signerToken });
  return async (op, deposit) => {
    const clientRef = `wmelek-mint:${String((deposit && deposit.depositRef) || '').slice(0, 40)}`;
    return signer.broadcast([op], { clientRef });
  };
}

async function main() {
  const cfg = loadConfig();
  const signerUrl = process.env.MELEK_SIGNER_URL;
  const signerToken = resolveSignerToken();
  if (!cfg.melekRpc || !cfg.custody || !cfg.bridgeAccount || !cfg.sidechainId || !signerUrl || !signerToken) {
    process.stderr.write('[wmelek-relayer] missing env (MELEK_RPC_URL / WMELEK_BRIDGE_CUSTODY / MELEK_SIGNER_URL / MELEK_SIGNER_TOKEN) or engine config — staying DOWN (safe)\n');
    process.exit(1);
  }
  const submit = makeSignerSubmit({ signerUrl, signerToken });
  const runner = makeRunner(submit, cfg);
  const tickMs = Math.max(5000, +(process.env.TICK_MS || 30000));
  process.stdout.write(
    `[wmelek-relayer] bridge=${cfg.bridgeAccount} watching custody ${cfg.custody} on ${cfg.sidechainId} every ${tickMs}ms (signer broadcast)\n`,
  );
  const loop = async () => {
    try {
      const r = await runner.tick();
      if (r && r.submitted && r.submitted.length) {
        for (const s of r.submitted) {
          process.stdout.write(`[wmelek-relayer] minted WMELEK ref=${String(s.ref).slice(0, 14)} -> @${s.recipient} amount=${s.amount}\n`);
        }
      }
      if (r && r.failed && r.failed.length) process.stderr.write(`[wmelek-relayer] ${r.failed.length} failed this tick (will retry)\n`);
      if (r && !r.ok && r.reason) process.stderr.write(`[wmelek-relayer] read/setup issue: ${r.reason}\n`);
    } catch (e) { process.stderr.write(`[wmelek-relayer] tick error: ${e.message}\n`); }
  };
  await loop();
  setInterval(loop, tickMs);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
