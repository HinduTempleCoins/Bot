/**
 * hello.js — Hathor's read-only smoke test.
 *
 * What it does:
 *   - Reports the Witness's local status (account name, network, key presence,
 *     missing config).
 *   - If config is complete, attempts ONE network read: head block + the
 *     Witness's own account record + its witness record (if one exists yet).
 *   - Never broadcasts. Never prints keys. Reports presence of keys only.
 *
 * Run:    npm run hello
 *
 * Phase 1 of the Bot per BRIEF.md §10 is "Hello World" — block production +
 * informational price feed + intro post. Actual block production runs on the
 * chain daemon's VPS, not in this repo. This script is the operator-side
 * "is everything wired up?" check that runs before any of that.
 */

import 'dotenv/config';
import { Hathor } from './witness/hathor.js';

function printStatus(s) {
  console.log('');
  console.log('  Hathor — MELEK AI Witness, local status');
  console.log('  ---------------------------------------');
  console.log(`  account            : ${s.account}`);
  console.log(`  network            : ${s.network}`);
  console.log(`  rpc url set        : ${s.rpcUrlSet ? 'yes' : 'no'}`);
  console.log(`  chain id set       : ${s.chainIdSet ? 'yes' : 'no'}`);
  console.log(`  address prefix set : ${s.addressPrefixSet ? 'yes' : 'no'}`);
  console.log(`  posting key loaded : ${s.postingKeyLoaded ? 'yes' : 'no'}`);
  console.log(`  active key loaded  : ${s.activeKeyLoaded ? 'yes' : 'no'}`);
  console.log(`  ready to connect   : ${s.readyToConnect ? 'yes' : 'no'}`);
  if (s.missingConfig.length > 0) {
    console.log(`  missing env vars   : ${s.missingConfig.join(', ')}`);
  }
  console.log('');
}

async function main() {
  const hathor = new Hathor();
  const status = hathor.status();
  printStatus(status);

  if (!status.readyToConnect) {
    console.log('  Chain config incomplete — skipping network probe.');
    console.log('  Set the env vars above (see .env.example) and try again.');
    console.log('');
    return;
  }

  console.log('  Probing chain...');
  try {
    const head = await hathor.getHeadBlock();
    console.log(`  head block         : ${head}`);
  } catch (err) {
    console.log(`  head block         : unreachable (${err.message})`);
    console.log('');
    return;
  }

  try {
    const acct = await hathor.getMyAccount();
    if (acct) {
      console.log(`  on-chain account   : found (created ${acct.created})`);
    } else {
      console.log(`  on-chain account   : not found — '${status.account}' has not been created yet`);
    }
  } catch (err) {
    console.log(`  on-chain account   : query failed (${err.message})`);
  }

  try {
    const witness = await hathor.getMyWitness();
    if (witness) {
      console.log(`  witness record     : found (signing key set, last confirmed block ${witness.last_confirmed_block_num ?? 'n/a'})`);
    } else {
      console.log(`  witness record     : none — '${status.account}' is not a registered witness yet`);
    }
  } catch (err) {
    console.log(`  witness record     : query failed (${err.message})`);
  }

  console.log('');
}

main().catch((err) => {
  console.error(`  hello.js failed: ${err.message}`);
  process.exit(1);
});
