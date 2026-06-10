// hathor-chain-deps.mjs — the ONE set of read-only data sources for Hathor's deterministic !commands.
//
// "When they talk to Hathor in chat or Hathor on Discord, they are talking to the same person, and we
// don't lose any features from either one." (operator, 2026-06-10). The way we keep that promise is:
//   • ONE command brain  — commands/menu.mjs (the !command handlers).
//   • ONE set of data sources — this module — that EVERY surface wires into that brain.
//
// Every surface (the browser chat-server, the Discord bridge, the Telegram bot, the alpha report) calls
// chainDeps() and hands the result to menu.handle(text, deps) / hathor-dispatch's `deps`. Add a data
// source here once and `!that-command` lights up on all of them at the same time — no per-surface drift.
//
// The shapes returned match exactly what commands/menu.mjs expects:
//   getAccount(name) -> { balance, vesting_shares, savings_balance, post_count, reputation } | null
//   getWitness(name) -> { url, signing_key, last_confirmed_block_num, total_missed } | null
//   getPrice(symbol) -> { usd, sources?, confident? } | null
//   getHolders(SYM)  -> integrations/holders.mjs shape | null   (PIZZA-bot token-holder mechanic)
//
// Custody: READ-ONLY. No keys, no broadcast. Every source SOFT-FAILS to null so one dead backend never
// breaks the whole command surface. The MELEK readers need MELEK_RPC_URL; getHolders/getPrice read
// Hive-Engine / the price oracle and work independently of the MELEK RPC.

import { accountInfo, witnessInfo, configured } from './melek-chain.mjs';
import { priceUsd } from './price-oracle.mjs';
import { holders } from './holders.mjs';

/**
 * Build the shared read-only data sources for Hathor's !commands.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.requireRpc=true]  When true, the MELEK-RPC readers (getAccount/getWitness) are
 *   only attached if an RPC is configured; the menu then cleanly says "unavailable" instead of erroring.
 *   getHolders/getPrice are always attached (they do not depend on the MELEK RPC).
 * @returns {{ getAccount?: Function, getWitness?: Function, getPrice: Function, getHolders: Function }}
 */
export function chainDeps({ requireRpc = true } = {}) {
  const deps = {
    getPrice: (symbol) => priceUsd(symbol).catch(() => null),
    async getHolders(symbol) {
      try { return await holders(symbol); } catch { return null; }
    },
  };

  // Attach the MELEK-RPC readers only when an RPC is configured (or the caller opts out of the gate).
  if (!requireRpc || configured()) {
    deps.getAccount = async (name) => {
      try {
        const a = await accountInfo(name);
        if (!a) return null;
        return {
          balance: a.balances?.liquid,
          vesting_shares: a.balances?.vesting,
          savings_balance: a.balances?.stable,
          post_count: a.postCount,
          reputation: undefined,
        };
      } catch { return null; }
    };
    deps.getWitness = async (name) => {
      try {
        const w = await witnessInfo(name);
        if (!w) return null;
        return {
          url: w.url,
          signing_key: w.signingKey,
          last_confirmed_block_num: w.lastConfirmedBlock,
          total_missed: w.missed,
        };
      } catch { return null; }
    };
  }
  return deps;
}

/** True when the MELEK RPC is configured (so the account/witness readers will be live). */
export function rpcConfigured() { return configured(); }

if (process.argv[1] && process.argv[1].endsWith('hathor-chain-deps.mjs')) {
  const d = chainDeps();
  console.log('hathor-chain-deps wired:', Object.keys(d).join(', '));
  console.log('MELEK RPC configured:', rpcConfigured());
}
