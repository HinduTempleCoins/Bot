// chain-mirror.mjs — reads the forum's on-chain writing back from MELEK and shapes it as forum-core ledger
// entries, so what is posted on chain shows up as threads on the forum.
//
// Two sources:
//   1. The blogs of the ecosystem's own accounts (@hathor, @melek by default) — each top-level post becomes a
//      thread on the board its category maps to (Announcements by default), shown as an excerpt with a link to
//      the canonical post on melek.salon.
//   2. Every post in a forum board's category (`melek-forum-<board>`, see tagForBoard) — these ARE forum
//      threads, posted through /post and signed in the browser via MELEK-Signer, so they render in full.
//      A post that carries json_metadata.reply_to = <forum thread id> is a reply to a thread that is not
//      itself on chain (a seed thread), and is attached to that thread as a reply.
//   Chain replies to either kind are read with get_content_replies and attached under their parent.
//
// House style: pure shaping functions + a refresher with injectable fetch and clock. Soft-fail, never throws:
// an unreachable RPC leaves the last good mirror in place. Rendering never waits on it — callers read
// `entries()` synchronously, and `refresh()` runs in the background.
//
//   const m = createChainMirror({ rpcUrl, fetch, boardTags, resolveBoard, onNew })
//   m.load(persistedEntries); m.start(); …  m.entries() → ledger post entries

export const DEFAULT_RPC = 'https://melek.salon/rpc';
export const DEFAULT_ACCOUNTS = ['hathor', 'melek'];
export const FORUM_TAG_PREFIX = 'melek-forum-';
export const CANONICAL_BASE = 'https://melek.salon';
export const EXCERPT_CHARS = 1600;
const MAX_REPLY_CALLS = 120;

/** The on-chain category for a forum board. Chain permlinks/categories allow only [a-z0-9-], so '/' → '-'. */
export function tagForBoard(boardId) {
  return FORUM_TAG_PREFIX + String(boardId || '').toLowerCase().replace(/\//g, '-').replace(/[^a-z0-9-]/g, '');
}

/** The forum ledger id for a chain post. */
export function chainId(author, permlink) {
  return `m-${String(author || '').replace(/[^a-z0-9.-]/gi, '')}-${String(permlink || '').replace(/[^a-z0-9-]/gi, '')}`;
}

/** The canonical melek.salon URL for a chain post: /<category>/@author/permlink when the category is known
 *  (that is the URL melek.salon itself declares canonical), else /@author/permlink, which also resolves. */
export function canonicalUrl(author, permlink, category = '') {
  const cat = String(category || '').toLowerCase();
  const prefix = /^[a-z0-9-]+$/.test(cat) ? `/${cat}` : '';
  return `${CANONICAL_BASE}${prefix}/@${encodeURIComponent(author)}/${encodeURIComponent(permlink)}`;
}

// Which board an ecosystem-account blog post lands on, by its chain category. Anything unmapped → announcements.
export const CATEGORY_BOARD = {
  biohacking: 'nootropics',
  aiclub: 'ai-history',
  history: 'history/mysteries',
  kula: 'crypto/prana',
  prana: 'crypto/prana',
  witness: 'witness',
  ai: 'development',
  writing: 'general',
};

// Test spam / smoke posts that should never become forum threads.
export function isNoise(d) {
  if (!d) return true;
  const cat = String(d.category || '').toLowerCase();
  if (cat === 'melektest' || cat === 'test') return true;
  if (/(^|-)test(-|$)/.test(String(d.permlink || '')) && String(d.body || '').length < 400) return true;
  return false;
}

function parseMeta(d) {
  if (!d) return {};
  if (d.json_metadata && typeof d.json_metadata === 'object') return d.json_metadata;
  try { const j = JSON.parse(d.json_metadata || '{}'); return j && typeof j === 'object' ? j : {}; } catch { return {}; }
}

function chainTs(created) {
  const s = String(created || '');
  const t = Date.parse(/Z$|[+-]\d\d:?\d\d$/.test(s) ? s : `${s}Z`);
  return Number.isFinite(t) ? t : 0;
}

/** Markdown/HTML → readable plain text for the forum renderer (which escapes and autolinks). */
export function markdownToText(md) {
  let s = String(md || '');
  s = s.replace(/\r\n/g, '\n');
  s = s.replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*\n?/g, ''));
  s = s.replace(/!\[[^\]]*\]\([^)]*\)/g, '');                       // images
  s = s.replace(/<img[^>]*>/gi, '');
  s = s.replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, (m, t, u) => (t.trim() === u.trim() ? u : `${t} (${u})`));
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/?(p|div|center|h[1-6]|li|ul|ol|blockquote|table|tr)[^>]*>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/^#{1,6}\s+(.*)$/gm, '## $1');                       // any heading → the renderer's one level
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '$1').replace(/__([^_\n]+)__/g, '$1');
  s = s.replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2');
  s = s.replace(/^\s*[*+]\s+/gm, '- ');
  s = s.replace(/^\s*>\s?/gm, '');
  s = s.replace(/^\|?\s*:?-{3,}.*$/gm, '');                          // table rules
  s = s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
  s = s.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

