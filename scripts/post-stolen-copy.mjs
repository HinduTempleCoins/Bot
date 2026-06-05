// scripts/post-stolen-copy.mjs — set up the cross-platform-theft test fixture.
//
// Posts the @punicwax Steem original (the operator's canonical case) onto the
// MELEK testnet as @initminer/stolen-from-steem-<ts>, so cheetah/xplatform-theft.mjs
// has a real on-chain copy to catch. Step 2 of that test.
//
// TESTNET THROWAWAY KEY ONLY — supplied via the TESTNET_WIF env var. NEVER a
// mainnet/HIVE key, and NEVER hard-coded here (repo HARD RULE: zero WIF in this
// repo). On this fork initminer is the public Steem-testnet init account; its
// throwaway WIF lives in the testnet node config on the chain host — export it
// into TESTNET_WIF before running (recipe kept out of the repo, see .local).
// Comment ops serialize fine on this fork (only witness_update was broken).
//
// Idempotent-ish: each run posts a fresh permlink; the xplatform test matches
// any permlink starting `stolen-from-steem-`, so re-running is harmless.
//
//   node scripts/post-stolen-copy.mjs
//
// Env:
//   MELEK_RPC_URL   default https://alpha.melek.salon/rpc
//   STEEM_RPC_URL   default https://api.steemit.com
//   TESTNET_WIF     REQUIRED — testnet throwaway WIF (never committed; see above)
//   THIEF_ACCOUNT   default initminer

import { Client, PrivateKey } from '@hiveio/dhive';

const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_ADDRESS_PREFIX || 'TST';
const RPC = process.env.MELEK_RPC_URL || 'https://alpha.melek.salon/rpc';
const STEEM_RPC = process.env.STEEM_RPC_URL || 'https://api.steemit.com';
// Testnet throwaway WIF — env only, never hard-coded (repo HARD RULE).
const WIF = process.env.TESTNET_WIF;
if (!WIF) { console.error('set TESTNET_WIF (testnet throwaway key only) — see header comment'); process.exit(1); }
const THIEF = process.env.THIEF_ACCOUNT || 'initminer';

async function steem(method, params) {
  const r = await fetch(STEEM_RPC, { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }) });
  return (await r.json()).result;
}

// Pick the same original the test picks: first @punicwax post > 800 chars.
const blog = await steem('condenser_api.get_discussions_by_blog', [{ tag: 'punicwax', limit: 10 }]);
const head = (blog || []).find((p) => p.author === 'punicwax' && (p.body || '').length > 800);
if (!head) { console.error('no substantial @punicwax post found on Steem'); process.exit(1); }
// Fetch full content (blog list bodies can be truncated).
const orig = await steem('condenser_api.get_content', ['punicwax', head.permlink]);

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX });
const key = PrivateKey.fromString(WIF);

const permlink = 'stolen-from-steem-' + Date.now().toString(36);
const op = ['comment', {
  parent_author: '',
  parent_permlink: 'cheetah-test',
  author: THIEF,
  permlink,
  title: orig.title || 'Reposted',
  body: orig.body, // verbatim copy of the @punicwax Steem original
  json_metadata: JSON.stringify({ tags: ['cheetah-test', 'reposted'], app: 'cheetah-xplatform-test' }),
}];

console.log(`posting @${THIEF}/${permlink} (${orig.body.length} chars)…`);
const r = await client.broadcast.sendOperations([op], key);
console.log('tx:', r.id);
console.log('PERMLINK:', permlink);
console.log('verify: node cheetah/xplatform-theft.mjs');
