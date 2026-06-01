// internal.mjs — the "inside the angelicalist account" reader. READ-ONLY, NO KEYS.
//
// Operator 2026-06-01: be inside the (already-breached) angelicalist account for a better
// perspective, then start trading. The crucial safety fact: an account's INTERNAL state —
// HIVE/HBD/HP balances, every HIVE-Engine token balance, open market orders, recent trade
// history — is ALL public on-chain. We read the complete internal picture with NO private key.
// Only PLACING a trade needs the key (see trader.mjs), and that is gated + dry-run by default.
//
//   node integrations/angelicalist/internal.mjs            # full snapshot of angelicalist
//   node integrations/angelicalist/internal.mjs someaccount
//   import { snapshot } from './angelicalist/internal.mjs'

import { Client } from '@hiveio/dhive';
import { find, historyPage } from '../he-client.mjs';

const HIVE_NODES = (process.env.HIVE_NODES || 'https://api.hive.blog,https://api.deathwing.me,https://rpc.mahdiyari.info').split(',');
const ACCOUNT = process.env.ANGELICALIST_ACCOUNT || 'angelicalist';
const client = new Client(HIVE_NODES, { timeout: 8000, failoverThreshold: 3 });

const asNum = (s) => parseFloat(String(s || '0').split(' ')[0]) || 0;

// HIVE-layer balances (liquid HIVE/HBD + vesting/HP).
export async function accountState(account = ACCOUNT) {
  const [acc] = await client.database.getAccounts([account]);
  if (!acc) return { account, exists: false };
  return {
    account, exists: true,
    hive: asNum(acc.balance),
    hbd: asNum(acc.hbd_balance),
    hp_vests: asNum(acc.vesting_shares),
    savings_hbd: asNum(acc.savings_hbd_balance),
    last_post: acc.last_post, created: acc.created,
  };
}

// every HIVE-Engine token the account holds (balance + staked).
export async function tokenBalances(account = ACCOUNT) {
  const rows = await find('tokens', 'balances', { account }, 1000);
  return rows
    .map((r) => ({ symbol: r.symbol, balance: +r.balance || 0, stake: +r.stake || 0 }))
    .filter((t) => t.balance > 0 || t.stake > 0)
    .sort((a, b) => b.balance - a.balance);
}

// open market orders the account has resting on HIVE-Engine (both sides).
export async function openOrders(account = ACCOUNT) {
  const [buys, sells] = await Promise.all([
    find('market', 'buyBook', { account }, 1000).catch(() => []),
    find('market', 'sellBook', { account }, 1000).catch(() => []),
  ]);
  const norm = (o, side) => ({ side, symbol: o.symbol, price: +o.price, quantity: +o.quantity, txId: o.txId });
  return [...buys.map((o) => norm(o, 'BUY')), ...sells.map((o) => norm(o, 'SELL'))];
}

// recent market activity (the trade history that revealed the SWAP.LTC bleed).
export async function recentMarketHistory(account = ACCOUNT, limit = 100) {
  const rows = await historyPage(account, { limit }).catch(() => []);
  return Array.isArray(rows) ? rows.slice(0, limit) : [];
}

// the full "inside the account" snapshot — one call, all read-only.
export async function snapshot(account = ACCOUNT) {
  const [state, tokens, orders] = await Promise.all([
    accountState(account).catch((e) => ({ account, error: e.message })),
    tokenBalances(account).catch(() => []),
    openOrders(account).catch(() => []),
  ]);
  return { account, at: new Date().toISOString(), state, tokens, openOrders: orders, tokenCount: tokens.length, openOrderCount: orders.length };
}

if (process.argv[1] && process.argv[1].endsWith('internal.mjs')) {
  const account = process.argv[2] || ACCOUNT;
  const snap = await snapshot(account);
  console.log(`Inside @${account} — read-only, no keys (${snap.at})\n` + '─'.repeat(60));
  console.log('HIVE layer:', JSON.stringify(snap.state));
  console.log(`\nHIVE-Engine tokens (${snap.tokenCount}):`);
  for (const t of snap.tokens.slice(0, 25)) console.log(`  ${t.symbol.padEnd(14)} ${t.balance}${t.stake ? ` (staked ${t.stake})` : ''}`);
  console.log(`\nOpen orders (${snap.openOrderCount}):`);
  for (const o of snap.openOrders.slice(0, 20)) console.log(`  [${o.side}] ${o.quantity} ${o.symbol} @ ${o.price}`);
}
