#!/usr/bin/env node
// hathor-welcome-live.mjs — TESTNET-ONLY single-account live test of Hathor's welcome flow.
//
// Proves, on the live chain, the three things the production welcomer does for a newcomer:
//   1. ensure Hathor's WELCOME POST exists (a real on-chain post Hathor authored),
//   2. delegate POWER (delegate_vesting_shares) so the newcomer has Resource Credits,
//   3. PING them with an @-mention reply on the welcome post (fires their wallet notification),
//   and attempts the TESTS grant (reported honestly — Hathor must be funded for it to land).
//
// Keys come ONLY from env (HATHOR_ACTIVE_KEY / HATHOR_POSTING_KEY), injected by the vault wrapper —
// never hardcoded or logged. Active key signs delegate/transfer; posting key signs comments.
// Hard TST/TESTS guard. Usage:  HATHOR_ACTIVE_KEY=.. HATHOR_POSTING_KEY=.. node hathor-welcome-live.mjs <target>

import { Client, PrivateKey } from '@hiveio/dhive';

const RPC = process.env.WELCOME_RPC || 'http://127.0.0.1:8090';
const CHAIN_ID = (process.env.MELEK_CHAIN_ID || '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e').trim();
const PREFIX = (process.env.MELEK_PREFIX || 'TST').trim();
const SYMBOL = (process.env.MELEK_SYMBOL || 'TESTS').trim();
const HATHOR = 'hathor';
const POST_PERMLINK = process.env.WELCOME_POST_PERMLINK || 'welcome-to-melek-20260610';
const DELEGATION = process.env.WELCOME_DELEGATION || '50.000000 VESTS'; // fits Hathor's stake
const GRANT = process.env.WELCOME_GRANT || `3.000 ${SYMBOL}`;

const target = process.argv[2];
if (PREFIX !== 'TST' || SYMBOL !== 'TESTS') { console.error(`testnet only (${PREFIX}/${SYMBOL})`); process.exit(2); }
if (!target) { console.error('usage: hathor-welcome-live.mjs <target-account>'); process.exit(2); }

const activeKey = process.env.HATHOR_ACTIVE_KEY && PrivateKey.fromString(process.env.HATHOR_ACTIVE_KEY.trim());
const postingKey = process.env.HATHOR_POSTING_KEY && PrivateKey.fromString(process.env.HATHOR_POSTING_KEY.trim());
if (!activeKey || !postingKey) { console.error('FATAL: HATHOR_ACTIVE_KEY / HATHOR_POSTING_KEY not in env'); process.exit(1); }

const client = new Client(RPC, { chainId: CHAIN_ID, addressPrefix: PREFIX, timeout: 20000 });
const report = { target, post: POST_PERMLINK, steps: [] };
const step = (name, d) => { report.steps.push({ name, ...d }); console.log(`• ${name}:`, JSON.stringify(d)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function exists(author, permlink) {
  const c = await client.database.call('get_content', [author, permlink]).catch(() => null);
  return Boolean(c && c.author === author);
}

(async () => {
  // 1. ensure the welcome post exists
  if (await exists(HATHOR, POST_PERMLINK)) {
    step('welcome-post', { existed: true });
  } else {
    const op = ['comment', {
      parent_author: '', parent_permlink: 'melek', author: HATHOR, permlink: POST_PERMLINK,
      title: 'Welcome to MELEK',
      body: 'Welcome to the MELEK testnet. I am Hathor, the witness here — I produce blocks, help newcomers, and answer questions. Reply here and I will get you started. New accounts: I delegate you a little POWER so you can post right away.',
      json_metadata: JSON.stringify({ tags: ['melek', 'welcome'], app: 'melek-welcome/1.0' }),
    }];
    const r = await client.broadcast.sendOperations([op], postingKey).catch((e) => ({ error: String(e.message || e) }));
    step('welcome-post', { created: !r.error, id: r.id || null, error: r.error || null });
    if (r.error) { report.aborted = 'welcome-post-failed'; return done(); }
    await sleep(4500);
  }

  // 2. delegate POWER (RC) — active key
  const delOp = ['delegate_vesting_shares', { delegator: HATHOR, delegatee: target, vesting_shares: DELEGATION }];
  const dr = await client.broadcast.sendOperations([delOp], activeKey).catch((e) => ({ error: String(e.message || e) }));
  step('delegate-power', { to: target, amount: DELEGATION, ok: !dr.error, id: dr.id || null, error: dr.error || null });
  await sleep(3500);

  // 3. attempt the TESTS grant — transfer from Hathor (will fail if Hathor is unfunded; reported)
  const grOp = ['transfer', { from: HATHOR, to: target, amount: GRANT, memo: 'Welcome to MELEK — a little starter to explore.' }];
  const gr = await client.broadcast.sendOperations([grOp], activeKey).catch((e) => ({ error: String(e.message || e) }));
  step('grant-tests', { to: target, amount: GRANT, ok: !gr.error, id: gr.id || null, error: gr.error ? gr.error.slice(0, 120) : null });
  await sleep(3500);

  // 4. ping — @-mention the newcomer in a reply on the welcome post (posting key)
  const pingPermlink = `welcome-${target}`.slice(0, 255);
  const pingOp = ['comment', {
    parent_author: HATHOR, parent_permlink: POST_PERMLINK, author: HATHOR, permlink: pingPermlink,
    title: '', body: `Welcome, @${target}! 🎉 You're on MELEK now. I delegated you a little POWER so you can post and comment right away. Ask me anything here.`,
    json_metadata: JSON.stringify({ tags: ['melek', 'welcome'], users: [target], app: 'melek-welcome/1.0' }),
  }];
  const pr = await client.broadcast.sendOperations([pingOp], postingKey).catch((e) => ({ error: String(e.message || e) }));
  step('welcome-ping', { mentions: target, permlink: pingPermlink, ok: !pr.error, id: pr.id || null, error: pr.error || null });
  await sleep(4500);

  // 5. verify on chain
  const ping = await client.database.call('get_content', [HATHOR, pingPermlink]).catch(() => null);
  const acct = await client.database.call('get_accounts', [[target]]).catch(() => null);
  const recv = acct && acct[0] ? acct[0].received_vesting_shares : '?';
  step('verify', { pingOnChain: Boolean(ping && ping.author === HATHOR), targetReceivedVesting: recv });
  report.ok = !report.aborted;
  done();
})();

function done() {
  console.log('\n=== REPORT ===\n' + JSON.stringify(report, null, 2));
  process.exit(report.ok ? 0 : 1);
}
