#!/usr/bin/env node
// mutual-curation-live.mjs — TESTNET live test of the curation/vote-trail mechanic (Tomoyan-style
// autovote, but run directly): the populated testnet accounts UPVOTE EACH OTHER'S posts on-chain, so
// real curation activity is visible at alpha.melek.salon (net_votes climb, active_votes populate).
//
// This is the "fanbase / vote trail" idea from autovote/ exercised end-to-end: each account follows
// the others and votes their fresh posts. Keys are the SAME deterministic throwaway keys the populator
// derives (POPULATE_SEED) — re-derived in-process, never logged. Hard TST/TESTS guard; never mainnet.
//
//   node witness/mutual-curation-live.mjs            # dry run (plan only, no broadcast)
//   node witness/mutual-curation-live.mjs --live     # broadcast the votes on-chain
//
// Env: MELEK_RPC (default public testnet), POPULATE_SEED, POPULATE_NAMES, VOTE_WEIGHT (default 10000=100%).

import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'https://alpha.melek.salon/rpc';
const CHAIN_ID = process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = process.env.MELEK_PREFIX || 'TST';
const SEED = process.env.POPULATE_SEED || 'melek-testnet-populate-v1';
const NAMES = (process.env.POPULATE_NAMES || 'melekvankush,angelnetwork,cryptokannon,vrhathor,soapboxdao,templebuilder')
  .split(',').map((s) => s.trim()).filter(Boolean);
const WEIGHT = Math.max(1, Math.min(10000, Number(process.env.VOTE_WEIGHT || 10000)));
const POSTS_PER_AUTHOR = Number(process.env.POSTS_PER_AUTHOR || 2); // vote the N freshest posts per author
const VOTE_GAP_MS = Number(process.env.VOTE_GAP_MS || 3500);        // > chain min vote interval
const KEEP_LIQUID = Number(process.env.KEEP_LIQUID || 1);           // TESTS to leave liquid when powering up
const live = process.argv.includes('--live');
const doPowerup = process.argv.includes('--powerup'); // self-stake funded accounts so their votes carry weight
const reVote = process.argv.includes('--revote');     // re-cast even if already voted (updates rshares post-powerup)

// Hard guard: this script only ever runs on the MELEK TESTNET (prefix TST). Refuse anything else.
if (PREFIX !== 'TST') { console.error('FATAL: mutual-curation-live is testnet-only (prefix must be TST)'); process.exit(1); }

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Same derivation as witness/populate-testnet.mjs — deterministic keys, never logged.
function keyFor(name, role) {
  const m = PrivateKey.fromSeed(`${SEED}:${name}`).toString().slice(0, 32);
  return PrivateKey.fromLogin(name, m, role);
}
const postingKey = (name) => keyFor(name, 'posting');

// Self-stake (transfer_to_vesting) so a test account's votes carry positive weight. Funded accounts
// only; leaves KEEP_LIQUID liquid. Uses the account's own ACTIVE key (transfer_to_vesting is active-auth).
async function powerUp(accounts) {
  console.log('=== power-up (self-stake so votes carry weight) ===');
  const accts = await client.database.call('get_accounts', [accounts]).catch(() => []);
  for (const a of (accts || [])) {
    const liquid = Number(String(a.balance).split(' ')[0]);
    const vest = Math.floor((liquid - KEEP_LIQUID) * 1000) / 1000;
    if (!(vest > 0)) { console.log(`  @${a.name}: ${a.balance} — too low to power up (keep ${KEEP_LIQUID}), skip`); continue; }
    const op = ['transfer_to_vesting', { from: a.name, to: a.name, amount: `${vest.toFixed(3)} TESTS` }];
    const r = await client.broadcast.sendOperations([op], keyFor(a.name, 'active')).catch((e) => ({ error: String(e.message || e).slice(0, 110) }));
    console.log(`  @${a.name}: vest ${vest.toFixed(3)} TESTS -> ${r && r.error ? 'ERR ' + r.error : 'tx ' + (r.id || r.trx_id)}`);
    await sleep(VOTE_GAP_MS);
  }
  console.log('');
}

async function existing(names) {
  const accts = await client.database.call('get_accounts', [names]).catch(() => []);
  return new Set((accts || []).map((a) => a.name));
}
async function postsOf(author) {
  const r = await client.database.call('get_discussions_by_blog', [{ tag: author, limit: 10 }]).catch(() => []);
  // root posts authored BY this account only (get_discussions_by_blog includes reblogs)
  return (r || []).filter((p) => p.author === author).slice(0, POSTS_PER_AUTHOR);
}

(async () => {
  const present = await existing(NAMES);
  const accounts = NAMES.filter((n) => present.has(n));
  console.log(`mutual-curation (${live ? 'LIVE' : 'dry'}) on ${RPC}`);
  console.log(`accounts present: ${accounts.join(', ') || '(none)'}\n`);
  if (accounts.length < 2) { console.error('need >= 2 present accounts to cross-vote'); process.exit(1); }

  if (live && doPowerup) await powerUp(accounts);

  // Build the vote plan: every account votes the freshest posts of every OTHER account it has not
  // already voted on. (This is the fanbase/trail relationship: each follows all the others.)
  const plan = [];
  for (const author of accounts) {
    const posts = await postsOf(author);
    for (const post of posts) {
      const alreadyVoted = new Set((post.active_votes || []).map((v) => v.voter));
      for (const voter of accounts) {
        if (voter === author) continue;            // no self-votes
        if (alreadyVoted.has(voter) && !reVote) continue; // idempotent unless --revote (re-cast to update rshares)
        plan.push({ voter, author, permlink: post.permlink });
      }
    }
  }
  console.log(`planned votes: ${plan.length}`);
  for (const v of plan) console.log(`  @${v.voter} -> @${v.author}/${v.permlink}  (${(WEIGHT / 100).toFixed(0)}%)`);
  if (!live) { console.log('\n(dry — pass --live to broadcast the votes)'); return; }

  let ok = 0, fail = 0;
  for (const v of plan) {
    const op = ['vote', { voter: v.voter, author: v.author, permlink: v.permlink, weight: WEIGHT }];
    const r = await client.broadcast.sendOperations([op], postingKey(v.voter)).catch((e) => ({ error: String(e.message || e).slice(0, 110) }));
    if (r && r.error) { fail++; console.log(`  ✗ @${v.voter} -> @${v.author}: ${r.error}`); }
    else { ok++; console.log(`  ✓ @${v.voter} -> @${v.author}/${v.permlink}  tx ${r.id || r.trx_id || 'sent'}`); }
    await sleep(VOTE_GAP_MS); // stay above the chain's min vote interval
  }
  console.log(`\nvotes broadcast: ${ok} ok, ${fail} failed`);

  // Verify on-chain: re-read each author's posts and show net_votes climbed.
  console.log('\n=== verify (net_votes after) ===');
  for (const author of accounts) {
    for (const post of await postsOf(author)) {
      console.log(`  @${author}/${post.permlink}: net_votes=${post.net_votes}, voters=${(post.active_votes || []).length}`);
    }
  }
})();
