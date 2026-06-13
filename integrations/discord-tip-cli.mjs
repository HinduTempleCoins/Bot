#!/usr/bin/env node
// discord-tip-cli.mjs — the host side of the Discord /tip hookup. The live bot (index.js) spawns this
// with `<fromDiscordUser> <toAccount> <amount> <symbol>`; this fetches Hathor's JIT vault key, runs the
// tested handleTip (caps + op build), broadcasts the MELEK-Engine token tip as @hathor, and prints the
// Discord reply line on stdout. Keeps index.js free of any key handling. TESTNET only.
//
//   node integrations/discord-tip-cli.mjs <discordUser> <toAccount> <amount> <SYMBOL>

import { execFileSync } from 'node:child_process';
import { Client, PrivateKey } from '@hiveio/dhive';
import { handleTip } from './discord-tip-handler.mjs';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const VAULT = process.env.MELEK_VAULT_CLI || '/opt/melek-bot/vault.mjs';

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

(async () => {
  let key;
  try { key = hathorActiveKey(); } catch { console.log("Tipping is offline right now (couldn't reach the vault)."); process.exit(0); }
  const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
  const out = await handleTip(`/tip @${to.replace(/^@/, '')} ${amount} ${symbol}`, {
    from,
    deps: { tipFrom: 'hathor', broadcast: (op) => client.broadcast.sendOperations([op], key) },
  });
  console.log(out.reply || 'Nothing to tip.');
  process.exit(0);
})();
