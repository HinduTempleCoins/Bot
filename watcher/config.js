/**
 * watcher/config.js — env-var loader for the out-of-band alerter.
 *
 * Same naming conventions as welcomer/config.js: generic CHAIN_* env vars
 * with MELEK_* fallbacks, BOT_ACCOUNT with HATHOR_ACCOUNT fallback. Lets
 * the watcher run against any chain by env change alone.
 *
 * Env vars (in priority order):
 *   CHAIN_RPC_URL          | MELEK_RPC_URL                  required (read-only)
 *   CHAIN_ID               | MELEK_CHAIN_ID                 optional (dhive infers from RPC)
 *   CHAIN_ADDRESS_PREFIX   | MELEK_ADDRESS_PREFIX           optional
 *   BOT_ACCOUNT            | HATHOR_ACCOUNT (default 'hathor')
 *   WATCHER_CRON           cron expression (default '* * * * *' — every minute)
 *   WATCHER_HISTORY_LIMIT  how many history entries to fetch per tick (default 100)
 *   WATCHER_STATE_FILE     path to state JSON (default watcher/.state.json)
 *
 *   WATCHER_LOG_FILE       JSONL alert log path. Always-on sink.
 *                          Default: watcher/alerts.jsonl
 *
 *   TELEGRAM_BOT_TOKEN     enable Telegram sink when set with chat id
 *   TELEGRAM_CHAT_ID
 *
 *   RESEND_API_KEY         enable email sink when set with from + to
 *   ALERT_EMAIL_FROM
 *   ALERT_EMAIL_TO         single address or comma-separated list
 */

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

const env = (name, fallback) => {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
};

export function getWatcherConfig() {
  const botAccount = env('BOT_ACCOUNT', env('HATHOR_ACCOUNT', 'hathor'));
  const emailToRaw = env('ALERT_EMAIL_TO');
  return {
    chain: {
      rpcUrl: env('CHAIN_RPC_URL', env('MELEK_RPC_URL')),
      chainId: env('CHAIN_ID', env('MELEK_CHAIN_ID')),
      addressPrefix: env('CHAIN_ADDRESS_PREFIX', env('MELEK_ADDRESS_PREFIX')),
    },
    bot: {
      account: botAccount,
    },
    cronExpr: env('WATCHER_CRON', '* * * * *'),
    historyLimit: parseInt(env('WATCHER_HISTORY_LIMIT', '100'), 10),
    statePath: env('WATCHER_STATE_FILE', join(__dirname, '.state.json')),
    sinks: {
      file: {
        path: env('WATCHER_LOG_FILE', join(__dirname, 'alerts.jsonl')),
      },
      telegram: {
        botToken: env('TELEGRAM_BOT_TOKEN'),
        chatId: env('TELEGRAM_CHAT_ID'),
      },
      email: {
        apiKey: env('RESEND_API_KEY'),
        from: env('ALERT_EMAIL_FROM'),
        to: emailToRaw
          ? emailToRaw.split(',').map((s) => s.trim()).filter(Boolean)
          : null,
      },
    },
  };
}

export function validateForRead(config) {
  const missing = [];
  if (!config.chain.rpcUrl) missing.push('CHAIN_RPC_URL (or MELEK_RPC_URL)');
  if (!config.bot.account) missing.push('BOT_ACCOUNT (or HATHOR_ACCOUNT)');
  return { ok: missing.length === 0, missing };
}
