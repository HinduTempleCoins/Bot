#!/usr/bin/env node
// ping-welcome.mjs — TESTNET. Post the welcome @-mention ping for one or more accounts as a reply on
// Hathor's Welcome post (the op the welcomer does; it failed with "unknown key" while the post didn't
// exist). Proves/repairs the ping now that @hathor/welcome-to-melek-20260610 exists. Posting key via
// env (HATHOR_POSTING_KEY, from the vault; never logged). --live to broadcast.
//
//   node witness/ping-welcome.mjs zoe [more...] --live

import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'https://alpha.melek.salon/rpc';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const POST_AUTHOR = 'hathor';
const POST_PERMLINK = process.env.WELCOME_PERMLINK || 'welcome-to-melek-20260610';
const live = process.argv.includes('--live');
const accounts = process.argv.slice(2).filter((a) => !a.startsWith('--'));
if (PREFIX !== 'TST') { console.error('FATAL: testnet-only'); process.exit(1); }
if (!accounts.length) { console.error('usage: ping-welcome.mjs <acct...> [--live]'); process.exit(1); }

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  if (!live) { console.log(`(dry) would ping: ${accounts.join(', ')} on @${POST_AUTHOR}/${POST_PERMLINK}`); return; }
  const key = process.env.HATHOR_POSTING_KEY && PrivateKey.fromString(process.env.HATHOR_POSTING_KEY.trim());
  if (!key) { console.error('FATAL: set HATHOR_POSTING_KEY for --live'); process.exit(1); }
  for (const a of accounts) {
    const permlink = `welcome-${a}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 255);
    const body = `Welcome to MELEK, @${a}. You have your first MELEK and the Resource Credits to begin. Reply to me here, or start the tutorial whenever you are ready — I will show the way.`;
    const op = ['comment', {
      parent_author: POST_AUTHOR, parent_permlink: POST_PERMLINK, author: POST_AUTHOR, permlink,
      title: '', body, json_metadata: JSON.stringify({ app: 'hathor/welcome', tags: ['welcome'] }),
    }];
    const r = await client.broadcast.sendOperations([op], key).catch((e) => ({ error: String(e.message || e).slice(0, 140) }));
    console.log(`  ping @${a}: ${r && r.error ? 'ERR ' + r.error : 'tx ' + (r.id || r.trx_id)}`);
    await sleep(3500);
  }
})();
