// melek-notify.mjs — MELEK's own notification source (the Blurt condenser was hardwired to the
// foreign `wss://notifications.blurt.world`, which knows nothing about MELEK accounts — so mentions
// never surfaced). This is the PURE, testable core: turn chain operations into per-account
// notification items in the exact shape the condenser's NotificationsList renders
// ({ type, author/from, permlink, timestamp }). A thin host server (melek-notify-server.mjs)
// streams the chain through this and answers `get_notifications [account]`.
//
//   import { extractNotifications, MENTION_RE } from './melek-notify.mjs'
//   extractNotifications(['comment', {author:'hathor', permlink:'p', parent_author:'', body:'hi @alice'}], 1700000000)
//   -> [{ to:'alice', item:{ type:'mention', author:'hathor', permlink:'p', timestamp:1700000000 } }]
//
// Types the condenser renders: mention · transfer · reply · reblog · follow · witness_vote.

// @mention scan: a username token after '@', Graphene rules (3-16 chars, a-z0-9.-, starts a-z).
export const MENTION_RE = /@([a-z][a-z0-9.-]{2,15})\b/g;

function unixTime(t) {
  if (typeof t === 'number') return Math.floor(t);
  const ms = Date.parse(typeof t === 'string' && !/[zZ]|[+-]\d\d:?\d\d$/.test(t) ? t + 'Z' : t);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : 0;
}

function uniqueMentions(body) {
  const out = new Set();
  const text = String(body || '');
  let m;
  MENTION_RE.lastIndex = 0;
  while ((m = MENTION_RE.exec(text)) !== null) out.add(m[1].toLowerCase());
  return [...out];
}

/**
 * extractNotifications(op, time) -> [{ to, item }]
 *   op   : a Graphene op as [type, body] (what get_block / account_history yields)
 *   time : the block/op timestamp (unix seconds or ISO string)
 * Each result targets ONE recipient account `to` with a condenser-shaped `item`.
 * Pure, soft-fail (returns [] on anything unexpected). The recipient is never notified about
 * their own action (no self-mention / self-reply / self-transfer).
 */
export function extractNotifications(op, time) {
  try {
    if (!Array.isArray(op) || op.length < 2) return [];
    const [type, body] = op;
    const ts = unixTime(time);
    const out = [];

    if (type === 'comment' && body) {
      const author = String(body.author || '').toLowerCase();
      const permlink = String(body.permlink || '');
      const parent = String(body.parent_author || '').toLowerCase();
      // reply: a comment whose parent is someone else's post/comment
      if (parent && parent !== author) {
        out.push({ to: parent, item: { type: 'reply', author, permlink, timestamp: ts } });
      }
      // mentions: @user anywhere in the body (skip the author, skip the parent already notified)
      for (const u of uniqueMentions(body.body)) {
        if (u === author || u === parent) continue;
        out.push({ to: u, item: { type: 'mention', author, permlink, timestamp: ts } });
      }
      return out;
    }

    if (type === 'transfer' && body) {
      const from = String(body.from || '').toLowerCase();
      const to = String(body.to || '').toLowerCase();
      if (to && to !== from) out.push({ to, item: { type: 'transfer', from, amount: String(body.amount || ''), memo: String(body.memo || ''), timestamp: ts } });
      return out;
    }

    if (type === 'custom_json' && body && (body.id === 'follow' || body.id === 'blurt_follow')) {
      try {
        const j = typeof body.json === 'string' ? JSON.parse(body.json) : body.json;
        const [verb, data] = Array.isArray(j) ? j : [];
        if (verb === 'follow' && data && data.follower && data.following) {
          const follower = String(data.follower).toLowerCase();
          const following = String(data.following).toLowerCase();
          const isReblog = false; // reblog is a separate custom_json verb handled below
          const what = Array.isArray(data.what) ? data.what : [];
          if (what.includes('blog') && following !== follower) {
            out.push({ to: following, item: { type: 'follow', follower, timestamp: ts } });
          }
        }
        if (verb === 'reblog' && data && data.account && data.author) {
          const account = String(data.account).toLowerCase();
          const target = String(data.author).toLowerCase();
          if (target !== account) out.push({ to: target, item: { type: 'reblog', account, permlink: String(data.permlink || ''), timestamp: ts } });
        }
      } catch { /* malformed follow json → no notification */ }
      return out;
    }

    if (type === 'account_witness_vote' && body && body.approve) {
      const account = String(body.account || '').toLowerCase();
      const witness = String(body.witness || '').toLowerCase();
      if (witness && witness !== account) out.push({ to: witness, item: { type: 'witness_vote', account, timestamp: ts } });
      return out;
    }

    return [];
  } catch { return []; }
}

/**
 * A tiny in-memory per-account notification store with a cap, newest-first. The host wraps this
 * with chain streaming + a websocket `get_notifications [account]` responder + file persistence.
 */
export function makeNotifStore({ cap = 100 } = {}) {
  const byAccount = new Map();
  return {
    add(to, item) {
      if (!to || !item) return;
      const list = byAccount.get(to) || [];
      list.unshift(item);
      if (list.length > cap) list.length = cap;
      byAccount.set(to, list);
    },
    ingest(op, time) { for (const { to, item } of extractNotifications(op, time)) this.add(to, item); },
    get(account) { return byAccount.get(String(account || '').toLowerCase()) || []; },
    dump() { return Object.fromEntries(byAccount); },
    load(obj) { if (obj && typeof obj === 'object') for (const [k, v] of Object.entries(obj)) if (Array.isArray(v)) byAccount.set(k, v.slice(0, cap)); },
  };
}
