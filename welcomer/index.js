/**
 * welcomer/index.js — orchestrator + CLI.
 *
 * Responsibilities:
 *   1. Bootstrap: validate env, connect to chain, run startup health checks
 *      (welcome post resolves, bot account exists).
 *   2. Each tick: scan new blocks since cursor for account-creation ops,
 *      record discoveries, welcome any pending accounts.
 *   3. Persist `last_processed_block` after each tick; persist welcomes
 *      immediately as they happen.
 *
 * CLI:
 *   node welcomer/index.js --once               run one tick, exit
 *   node welcomer/index.js --cron               schedule recurring ticks
 *   node welcomer/index.js --once --broadcast   actually post (default is dry-run output)
 *   node welcomer/index.js --cron --broadcast   schedule + actually post
 *
 * Default behavior (no --broadcast) is dry-run: logs what it WOULD post,
 * marks accounts as "welcomed" in state with txId="dry-run" so they don't
 * get re-processed on the next tick. Run without --broadcast against any
 * chain (Blurt, MELEK testnet, anything) to validate behavior; only pass
 * --broadcast when you want actual chain writes.
 *
 * Startup will fail-loudly if:
 *   - required env vars are missing
 *   - the chain RPC doesn't respond
 *   - BOT_ACCOUNT doesn't exist on the configured chain
 *   - WELCOME_POST_AUTHOR/PERMLINK doesn't resolve
 *
 * (The bot has no Blurt/Steem keys, so even with --broadcast pointed at
 * those chains, the signature check would reject — but failing at startup
 * is friendlier than failing on first broadcast.)
 */

import 'dotenv/config';
import cron from 'node-cron';
import { Client } from '@hiveio/dhive';
import { WelcomerState } from './state.js';
import { composeWelcomeMention } from './composer.js';
import { scanBlockRange, getHeadBlockNumber } from './discover.js';
import { getWelcomerConfig, validateForRead, validateForBroadcast } from './config.js';
import { createSignerClient } from '../src/chain/melek-signer-client.mjs';

export class Welcomer {
  /**
   * @param {object} args
   * @param {object} args.config   from getWelcomerConfig()
   * @param {object} args.state    WelcomerState instance
   * @param {object} args.client   dhive Client (or compatible mock) — used for
   *   READ ops only (block scans, account/post lookups).
   * @param {object} [args.logger] default console
   * @param {object} [args.signer] a MELEK-Signer client — shape
   *   { broadcast(ops, { clientRef }) } (createSignerClient / createMockSigner).
   *   Broadcasting is delegated to MELEK-Signer; this host holds NO chain key
   *   (BRIEF.md §7, MELEK_SIGNER.md §6). When null/omitted, broadcasts FAIL SOFT
   *   with a clear read-only error — there is no local-key fallback. Tests inject
   *   a mock signer to verify the broadcast path.
   */
  constructor({ config, state, client, logger = console, signer = null }) {
    this.config = config;
    this.state = state;
    this.client = client;
    this.logger = logger;
    this.signer = signer;
  }

  /**
   * Confirm the configured chain accepts requests, the bot account exists,
   * and the welcome post resolves. Throws with a descriptive message if any
   * check fails — the CLI exits on that.
   */
  async startupHealthChecks() {
    // 1. Bot account exists on chain.
    const [account] = await this.client.database.getAccounts([this.config.bot.account]);
    if (!account) {
      throw new Error(
        `BOT_ACCOUNT "${this.config.bot.account}" does not exist on the chain at ${this.config.chain.rpcUrl}`,
      );
    }
    // 2. Welcome post exists.
    const post = await this.client.database.call('get_content', [
      this.config.welcomePost.author,
      this.config.welcomePost.permlink,
    ]);
    if (!post?.author) {
      throw new Error(
        `Welcome post @${this.config.welcomePost.author}/${this.config.welcomePost.permlink} does not exist on the chain`,
      );
    }
  }

  /**
   * One welcomer pass: discover new accounts, welcome pending ones.
   *
   * @param {object} args
   * @param {boolean} [args.broadcast]  false (default) → dry-run logging only
   */
  async tick({ broadcast = false } = {}) {
    await this.#discover();
    await this.#welcomePending({ broadcast });
  }

  async #discover() {
    const head = await getHeadBlockNumber(this.client);
    let cursor = this.state.getLastProcessedBlock();

    if (cursor === null) {
      // First run: start from head. Don't backfill historical blocks —
      // that would mass-welcome every account ever created.
      this.state.setLastProcessedBlock(head);
      this.logger.log(`[welcomer] bootstrap: starting from head block ${head}`);
      return;
    }

    if (cursor >= head) {
      this.logger.log(`[welcomer] caught up at block ${cursor}`);
      return;
    }

