/**
 * !post-count @account — show how many posts / comments an account has made.
 *
 * Uses the cached `post_count` field on the account record, which Graphene
 * keeps current. Cheap call.
 */

import { normalizeAccount } from '../parser.js';

export async function postCount(parsed, ctx) {
  const target = normalizeAccount(parsed.args[0] || ctx.askerAccount || '');
  if (!target) {
    return { ok: true, reply: 'Usage: !post-count @account' };
  }
  if (!ctx.adapter?.client?.database?.getAccounts) {
    return { ok: false, error: 'post-count: ctx.adapter missing or wrong shape' };
  }
  const [acct] = await ctx.adapter.client.database.getAccounts([target]);
  if (!acct) {
    return { ok: true, reply: `@${target} not found on this chain.` };
  }
  return {
    ok: true,
    reply: `**@${target}** has ${acct.post_count} posts/comments total. Reputation: ${acct.reputation}.`,
  };
}
