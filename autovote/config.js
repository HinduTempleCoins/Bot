/**
 * autovote — configuration for the chain-agnostic Hive.Vote clone.
 *
 * The platform serves MULTIPLE Graphene chains (see chains.js): MELEK testnet
 * (default), plus HIVE / STEEM / BLURT mainnets. Per-chain RPC/chainId/prefix
 * live in chains.js; this file holds HTTP, storage, engine cadence, and the
 * default chain.
 *
 * KEY CUSTODY: posting-key login stores a WIF server-side — acceptable ONLY for
 * the MELEK testnet with throwaway keys. The keyless paths (HiveSigner OAuth,
 * WhaleVault in-browser) never give us a key. See the SIGNER SEAM note in
 * vote-engine.js — MELEK-Signer replaces stored keys for MELEK later.
 */

import { DEFAULT_CHAIN } from './chains.js';

export const config = {
  // Default chain when a user hasn't picked one. (Legacy AUTOVOTE_* RPC/chainId/
  // prefix envs are still honored by chains.js → melek-testnet for continuity.)
  defaultChain: process.env.AUTOVOTE_DEFAULT_CHAIN || DEFAULT_CHAIN,

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
  // Default poll cadence (per-chain override in chains.js).
  pollIntervalMs: Number(process.env.AUTOVOTE_POLL_MS || 3000),
  // Don't act on posts older than this (seconds) when first matching a fanbase/trail.
  maxPostAgeSec: Number(process.env.AUTOVOTE_MAX_POST_AGE_SEC || 7 * 24 * 3600),

  // SAFETY: when true (default), the engine refuses to broadcast any vote on a
  // mainnet chain (hive/steem/blurt). Multi-chain logic is exercised against the
  // MELEK testnet + mocks. Flip only with operator sign-off + verified app reg.
  blockMainnetBroadcast: process.env.AUTOVOTE_ALLOW_MAINNET !== '1',

  // Curation-timing: when ON, fanbase/trail votes fire at the per-chain
  // curation-optimal moment (Hive=prompt, Steem/Blurt=+5min reverse-auction
  // edge; see curation-timing.mjs) instead of a flat eventTime+delay. Default
  // OFF so live behavior is unchanged until the operator opts in. Purely a
  // scheduling change — it never bypasses the mainnet-broadcast safety gate.
  curationTiming: process.env.AUTOVOTE_CURATION_TIMING === '1',

  testnetBanner: true,
};
