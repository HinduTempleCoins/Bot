#!/usr/bin/env node
// scot-rewards-live.mjs — TESTNET end-to-end SCOT reward proof on-chain:
//   1. (initminer) re-setReward SCROLL with tag 'scroll' + issue SCROLL to a STAKER
//   2. (staker) stake SCROLL  -> gains the power to give out rewards
//   3. (author, holds ZERO SCROLL) post a 'scroll'-tagged post
//   4. (staker) L1-vote the author's post  -> engine folds a stake-weighted reward vote
//   5. wait the reward window -> engine cranks payout -> verify the NO-STAKE author got paid
// Proves: stake to GIVE OUT, no stake to GET. Genesis (initminer) key via env; test-account keys
// from POPULATE_SEED. --live to broadcast.
//
//   MELEK_GENESIS_WIF=… node engine/test/scot-rewards-live.mjs --live

import pkg from '@hiveio/dhive';
const { Client, PrivateKey } = pkg;

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = 'TST';
const SIDECHAIN = 'mse-testnet-melek';
const ENGINE_API = process.env.MELEK_ENGINE_API || 'http://127.0.0.1:8098';
const SEED = process.env.POPULATE_SEED || 'melek-testnet-populate-v1';
const SYMBOL = (process.env.SCOT_SYMBOL || 'SCROLL').toUpperCase();
const TAG = (process.env.SCOT_TAG || SYMBOL.toLowerCase());
const VIDEO = process.env.SCOT_VIDEO || ''; // if set, the test post carries this video URL (ScotTube/dTube)
const STAKER = process.env.SCOT_STAKER || 'melekvankush';
const AUTHOR = process.env.SCOT_AUTHOR || 'vrhathor';
const WINDOW = Number(process.env.SCOT_WINDOW || 20);
const live = process.argv.includes('--live');

const genesis = process.env.MELEK_GENESIS_WIF && PrivateKey.fromString(process.env.MELEK_GENESIS_WIF.trim());
if (live && !genesis) { console.error('FATAL: set MELEK_GENESIS_WIF (initminer/genesis)'); process.exit(1); }
const key = (n, role) => PrivateKey.fromLogin(n, PrivateKey.fromSeed(`${SEED}:${n}`).toString().slice(0, 32), role);

const c = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const eng = (acct, action, payload) => ['custom_json', { required_auths: [acct], required_posting_auths: [], id: SIDECHAIN, json: JSON.stringify({ contractName: action.c, contractAction: action.a, contractPayload: payload }) }];
async function bc(op, k, label) { const r = await c.broadcast.sendOperations([op], k).catch((e) => ({ error: String(e.message || e).slice(0, 120) })); console.log(`  ${label}: ${r.error ? 'ERR ' + r.error : 'tx ' + (r.id || r.trx_id)}`); return r; }
const bal = async (a) => { try { const r = await (await fetch(`${ENGINE_API}/api/balances?account=${a}&symbol=${SYMBOL}`)).json(); return Array.isArray(r) && r[0] ? Number(r[0].balance) : 0; } catch { return '?'; } };

(async () => {
  console.log(`scot-rewards-live (${live ? 'LIVE' : 'dry'}) — tribe ${SYMBOL}, staker @${STAKER}, author @${AUTHOR} (author holds 0 ${SYMBOL})`);
  if (!live) { console.log('(dry — pass --live)'); return; }

  // 0. create the token if it doesn't exist yet (issuer = initminer, burns APIS)
  const tok = await (await fetch(`${ENGINE_API}/api/tokens?symbol=${SYMBOL}`).catch(() => null))?.json?.().catch(() => []);
  if (!Array.isArray(tok) || !tok.length) {
    await bc(eng('initminer', { c: 'tokens', a: 'create' }, { symbol: SYMBOL, name: `${SYMBOL} Tribe`, precision: 3, maxSupply: '1000000' }), genesis, `create ${SYMBOL}`);
    await sleep(5000);
  }
  // 1. register the rule WITH the tag, and issue to the staker (initminer = issuer)
  await bc(eng('initminer', { c: 'rewards', a: 'setReward' }, { symbol: SYMBOL, tag: TAG, emissionPerWindow: '100', windowBlocks: WINDOW, authorBps: 5000, curve: 'linear' }), genesis, `setReward (tag=${TAG})`);
  await sleep(4000);
  await bc(eng('initminer', { c: 'tokens', a: 'issue' }, { symbol: SYMBOL, to: STAKER, quantity: '1000' }), genesis, `issue 1000 ${SYMBOL} -> @${STAKER}`);
  await sleep(5000);
  // 2. staker stakes -> power to give out
  await bc(eng(STAKER, { c: 'tokens', a: 'stake' }, { symbol: SYMBOL, quantity: '1000' }), key(STAKER, 'active'), `@${STAKER} stake 1000 ${SYMBOL}`);
  await sleep(5000);

  // 3. author (zero SCROLL) posts a 'scroll'-tagged post
  const permlink = `scot-${Date.now().toString(36)}`;
  const meta = { app: 'melek/scot-test', tags: [TAG, 'melek'], ...(VIDEO ? { video: VIDEO } : {}) };
  const body = VIDEO ? `A ${TAG}-tribe video by an author who holds no ${SYMBOL}.\n\n${VIDEO}` : `A ${TAG}-tribe post by an author who holds no ${SYMBOL}.`;
  await bc(['comment', { parent_author: '', parent_permlink: TAG, author: AUTHOR, permlink, title: VIDEO ? 'ScotTube test video' : 'SCOT reward test', body, json_metadata: JSON.stringify(meta) }], key(AUTHOR, 'posting'), `@${AUTHOR} posts (tag ${TAG}${VIDEO ? ', video' : ''})`);
  await sleep(4000);
  // 4. staker votes it -> engine folds a stake-weighted reward vote
  await bc(['vote', { voter: STAKER, author: AUTHOR, permlink, weight: 10000 }], key(STAKER, 'posting'), `@${STAKER} votes @${AUTHOR}/${permlink}`);

  console.log(`\nauthor ${SYMBOL} before payout: ${await bal(AUTHOR)}`);
  console.log(`waiting for the ${WINDOW}-block reward window + engine crank...`);
  for (let i = 0; i < 24; i++) {
    await sleep(8000);
    const a = await bal(AUTHOR);
    if (typeof a === 'number' && a > 0) { console.log(`\n✅ NO-STAKE AUTHOR PAID at ~${(i + 1) * 8}s: @${AUTHOR} = ${a} ${SYMBOL}; @${STAKER} (curator) = ${await bal(STAKER)} ${SYMBOL}`); process.exit(0); }
    if (i % 3 === 0) process.stdout.write(`  ...${(i + 1) * 8}s author=${a}\n`);
  }
  console.log(`\n⏱ no payout within ~190s. author=${await bal(AUTHOR)} staker=${await bal(STAKER)} (engine may still be catching up to head)`);
})();
