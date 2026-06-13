#!/usr/bin/env node
// discord-upvote-cli.mjs — host side of the Discord !upvote ("powdered upvote") hookup. The live bot
// (index.js) spawns this with `<discordUser> <author/permlink-or-url> [percent]`; it fetches Hathor's
// JIT vault POSTING key, runs the tested handleUpvote (1/account/day cap + vote op), broadcasts the
// MELEK vote as @hathor, and prints the Discord reply on stdout. No key handling in index.js. TESTNET.
//
//   node integrations/discord-upvote-cli.mjs <discordUser> <@author/permlink|url> [percent]

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { Client, PrivateKey } from '@hiveio/dhive';
import { handleUpvote, makeUpvoteLedger } from './discord-upvote-handler.mjs';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const VAULT = process.env.MELEK_VAULT_CLI || '/opt/melek-bot/vault.mjs';
const LEDGER_FILE = process.env.MELEK_UPVOTE_LEDGER || `${process.env.MELEK_DATA_DIR || '.'}/discord-upvote-ledger.json`;
const DEFAULT_PCT = Number(process.env.MELEK_UPVOTE_PCT || 1);
const MAX_PCT = Number(process.env.MELEK_UPVOTE_MAX_PCT || 10);

const [from, ref, pct] = process.argv.slice(2);
if (!from || !ref) { console.log('Usage: !upvote @author/permlink [percent]'); process.exit(0); }

function hathorPostingKey() {
  const block = execFileSync('node', [VAULT, 'get', 'hathor-testnet-keys'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const m = block.match(/^posting:\s*(5[1-9A-HJ-NP-Za-km-z]{50})/m);
  if (!m) throw new Error('no posting key from vault');
  return PrivateKey.fromString(m[1]);
}

function fileUpvoteLedger() {
  return makeUpvoteLedger({
    load: () => { try { return JSON.parse(readFileSync(LEDGER_FILE, 'utf8')); } catch { return null; } },
    save: (entries) => {
      try {
        const tmp = `${LEDGER_FILE}.tmp`;
        writeFileSync(tmp, JSON.stringify(entries), { mode: 0o600 });
        renameSync(tmp, LEDGER_FILE);
      } catch { /* soft-fail: the vote still goes through; the 1/day cap just isn't recorded this once */ }
    },
  });
}

// REMOTE mode — bot off the chain host: POST to the signer endpoint instead of touching the vault.
const REMOTE_URL = process.env.MELEK_UPVOTE_BROADCAST_URL || process.env.MELEK_TIP_BROADCAST_URL || '';
const REMOTE_SECRET = process.env.MELEK_TIP_SHARED_SECRET || '';
async function remoteUpvote() {
  const r = await fetch(REMOTE_URL.replace(/\/$/, '') + '/upvote', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + REMOTE_SECRET },
    body: JSON.stringify({ from, ref, pct }),
  });
  const j = await r.json().catch(() => null);
  return (j && j.reply) || (r.ok ? 'Upvote sent.' : 'Upvotes are offline right now.');
}

(async () => {
  if (REMOTE_URL) {
    let reply;
    try { reply = await remoteUpvote(); } catch { reply = "Upvotes are offline right now (couldn't reach the signer)."; }
    console.log(reply); process.exit(0);
  }
  let key;
  try { key = hathorPostingKey(); } catch { console.log("Upvotes are offline right now (couldn't reach the vault)."); process.exit(0); }
  const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
  const text = `!upvote ${ref}${pct ? ' ' + pct : ''}`;
  const out = await handleUpvote(text, {
    from,
    deps: {
      voter: 'hathor',
      rules: { defaultPct: DEFAULT_PCT, maxPct: MAX_PCT },
      ledger: fileUpvoteLedger(),
      broadcast: (op) => client.broadcast.sendOperations([op], key),
    },
  });
  console.log(out.reply || 'Nothing to upvote.');
  process.exit(0);
})();
