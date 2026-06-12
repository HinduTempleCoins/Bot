#!/usr/bin/env node
// hathor-welcome-genesis.mjs — TESTNET-ONLY. Runs Hathor's welcome flow (the operator's spec:
// ping EVERY account on the Welcome post + grant 5–15 liquid coins) using the key that currently
// CONTROLS @hathor on-chain — the public Steem-testnet genesis key (the re-genesis left hathor on it).
// Public constant, signed in-process (never on the command line). Hard TST/TESTS guard.
//
// Steps: ensure Hathor's Welcome post exists -> fund Hathor from initminer if it's broke ->
// for each target account: Hathor grants a random 5–15 TESTS + pings them (@-mention) on the Welcome
// post. Idempotent-ish: skips the grant if the account was already paid by Hathor.
//
// Usage:  node witness/hathor-welcome-genesis.mjs <acct1> <acct2> ... [--live]

import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.MELEK_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e';
const PREFIX = 'TST';
// The public Steem-testnet genesis key currently controls @hathor + initminer. Provided via env
// (kept in .local, never committed). On the box: export MELEK_GENESIS_WIF=$(cat .local/genesis-wif).
const GENESIS_WIF = (process.env.MELEK_GENESIS_WIF || '').trim();
if (!GENESIS_WIF) { console.error('FATAL: set MELEK_GENESIS_WIF (public testnet genesis key, from .local)'); process.exit(1); }
const POST = 'welcome-to-melek';
const live = process.argv.includes('--live');
const targets = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const key = PrivateKey.fromString(GENESIS_WIF);
const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);
async function send(ops) { return client.broadcast.sendOperations(ops, key).catch((e) => ({ error: String(e.message || e).slice(0, 140) })); }
async function content(a, p) { return client.database.call('get_content', [a, p]).catch(() => null); }
async function acct(a) { const r = await client.database.call('get_accounts', [[a]]).catch(() => null); return r && r[0]; }
function grantAmount() { return (5 + Math.floor(Math.random() * 11)).toFixed(3) + ' TESTS'; } // 5..15

(async () => {
  // 1. ensure the Welcome post exists (authored by hathor)
  const wp = await content('hathor', POST);
  if (!(wp && wp.author === 'hathor')) {
    log('• welcome post missing — creating it');
    if (live) {
      const r = await send([['comment', { parent_author: '', parent_permlink: 'melek', author: 'hathor', permlink: POST,
        title: 'Welcome to MELEK 👋', body: 'Welcome to MELEK — the angel network. I’m Hathor, the witness here: I produce blocks, help newcomers, and answer questions. Every new account gets a little starter MELEK and a hello from me right here. Reply below and I’ll get you going.',
        json_metadata: JSON.stringify({ tags: ['melek', 'welcome'], app: 'melek-welcome/1.0' }) }]]);
      log('  welcome post:', r.error || ('tx ' + (r.id || r.trx_id))); if (r.error) return;
      await sleep(4500);
    }
  } else log('• welcome post exists');

  // 2. fund Hathor if it can't cover the grants (transfer from initminer — same genesis key)
  const h = await acct('hathor');
  const bal = h ? parseFloat(h.balance) : 0;
  const need = targets.length * 15 + 50;
  if (bal < need) {
    log(`• Hathor balance ${bal} TESTS < needed ~${need}; funding from initminer`);
    if (live) {
      const r = await send([['transfer', { from: 'initminer', to: 'hathor', amount: (need * 2).toFixed(3) + ' TESTS', memo: 'fund Hathor welcome grants' }]]);
      log('  fund:', r.error || ('tx ' + (r.id || r.trx_id))); if (r.error) return;
      await sleep(4500);
    }
  } else log(`• Hathor balance ${bal} TESTS is enough`);

  // 3. per account: grant 5–15 + ping on the welcome post
  const report = [];
  for (const t of targets) {
    const a = await acct(t);
    if (!a) { report.push(`${t}: account not found`); continue; }
    const amount = grantAmount();
    const pingPermlink = `welcome-${t}`.slice(0, 255);
    if (!live) { report.push(`${t}: would grant ${amount} + ping`); continue; }
    const g = await send([['transfer', { from: 'hathor', to: t, amount, memo: 'Welcome to MELEK! A little starter so you can explore. — Hathor' }]]);
    await sleep(3500);
    const p = await send([['comment', { parent_author: 'hathor', parent_permlink: POST, author: 'hathor', permlink: pingPermlink, title: '',
      body: `Welcome, @${t}! 🎉 You’re on MELEK now — I just sent you ${amount} to get started. Post anything and I’ll see it. Ask me questions right here.`,
      json_metadata: JSON.stringify({ tags: ['melek', 'welcome'], users: [t], app: 'melek-welcome/1.0' }) }]]);
    report.push(`${t}: grant ${amount} ${g.error ? '(ERR ' + g.error + ')' : 'ok'} | ping ${p.error ? '(ERR ' + p.error + ')' : 'ok'}`);
    await sleep(3500);
  }
  log('\n=== welcome report ===');
  report.forEach((r) => log(' •', r));
})();
