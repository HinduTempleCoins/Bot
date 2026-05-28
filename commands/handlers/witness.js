/**
 * !witness @account — show witness record for an account, if any.
 *
 * Reports the witness URL, block-signing key, missed blocks, last
 * confirmed block, props. Useful for spot-checking governance state.
 */

import { normalizeAccount } from '../parser.js';

export async function witness(parsed, ctx) {
  const target = normalizeAccount(parsed.args[0] || '');
  if (!target) {
    return { ok: true, reply: 'Usage: !witness @account' };
  }
  if (!ctx.adapter?.client?.database?.call) {
    return { ok: false, error: 'witness: ctx.adapter missing or wrong shape' };
  }
  let w;
  try {
    w = await ctx.adapter.client.database.call('get_witness_by_account', [target]);
  } catch (err) {
    return { ok: false, error: `chain error: ${err.message}` };
  }
  if (!w) {
    return { ok: true, reply: `@${target} is not a witness.` };
  }
  const lines = [
    `**@${target}** witness record`,
    `URL: ${w.url || '(none)'}`,
    `Block-signing key: ${w.signing_key}`,
    `Last confirmed: block ${w.last_confirmed_block_num}`,
    `Missed: ${w.total_missed}`,
    `Account creation fee: ${w.props?.account_creation_fee || '(unset)'}`,
    `Max block size: ${w.props?.maximum_block_size || '(unset)'}`,
  ];
  return { ok: true, reply: lines.join('\n') };
}
