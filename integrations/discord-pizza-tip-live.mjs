#!/usr/bin/env node
// discord-pizza-tip-live.mjs — TESTNET: the PIZZA-bot flow on MELEK, end to end except the Discord
// socket itself. Simulates a Discord "!tip @user <n> MANNA" command (parsed by the real bridge),
// then has @hathor — the bot — broadcast the on-chain TOKEN tip (a MELEK-Engine custom_json
// tokens.transfer). The recipient ends up holding the token; the engine reflects it.
//
// Why this shape: discord-chain-bridge.mjs maps Discord commands -> ops and NEVER holds a key; the
// HOST broadcasts. Here the host is this script: initminer (genesis key) bootstraps the MANNA tip
// token and stocks Hathor; Hathor (vault posting key) signs the tip. The only piece NOT exercised is
// the live Discord message in -> bot out (needs a real Discord post; the melek-discord bot is wired).
//
// Env: MELEK_GENESIS_WIF (initminer, create/issue), HATHOR_ACTIVE_KEY (hathor, the tip). --live broadcasts.

import { Client, PrivateKey } from '@hiveio/dhive';
import { parseCommand } from './discord-chain-bridge.mjs';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = 'TST';
const SIDECHAIN = 'mse-testnet-melek';
const ENGINE_API = process.env.MELEK_ENGINE_API || 'http://127.0.0.1:8098';
const SYMBOL = process.env.TIP_SYMBOL || 'MANNA';
const RECIPIENT = process.env.TIP_TO || 'melekvankush';
const TIP_AMOUNT = process.env.TIP_AMOUNT || '10';
const live = process.argv.includes('--live');

const genesis = process.env.MELEK_GENESIS_WIF && PrivateKey.fromString(process.env.MELEK_GENESIS_WIF.trim());
const hathorKey = process.env.HATHOR_ACTIVE_KEY && PrivateKey.fromString(process.env.HATHOR_ACTIVE_KEY.trim());
if (live && (!genesis || !hathorKey)) { console.error('FATAL: set MELEK_GENESIS_WIF and HATHOR_ACTIVE_KEY'); process.exit(1); }

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const engineOp = (acct, action, payload) => ['custom_json', { required_auths: [acct], required_posting_auths: [], id: SIDECHAIN, json: JSON.stringify({ contractName: 'tokens', contractAction: action, contractPayload: payload }) }];
async function bc(ops, key, label) { const r = await client.broadcast.sendOperations(ops, key).catch((e) => ({ error: String(e.message || e).slice(0, 120) })); console.log(`  ${label}: ${r.error ? 'ERR ' + r.error : 'tx ' + (r.id || r.trx_id)}`); return r; }
async function bal(acct) { try { const b = await (await fetch(`${ENGINE_API}/api/balances?account=${acct}&symbol=${SYMBOL}`)).json(); return Array.isArray(b) && b[0] ? b[0].balance : '0'; } catch { return '?'; } }

(async () => {
  // Parse the Discord command exactly as the live bridge would.
  const discordText = `!tip @${RECIPIENT} ${TIP_AMOUNT} ${SYMBOL}`;
  const cmd = parseCommand(discordText);
  console.log(`Discord command "${discordText}" parsed by the bridge:`, JSON.stringify({ cmd: cmd.cmd, to: cmd.to, amount: cmd.amount }));
  console.log(`=> Hathor (the bot) will tip @${cmd.to || RECIPIENT} ${TIP_AMOUNT} ${SYMBOL} on the MELEK-Engine.`);
  if (!live) { console.log('\n(dry — pass --live to broadcast)'); return; }

  // 1. bootstrap the tip token + stock Hathor (initminer = genesis key)
  const tok = await (await fetch(`${ENGINE_API}/api/tokens?symbol=${SYMBOL}`)).json().catch(() => []);
  if (!Array.isArray(tok) || !tok.length) {
    await bc([engineOp('initminer', 'create', { symbol: SYMBOL, name: 'Manna', precision: 3, maxSupply: '1000000' })], genesis, `create ${SYMBOL}`);
    await sleep(4500);
  } else console.log(`  ${SYMBOL} already exists`);
  await bc([engineOp('initminer', 'issue', { symbol: SYMBOL, to: 'hathor', quantity: '50000' })], genesis, `issue 50000 ${SYMBOL} -> @hathor (bot stash)`);
  await sleep(6000); // let the engine credit Hathor before she tips

  // 2. the tip: Hathor transfers the token to the recipient (signed with Hathor's vault key)
  await bc([engineOp('hathor', 'transfer', { symbol: SYMBOL, to: RECIPIENT, quantity: TIP_AMOUNT })], hathorKey, `Hathor tips ${TIP_AMOUNT} ${SYMBOL} -> @${RECIPIENT}`);
  await sleep(8000); // let the engine process

  // 3. verify on the engine
  console.log('\n=== engine state ===');
  console.log(`  @hathor stash: ${await bal('hathor')} ${SYMBOL}`);
  console.log(`  @${RECIPIENT}:  ${await bal(RECIPIENT)} ${SYMBOL}`);
})();
