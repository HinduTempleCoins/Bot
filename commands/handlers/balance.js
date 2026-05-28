/**
 * !balance @account — show liquid MELEK + MP for an account.
 *
 * No account specified → assumes the asker (ctx.askerAccount), otherwise
 * fails with "specify an account".
 *
 * Requires ctx.adapter (GrapheneAdapter / Hathor.connect()).
 */

import { normalizeAccount } from '../parser.js';

export async function balance(parsed, ctx) {
  const target = normalizeAccount(parsed.args[0] || ctx.askerAccount || '');
  if (!target) {
    return { ok: true, reply: 'Usage: !balance @account' };
  }
  if (!ctx.adapter?.client?.database?.getAccounts) {
    return { ok: false, error: 'balance: ctx.adapter missing or wrong shape' };
  }
  const [acct] = await ctx.adapter.client.database.getAccounts([target]);
  if (!acct) {
    return { ok: true, reply: `@${target} not found on this chain.` };
  }
  const liquid = acct.balance;            // e.g. "12.345 MELEK"
  const vesting = acct.vesting_shares;    // VESTS — converted to MP off-chain
  const savings = acct.savings_balance;   // optional
  const lines = [
    `**@${target}**`,
    `Liquid: ${liquid}`,
    `Vesting: ${vesting}  (≈ MP at current global rate)`,
    savings ? `Savings: ${savings}` : null,
  ].filter(Boolean);
  return { ok: true, reply: lines.join('\n') };
}
