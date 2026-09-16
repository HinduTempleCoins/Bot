// sweep.mjs — move ALL liquid HIVE-Engine tokens off the angelicalist account to kalivankush.
//
// ⚠ THIS IS SUPERSEDED BY THE HARD RULE AND IS DISARMED. Read before touching it.
//
// It was written 2026-06-01 on the premise "the angelicalist key is public, so the funds must go
// somewhere else." That premise was retired twice over:
//
//   1. The operator ACCEPTED the account as compromised/burned (MoM 2026-06-11): the key was public
//      ~4 months and nothing was ever taken. The standing decision is explicitly NOT to gate the
//      account on key-rotation or custody moves — it is the hot trading account, and it trades.
//   2. The HARD RULE (same MoM): "funds may leave angelicalist ONLY as genuine realized PROFIT —
//      base value sold into another currency, appreciating, returning worth more; or cross-exchange
//      arbitrage." A blanket drain to @kalivankush is neither. It is housekeeping, and housekeeping
//      is exactly the category the rule was written to forbid. The same reasoning already removed
//      the auto-sweep from loop.mjs (PR #110), which had moved a 114 SWAP.HIVE float on a tick where
//      principal was 0. This file is the last remaining copy of that behaviour.
//
// It is NOT on any timer and must not be put on one. It survives only as a break-glass tool for an
// active key compromise — a case where moving funds is not a trade but a rescue — and it now refuses
// to run unless the operator names the destination explicitly in SWEEP_CONFIRM. There is no code path
// that reaches a live transfer without a human typing that account name on the command line.
//
//   (dry-run)  node integrations/angelicalist/sweep.mjs
//   (live)     SWEEP_CONFIRM=kalivankush ANGELICALIST_LIVE=true node integrations/angelicalist/sweep.mjs

import { Client, PrivateKey } from '@hiveio/dhive';
import { tokenBalances } from './internal.mjs';

const HIVE_NODES = (process.env.HIVE_NODES || 'https://api.hive.blog,https://api.deathwing.me,https://rpc.mahdiyari.info').split(',');
const ACCOUNT = process.env.ANGELICALIST_ACCOUNT || 'angelicalist';
const TO = process.env.SWEEP_TO_ACCOUNT || 'kalivankush';
const LIVE = process.env.ANGELICALIST_LIVE === 'true';
const client = new Client(HIVE_NODES, { timeout: 10000, failoverThreshold: 3 });
const DUST = parseFloat(process.env.SWEEP_DUST || '0.001'); // skip balances below this (not worth a tx)

function key() { try { return PrivateKey.fromString(process.env.ANGELICALIST_WIF); } catch { return null; } }

async function transferToken(k, symbol, quantity) {
  const json = JSON.stringify({ contractName: 'tokens', contractAction: 'transfer', contractPayload: { symbol, to: TO, quantity: String(quantity), memo: 'sweep to safety' } });
  const op = ['custom_json', { required_auths: [ACCOUNT], required_posting_auths: [], id: 'ssc-mainnet-hive', json }];
  const r = await client.broadcast.sendOperations([op], k);
  return r.id;
}

const tokens = await tokenBalances(ACCOUNT).catch(() => []);
const movable = tokens.filter((t) => t.balance >= DUST);
console.log(`Sweep @${ACCOUNT} -> @${TO}  [${LIVE && process.env.ANGELICALIST_WIF ? '🔴 LIVE' : '🟢 DRY-RUN'}]`);
console.log(`${movable.length} token(s) with a balance >= ${DUST}:`);
for (const t of movable) console.log(`  ${t.balance} ${t.symbol}`);

// The HARD-RULE gate. A sweep is not a trade, so it may never happen by default, by timer, or by a
// flag that some other service already sets. The destination must be named on this invocation.
const CONFIRMED = process.env.SWEEP_CONFIRM && process.env.SWEEP_CONFIRM === TO;

if (!LIVE || !process.env.ANGELICALIST_WIF) {
  console.log('\nDRY-RUN — nothing sent. This tool is disarmed by policy; see the header.');
} else if (!CONFIRMED) {
  console.log(`\nREFUSED — moving funds off @${ACCOUNT} is not a trade, and the HARD RULE allows funds`);
  console.log(`to leave only as realized profit or cross-exchange arbitrage. This is a break-glass tool`);
  console.log(`for an active key compromise only. To proceed, re-run with SWEEP_CONFIRM=${TO}.`);
  process.exit(2);
} else {
  const k = key();
  if (!k) { console.error('no valid key in ANGELICALIST_WIF'); process.exit(1); }
  console.log('\nExecuting transfers (one tx per token)…');
  for (const t of movable) {
    try {
      const id = await transferToken(k, t.symbol, t.balance);
      console.log(`  ✓ ${t.balance} ${t.symbol} -> @${TO}  tx ${id}`);
      await new Promise((r) => setTimeout(r, 3500)); // spacing to avoid duplicate-tx / RC throttle
    } catch (e) {
      console.log(`  ✗ ${t.symbol}: ${e.message}`);
    }
  }
  console.log('\nSweep complete. Verifying destination…');
  const after = await tokenBalances(TO).catch(() => []);
  for (const t of movable) { const got = after.find((x) => x.symbol === t.symbol); console.log(`  @${TO} ${t.symbol}: ${got ? got.balance : '(check)'}`); }
}
