/**
 * tutorial/scheduler.js — orchestrator + CLI for the tutorial response loop.
 *
 * Pulls the pieces together:
 *
 *   welcomed account list (welcomer/state.js)
 *     -> read user activity (witness/chain-reader.js)
 *     -> detect completions (tutorial/detector.js)
 *     -> filter out already-responded stages (tutorial/state.js)
 *     -> compose response (tutorial/composer.js)
 *     -> broadcast via GrapheneAdapter.reply / .vote / .transfer
 *     -> record in tutorial state
 *
 * Dry-run by default; --broadcast required for actual chain writes.
 * Cron loop and flag shape mirror welcomer/index.js so operators don't
 * have to relearn the surface.
 *
 * CLI:
 *   node tutorial/scheduler.js --once               run one pass, exit
 *   node tutorial/scheduler.js --cron               schedule recurring passes
 *   node tutorial/scheduler.js --once --broadcast   actually post (default is dry-run)
 *   node tutorial/scheduler.js --cron --broadcast   schedule + actually post
 */

import 'dotenv/config';
import cron from 'node-cron';
import { Hathor } from '../witness/hathor.js';
import { readUserActivity } from '../witness/chain-reader.js';
import { detectCompletedStages } from './detector.js';
import { composeResponse } from './composer.js';
import { TutorialState } from './state.js';
import { WelcomerState } from '../welcomer/state.js';

const DEFAULT_MAX_PER_TICK = 10;
const DEFAULT_CRON = process.env.TUTORIAL_CRON || '*/15 * * * *';

export class TutorialScheduler {
  /**
   * @param {object} args
   * @param {object} args.adapter             a GrapheneAdapter or Hathor instance.
   * @param {TutorialState} args.state        per-account/per-stage response state.
   * @param {WelcomerState} args.welcomerState account list to walk.
   * @param {object} [args.logger]            default console.
   * @param {number} [args.maxAccountsPerTick] cap, default 10.
   */
  constructor({
    adapter,
    state,
    welcomerState,
    logger = console,
    maxAccountsPerTick = DEFAULT_MAX_PER_TICK,
    readActivity = readUserActivity,
  }) {
    if (!adapter) throw new Error('TutorialScheduler: adapter required');
    if (!state) throw new Error('TutorialScheduler: state required');
    if (!welcomerState) throw new Error('TutorialScheduler: welcomerState required');
    this.adapter = adapter instanceof Hathor ? adapter.connect() : adapter;
    this.state = state;
    this.welcomerState = welcomerState;
    this.logger = logger;
    this.maxAccountsPerTick = maxAccountsPerTick;
    this.readActivity = readActivity;
  }

  /**
   * One scheduler pass.
   *
   * @param {object} args
   * @param {boolean} [args.broadcast]   false (default) → dry-run; true → real broadcast.
   * @returns {Promise<{ checked: number, fired: number, errors: number }>}
   */
  async tick({ broadcast = false } = {}) {
    const accounts = this.welcomedAccounts();
    if (!accounts.length) {
      this.logger.log('[tutorial] no welcomed accounts to walk yet');
      return { checked: 0, fired: 0, errors: 0 };
    }

    const batch = accounts.slice(0, this.maxAccountsPerTick);
    this.logger.log(`[tutorial] checking ${batch.length}/${accounts.length} accounts (max=${this.maxAccountsPerTick})`);

    let checked = 0, fired = 0, errors = 0;
    for (const account of batch) {
      try {
        const n = await this.#checkAndRespond(account, { broadcast });
        fired += n;
        checked += 1;
      } catch (err) {
        errors += 1;
        this.logger.error(`[tutorial] @${account} failed: ${err.message}`);
      }
    }
    this.logger.log(`[tutorial] tick done: checked=${checked} fired=${fired} errors=${errors}`);
    return { checked, fired, errors };
  }

  /**
   * Read activity, detect completions, fire any responses the bot has not
   * already sent. Returns the number of stage responses fired (or dry-run-logged).
   */
  async #checkAndRespond(account, { broadcast }) {
    const activity = await this.readActivity(this.adapter, account);
    const completions = detectCompletedStages(activity);

