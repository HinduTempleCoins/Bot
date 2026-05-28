/**
 * watcher/detect.js — pure detector for sensitive on-chain ops.
 *
 * Takes a slice of account_history entries and returns the subset that
 * represent something the operator wants to be alerted about. "Sensitive"
 * means: an op signed by the watched account that moves funds, changes
 * keys, alters delegation, starts a power-down, or changes the witness
 * record.
 *
 * Pure — no I/O, no env, no clock. The orchestrator hands raw
 * `get_account_history` output in; structured events come out. Test in
 * isolation; reuse against any chain.
 *
 * The 5 ops watched, and the field on each that means "signed by us":
 *
 *   transfer                  from === account     (outbound funds only)
 *   account_update            account === account  (KEY ROTATION)
 *   withdraw_vesting          account === account  (power-down begun)
 *   delegate_vesting_shares   delegator === account
 *   witness_update            owner === account    (block-signing key change etc)
 *
 * Inbound transfers (to === account) are NOT alerted — income is normal.
 * The operator can see receipts in the wallet UI; security alerts are
 * for outbound, key, and witness changes only.
 *
 * Each emitted event has:
 *   { kind, severity, account, op, opData, block, trxId, historyIndex, timestamp }
 *
 *   - kind:      'transfer' | 'account_update' | 'withdraw_vesting' |
 *                'delegate_vesting_shares' | 'witness_update'
 *   - severity:  'critical' (key/witness change), 'high' (transfer), 'warn' (power-down, delegation)
 *
 * The orchestrator dedupes on `historyIndex` (account_history is monotonic
 * per account; the same index = the same op).
 */

const SEVERITY = {
  transfer: 'high',
  account_update: 'critical',
  withdraw_vesting: 'warn',
  delegate_vesting_shares: 'warn',
  witness_update: 'critical',
};

/**
 * Test whether a single op-tuple, in the context of `account`, is a
 * sensitive event we want to alert on.
 *
 * @returns {boolean}
 */
export function isSensitiveOp(opTuple, account) {
  if (!Array.isArray(opTuple) || opTuple.length < 2) return false;
  const [opName, opVal] = opTuple;
  if (!opVal || typeof opVal !== 'object') return false;
  switch (opName) {
    case 'transfer':
      return opVal.from === account;
    case 'account_update':
      return opVal.account === account;
    case 'withdraw_vesting':
      return opVal.account === account;
    case 'delegate_vesting_shares':
      return opVal.delegator === account;
    case 'witness_update':
      return opVal.owner === account;
    default:
      return false;
  }
}

/**
 * Detect sensitive events in a history slice.
 *
 * @param {Array<[number, object]>} historySlice    `get_account_history` output
 *   shape: [[index, { trx_id, block, op: [opName, opData], timestamp }], ...]
 * @param {string} account                          the account we're watching
 * @param {{ minIndex?: number }} [opts]            ignore history index <= minIndex
 * @returns {Array<object>} sensitive events, oldest-first
 */
export function detectSensitiveEvents(historySlice, account, { minIndex = -1 } = {}) {
  if (!Array.isArray(historySlice) || !account) return [];
  const events = [];
  for (const entry of historySlice) {
    if (!Array.isArray(entry) || entry.length < 2) continue;
    const [index, record] = entry;
    if (typeof index !== 'number' || index <= minIndex) continue;
    if (!record || !Array.isArray(record.op)) continue;
    const [opName, opData] = record.op;
    if (!isSensitiveOp(record.op, account)) continue;
    events.push({
      kind: opName,
      severity: SEVERITY[opName] || 'warn',
      account,
      op: opName,
      opData,
      block: record.block ?? null,
      trxId: record.trx_id ?? null,
      historyIndex: index,
      timestamp: record.timestamp ?? null,
    });
  }
  events.sort((a, b) => a.historyIndex - b.historyIndex);
  return events;
}

/**
 * Highest historyIndex in a slice, or null if empty.
 * Used by the orchestrator to advance its cursor after a successful tick.
 */
export function maxHistoryIndex(historySlice) {
  if (!Array.isArray(historySlice) || historySlice.length === 0) return null;
  let max = -Infinity;
  for (const entry of historySlice) {
    if (Array.isArray(entry) && typeof entry[0] === 'number' && entry[0] > max) {
      max = entry[0];
    }
  }
  return Number.isFinite(max) ? max : null;
}

export const _internals = { SEVERITY };
