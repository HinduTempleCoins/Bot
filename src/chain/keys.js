/**
 * Hathor account key loading.
 *
 * Active key is for transfers, delegations, account creation.
 * Posting key is for comments and votes.
 * Owner key is NEVER loaded here — it stays offline.
 *
 * Keys are read from env once at module load. They are not logged,
 * not stringified into errors, and not returned by any debug helper.
 */

const ACCOUNT = process.env.HATHOR_ACCOUNT || 'hathor';
const POSTING = process.env.HATHOR_POSTING_KEY || null;
const ACTIVE = process.env.HATHOR_ACTIVE_KEY || null;

export function getAccount() {
  return ACCOUNT;
}

export function getPostingKey() {
  if (!POSTING) {
    throw new Error('HATHOR_POSTING_KEY not configured');
  }
  return POSTING;
}

export function getActiveKey() {
  if (!ACTIVE) {
    throw new Error('HATHOR_ACTIVE_KEY not configured');
  }
  return ACTIVE;
}

export function hasPostingKey() {
  return Boolean(POSTING);
}

export function hasActiveKey() {
  return Boolean(ACTIVE);
}