    let fired = 0;
    for (const [stageKey, result] of Object.entries(completions)) {
      if (!result.complete) continue;
      if (this.state.hasResponded(account, stageKey)) continue;

      const payload = composeResponse({
        stageKey,
        account,
        evidence: result.evidence,
      });

      if (!broadcast) {
        this.logger.log(`[tutorial] DRY-RUN @${account} stage=${stageKey} action=${payload.action}`);
        this.logger.log(`  reply → @${payload.comment.parentAuthor}/${payload.comment.parentPermlink}`);
        this.logger.log(`  body: ${payload.comment.body.slice(0, 180)}${payload.comment.body.length > 180 ? '…' : ''}`);
        if (payload.upvote) {
          this.logger.log(`  upvote → @${payload.upvote.author}/${payload.upvote.permlink} weight=${payload.upvote.weight}`);
        }
        if (payload.transfer) {
          this.logger.log(`  transfer → @${payload.transfer.to} ${payload.transfer.amount} memo="${payload.transfer.memo}"`);
        }
        this.state.recordResponse(account, stageKey, {
          txId: 'dry-run',
          action: payload.action,
          evidencePermlink: payload.comment.parentPermlink || null,
        });
        fired += 1;
        continue;
      }

      try {
        const replyResult = await this.adapter.reply({
          parentAuthor: payload.comment.parentAuthor,
          parentPermlink: payload.comment.parentPermlink,
          body: payload.comment.body,
          permlink: payload.comment.permlink,
        });
        if (payload.upvote) {
          await this.adapter.vote({
            author: payload.upvote.author,
            permlink: payload.upvote.permlink,
            weight: payload.upvote.weight,
          });
        }
        if (payload.transfer) {
          await this.adapter.transfer({
            to: payload.transfer.to,
            amount: payload.transfer.amount,
            memo: payload.transfer.memo,
          });
        }
        this.state.recordResponse(account, stageKey, {
          txId: replyResult?.id ?? null,
          action: payload.action,
          evidencePermlink: payload.comment.parentPermlink || null,
        });
        this.logger.log(`[tutorial] @${account} stage=${stageKey} ${payload.action} tx=${replyResult?.id ?? '(no id)'}`);
        fired += 1;
      } catch (err) {
        this.logger.error(`[tutorial] @${account} stage=${stageKey} broadcast failed: ${err.message}`);
        // Don't record — will retry next tick.
      }
    }
    return fired;
  }

  welcomedAccounts() {
    return this.welcomerState.accounts().filter((a) => this.welcomerState.hasWelcomed(a));
  }
}

// ---- CLI -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const onceMode = args.includes('--once');
  const cronMode = args.includes('--cron');
  const broadcast = args.includes('--broadcast');

  if (!onceMode && !cronMode) {
    console.error('usage: node tutorial/scheduler.js (--once | --cron) [--broadcast]');
    console.error('default (no --broadcast) is dry-run.');
    process.exit(1);
  }
  if (onceMode && cronMode) {
    console.error('--once and --cron are mutually exclusive');
    process.exit(1);
  }

  const hathor = new Hathor();
  const adapter = hathor.connect();
  const state = new TutorialState();
  const welcomerState = new WelcomerState();
  const scheduler = new TutorialScheduler({ adapter, state, welcomerState });

  if (onceMode) {
    await scheduler.tick({ broadcast });
    return;
  }

  if (!cron.validate(DEFAULT_CRON)) {
    console.error(`[tutorial] invalid TUTORIAL_CRON: ${DEFAULT_CRON}`);
    process.exit(1);
  }
  console.log(`[tutorial] scheduled: ${DEFAULT_CRON} (broadcast=${broadcast})`);
  await scheduler.tick({ broadcast });
  cron.schedule(DEFAULT_CRON, () => {
    scheduler.tick({ broadcast }).catch((err) =>
      console.error(`[tutorial] tick error: ${err.message}`),
    );
  });
}

const isCli = import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop());

if (isCli) {
  main().catch((err) => {
    console.error(`[tutorial] fatal: ${err.message}`);
    process.exit(1);
  });
}
