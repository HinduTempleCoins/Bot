#!/usr/bin/env node
// discord-tip-cli.mjs — the host side of the Discord /tip hookup. The live bot (index.js) spawns this
// with `<fromDiscordUser> <toAccount> <amount> <symbol>`; this fetches Hathor's JIT vault key, runs the
// tested handleTip (caps + op build), broadcasts the MELEK-Engine token tip as @hathor, and prints the
// Discord reply line on stdout. Keeps index.js free of any key handling. TESTNET only.
//
//   node integrations/discord-tip-cli.mjs <discordUser> <toAccount> <amount> <SYMBOL>

import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { Client, PrivateKey } from '@hiveio/dhive';
import { handleTip } from './discord-tip-handler.mjs';
import { makeTipLedger } from './discord-chain-bridge.mjs';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const VAULT = process.env.MELEK_VAULT_CLI || '/opt/melek-bot/vault.mjs';
// Durable anti-drain ledger. This CLI is spawned fresh per /tip, so an in-memory ledger would reset
// the rate-limit + daily-cap every invocation (only the per-tip cap would survive). Persist to a file
// the host owns so the caps actually bind across tips.
const LEDGER_FILE = process.env.MELEK_TIP_LEDGER || `${process.env.MELEK_DATA_DIR || '.'}/discord-tip-ledger.json`;

const [from, to, amount, symbolRaw] = process.argv.slice(2);
const symbol = (symbolRaw || 'MANNA').toUpperCase();
if (!from || !to || !amount) { console.log('Usage: /tip @user <amount> [TOKEN]'); process.exit(0); }

function hathorActiveKey() {
  // JIT vault fetch — same path the welcomer/feed use. The key is parsed and used in-process, never logged.
  const block = execFileSync('node', [VAULT, 'get', 'hathor-testnet-keys'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  const m = block.match(/^active:\s*(5[1-9A-HJ-NP-Za-km-z]{50})/m);
  if (!m) throw new Error('no active key from vault');
  return PrivateKey.fromString(m[1]);
}

// File-backed ledger so the anti-flood / anti-drain caps survive across the per-tip subprocess spawns.
function fileTipLedger() {
  return makeTipLedger({
    load: () => { try { return JSON.parse(readFileSync(LEDGER_FILE, 'utf8')); } catch { return null; } },
    save: (entries) => {
      try {
        const tmp = `${LEDGER_FILE}.tmp`;
        writeFileSync(tmp, JSON.stringify(entries), { mode: 0o600 });
        renameSync(tmp, LEDGER_FILE); // atomic replace
      } catch { /* soft-fail: a tip still goes through; the cap just isn't recorded this once */ }
    },
  });
}

// REMOTE mode — when the bot is NOT on the chain host (Azure/Google/etc.), POST the tip to the
// signer endpoint on the chain host instead of touching the vault locally. The endpoint enforces the
// caps + holds the key; this side holds nothing. Returns the endpoint's reply line.
const REMOTE_URL = process.env.MELEK_TIP_BROADCAST_URL || '';
const REMOTE_SECRET = process.env.MELEK_TIP_SHARED_SECRET || '';
async function remoteTip() {
  const r = await fetch(REMOTE_URL.replace(/\/$/, '') + '/tip', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + REMOTE_SECRET },
    body: JSON.stringify({ from, to: to.replace(/^@/, ''), amount, symbol }),
  });
  const j = await r.json().catch(() => null);
  return (j && j.reply) || (r.ok ? 'Tip sent.' : 'Tipping is offline right now.');
}

(async () => {
  if (REMOTE_URL) {
    let reply;
    try { reply = await remoteTip(); } catch { reply = "Tipping is offline right now (couldn't reach the signer)."; }
    console.log(reply); process.exit(0);
  }
  let key;
  try { key = hathorActiveKey(); } catch { console.log("Tipping is offline right now (couldn't reach the vault)."); process.exit(0); }
  const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
  const out = await handleTip(`/tip @${to.replace(/^@/, '')} ${amount} ${symbol}`, {
    from,
    deps: { tipFrom: 'hathor', ledger: fileTipLedger(), broadcast: (op) => client.broadcast.sendOperations([op], key) },
  });
  console.log(out.reply || 'Nothing to tip.');
  process.exit(0);
})();