/** A paragraph-boundary excerpt of at most `max` characters. */
export function excerpt(text, max = EXCERPT_CHARS) {
  const t = String(text || '');
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const para = cut.lastIndexOf('\n\n');
  const at = para > max * 0.5 ? para : (cut.lastIndexOf('. ') > max * 0.5 ? cut.lastIndexOf('. ') + 1 : max);
  return `${cut.slice(0, at).trim()} …`;
}

/**
 * Shape a top-level chain discussion into a forum ledger post entry (a thread root), or null.
 * kind 'blog' → excerpt + canonical link; kind 'forum' → full body. `resolveBoard` validates board ids.
 */
export function discussionToEntry(d, { kind = 'blog', boardForTag = null, resolveBoard = null } = {}) {
  try {
    if (!d || !d.author || !d.permlink || isNoise(d)) return null;
    const meta = parseMeta(d);
    const id = chainId(d.author, d.permlink);
    const url = canonicalUrl(d.author, d.permlink, d.category);
    const ts = chainTs(d.created);
    const text = markdownToText(d.body);
    const ok = (b) => !!(b && (typeof resolveBoard !== 'function' || resolveBoard(b)));

    if (kind === 'forum') {
      let board = typeof meta.board === 'string' && tagForBoard(meta.board) === d.category && ok(meta.board) ? meta.board : null;
      if (!board && boardForTag) board = boardForTag(d.category);
      if (!board) return null;
      const replyTo = typeof meta.reply_to === 'string' ? meta.reply_to : null;
      const base = {
        kind: 'post', id, board, author: d.author, body: text, ts, seq: 0, src: 'chain',
        chain: { author: d.author, permlink: d.permlink, url },
      };
      if (replyTo) {
        const parent = typeof meta.reply_parent === 'string' ? meta.reply_parent : replyTo;
        return { ...base, threadId: replyTo, parentId: parent, title: '' };
      }
      if (!String(d.title || '').trim()) return null;
      return { ...base, threadId: id, parentId: null, title: String(d.title).trim() };
    }

    // blog post by an ecosystem account
    if (d.parent_author) return null;                       // a comment, not a post
    const title = String(d.title || '').trim();
    if (!title) return null;
    const mapped = CATEGORY_BOARD[String(d.category || '').toLowerCase()];
    const board = ok(mapped) ? mapped : 'announcements';
    const body = `${excerpt(text)}\n\nRead the full post on melek.salon: ${url}`;
    return {
      kind: 'post', id, threadId: id, board, author: d.author, title, body, parentId: null, ts, seq: 0, src: 'chain',
      chain: { author: d.author, permlink: d.permlink, url, category: d.category || '' },
    };
  } catch { return null; }
}

/** Shape a chain reply (from get_content_replies) under a known parent entry. */
export function replyToEntry(r, parentEntry) {
  try {
    if (!r || !r.author || !r.permlink || !parentEntry) return null;
    const text = markdownToText(r.body);
    if (!text) return null;
    return {
      kind: 'post', id: chainId(r.author, r.permlink), threadId: parentEntry.threadId || parentEntry.id,
      board: parentEntry.board, author: r.author, title: '', body: text,
      parentId: parentEntry.id, ts: chainTs(r.created), seq: 0, src: 'chain',
      chain: { author: r.author, permlink: r.permlink, url: canonicalUrl(r.author, r.permlink) },
    };
  } catch { return null; }
}

/**
 * The refresher. Options:
 *   rpcUrl, fetch (injectable), accounts, boardTags: () => [{ board, tag }], resolveBoard, onNew(entries),
 *   refreshMs (default 10 min), timeoutMs (default 15 s), concurrency (default 4).
 */
