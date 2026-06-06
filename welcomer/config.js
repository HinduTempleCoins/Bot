/**
 * welcomer/config.js — env-var loader for the welcomer.
 *
 * The brief named generic env vars (CHAIN_RPC_URL, BOT_ACCOUNT, etc.) so
 * the welcomer is chain-agnostic and can run against Blurt for read-only
 * observation today, then point at MELEK when MELEK launches with no code
 * change. To keep compatibility with the existing MELEK_ and HATHOR_ env
 * vars already in the repo's .env.example, each generic name falls back to
 * the MELEK-specific name if unset.
 *
 * Key custody (BRIEF.md §7, MELEK_SIGNER.md §6): the welcomer holds NO chain
 * private key. Broadcasting requires a MELEK-Signer endpoint + scoped bearer
 * token (MELEK_SIGNER_URL / MELEK_SIGNER_TOKEN), not a posting WIF. "Broadcast
 * readiness" therefore means "signer env configured", not "key present".
 *
 * Env vars (in priority order):
 *   CHAIN_RPC_URL          | MELEK_RPC_URL                  required
 *   CHAIN_ID               | MELEK_CHAIN_ID                 required
 *   CHAIN_ADDRESS_PREFIX   | MELEK_ADDRESS_PREFIX           required
 *   BOT_ACCOUNT            | MELEK_ACCOUNT  (default hathor)
 *   MELEK_SIGNER_URL                                         required for --broadcast
 *   MELEK_SIGNER_TOKEN                                       required for --broadcast
 *   WELCOME_POST_AUTHOR                                      required
 *   WELCOME_POST_PERMLINK                                    required
 *   TUTORIAL_LINK                                            default: BRIEF.md on GitHub
 *   LAST_BLOCK_FILE                                          default: welcomer/.state.json
 *   SKIP_ACCOUNTS          comma/space-separated skip list (default: bot account itself)
 *   WELCOMER_CRON          cron expression (default '*​/2 * * * *')
 *   WELCOMER_BATCH_BLOCKS  max blocks scanned per tick (default 50)
 */

const env = (name, fallback) => {
  const v = process.env[name];
  return v !== undefined && v !== '' ? v : fallback;
};

const TUTORIAL_LINK_DEFAULT =
  'https://github.com/HinduTempleCoins/Bot/blob/main/BRIEF.md';

export function getWelcomerConfig() {
  const botAccount = env('BOT_ACCOUNT', env('MELEK_ACCOUNT', 'hathor'));
  return {
    chain: {
      rpcUrl: env('CHAIN_RPC_URL', env('MELEK_RPC_URL')),
      chainId: env('CHAIN_ID', env('MELEK_CHAIN_ID')),
      addressPrefix: env('CHAIN_ADDRESS_PREFIX', env('MELEK_ADDRESS_PREFIX')),
    },
    welcomePost: {
      author: env('WELCOME_POST_AUTHOR'),
      permlink: env('WELCOME_POST_PERMLINK'),
    },
    bot: {
      account: botAccount,
    },
    signer: {
      url: env('MELEK_SIGNER_URL'),
      token: env('MELEK_SIGNER_TOKEN'),
    },
    tutorialLink: env('TUTORIAL_LINK', TUTORIAL_LINK_DEFAULT),
    statePath: env('LAST_BLOCK_FILE'),
    skipAccounts: parseSkipList(env('SKIP_ACCOUNTS', botAccount)),
    cronExpr: env('WELCOMER_CRON', '*/2 * * * *'),
    batchBlocks: parseInt(env('WELCOMER_BATCH_BLOCKS', '50'), 10),
  };
}

function parseSkipList(s) {
  return new Set(String(s).split(/[,\s]+/).map((x) => x.trim()).filter(Boolean));
}

export function validateForRead(config) {
  const missing = [];
  if (!config.chain.rpcUrl) missing.push('CHAIN_RPC_URL (or MELEK_RPC_URL)');
  if (!config.chain.chainId) missing.push('CHAIN_ID (or MELEK_CHAIN_ID)');
  if (!config.chain.addressPrefix) missing.push('CHAIN_ADDRESS_PREFIX (or MELEK_ADDRESS_PREFIX)');
  if (!config.welcomePost.author) missing.push('WELCOME_POST_AUTHOR');
  if (!config.welcomePost.permlink) missing.push('WELCOME_POST_PERMLINK');
  if (!config.bot.account) missing.push('BOT_ACCOUNT (or MELEK_ACCOUNT)');
  return { ok: missing.length === 0, missing };
}

export function validateForBroadcast(config) {
  const readCheck = validateForRead(config);
  const missing = [...readCheck.missing];
  // Broadcast readiness = a MELEK-Signer client can be built. No local key.
  if (!config.signer?.url) missing.push('MELEK_SIGNER_URL');
  if (!config.signer?.token) missing.push('MELEK_SIGNER_TOKEN');
  return { ok: missing.length === 0, missing };
}
