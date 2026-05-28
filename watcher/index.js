/**
 * watcher/index.js — out-of-band alerter for sensitive ops on the bot account.
 *
 * Per SECURITY.md §4d: "Out-of-band alerting on `transfer` ops from `hathor`.
 * Any transfer triggers Telegram/email to the operator within seconds. If
 * you didn't initiate it, you have minutes to act with the offline owner
 * key." This module is that alerter, expanded to also watch account_update
 * (key rotation), withdraw_vesting (power-down init), delegate_vesting_shares,
 * and witness_update — the other ops a compromised active key would use.
 *
 * Architecture:
 *
 *   tick → read account_history above cursor → detect sensitive ops →
 *   compose alert text → fan out to enabled sinks → record per-event ID
 *   → advance cursor
 *
 * Sinks: file (always), telegram (env-gated), email/resend (env-gated).
 * Sink failures are logged but don't break sibling sinks; the file sink
 * never fails unless the disk is full, so alerts are durably recorded
 * even if every network sink is down.
 *
 * Bootstrap: first run snapshots the current head of account_history and
 * does NOT alert on backfill. There's no security value in alerting today
 * about ops that happened months ago; the operator either already knows
 * or it's too late.
 *
 * CLI:
 *   node watcher/index.js --once               run one tick, exit
 *   node watcher/index.js --cron               schedule recurring ticks
 *   node watcher/index.js --once --dry-run     write to file sink only,
 *                                              skip network sinks
 *   node watcher/index.js --cron --dry-run
 *
 * KEY SAFETY: this module reads no keys, broadcasts no ops, and never
 * touches HATHOR_ACTIVE_KEY / HATHOR_POSTING_KEY. It is strictly read-side.
 * Run it on a separate VPS from the witness if you want maximum isolation —
 * compromise of the watcher host does not compromise hathor.
 */

import 'dotenv/config';
import cron from 'node-cron';
import { Client } from '@hiveio/dhive';
import { WatcherState } from './state.js';
import { detectSensitiveEvents } from './detect.js';
import { composeAlert } from './compose.js';
import { dispatch, enabledSinks } from './sinks/index.js';
import { getWatcherConfig, validateForRead } from './config.js';

export class Watcher {
  /**
   * @param {object} args
   * @param {object} args.config   from getWatcherConfig()
   * @param {object} args.state    WatcherState instance
   * @param {object} args.client   dhive Client (or compatible mock)
   * @param {object} [args.logger] default console
   * @param {object} [args.sinkOverrides] inject {pool, fetchImpl} for tests
   */
  constructor({ config, state, client, logger = console, sinkOverrides = {} }) {
    this.config = config;
    this.state = state;
    this.client = client;
    this.logger = logger;
    this.sinkOverrides = sinkOverrides;
  }

  /**
   * Refuse to start if the bot account doesn't exist on the configured chain.
   * That's almost always a misconfigured RPC URL or a typo'd account name.
   */
  async startupHealthChecks() {
    const [account] = await this.client.database.getAccounts([this.config.bot.account]);
    if (!account) {
      throw new Error(
        `BOT_ACCOUNT "${this.config.bot.account}" does not exist on the chain at ${this.config.chain.rpcUrl}`,
      );
    }
    // Confirm state file is keyed to this account (or claim it on first run).
    this.state.setAccount(this.config.bot.account);
  }

