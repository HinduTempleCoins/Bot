// forum-core.mjs — the MELEK FORUM engine (Gaia Online × Bitcointalk, in the SoapBox house style).
//
// WHY THIS EXISTS: MELEK needs a real discussion forum — categorised boards, threads, threaded replies —
// with the two ideas that make Bitcointalk's forum trustworthy rather than a spam pit:
//   1. SCARCE PEER-MERIT (integrations/peer-merit.mjs): merit is peer-awarded, can't be self-minted, and a
//      whale's stake buys none. A post's standing rises when a PEER spends merit they were given on it.
//   2. GATING: brand-new / zero-merit accounts are rate-limited (anti-flood); accumulating received merit
//      unlocks privileges (the rate-limit lifts). No stake, no purchase — only earned peer trust.
// Portable identity (integrations/persona-card.mjs) supplies each poster's forum SIGNATURE.
//
// This module is PURE + soft-fail-never-throw + deterministic (the clock is injected as `now`; pure logic
// never calls Date.now()). It owns NO keys and signs NOTHING — the site layer renders a signable
// MELEK-Signer `comment` intent; the actual broadcast happens in the browser against the Signer.
//
// STORE: an append-only EVENT LEDGER, exactly like karma/index.mjs. Two entry kinds share one ledger:
//   • post  : { kind:'post',  id, threadId, board, author, title, body, parentId, ts, seq }
//   • merit : { kind:'merit', postId, from, to, amount, ts, seq }
// A THREAD is its root post (threadId === id, parentId === null, has a title). A REPLY is a post with a
// parentId. A post's MERIT standing = sum of merit-entry amounts for that postId; the scarce rails
// (self-award blocked, insufficient-sendable blocked) are enforced by peer-merit underneath.
//
//   import { createForum, makeMemoryStore, BOARDS, esc } from './forum-core.mjs'
//
// STORE CONTRACT (duck-typed, sync or async — everything is awaited):
//   store.append(entry) → void      append one immutable entry
//   store.all()         → entry[]    every entry, in append order

import { createPeerMerit } from '../peer-merit.mjs';
import { cardSvg } from '../persona-card.mjs';

// ── the FORUM's own merit unit ────────────────────────────────────────────────
// The forum's native standing signal is FORUM merit (the peer-merit `received` score). It is NOT a
// stake token and cannot be bought; it is the scarce, peer-awarded trust primitive re-used from
// peer-merit.mjs. "FORUM" here names that merit unit as surfaced on the forum.
export const FORUM_TOKEN = 'FORUM';

// ── gating / ranking constants (tunable) ──────────────────────────────────────
export const NEW_ACCOUNT_POST_INTERVAL_MS = 60 * 1000; // min gap between posts for a zero-merit account
export const MERIT_UNLOCK_THRESHOLD = 1;               // received merit that lifts the rate-limit
export const MAX_TITLE = 160;                          // clamp lengths (anti-abuse, storage sanity)
export const MAX_BODY = 20000;
export const MERIT_WEIGHT = 10;   // ranking: each merit point on a thread
export const REPLY_WEIGHT = 2;    // ranking: each reply
export const RECENCY_WEIGHT = 20; // ranking: newness bonus (decays with age in days)
const DAY_MS = 24 * 60 * 60 * 1000;

// ── boards registry (categories → boards) ─────────────────────────────────────
export const BOARDS = [
  { id: 'announcements', title: 'Announcements', category: 'MELEK', desc: 'Official MELEK news, releases, and witness notices.' },
  { id: 'general',       title: 'General Discussion', category: 'MELEK', desc: 'Anything MELEK — introductions, questions, and open talk.' },
  { id: 'economy',       title: 'Economy & Tokens', category: 'MELEK', desc: 'MELEK, MBD, side-tokens, curation rewards, and the FORUM merit economy.' },
  { id: 'witness',       title: 'Witnesses & Governance', category: 'Chain', desc: 'Block production, voting, and running a node.' },
  { id: 'development',   title: 'Development', category: 'Chain', desc: 'Building on the chain — apps, APIs, the condenser, and tooling.' },
  { id: 'marketplace',   title: 'Marketplace & Services', category: 'Community', desc: 'Offer or find services, goods, and bounties.' },
  { id: 'library',       title: 'Library of Ashurbanipal', category: 'Community', desc: 'Plant-medicine & harm-reduction reference — history, ethnobotany, safety. Education only; no synthesis/extraction recipes.' },
  { id: 'meta',          title: 'Forum Feedback', category: 'Community', desc: 'Bugs, ideas, and moderation for the forum itself.' },
];

