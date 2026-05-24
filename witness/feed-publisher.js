/**
 * feed-publisher.js — informational price feed publication.
 *
 * MELEK has no internal stablecoin (see HinduTempleCoins/melek-chain
 * CLAUDE.md "Single token"). The witness `feed_publish` op is therefore
 * informational only — it does not enforce currency conversion. Publishing
 * one regularly is still a normal witness behavior: it advertises the
 * Witness's view of MELEK's exchange rate against an external reference.
 *
 * Phase 1: this script publishes a configured fixed rate from env vars,
 * intended for the period before MELEK is traded on any exchange. When
 * exchange listings exist, swap the source for a price aggregator; the
 * broadcast shape stays the same.
 *
 * Modes:
 *   node witness/feed-publisher.js --once             # publish once, exit
 *   node witness/feed-publisher.js --dry-run          # print what would publish, exit
 *   node witness/feed-publisher.js --cron             # run on a schedule (FEED_CRON env var, default hourly)
 *
 * Env vars used:
 *   MELEK_FEED_BASE   — e.g. "1.000 MELEK" (the amount of MELEK that equals MELEK_FEED_QUOTE)
 *   MELEK_FEED_QUOTE  — e.g. "0.001 USD" (the exchange-rate target)
 *   FEED_CRON         — cron expression for --cron mode (default: "0 * * * *", every hour at :00)
 *
 * Key-safety: uses Hathor#publishFeed, which uses the active key from
 * src/chain/keys.js. The key is never logged or printed.
 */

import 'dotenv/config';
import cron from 'node-cron';
import { Hathor } from './hathor.js';

const BASE = process.env.MELEK_FEED_BASE || '1.000 MELEK';
const QUOTE = process.env.MELEK_FEED_QUOTE || null;
const CRON_EXPR = process.env.FEED_CRON || '0 * * * *';

function buildExchangeRate() {
  if (!QUOTE) {
    throw new Error('MELEK_FEED_QUOTE not configured (e.g. "0.001 USD")');
  }
  return { base: BASE, quote: QUOTE };
}

async function publishOnce({ dryRun }) {
  const exchangeRate = buildExchangeRate();
  const stamp = new Date().toISOString();
  console.log(`[${stamp}] feed: base=${exchangeRate.base} quote=${exchangeRate.quote}`);

  if (dryRun) {
    console.log('  --dry-run: not broadcast');
    return;
  }

  const hathor = new Hathor();
  const status = hathor.status();

  if (!status.readyToConnect) {
    console.error(`cannot publish: missing env vars: ${status.missingConfig.join(', ')}`);
    process.exit(1);
  }
  if (!status.activeKeyLoaded) {
    console.error('cannot publish: HATHOR_ACTIVE_KEY not configured');
    process.exit(1);
  }

  try {
    const result = await hathor.publishFeed({ exchangeRate });
    console.log(`  broadcast id: ${result.id ?? '(no id returned)'}`);
  } catch (err) {
    console.error(`  publish failed: ${err.message}`);
    // In --cron mode, don't exit — try again next tick. In --once mode the caller exits.
    if (!process.argv.includes('--cron')) {
      process.exit(1);
    }
  }
}

async function main() {
  const onceMode = process.argv.includes('--once');
  const dryRun = process.argv.includes('--dry-run');
  const cronMode = process.argv.includes('--cron');

  if (!onceMode && !dryRun && !cronMode) {
    console.error('specify one of: --once, --dry-run, --cron');
    process.exit(1);
  }

  if (cronMode) {
    if (!cron.validate(CRON_EXPR)) {
      console.error(`invalid FEED_CRON expression: ${CRON_EXPR}`);
      process.exit(1);
    }
    console.log(`scheduling feed publication: ${CRON_EXPR}`);
    cron.schedule(CRON_EXPR, () => publishOnce({ dryRun: false }));
    // Publish once immediately on start so the operator sees output.
    await publishOnce({ dryRun: false });
    // Keep the process alive — cron does not block.
  } else {
    await publishOnce({ dryRun });
  }
}

main().catch((err) => {
  console.error(`feed-publisher failed: ${err.message}`);
  process.exit(1);
});
