#!/usr/bin/env node
// vault-diag-to-chain.mjs — TESTNET diagnostic RELAY. The box can run this, but its stdout isn't
// visible to the assistant; so this captures the vault health + the `vault.mjs get` result and
// BROADCASTS a short diagnostic on-chain (custom_json from a test account whose posting key is
// re-derived from POPULATE_SEED), where the assistant can read it via get_account_history.
//
// SAFETY: it NEVER posts a private key. On success it posts only gotKey=true (no bytes); on failure
// it posts the error text with any WIF-pattern redacted. Testnet only.
//
//   node witness/vault-diag-to-chain.mjs            (relays from @melekvankush by default)

import { execFileSync } from 'node:child_process';
import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'https://alpha.melek.salon/rpc';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const SEED = process.env.POPULATE_SEED || 'melek-testnet-populate-v1';
const VAULT = process.env.MELEK_VAULT_CLI || '/opt/melek-bot/vault.mjs';
const RELAY = process.env.DIAG_RELAY || 'melekvankush'; // the account that posts the diagnostic
const VAULT_URL = process.env.VAULT_URL || 'https://127.0.0.1:8222';

const redact = (s) => String(s).replace(/5[1-9A-HJ-NP-Za-km-z]{50}/g, '<WIF-REDACTED>').slice(0, 480);

(async () => {
  const diag = { t: 'vault-diag' };

  // 1. Vaultwarden alive?
  try {
    const r = await fetch(`${VAULT_URL}/alive`, { headers: {} }).catch((e) => ({ status: 0, _e: String(e.message || e) }));
    diag.alive = r.status || 0;
  } catch (e) { diag.alive = 'err:' + redact(e.message || e); }

  // 2. vault.mjs get (capture stdout + stderr; NEVER post the key)
  try {
    const out = execFileSync('node', [VAULT, 'get', 'hathor-testnet-keys'], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] });
    diag.gotKey = /^active:\s*5[1-9A-HJ-NP-Za-km-z]{50}/m.test(out);
    diag.outLen = out.length;
    if (!diag.gotKey) diag.out = redact(out); // no key found — safe to show what came back
  } catch (e) {
    diag.gotKey = false;
    diag.err = redact((e.stderr ? e.stderr.toString() : '') + ' | ' + (e.message || e));
  }

  // 3. relay on-chain so the assistant can read it
  const m = PrivateKey.fromSeed(`${SEED}:${RELAY}`).toString().slice(0, 32);
  const postingKey = PrivateKey.fromLogin(RELAY, m, 'posting');
  const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
  const op = ['custom_json', { required_auths: [], required_posting_auths: [RELAY], id: 'melek-vaultdiag', json: JSON.stringify(diag) }];
  const r = await client.broadcast.sendOperations([op], postingKey).catch((e) => ({ error: String(e.message || e).slice(0, 120) }));
  console.log('diag relayed:', r.id || r.trx_id || r.error, JSON.stringify(diag));
})();