const BOARD_IDS = new Set(BOARDS.map((b) => b.id));

/** Boards grouped by category, in first-seen order. */
export function boardsByCategory(boards = BOARDS) {
  const order = [];
  const map = new Map();
  for (const b of boards) {
    if (!map.has(b.category)) { map.set(b.category, []); order.push(b.category); }
    map.get(b.category).push(b);
  }
  return order.map((category) => ({ category, boards: map.get(category) }));
}

// ── helpers ───────────────────────────────────────────────────────────────────
const num = (x) => { const v = Number(x); return Number.isFinite(v) ? v : 0; };

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ));
}

function normAccount(a) {
  if (typeof a !== 'string') return null;
  const t = a.trim();
  return t.length ? t : null;
}
function clampStr(s, max) {
  const t = typeof s === 'string' ? s : '';
  return t.length > max ? t.slice(0, max) : t;
}
function isBoard(id) { return typeof id === 'string' && BOARD_IDS.has(id); }

// ── stores (mirror karma/index.mjs exactly) ───────────────────────────────────
export function makeMemoryStore() {
  const entries = [];
  return {
    append(entry) { entries.push(entry); },
    all() { return entries.slice(); },
  };
}

export function makeJsonlStore(file, fsImpl = null) {
  let _fs = fsImpl;
  const fsOrDie = () => {
    if (_fs) return _fs;
    throw new Error('jsonl store needs an fs impl; call with one or use the CLI');
  };
  return {
    __setFs(impl) { _fs = impl || null; },
    append(entry) {
      try { fsOrDie().appendFileSync(file, JSON.stringify(entry) + '\n'); } catch { /* soft-fail */ }
    },
    all() {
      try {
        const raw = fsOrDie().readFileSync(file, 'utf8');
        const out = [];
        for (const line of raw.split('\n')) {
          const t = line.trim();
          if (!t) continue;
          try { out.push(JSON.parse(t)); } catch { /* skip corrupt line */ }
        }
        return out;
      } catch { return []; }
    },
  };
}

/**
 * Create a forum instance bound to a store and a peer-merit instance.
 * @param {object} [opts]
 * @param {{append:Function, all:Function}} [opts.store] injectable ledger (default in-memory).
 * @param {() => number} [opts.now] injectable clock (default Date.now) — only the store/CLI ever calls it.
 * @param {object} [opts.merit] a peer-merit instance (default: a fresh in-memory one).
 * @param {object} [opts.config] override gating/ranking constants.
 */