export function createChainMirror(opts = {}) {
  const rpcUrl = opts.rpcUrl || DEFAULT_RPC;
  let _fetch = typeof opts.fetch === 'function' ? opts.fetch : (typeof fetch === 'function' ? fetch : null);
  const accounts = Array.isArray(opts.accounts) && opts.accounts.length ? opts.accounts : DEFAULT_ACCOUNTS;
  const boardTags = typeof opts.boardTags === 'function' ? opts.boardTags : () => [];
  const resolveBoard = typeof opts.resolveBoard === 'function' ? opts.resolveBoard : null;
  const onNew = typeof opts.onNew === 'function' ? opts.onNew : null;
  const refreshMs = Number(opts.refreshMs) > 0 ? Number(opts.refreshMs) : 10 * 60 * 1000;
  const timeoutMs = Number(opts.timeoutMs) > 0 ? Number(opts.timeoutMs) : 15000;
  const concurrency = Number(opts.concurrency) > 0 ? Math.floor(Number(opts.concurrency)) : 4;

  const byId = new Map();          // id → entry
  let _timer = null;
  let _running = null;
  const status = { lastRefreshTs: 0, lastOk: false, threads: 0, posts: 0, errors: 0 };

  function boardForTag(tag) {
    for (const { board, tag: t } of boardTags()) if (t === tag) return board;
    return null;
  }

  async function rpc(method, params) {
    if (!_fetch) return null;
    let ctl = null; let t = null;
    try {
      ctl = typeof AbortController === 'function' ? new AbortController() : null;
      t = ctl ? setTimeout(() => { try { ctl.abort(); } catch { /* noop */ } }, timeoutMs) : null;
      if (t && typeof t.unref === 'function') t.unref();
      const r = await _fetch(rpcUrl, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        ...(ctl ? { signal: ctl.signal } : {}),
      });
      if (!r || !r.ok) { status.errors++; return null; }
      const j = await r.json();
      if (!j || j.error) { status.errors++; return null; }
      return j.result == null ? null : j.result;
    } catch { status.errors++; return null; } finally { if (t) clearTimeout(t); }
  }

  async function pool(items, fn) {
    const out = [];
    let i = 0;
    const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (i < items.length) { const k = i++; try { out[k] = await fn(items[k]); } catch { out[k] = null; } }
    });
    await Promise.all(workers);
    return out;
  }

  async function blogOf(account) {
    const all = [];
    let start = null;
    for (let page = 0; page < 3; page++) {
      const q = { tag: account, limit: 100 };
      if (start) { q.start_author = start.author; q.start_permlink = start.permlink; }
      const res = await rpc('condenser_api.get_discussions_by_blog', [q]);
      if (!Array.isArray(res) || !res.length) break;
      for (const d of (start ? res.slice(1) : res)) all.push(d);
      if (res.length < 100) break;
      start = res[res.length - 1];
    }
    return all.filter((d) => d && d.author === account);   // drop reblogs
  }

  function put(entry, fresh) {
    if (!entry) return;
    const prev = byId.get(entry.id);
    if (prev && prev.body === entry.body && prev.title === entry.title && prev.board === entry.board) return;
    byId.set(entry.id, entry);
    fresh.push(entry);
  }

  async function refresh() {
    if (_running) return _running;
    _running = (async () => {
      const fresh = [];
      let anyOk = false;
      try {
        // 1. ecosystem-account blogs
        const blogs = await pool(accounts, blogOf);
        const roots = [];
        for (const list of blogs) {
          if (!Array.isArray(list)) continue;
          if (list.length) anyOk = true;
          for (const d of list) {
            const e = discussionToEntry(d, { kind: 'blog', resolveBoard });
            if (e) { put(e, fresh); roots.push({ d, e }); }
          }
        }
        // 2. forum-category posts
        const tags = boardTags();
        const lists = await pool(tags, (bt) => rpc('condenser_api.get_discussions_by_created', [{ tag: bt.tag, limit: 50 }]));
        for (const list of lists) {
          if (!Array.isArray(list)) continue;
          anyOk = true;
          for (const d of list) {
            const e = discussionToEntry(d, { kind: 'forum', boardForTag, resolveBoard });
            if (e) { put(e, fresh); if (e.parentId === null) roots.push({ d, e }); }
          }
        }
        // 3. replies to anything we mirror that has children
        let calls = 0;
        const queue = roots.filter(({ d }) => Number(d.children) > 0).map(({ d, e }) => ({ d, e, depth: 0 }));
        while (queue.length && calls < MAX_REPLY_CALLS) {
          const batch = queue.splice(0, concurrency);
          calls += batch.length;
          const res = await pool(batch, ({ d }) => rpc('condenser_api.get_content_replies', [d.author, d.permlink]));
          res.forEach((replies, k) => {
            if (!Array.isArray(replies)) return;
            const { e: parent, depth } = batch[k];
            for (const r of replies) {
              const re = replyToEntry(r, parent);
              if (!re) continue;
              put(re, fresh);
              if (Number(r.children) > 0 && depth < 4) queue.push({ d: r, e: re, depth: depth + 1 });
            }
          });
        }
      } catch { /* soft-fail: keep the last good mirror */ }
      status.lastRefreshTs = Date.now();
      status.lastOk = anyOk;
      const all = [...byId.values()];
      status.threads = all.filter((x) => x.parentId === null).length;
      status.posts = all.length;
      if (fresh.length && onNew) { try { await onNew(fresh); } catch { /* soft-fail */ } }
      return fresh;
    })();
    try { return await _running; } finally { _running = null; }
  }

  return {
    /** Seed the mirror from persisted entries (last write per id wins). */
    load(entries) {
      for (const e of Array.isArray(entries) ? entries : []) {
        if (e && e.kind === 'post' && e.src === 'chain' && typeof e.id === 'string') byId.set(e.id, e);
      }
    },
    entries() { return [...byId.values()]; },
    refresh,
    start() {
      if (_timer) return;
      refresh().catch(() => {});
      _timer = setInterval(() => { refresh().catch(() => {}); }, refreshMs);
      if (_timer && typeof _timer.unref === 'function') _timer.unref();
    },
    stop() { if (_timer) clearInterval(_timer); _timer = null; },
    __setFetch(f) { _fetch = typeof f === 'function' ? f : null; },
    get status() { return { ...status }; },
  };
}

export default createChainMirror;
