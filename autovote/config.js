/**
 * autovote — configuration for the MELEK-testnet Hive.Vote clone.
 *
 * TESTNET ONLY. This service stores posting keys server-side so the worker can
 * cast votes on a schedule. That is acceptable *only* because this targets the
 * MELEK testnet with throwaway keys. See SIGNER SEAM note in vote-engine.js —
 * production replaces stored keys with OAuth + MELEK-Signer scoped tokens.
 */

export const config = {
  // Chain — MELEK testnet (alpha.melek.salon). chain id starts 18dcf0, prefix TST.
  rpcUrl: process.env.AUTOVOTE_RPC || 'https://alpha.melek.salon/rpc',
  chainId:
    process.env.AUTOVOTE_CHAIN_ID ||
    '18dcf0a285365fc58b71f18b3d3fec954aa0c141c44e4e5cb4cf777b9eab274e',
  addressPrefix: process.env.AUTOVOTE_PREFIX || 'TST',

  // HTTP
  port: Number(process.env.PORT || process.env.AUTOVOTE_PORT || 8120),
  host: process.env.AUTOVOTE_HOST || '127.0.0.1',

  // Storage
  dbPath: process.env.AUTOVOTE_DB || new URL('./data/autovote.json', import.meta.url).pathname,

  // Session secret (cookie signing). Ephemeral if unset — fine for testnet.
  sessionSecret: process.env.AUTOVOTE_SESSION_SECRET || null,

  // Engine
  // Per-account minimum gap between vote broadcasts (chain enforces ~3s; we use 3.3s).
  voteIntervalMs: Number(process.env.AUTOVOTE_VOTE_INTERVAL_MS || 3300),
  // How often the engine polls for new blocks / due schedules.
  pollIntervalMs: Number(process.env.AUTOVOTE_POLL_MS || 3000),
  // Don't act on posts older than this (seconds) when first matching a fanbase/trail.
  maxPostAgeSec: Number(process.env.AUTOVOTE_MAX_POST_AGE_SEC || 7 * 24 * 3600),

  testnetBanner: true,
};