export function createForum({ store, now, merit, config } = {}) {
  const _store = store && typeof store.append === 'function' && typeof store.all === 'function'
    ? store
    : makeMemoryStore();
  const _now = typeof now === 'function' ? now : Date.now;
  const _merit = merit && typeof merit.sendMerit === 'function' ? merit : createPeerMerit({});

  const cfg = {
    newAccountIntervalMs: NEW_ACCOUNT_POST_INTERVAL_MS,
    unlockThreshold: MERIT_UNLOCK_THRESHOLD,
    meritWeight: MERIT_WEIGHT,
    replyWeight: REPLY_WEIGHT,
    recencyWeight: RECENCY_WEIGHT,
    ...(config && typeof config === 'object' ? config : {}),
  };

  let _seq = 0;
  try {
    for (const e of _store.all() || []) {
      const s = num(e && e.seq);
      if (s >= _seq) _seq = s + 1;
    }
  } catch { /* soft-fail: start at 0 */ }

  async function _all() {
    try { return (await _store.all()) || []; } catch { return []; }
  }
  const _posts = (rows) => rows.filter((e) => e && e.kind === 'post');
  const _merits = (rows) => rows.filter((e) => e && e.kind === 'merit');

  async function _append(entry) {
    const frozen = Object.freeze({ ...entry });
    try { await _store.append(frozen); return true; } catch { return false; }
  }

  // last time this account posted anything (0 if never). Used by the rate-limit gate.
  async function _lastPostTs(acc) {
    let last = 0;
    for (const e of _posts(await _all())) {
      if (e.author === acc) { const t = num(e.ts); if (t > last) last = t; }
    }
    return last;
  }

  // GATE: may this account post right now? Zero-merit accounts are rate-limited; merit lifts the limit.
  async function _canPost(acc, nowTs) {
    let score = 0;
    try { score = await _merit.meritScore(acc); } catch { score = 0; }
    if (score >= cfg.unlockThreshold) return { ok: true, privileged: true };
    const last = await _lastPostTs(acc);
    if (last && (nowTs - last) < cfg.newAccountIntervalMs) {
      return { ok: false, reason: 'rate-limited', retryInMs: cfg.newAccountIntervalMs - (nowTs - last) };
    }
    return { ok: true, privileged: false };
  }

  // sum of merit awarded to one post.
  async function _postMerit(postId, rows) {
    const all = rows || await _all();
    let sum = 0;
    for (const m of _merits(all)) if (m.postId === postId) sum += num(m.amount);
    return sum;
  }

  return {
    /** Board metadata by id (null if unknown). */
    boardMeta(id) { return BOARDS.find((b) => b.id === id) || null; },

    /** All boards, grouped by category. */
    boards() { return boardsByCategory(); },

    /**
     * Create a new thread (a root post). Enforces a real board, an account, a title, and the post gate.
     * `now` (ms) MUST be passed for determinism. Returns { ok, reason?, thread } — never throws.
     */
    async createThread({ board, author, title, body, now: nowArg } = {}) {
      const acc = normAccount(author);
      if (!acc) return { ok: false, reason: 'invalid-account' };
      if (!isBoard(board)) return { ok: false, reason: 'unknown-board' };
      const t = clampStr(title, MAX_TITLE).trim();
      if (!t) return { ok: false, reason: 'title-required' };
      const nowTs = Math.floor(num(nowArg) || num(_now()));
      const gate = await _canPost(acc, nowTs);
      if (!gate.ok) return { ok: false, reason: gate.reason, retryInMs: gate.retryInMs };

      const seq = _seq++;
      const id = `t${seq}`;
      const thread = {
        kind: 'post', id, threadId: id, board, author: acc,
        title: t, body: clampStr(body, MAX_BODY), parentId: null, ts: nowTs, seq,
      };
      if (!(await _append(thread))) { _seq--; return { ok: false, reason: 'store-error' }; }
      return { ok: true, thread };
    },

    /**
     * Reply to a thread (optionally nested under another post via parentId). Enforces account, an existing
     * target thread, a non-empty body, and the post gate. Returns { ok, reason?, post } — never throws.
     */
    async reply({ threadId, author, body, parentId, now: nowArg } = {}) {
      const acc = normAccount(author);
      if (!acc) return { ok: false, reason: 'invalid-account' };
      const rows = await _all();
      const root = _posts(rows).find((p) => p.id === threadId && p.parentId === null);
      if (!root) return { ok: false, reason: 'no-such-thread' };
      const b = clampStr(body, MAX_BODY).trim();
      if (!b) return { ok: false, reason: 'body-required' };
      // parentId defaults to the thread root; if given, it must be a post IN this thread.
      let parent = root.id;
      if (parentId && parentId !== root.id) {
        const pp = _posts(rows).find((p) => p.id === parentId && p.threadId === root.id);
        if (!pp) return { ok: false, reason: 'no-such-parent' };
        parent = pp.id;
      }
      const nowTs = Math.floor(num(nowArg) || num(_now()));
      const gate = await _canPost(acc, nowTs);
      if (!gate.ok) return { ok: false, reason: gate.reason, retryInMs: gate.retryInMs };

      const seq = _seq++;
      const id = `p${seq}`;
      const post = {
        kind: 'post', id, threadId: root.id, board: root.board, author: acc,
        title: '', body: b, parentId: parent, ts: nowTs, seq,
      };
      if (!(await _append(post))) { _seq--; return { ok: false, reason: 'store-error' }; }
      return { ok: true, post };
    },

    /**
     * A single thread: the root post + every post in it (root first, then by seq), each annotated with
     * `merit` (its standing) and `depth` (nesting level for indentation). Unknown id → null.
     */
    async thread(id) {
      const rows = await _all();
      const posts = _posts(rows);
      const root = posts.find((p) => p.id === id && p.parentId === null);
      if (!root) return null;
      const inThread = posts.filter((p) => p.threadId === root.id)
        .sort((a, b) => a.seq - b.seq);
      const byId = new Map(inThread.map((p) => [p.id, p]));
      const depthOf = (p) => {
        let d = 0; let cur = p;
        // walk parent chain, guard against cycles/corruption
        for (let i = 0; i < 64 && cur && cur.parentId; i++) {
          const par = byId.get(cur.parentId);
          if (!par || par.id === cur.id) break;
          d++; cur = par;
        }
        return d;
      };
      const out = [];
      for (const p of inThread) {
        out.push({ ...p, merit: await _postMerit(p.id, rows), depth: depthOf(p) });
      }
      const meritTotal = out.reduce((s, p) => s + p.merit, 0);
      const lastActivityTs = out.reduce((m, p) => Math.max(m, num(p.ts)), 0);
      return {
        id: root.id, board: root.board, title: root.title, author: root.author,
        posts: out, replyCount: out.length - 1, meritTotal, lastActivityTs,
      };
    },

    /**
     * Thread summaries for one board, ranked by standing (merit + replies + recency) given `now`.
     * Returns [] for an unknown board. Deterministic when `now` is passed.
     */
    async board(id, { now: nowArg, sort = 'rank', limit } = {}) {
      if (!isBoard(id)) return [];
      const rows = await _all();
      const posts = _posts(rows);
      const roots = posts.filter((p) => p.board === id && p.parentId === null);
      const nowTs = Math.floor(num(nowArg) || num(_now()));
      const summaries = roots.map((r) => {
        const inThread = posts.filter((p) => p.threadId === r.id);
        const replyCount = inThread.length - 1;
        const lastActivityTs = inThread.reduce((m, p) => Math.max(m, num(p.ts)), 0);
        let meritTotal = 0;
        for (const p of inThread) for (const mm of _merits(rows)) if (mm.postId === p.id) meritTotal += num(mm.amount);
        const ageDays = Math.max(0, (nowTs - lastActivityTs) / DAY_MS);
        const score = meritTotal * cfg.meritWeight
          + replyCount * cfg.replyWeight
          + (cfg.recencyWeight / (1 + ageDays));
        return {
          id: r.id, board: r.board, title: r.title, author: r.author,
          createdTs: r.ts, lastActivityTs, replyCount, meritTotal, score,
        };
      });
      summaries.sort(sort === 'new'
        ? (a, b) => b.lastActivityTs - a.lastActivityTs || b.id.localeCompare(a.id)
        : (a, b) => b.score - a.score || b.lastActivityTs - a.lastActivityTs);
      const n = num(limit);
      return n > 0 ? summaries.slice(0, Math.floor(n)) : summaries;
    },

    /** Most-recently-active threads across ALL boards (default 20). */
    async recentThreads(limit = 20) {
      const rows = await _all();
      const posts = _posts(rows);
      const roots = posts.filter((p) => p.parentId === null);
      const summaries = roots.map((r) => {
        const inThread = posts.filter((p) => p.threadId === r.id);
        const lastActivityTs = inThread.reduce((m, p) => Math.max(m, num(p.ts)), 0);
        return {
          id: r.id, board: r.board, title: r.title, author: r.author,
          replyCount: inThread.length - 1, lastActivityTs, createdTs: r.ts,
        };
      });
      summaries.sort((a, b) => b.lastActivityTs - a.lastActivityTs || b.id.localeCompare(a.id));
      const n = num(limit);
      return n > 0 ? summaries.slice(0, Math.floor(n)) : summaries;
    },

    /**
     * Award scarce peer-merit to a post. Delegates to peer-merit (self-award & insufficient-sendable are
     * blocked THERE), then records a merit entry so the post's standing rises. Returns
     * { ok, reason?, postMerit, authorScore } — never throws.
     */
    async awardMerit({ from, postId, amount = 1, now: nowArg } = {}) {
      const f = normAccount(from);
      if (!f) return { ok: false, reason: 'invalid-account' };
      const rows = await _all();
      const post = _posts(rows).find((p) => p.id === postId);
      if (!post) return { ok: false, reason: 'no-such-post' };
      if (post.author === f) return { ok: false, reason: 'self-award' };
      const nowTs = Math.floor(num(nowArg) || num(_now()));
      let res;
      try { res = await _merit.sendMerit(f, post.author, amount, { now: nowTs }); }
      catch { return { ok: false, reason: 'merit-error' }; }
      if (!res || !res.ok) return { ok: false, reason: (res && res.reason) || 'merit-refused' };

      const seq = _seq++;
      const entry = { kind: 'merit', postId, from: f, to: post.author, amount: Math.floor(num(amount)), ts: nowTs, seq };
      if (!(await _append(entry))) { _seq--; return { ok: false, reason: 'store-error' }; }
      const postMerit = await _postMerit(postId);
      let authorScore = 0;
      try { authorScore = await _merit.meritScore(post.author); } catch { authorScore = 0; }
      return { ok: true, postMerit, authorScore };
    },

    /** A post's merit standing (sum of awards). Unknown post → 0. */
    async postMerit(postId) { return _postMerit(postId); },

    /** Grant the periodic scarce faucet allotment (delegates to peer-merit). */
    async grantAllotment(account, opts) {
      try { return await _merit.grantAllotment(account, opts); }
      catch { return { ok: false, reason: 'merit-error' }; }
    },

    /** May this account post right now? (exposes the gate for the UI). */
    async canPost(account, nowArg) {
      const acc = normAccount(account);
      if (!acc) return { ok: false, reason: 'invalid-account' };
      return _canPost(acc, Math.floor(num(nowArg) || num(_now())));
    },

    /** Does this account clear a privilege threshold on its received merit? */
    async meetsThreshold(account, threshold) {
      try { return await _merit.meetsThreshold(account, threshold); } catch { return false; }
    },

    /** Naive full-text search over thread titles + post bodies. Returns thread summaries. */
    async search(query, { limit = 25 } = {}) {
      const q = String(query ?? '').trim().toLowerCase();
      if (!q) return [];
      const rows = await _all();
      const posts = _posts(rows);
      const hitThreadIds = new Set();
      for (const p of posts) {
        const hay = `${p.title || ''}\n${p.body || ''}`.toLowerCase();
        if (hay.includes(q)) hitThreadIds.add(p.threadId);
      }
      const roots = posts.filter((p) => p.parentId === null && hitThreadIds.has(p.id));
      const out = roots.map((r) => {
        const inThread = posts.filter((p) => p.threadId === r.id);
        const lastActivityTs = inThread.reduce((m, p) => Math.max(m, num(p.ts)), 0);
        return { id: r.id, board: r.board, title: r.title, author: r.author, replyCount: inThread.length - 1, lastActivityTs };
      });
      out.sort((a, b) => b.lastActivityTs - a.lastActivityTs);
      const n = num(limit);
      return n > 0 ? out.slice(0, Math.floor(n)) : out;
    },

    /**
     * A poster's forum SIGNATURE (the portable persona card). `personaData` is a persona-shaped object
     * (account/renName/balances/postCount…); reuses persona-card.cardSvg (pure, no network). If merit is
     * known it's shown as a FORUM badge line. Always returns valid HTML, never throws.
     */
    async signature(account, personaData) {
      const acc = normAccount(account) || '';
      const p = personaData && typeof personaData === 'object' ? personaData : { account: acc, balances: {} };
      let score = 0;
      try { score = await _merit.meritScore(acc); } catch { score = 0; }
      let svg = '';
      try { svg = cardSvg({ account: acc, ...p }); } catch { svg = ''; }
      return `<div class="forum-sig" data-account="${esc(acc)}">`
        + svg
        + `<div class="forum-sig-merit">✦ ${esc(score)} ${esc(FORUM_TOKEN)} merit</div>`
        + `</div>`;
    },

    get config() { return { ...cfg }; },
    get store() { return _store; },
    get merit() { return _merit; },
  };
}

