// sweep.mjs — move ALL liquid HIVE-Engine tokens off the (publicly-leaked-key) angelicalist account
// to the safe kalivankush account. Operator 2026-06-01: the keys can be found, so the funds must go
// somewhere else. This is the protective one-shot. DRY-RUN unless ANGELICALIST_LIVE=true + a key is
// present (key from .local/angelicalist.env, never committed/echoed). Receiving needs no key — only
// the send is signed with angelicalist's active key.
//
//   (dry-run)  node integrations/angelicalist/sweep.mjs
//   (live)     set -a; . .local/angelicalist.env; set +a; ANGELICALIST_LIVE=true node integrations/angelicalist/sweep.mjs

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

if (!LIVE || !process.env.ANGELICALIST_WIF) {
  console.log('\nDRY-RUN — nothing sent. Set ANGELICALIST_LIVE=true with the key in env to execute.');
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