    const toBlock = Math.min(cursor + this.config.batchBlocks, head);
    this.logger.log(`[welcomer] scanning blocks ${cursor + 1}..${toBlock} (head ${head})`);
    const events = await scanBlockRange(this.client, cursor + 1, toBlock);
    let recorded = 0;
    for (const evt of events) {
      if (this.config.skipAccounts.has(evt.account)) continue;
      if (this.state.isKnown(evt.account)) continue;
      this.state.recordDiscovery(evt.account, { block: evt.block });
      recorded += 1;
    }
    this.state.setLastProcessedBlock(toBlock);
    if (recorded > 0) {
      this.logger.log(`[welcomer] discovered ${recorded} new account(s) in this batch`);
    }
  }

  async #welcomePending({ broadcast }) {
    const pending = this.state.pendingAccounts();
    if (pending.length === 0) return;
    this.logger.log(`[welcomer] ${pending.length} pending welcome(s)`);

    for (const account of pending) {
      if (this.state.hasWelcomed(account)) continue; // defensive

      const welcome = composeWelcomeMention({
        account,
        welcomePost: this.config.welcomePost,
        tutorialLink: this.config.tutorialLink,
      });

      if (!broadcast) {
        this.logger.log(`[welcomer] DRY-RUN @${account}:`);
        this.logger.log(`  → @${welcome.comment.parentAuthor}/${welcome.comment.parentPermlink}`);
        this.logger.log(`  body: ${welcome.comment.body}`);
        // Mark as welcomed-in-dry-run so we don't keep re-printing the same
        // pending list on every tick. To re-test, delete state and restart.
        this.state.recordWelcome(account, { txId: 'dry-run' });
        continue;
      }

      try {
        const result = await this.#broadcastComment(welcome.comment);
        this.state.recordWelcome(account, { txId: result.id ?? null });
        this.logger.log(`[welcomer] welcomed @${account}: ${result.id ?? '(no id)'}`);
      } catch (err) {
        // Don't mark welcomed — will retry next tick.
        this.logger.error(`[welcomer] failed to welcome @${account}: ${err.message}`);
      }
    }
  }

  async #broadcastComment(comment) {
    if (!this.signer || typeof this.signer.broadcast !== 'function') {
      throw new Error(
        'signer not configured — read-only mode: set MELEK_SIGNER_URL and ' +
        'MELEK_SIGNER_TOKEN to enable broadcasting (no local-key fallback by design)',
      );
    }
    const op = ['comment', {
      parent_author: comment.parentAuthor,
      parent_permlink: comment.parentPermlink,
      author: this.config.bot.account,
      permlink: comment.permlink,
      title: '',
      body: comment.body,
      json_metadata: JSON.stringify({ app: 'hathor-welcomer/0.1', tags: ['welcome'] }),
    }];
    return this.signer.broadcast([op], { clientRef: `welcome-${comment.parentAuthor || this.config.bot.account}-${comment.permlink}` });
  }
}

// ---- CLI -------------------------------------------------------------------

async function main() {
  const args = process.argv.slice(2);
  const onceMode = args.includes('--once');
  const cronMode = args.includes('--cron');
  const broadcast = args.includes('--broadcast');

  if (!onceMode && !cronMode) {
    console.error('usage: node welcomer/index.js (--once | --cron) [--broadcast]');
    console.error('default (no --broadcast) is dry-run: logs what it would post, does not broadcast');
    process.exit(1);
  }
  if (onceMode && cronMode) {
    console.error('--once and --cron are mutually exclusive');
    process.exit(1);
  }

  const config = getWelcomerConfig();
  const check = broadcast ? validateForBroadcast(config) : validateForRead(config);
  if (!check.ok) {
    console.error(`[welcomer] missing env: ${check.missing.join(', ')}`);
    process.exit(1);
  }

  const client = new Client(config.chain.rpcUrl, {
    chainId: config.chain.chainId,
    addressPrefix: config.chain.addressPrefix,
    timeout: 15000,
  });
  const state = new WelcomerState({ path: config.statePath });
  // Build the MELEK-Signer client only when actually broadcasting. Read/dry-run
  // runs need no signer (and no key — there is none on this host).
  const signer = broadcast
    ? createSignerClient({ url: config.signer.url, token: config.signer.token })
    : null;
  const welcomer = new Welcomer({ config, state, client, signer });

  try {
    await welcomer.startupHealthChecks();
    console.log(`[welcomer] startup OK (chain: ${config.chain.rpcUrl}, broadcast: ${broadcast})`);
  } catch (err) {
    console.error(`[welcomer] startup failed: ${err.message}`);
    process.exit(1);
  }

  if (onceMode) {
    await welcomer.tick({ broadcast });
    return;
  }

  // cron mode
  if (!cron.validate(config.cronExpr)) {
    console.error(`[welcomer] invalid WELCOMER_CRON: ${config.cronExpr}`);
    process.exit(1);
  }
  console.log(`[welcomer] scheduled: ${config.cronExpr}`);
  await welcomer.tick({ broadcast }); // immediate first tick
  cron.schedule(config.cronExpr, () => {
    welcomer.tick({ broadcast }).catch((err) =>
      console.error(`[welcomer] tick error: ${err.message}`),
    );
  });
}

const isCli = import.meta.url.startsWith('file:') &&
  process.argv[1] &&
  import.meta.url.endsWith(process.argv[1].split('/').pop());

if (isCli) {
  main().catch((err) => {
    console.error(`[welcomer] fatal: ${err.message}`);
    process.exit(1);
  });
}