export default createForum;

// ── CLI ─────────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && process.argv[1].endsWith('forum-core.mjs');
if (isMain) {
  // A short deterministic demo over the in-memory store (no disk, no network).
  const forum = createForum({});
  const t0 = Date.parse('2026-01-01T00:00:00Z');
  const min = 60 * 1000;
  (async () => {
    await forum.grantAllotment('alice', { now: t0 });
    const th = await forum.createThread({ board: 'general', author: 'alice', title: 'Hello MELEK', body: 'First thread.', now: t0 });
    const rep = await forum.reply({ threadId: th.thread.id, author: 'bob', body: 'Welcome!', now: t0 });
    const flood = await forum.reply({ threadId: th.thread.id, author: 'bob', body: 'again', now: t0 + 1000 }); // rate-limited
    const aw = await forum.awardMerit({ from: 'alice', postId: rep.post.id, amount: 1, now: t0 + 2 * min });
    const self = await forum.awardMerit({ from: 'bob', postId: rep.post.id, amount: 1, now: t0 + 2 * min }); // self-award
    console.log('thread ok      :', th.ok, th.thread.id);
    console.log('reply ok       :', rep.ok, rep.post.id);
    console.log('flood reason   :', flood.reason);
    console.log('award ok       :', aw.ok, 'postMerit=', aw.postMerit);
    console.log('self-award     :', self.reason);
    console.log('board(general) :', (await forum.board('general', { now: t0 + 2 * min })).map((t) => `${t.title}:${t.score.toFixed(1)}`).join(' | '));
    console.log('search "hello" :', (await forum.search('hello')).map((t) => t.title).join(', '));
  })();
}