  /**
   * One watcher pass.
   *
   * @param {object} args
   * @param {boolean} [args.dryRun]  true = file sink only, skip network sinks
   */
  async tick({ dryRun = false } = {}) {
    const account = this.config.bot.account;
    const cursor = this.state.getLastHistoryIndex();

    // Fetch a recent window. condenser_api.get_account_history(account, -1, limit)
    // returns the last `limit` entries, oldest-first in the array. To page from
    // a known index, we'd pass `cursor + limit` as start — but for v1, fetching
    // the last `limit` and filtering by minIndex is simpler and correct as long
    // as throughput stays under `limit` ops per tick.
    const history = await this.client.call(
      'condenser_api',
      'get_account_history',
      [account, -1, this.config.historyLimit],
    );

    // Bootstrap: first run, no cursor — snapshot head and don't alert on
    // backfill. The maxHistoryIndex of the slice we just got is our new floor.
    if (cursor === null) {
      const top = newestIndex(history);
      if (top !== null) this.state.setLastHistoryIndex(top);
      this.logger.log(`[watcher] bootstrap: snapshot at history index ${top ?? 'empty'}`);
      return { detected: 0, alerted: 0, sinkResults: [] };
    }

    const events = detectSensitiveEvents(history, account, { minIndex: cursor });

    if (events.length === 0) {
      // Even with no sensitive ops, advance the cursor past anything we saw
      // so future ticks don't keep scanning the same window.
      const top = newestIndex(history);
      if (top !== null && top > cursor) this.state.setLastHistoryIndex(top);
      return { detected: 0, alerted: 0, sinkResults: [] };
    }

    this.logger.log(`[watcher] detected ${events.length} sensitive op(s) above index ${cursor}`);

    let alerted = 0;
    const allResults = [];
    const effectiveConfig = dryRun
      ? { ...this.config, sinks: { ...this.config.sinks, telegram: { botToken: null, chatId: null }, email: { apiKey: null, from: null, to: null } } }
      : this.config;

    for (const evt of events) {
      if (this.state.hasAlerted(evt.historyIndex)) continue;
      const alert = composeAlert(evt);
      const results = await dispatch(evt, alert, effectiveConfig, this.sinkOverrides);
      this.state.recordAlerted(evt.historyIndex, { trxId: evt.trxId, kind: evt.kind });
      alerted += 1;
      for (const r of results) {
        const tag = r.ok ? 'ok' : `FAIL: ${r.error}`;
        this.logger.log(`[watcher] [${evt.severity}] ${evt.kind} idx=${evt.historyIndex} → ${r.sink}: ${tag}`);
      }
      allResults.push({ event: evt, alert, sinkResults: results });
    }

    // Advance cursor to the newest history index we observed.
    const top = newestIndex(history);
    if (top !== null && top > cursor) this.state.setLastHistoryIndex(top);

    return { detected: events.length, alerted, sinkResults: allResults };
  }

  /**
   * Summary of which sinks are active. For startup logging.
   */
  activeSinks(dryRun = false) {
    const cfg = dryRun
      ? { ...this.config, sinks: { ...this.config.sinks, telegram: { botToken: null, chatId: null }, email: { apiKey: null, from: null, to: null } } }
      : this.config;
    return enabledSinks(cfg).map((s) => s.name);
  }
}

function newestIndex(history) {
  if (!Array.isArray(history) || history.length === 0) return null;
  let max = -Infinity;
  for (const e of history) {
    if (Array.isArray(e) && typeof e[0] === 'number' && e[0] > max) max = e[0];
  }
  return Number.isFinite(max) ? max : null;
}

// ---- CLI -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const onceMode = args.includes('--once');
  const cronMode = args.includes('--cron');
  const dryRun = args.includes('--dry-run');

  if (!onceMode && !cronMode) {
    console.error('usage: node watcher/index.js (--once | --cron) [--dry-run]');
    console.error('  --dry-run writes only to the JSONL log; skips Telegram/email');
    process.exit(1);
  }
  if (onceMode && cronMode) {
    console.error('--once and --cron are mutually exclusive');
    process.exit(1);
  }

  const config = getWatcherConfig();
  const check = validateForRead(config);
  if (!check.ok) {
    console.error(`[watcher] missing env: ${check.missing.join(', ')}`);
    process.exit(1);
  }

  const client = new Client(config.chain.rpcUrl, {
    chainId: config.chain.chainId,
    addressPrefix: config.chain.addressPrefix,
    timeout: 15000,
  });
  const state = new WatcherState({ path: config.statePath });
  const watcher = new Watcher({ config, state, client });

  try {
    await watcher.startupHealthChecks();
    const sinks = watcher.activeSinks(dryRun);
    console.log(
      `[watcher] startup OK — account=@${config.bot.account} chain=${config.chain.rpcUrl} ` +
        `sinks=[${sinks.join(', ')}]${dryRun ? ' (dry-run: network sinks suppressed)' : ''}`,
    );
  } catch (err) {
    console.error(`[watcher] startup failed: ${err.message}`);
    process.exit(1);
  }

  if (onceMode) {
    await watcher.tick({ dryRun });
    return;
  }

  if (!cron.validate(config.cronExpr)) {
    console.error(`[watcher] invalid WATCHER_CRON: ${config.cronExpr}`);
    process.exit(1);
  }
  console.log(`[watcher] scheduled: ${config.cronExpr}`);
  await watcher.tick({ dryRun }); // immediate first tick
  cron.schedule(config.cronExpr, () => {
    watcher.tick({ dryRun }).catch((err) =>
      console.error(`[watcher] tick error: ${err.message}`),
    );
  });
}

const isCli = import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop());

if (isCli) {
  main().catch((err) => {
    console.error(`[watcher] fatal: ${err.message}`);
    process.exit(1);
  });
}
