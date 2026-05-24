/**
 * disable.js — emergency circuit breaker. Retires the Hathor witness.
 *
 * Broadcasts a `witness_update` op with block_signing_key set to the
 * chain's null public key. After this op confirms, Hathor is removed
 * from the witness schedule and produces no further blocks.
 *
 * When to use:
 *   - Suspected compromise of the Bot's host but the active key still
 *     yours to broadcast with (e.g. anomalous activity but no transfers
 *     have happened yet). Hit the brake while you investigate.
 *   - Planned maintenance / extended downtime.
 *
 * When NOT to use:
 *   - The active key is compromised. An attacker with the active key
 *     can already broadcast anything; this script does nothing useful
 *     in that case. Go to the offline owner-key machine instead, rotate
 *     keys via account_update, and re-do OPERATOR.md §3 onward.
 *   - You are unsure whether your host is compromised. Stop the Bot
 *     process first, investigate, then decide. See SECURITY.md §6.
 *
 *   node witness/disable.js --dry-run    # show what would happen, no broadcast
 *   node witness/disable.js --yes        # actually broadcast
 *
 * Without --yes, this script refuses to broadcast. Required because
 * retiring the witness is a high-consequence, slow-to-undo move.
 */

import 'dotenv/config';
import { Hathor } from './hathor.js';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const confirmed = process.argv.includes('--yes');

  if (!dryRun && !confirmed) {
    console.error('refusing to broadcast without --yes.');
    console.error('use --dry-run first to verify, then re-run with --yes to confirm.');
    process.exit(1);
  }

  const hathor = new Hathor();
  const status = hathor.status();

  if (!status.readyToConnect) {
    console.error(`cannot proceed: missing env vars: ${status.missingConfig.join(', ')}`);
    process.exit(1);
  }
  if (!status.activeKeyLoaded) {
    console.error('cannot proceed: HATHOR_ACTIVE_KEY not configured.');
    console.error('if the active key is compromised, this script is not your tool —');
    console.error('go offline and rotate keys per OPERATOR.md §10 / SECURITY.md §6.');
    process.exit(1);
  }

  console.log(`account            : ${status.account}`);
  console.log(`network            : ${status.network}`);

  let existing;
  try {
    existing = await hathor.getMyWitness();
  } catch (err) {
    console.error(`could not read witness record: ${err.message}`);
    process.exit(1);
  }

  if (!existing) {
    console.error(`'${status.account}' is not a registered witness on this chain. nothing to disable.`);
    process.exit(1);
  }

  console.log(`current signing key: ${existing.signing_key}`);
  console.log(`will set signing key to the chain null key (retires the witness).`);

  if (dryRun) {
    console.log('');
    console.log('--- DRY RUN: no broadcast performed. ---');
    return;
  }

  console.log('broadcasting witness_update...');
  const result = await hathor.disableWitness();
  console.log(`broadcast id: ${result.id ?? '(no id returned)'}`);
  console.log('witness retired. verify with `npm run hello`.');
}

main().catch((err) => {
  console.error(`disable.js failed: ${err.message}`);
  process.exit(1);
});
