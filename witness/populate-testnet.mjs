#!/usr/bin/env node
// populate-testnet.mjs — TESTNET-ONLY: fill the MELEK feed with browseable content so the testnet
// looks like a living social network (the operator's point: a "testnet" is VISIBLE on-chain activity
// at alpha.melek.salon, not unit tests). Creates a few REUSABLE accounts (deterministic keys derived
// from a fixed seed, so re-runs don't burn faucet quota), then each posts several varied articles.
//
// All keys derived in-process from POPULATE_SEED — never logged. Hard TST/TESTS guard.
// Usage:  node witness/populate-testnet.mjs [accounts] [postsPerAccount]   (default 4 x 3)

import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const FAUCET = process.env.MELEK_FAUCET || 'http://127.0.0.1:7790';
const CHAIN_ID = (process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e').trim();
const PREFIX = (process.env.MELEK_PREFIX || 'TST').trim();
const SYMBOL = (process.env.MELEK_SYMBOL || 'TESTS').trim();
const SEED = process.env.POPULATE_SEED || 'melek-testnet-populate-v1';
const N = parseInt(process.argv[2] || '4', 10);
const K = parseInt(process.argv[3] || '3', 10);

if (PREFIX !== 'TST' || SYMBOL !== 'TESTS') { console.error(`testnet only (${PREFIX}/${SYMBOL})`); process.exit(2); }

// No `cryptokannon` here: CryptoKannon was a real human, and HATHOR is the tutor — no test account wears the
// person's handle (we honor her method, never her name). See integrations/hathor-tutor.mjs.
const NAMES = (process.env.POPULATE_NAMES || 'melekvankush,angelnetwork,vrhathor,soapboxdao,templebuilder').split(',').map((s) => s.trim()).filter(Boolean);
const TAGS = [['melek', 'intro'], ['melek', 'philosophy'], ['melek', 'tech'], ['melek', 'history'], ['melek', 'community']];
const TITLES = [
  'Why MELEK Pays You to Post', 'Notes from the Library of Ashurbanipal', 'The Angel Network, Explained',
  'How Witnesses Keep the Chain Open', 'Resource Credits for Newcomers', 'A Short History of On-Chain Attribution',
  'Building in Public on MELEK', 'The Convergence: Temple Technology', 'Crypt-ology and the Per-Person Map',
  'Lorem Ipsum: Placeholder for the Real Thing', 'What a Testnet Is For', 'Cheetah, the Credit-First Librarian',
];
const PARAS = [
  'Lorem ipsum dolor sit amet, consectetur adipiscing elit. MELEK is the angel network — post, upvote, and share in the daily rewards pool, with no algorithm deciding who sees you.',
  'The Library of Ashurbanipal catalogued clay tablets by subject and recorded the copyist in a colophon — an early act of attribution. MELEK treats that colophon as a design principle: credit travels with the work.',
  'A brand-new account starts with zero Resource Credits. Hathor delegates a little POWER so you can post from minute one; the stake is yours, a gift rather than a loan.',
  'Witnesses produce blocks and keep the network open. The community votes for them. Hathor is the founding witness here — it runs the chain, helps newcomers, and answers questions.',
  'Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. This is placeholder text standing in for the real content that will fill the feed as the community arrives.',
  'Cheetah is the chain’s attribution and discovery librarian: it states where content also appears and credits the source, first — never accusing. Hathor handles any resolution.',
];

function deriveKeys(name) {
  const m = PrivateKey.fromSeed(`${SEED}:${name}`).toString().slice(0, 32);
  const out = {};
  for (const role of ['owner', 'active', 'posting', 'memo']) {
    const priv = PrivateKey.fromLogin(name, m, role);
    out[role] = { priv, pub: priv.createPublic(PREFIX).toString() };
  }
  return out;
}
async function faucetCreate(name, k) {
  const res = await fetch(`${FAUCET}/faucet/create`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, ownerPub: k.owner.pub, activePub: k.active.pub, postingPub: k.posting.pub, memoPub: k.memo.pub }),
  });
  return res.json().catch(() => ({ ok: false, reason: 'bad-json' }));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
async function exists(name) { const a = await client.database.call('get_accounts', [[name]]).catch(() => null); return Boolean(a && a[0]); }

(async () => {
  const report = { created: [], reused: [], posts: [], errors: [] };
  let n = 0;
  for (const name of NAMES.slice(0, N)) {
    const keys = deriveKeys(name);
    if (await exists(name)) { report.reused.push(name); }
    else {
      const r = await faucetCreate(name, keys);
      if (r.ok) { report.created.push(name); await sleep(4000); }
      else { report.errors.push(`create ${name}: ${r.reason}`); continue; }
    }
    // each account posts K varied articles
    for (let j = 0; j < K; j++) {
      const idx = (n * K + j);
      const permlink = `melek-post-${name}-${j}-${process.hrtime.bigint() % 1000000n}`;
      const title = TITLES[idx % TITLES.length];
      const body = `${PARAS[idx % PARAS.length]}\n\n${PARAS[(idx + 2) % PARAS.length]}\n\n— @${name}`;
      const tags = TAGS[idx % TAGS.length];
      const op = ['comment', { parent_author: '', parent_permlink: tags[0], author: name, permlink, title, body, json_metadata: JSON.stringify({ tags, app: 'melek-populate/1.0' }) }];
      const r = await client.broadcast.sendOperations([op], keys.posting.priv).catch((e) => ({ error: String(e.message || e).slice(0, 100) }));
      if (r.error) report.errors.push(`post ${name}/${permlink}: ${r.error}`);
      else report.posts.push(`@${name}/${permlink} — "${title}"`);
      await sleep(3300); // STEEM_MIN_REPLY_INTERVAL ~3s
    }
    n++;
  }
  console.log(JSON.stringify(report, null, 2));
  console.log(`\nSUMMARY: created ${report.created.length}, reused ${report.reused.length}, posts ${report.posts.length}, errors ${report.errors.length}`);
})();
