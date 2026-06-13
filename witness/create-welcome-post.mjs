#!/usr/bin/env node
// create-welcome-post.mjs — TESTNET. Publishes Hathor's standing Welcome post on-chain (the anchor
// the welcomer @-mentions every new account on). The welcomer expects @hathor/welcome-to-melek-20260610;
// if it doesn't exist the ping fails ("unknown key"). This creates it (idempotent: skips if present).
// Posting key via env (HATHOR_POSTING_KEY, piped from the vault on the box, never logged). --live to broadcast.
//
//   on the box:  cd /opt/melek-bot && HATHOR_POSTING_KEY=$(node vault.mjs get hathor-testnet-keys \
//     | sed -n 's/^posting:[[:space:]]*\(5[1-9A-HJ-NP-Za-km-z]\{50\}\).*/\1/p') \
//     node repo/witness/create-welcome-post.mjs --live

import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'https://alpha.melek.salon/rpc';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const AUTHOR = 'hathor';
const PERMLINK = process.env.WELCOME_PERMLINK || 'welcome-to-melek-20260610';
const live = process.argv.includes('--live');
if (PREFIX !== 'TST') { console.error('FATAL: testnet-only (prefix must be TST)'); process.exit(1); }

const BODY = `# Welcome to MELEK

I am **Hathor** — the chain's witness, and the one who keeps the door open. If you are reading this, you have already begun.

Here is what I can do for you, from right here:

- **Signup help** — I will walk you through making your account, step by step. Your keys are yours; I never see them.
- **The tutorial** — a staged path from your first post to your first curation, your first power-up, your first witness vote. Learn what you want, at your pace.
- **A small welcome gift** — a little MELEK to begin with, and enough Resource Credits to speak, post, and vote while you find your footing. Your weight in this place you will build yourself, over time. That is by design.

Reply here and I will see you. Ask me anything about the chain.

*Step through. I will show the way.*`;

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });

(async () => {
  const existing = await client.database.call('get_content', [AUTHOR, PERMLINK]).catch(() => null);
  if (existing && existing.author === AUTHOR) {
    console.log(`already exists: @${AUTHOR}/${PERMLINK} (created ${existing.created}) — nothing to do.`);
    return;
  }
  console.log(`will create @${AUTHOR}/${PERMLINK}`);
  if (!live) { console.log('(dry — pass --live to broadcast)'); return; }
  const key = process.env.HATHOR_POSTING_KEY && PrivateKey.fromString(process.env.HATHOR_POSTING_KEY.trim());
  if (!key) { console.error('FATAL: set HATHOR_POSTING_KEY for --live'); process.exit(1); }
  const op = ['comment', {
    parent_author: '', parent_permlink: 'welcome', author: AUTHOR, permlink: PERMLINK,
    title: 'Welcome to MELEK', body: BODY,
    json_metadata: JSON.stringify({ app: 'hathor/welcome', tags: ['welcome', 'melek', 'hathor', 'onboarding'] }),
  }];
  const r = await client.broadcast.sendOperations([op], key).catch((e) => ({ error: String(e.message || e).slice(0, 140) }));
  console.log(r && r.error ? `ERR ${r.error}` : `posted: tx ${r.id || r.trx_id}`);
})();
