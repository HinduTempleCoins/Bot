/**
 * register.js — register Hathor as a witness, or update its witness record.
 *
 * Broadcasts a `witness_update` op signed by HATHOR_ACTIVE_KEY. Run once
 * at bootstrap after the on-chain account exists (OPERATOR.md §7), and
 * any time the signing key / url / props need to change.
 *
 * Required env vars:
 *   HATHOR_WITNESS_URL          — public URL describing the witness (e.g.
 *                                 the intro post's URL on the condenser)
 *   HATHOR_BLOCK_SIGNING_PUBKEY — public block-signing key (matches the
 *                                 private signing key on the witness_node
 *                                 host — see OPERATOR.md §2)
 * Optional env vars:
 *   HATHOR_ACCOUNT_CREATION_FEE — e.g. "0.000 MELEK" (default)
 *   HATHOR_MAXIMUM_BLOCK_SIZE   — e.g. 131072 (default)
 *
 * Modes:
 *   node witness/register.js --dry-run
 *   node witness/register.js --yes
 *
 * Without --yes this script refuses to broadcast. Witness registration
 * is a public, high-visibility action — the explicit confirm is the
 * "are you sure" you'd want anyway.
 */

import 'dotenv/config';
import { Hathor } from './hathor.js';

const URL = process.env.HATHOR_WITNESS_URL || '';
const SIGNING_KEY = process.env.HATHOR_BLOCK_SIGNING_PUBKEY || '';
const ACCOUNT_FEE = process.env.HATHOR_ACCOUNT_CREATION_FEE || '0.000 MELEK';
const MAX_BLOCK_SIZE = Number(process.env.HATHOR_MAXIMUM_BLOCK_SIZE || 131072);

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const confirmed = process.argv.includes('--yes');

  if (!URL) {
    console.error('HATHOR_WITNESS_URL not set (typically the intro post URL).');
    process.exit(1);
  }
  if (!SIGNING_KEY) {
    console.error('HATHOR_BLOCK_SIGNING_PUBKEY not set (the public block-signing key).');
    process.exit(1);
  }

  console.log(`account            : ${process.env.HATHOR_ACCOUNT || 'hathor'}`);
  console.log(`url                : ${URL}`);
  console.log(`block_signing_key  : ${SIGNING_KEY}`);
  console.log(`account creation fee: ${ACCOUNT_FEE}`);
  console.log(`maximum block size  : ${MAX_BLOCK_SIZE}`);

  if (dryRun) {
    console.log('');
    console.log('--- DRY RUN: no broadcast performed. ---');
    return;
  }

  if (!confirmed) {
    console.error('');
    console.error('refusing to broadcast without --yes. preview with --dry-run first.');
    process.exit(1);
  }

  const hathor = new Hathor();
  const status = hathor.status();
  if (!status.readyToConnect) {
    console.error(`cannot broadcast: missing env vars: ${status.missingConfig.join(', ')}`);
    process.exit(1);
  }
  if (!status.activeKeyLoaded) {
    console.error('cannot broadcast: HATHOR_ACTIVE_KEY not configured.');
    process.exit(1);
  }

  console.log('');
  console.log('broadcasting witness_update...');
  const result = await hathor.registerWitness({
    url: URL,
    blockSigningKey: SIGNING_KEY,
    props: {
      account_creation_fee: ACCOUNT_FEE,
      maximum_block_size: MAX_BLOCK_SIZE,
    },
  });
  console.log(`broadcast id: ${result.id ?? '(no id returned)'}`);
  console.log('witness registered. verify with `npm run hello`.');
}

main().catch((err) => {
  console.error(`register.js failed: ${err.message}`);
  process.exit(1);
});
