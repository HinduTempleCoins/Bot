/**
 * watcher/compose.js — render a sensitive-op event into operator-facing alert text.
 *
 * Pure. Same event → same subject + body, every call. No timestamps from
 * the local clock (the timestamp on the event is what gets shown).
 *
 * Output is a plain-text alert suitable for all three sinks (file JSONL,
 * Telegram message, email body). Telegram and email each format differently
 * at the edges — that's the sink's job. This module produces the canonical
 * content.
 *
 * SAFETY: this module never touches keys. It receives only public op data
 * (already in the chain's block) and renders it. There is no path by which
 * a key could end up in the alert body.
 */

const SEVERITY_TAG = {
  critical: '[CRITICAL]',
  high: '[HIGH]',
  warn: '[WARN]',
};

/**
 * Compose a subject + body for the given sensitive event.
 *
 * @param {object} event   from detectSensitiveEvents
 * @returns {{ subject: string, body: string }}
 */
export function composeAlert(event) {
  if (!event || typeof event !== 'object') {
    throw new Error('composeAlert: event required');
  }
  const tag = SEVERITY_TAG[event.severity] ?? '[WARN]';
  const subject = `${tag} ${subjectLine(event)}`;
  const body = buildBody(event);
  return { subject, body };
}

function subjectLine(event) {
  switch (event.kind) {
    case 'transfer':
      return `Transfer from @${event.account}: ${event.opData.amount} to @${event.opData.to}`;
    case 'account_update':
      return `KEY CHANGE on @${event.account} (account_update)`;
    case 'withdraw_vesting':
      return `Power-down initiated on @${event.account}: ${event.opData.vesting_shares}`;
    case 'delegate_vesting_shares':
      return `Delegation from @${event.account} to @${event.opData.delegatee}: ${event.opData.vesting_shares}`;
    case 'witness_update':
      return `Witness record updated for @${event.account}`;
    default:
      return `${event.kind} on @${event.account}`;
  }
}

function buildBody(event) {
  const lines = [
    `account:    @${event.account}`,
    `op:         ${event.kind}`,
    `block:      ${event.block ?? '(unknown)'}`,
    `trx_id:     ${event.trxId ?? '(unknown)'}`,
    `timestamp:  ${event.timestamp ?? '(unknown)'}`,
    '',
  ];
  switch (event.kind) {
    case 'transfer':
      lines.push(
        `Outbound transfer:`,
        `  amount: ${event.opData.amount}`,
        `  to:     @${event.opData.to}`,
        `  memo:   ${event.opData.memo || '(empty)'}`,
        '',
        `If this was you, no action needed.`,
        `If not: stop the bot process, broadcast disable_witness from the offline`,
        `owner key, rotate all keys via account_update. See SECURITY.md §6a.`,
      );
      break;
    case 'account_update':
      lines.push(
        `account_update changes keys and/or json_metadata. Even a legitimate`,
        `key rotation is rare enough to verify immediately.`,
        '',
        `If you did NOT initiate this in the last few minutes, treat it as a`,
        `compromise: the active key was used to change keys. Use the offline`,
        `owner key to re-rotate every authority. See SECURITY.md §6a steps 2-5.`,
      );
      break;
    case 'withdraw_vesting':
      lines.push(
        `Power-down begun:`,
        `  vesting_shares: ${event.opData.vesting_shares}`,
        '',
        `Power-down pays out over 13 weeks. Attackers often start one and`,
        `abandon. If this wasn't you, cancel-power-down via the rotated`,
        `active key as part of SECURITY.md §6a step 4.`,
      );
      break;
    case 'delegate_vesting_shares':
      lines.push(
        `Delegation:`,
        `  delegatee:      @${event.opData.delegatee}`,
        `  vesting_shares: ${event.opData.vesting_shares}`,
        '',
        `Delegation moves MP voting weight without transferring ownership.`,
        `Zero vesting_shares = revoke. Verify the delegatee is intentional.`,
      );
      break;
    case 'witness_update':
      lines.push(
        `Witness record changed:`,
        `  url:                ${event.opData.url ?? '(unchanged)'}`,
        `  block_signing_key:  ${event.opData.block_signing_key ?? '(unchanged)'}`,
        '',
        `If the block_signing_key matches the chain's null pubkey`,
        `(...111111...14T1Anm), the witness has been disabled — intended only`,
        `if you ran the circuit breaker. Otherwise verify against your last`,
        `intentional witness_update.`,
      );
      break;
    default:
      lines.push(`Raw op data: ${JSON.stringify(event.opData)}`);
  }
  return lines.join('\n');
}

export const _internals = { SEVERITY_TAG, subjectLine, buildBody };
