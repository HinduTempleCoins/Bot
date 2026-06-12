#!/usr/bin/env node
// hathor-steemd-answer.mjs — TESTNET: the "steemd" face of Hathor. A user asks @hathor about the
// blockchain in a comment; Hathor replies on-chain with REAL, live chain data she pulls herself
// (head block, irreversibility, active witnesses, account count, supply, + the MELEK-Engine token
// count). Demonstrates Hathor-as-the-chain-daemon answering questions in the condenser comments.
//
// Asker signs with a deterministic populate-account key (POPULATE_SEED). Hathor signs with her vault
// posting key (HATHOR_POSTING_KEY env, sourced from the vault — works now that her keys are rotated).
// --live to broadcast.

import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = 'TST';
const ENGINE_API = process.env.MELEK_ENGINE_API || 'http://127.0.0.1:8098';
const ASKER = process.env.ASKER || 'melekvankush';
const SEED = process.env.POPULATE_SEED || 'melek-testnet-populate-v1';
const PARENT_AUTHOR = 'hathor';
const PARENT_PERMLINK = 'welcome-to-melek'; // Hathor's welcome thread = a natural Q&A spot
const live = process.argv.includes('--live');

const HATHOR_POSTING = (process.env.HATHOR_POSTING_KEY || '').trim();
if (live && !HATHOR_POSTING) { console.error('FATAL: set HATHOR_POSTING_KEY (Hathor vault posting key)'); process.exit(1); }
const hathorKey = HATHOR_POSTING ? PrivateKey.fromString(HATHOR_POSTING) : null;
// asker's deterministic posting key (mirrors populate-testnet.mjs derivation)
const askerMaster = PrivateKey.fromSeed(`${SEED}:${ASKER}`).toString().slice(0, 32);
const askerKey = PrivateKey.fromLogin(ASKER, askerMaster, 'posting');

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rpc = (m, p) => client.database.call(m, p);

async function chainFacts() {
  const dgp = await rpc('get_dynamic_global_properties', []).catch(() => ({}));
  const wits = await client.call('condenser_api', 'get_active_witnesses', []).catch(() => []);
  const active = (wits || []).filter(Boolean);
  let accounts = '?';
  try { accounts = await client.call('condenser_api', 'get_account_count', []); } catch {}
  let tokens = '?';
  try { const s = await (await fetch(`${ENGINE_API}/status`)).json(); tokens = s.tokenCount; } catch {}
  return {
    head: dgp.head_block_number, lib: dgp.last_irreversible_block_num,
    supply: dgp.current_supply, witnesses: active, accounts, tokens,
    chainShort: CHAIN_ID.slice(0, 8) + '…' + CHAIN_ID.slice(-4),
  };
}

function answerBody(f) {
  return [
    `Happy to! I'm Hathor — I *am* the chain daemon here, so I can read this straight off the ledger I produce:`,
    ``,
    `- **Head block:** #${f.head} (last irreversible: #${f.lib})`,
    `- **Chain id:** \`${f.chainShort}\` (prefix TST, testnet)`,
    `- **Active witnesses (${f.witnesses.length}):** ${f.witnesses.map((w) => '@' + w).join(', ')}`,
    `- **Accounts on chain:** ${f.accounts}`,
    `- **Current supply:** ${f.supply}`,
    `- **MELEK-Engine tokens (L2/SMT):** ${f.tokens}`,
    ``,
    `Blocks come every 3 seconds. Ask me anything else about the chain, your account, or how to get started. 🪽`,
  ].join('\n');
}

(async () => {
  const f = await chainFacts();
  const qPermlink = `chain-question-${ASKER}-${process.hrtime.bigint() % 1000000n}`;
  const aPermlink = `re-${qPermlink}`.slice(0, 255);
  const question = `Hey @hathor — what can you tell us about the MELEK blockchain right now? Block height, witnesses, supply, all of it?`;

  console.log('=== Hathor steemd Q&A ===');
  console.log('chain facts:', JSON.stringify(f));
  console.log('Hathor answer preview:\n' + answerBody(f));
  if (!live) { console.log('\n(dry — pass --live to broadcast)'); return; }

  // 1. asker posts the question (reply on Hathor's welcome thread)
  const qOp = ['comment', { parent_author: PARENT_AUTHOR, parent_permlink: PARENT_PERMLINK, author: ASKER, permlink: qPermlink,
    title: '', body: question, json_metadata: JSON.stringify({ tags: ['melek'], users: ['hathor'], app: 'melek-steemd-test/1.0' }) }];
  const qr = await client.broadcast.sendOperations([qOp], askerKey).catch((e) => ({ error: String(e.message || e).slice(0, 140) }));
  console.log(`\nquestion by @${ASKER}: ${qr.error ? 'ERR ' + qr.error : 'tx ' + (qr.id || qr.trx_id)}`);
  if (qr.error) return;
  await sleep(4500);

  // 2. Hathor answers with the live chain data
  const f2 = await chainFacts(); // refresh head block at answer time
  const aOp = ['comment', { parent_author: ASKER, parent_permlink: qPermlink, author: 'hathor', permlink: aPermlink,
    title: '', body: answerBody(f2), json_metadata: JSON.stringify({ tags: ['melek'], users: [ASKER], app: 'melek-steemd-test/1.0' }) }];
  const ar = await client.broadcast.sendOperations([aOp], hathorKey).catch((e) => ({ error: String(e.message || e).slice(0, 140) }));
  console.log(`Hathor answer: ${ar.error ? 'ERR ' + ar.error : 'tx ' + (ar.id || ar.trx_id)}`);
  if (ar.error) return;
  await sleep(4500);

  const onchain = await rpc('get_content', ['hathor', aPermlink]).catch(() => null);
  console.log(`\nverify: Hathor's answer on-chain = ${Boolean(onchain && onchain.author === 'hathor')}, body ${onchain ? onchain.body.length : 0} chars`);
  console.log(`thread: https://alpha.melek.salon/melek/@${PARENT_AUTHOR}/${PARENT_PERMLINK}`);
})();
