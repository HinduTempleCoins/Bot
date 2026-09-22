// airdrop-authors.mjs — pay every author 5x their pending post payout, from Hathor, with a memo
// asking them to follow her for further airdrops.
//
// HARD RULE (CLAUDE.md "Zero WIF"): no private key lives in this repo or on this host. The active
// key is piped in from the vault ON THE BOX, per run, and is never logged and never passed on the
// command line. Without HATHOR_ACTIVE_KEY the script computes and prints the plan but cannot
// broadcast — that is the safety floor, same as feed-publisher.mjs.
//
//   On the box (key JIT from the vault):
//     cd /opt/melek-bot && node vault.mjs get melek-hathor-keys \
//       | sed -n 's/^active:[[:space:]]*//p' \
//       | HATHOR_ACTIVE_KEY=$(cat) node repo/witness/airdrop-authors.mjs --live
//
//   Plan only (safe anywhere, no key needed):
//     node witness/airdrop-authors.mjs
//
// Env: HATHOR_ACTIVE_KEY (required for --live), MELEK_RPC (default https://melek.salon/rpc),
//      MULTIPLIER (default 5), FROM (default hathor), MIN_PAY (default 0.001)

import { createRequire } from 'node:module';

const RPC = process.env.MELEK_RPC || 'https://melek.salon/rpc';
const FROM = process.env.FROM || 'hathor';
const MULT = Number(process.env.MULTIPLIER || 5);
const MIN_PAY = Number(process.env.MIN_PAY || 0.001);
const LIVE = process.argv.includes('--live');
const MEMO =
  'MELEK airdrop from @hathor — 5x your first post payout, for posting here in the early days. '
  + 'Follow @hathor for more airdrops while the platform is young.';

async function rpc(method, params, timeoutMs = 30000) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(RPC, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
      signal: ctl.signal,
    });
    const j = await res.json();
    if (j.error) throw new Error(`${method}: ${JSON.stringify(j.error).slice(0, 200)}`);
    return j.result;
  } finally { clearTimeout(timer); }
}

const amt = (s) => Number(String(s).split(' ')[0]);

/** Every author with a live pending payout, and what 5x of it comes to. */
export async function buildPlan() {
  const accounts = [];
  let start = '';
  for (;;) {
    const batch = await rpc('condenser_api.lookup_accounts', [start, 1000]);
    if (!batch || !batch.length) break;
    accounts.push(...batch);
    if (batch.length < 1000) break;
    start = batch[batch.length - 1];
  }

  const owed = new Map();
  const seen = new Set();
  for (const a of [...new Set(accounts)].sort()) {
    let posts;
    try { posts = await rpc('condenser_api.get_discussions_by_blog', [{ tag: a, limit: 100 }]); }
    catch { continue; }                        // a dead index is not a reason to stop the run
    for (const p of posts || []) {
      const key = `${p.author}/${p.permlink}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (p.cashout_time.startsWith('1969')) continue;   // already cashed out
      const v = amt(p.pending_payout_value);
      if (v > 0) owed.set(p.author, (owed.get(p.author) || 0) + v);
    }
  }

  return [...owed.entries()]
    .map(([author, due]) => ({ author, due, pay: Math.round(due * MULT * 1000) / 1000 }))
    .filter((r) => r.pay >= MIN_PAY)
    .sort((a, b) => b.pay - a.pay);
}

async function main() {
  const plan = await buildPlan();
  const totalDue = plan.reduce((n, r) => n + r.due, 0);
  const totalPay = plan.reduce((n, r) => n + r.pay, 0);

  console.log(`from=${FROM}  multiplier=${MULT}x  rpc=${RPC}`);
  console.log(`authors=${plan.length}  owed=${totalDue.toFixed(3)} MELEK  paying=${totalPay.toFixed(3)} MELEK\n`);
  for (const r of plan) console.log(`  ${r.author.padEnd(20)} owed ${r.due.toFixed(3).padStart(9)}  ->  pay ${r.pay.toFixed(3).padStart(10)} MELEK`);

  const [acct] = await rpc('condenser_api.get_accounts', [[FROM]]);
  const liquid = amt(acct.balance);
  console.log(`\n${FROM} liquid: ${liquid.toFixed(3)} MELEK`);
  if (liquid < totalPay) {
    console.error(`REFUSING: need ${totalPay.toFixed(3)}, have ${liquid.toFixed(3)}`);
    process.exit(1);
  }

  const key = process.env.HATHOR_ACTIVE_KEY;
  if (!LIVE || !key) {
    console.log(`\n${LIVE ? 'NO HATHOR_ACTIVE_KEY — ' : ''}PLAN ONLY, nothing broadcast.`);
    console.log('To send, run on the box with the key piped from the vault (see header).');
    return;
  }

  const require = createRequire(import.meta.url);
  const dsteem = require('dsteem');
  const client = new dsteem.Client(RPC, {
    chainId: '907959e559e253f0db275e467363425cc2cf4f20f7721699914d248a5547ad8b',
    addressPrefix: 'MELEK',
  });
  const wif = dsteem.PrivateKey.fromString(key);

  let sent = 0;
  for (const r of plan) {
    const op = ['transfer', {
      from: FROM,
      to: r.author,
      amount: `${r.pay.toFixed(3)} MELEK`,
      memo: MEMO,
    }];
    try {
      const res = await client.broadcast.sendOperations([op], wif);
      sent += r.pay;
      console.log(`SENT ${r.pay.toFixed(3)} -> ${r.author}  ${res.id}`);
    } catch (e) {
      console.log(`FAIL ${r.author}: ${String(e.message).slice(0, 140)}`);
    }
    await new Promise((s) => setTimeout(s, 3500));   // one per block, politely
  }
  console.log(`\ndone. paid ${sent.toFixed(3)} MELEK to ${plan.length} authors.`);
}

if (process.argv[1] && process.argv[1].endsWith('airdrop-authors.mjs')) {
  main().catch((e) => { console.error(String(e.message).slice(0, 300)); process.exit(1); });
}
