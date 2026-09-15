// pentecaust/herald/crossposter.mjs — Herald Graphene cross-poster (outreach brief, Component 1).
// Takes one authored source and mirrors it onto the Graphene social chains (MELEK / Blurt / Hive / Steem),
// each with chain-appropriate formatting + an ALWAYS-appended canonical backlink so the original stays the
// SEO/attribution root. Broadcasting is done by an INJECTED broadcaster — this module NEVER holds a WIF,
// never signs, never broadcasts on its own (key custody stays with MELEK-Signer, per BRIEF.md §7).
//
// MELEK is a BLURT fork, so it shares Blurt's formatting (8-tag cap, no per-op fee, no downvotes). Hive and
// Steem cap at 5 tags with the FIRST tag as the post's category. Per-chain daily pacing (default 2/day) is
// enforced off a small file-store of last-post timestamps so a burst never trips a chain's spam heuristics.
//
//   import { formatForChain, postToChains, verifyPost, postsFor, __setFetch, __setBroadcaster } from './crossposter.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('HERALD_CROSSPOST_DATA', join(process.cwd(), 'data', 'crosspost.json'));

const CHAINS = ['melek', 'blurt', 'hive', 'steem'];
const isChain = (c) => CHAINS.includes(String(c || '').toLowerCase());
// Tag caps: MELEK/Blurt allow 8; Hive/Steem allow 5 (first tag doubles as the category).
const TAG_CAP = { melek: 8, blurt: 8, hive: 5, steem: 5 };
// Default public front-ends for building shareable post URLs (overridable per chain via env).
const SITE = {
  melek: () => env('HERALD_SITE_MELEK', 'melek.salon'),
  blurt: () => env('HERALD_SITE_BLURT', 'blurt.blog'),
  hive: () => env('HERALD_SITE_HIVE', 'hive.blog'),
  steem: () => env('HERALD_SITE_STEEM', 'steemit.com'),
};
// Per-chain RPC endpoints for verifyPost's condenser_api.get_content read.
const RPC = {
  melek: () => env('HERALD_RPC_MELEK', 'https://rpc.melek.salon'),
  blurt: () => env('HERALD_RPC_BLURT', 'https://rpc.blurt.world'),
  hive: () => env('HERALD_RPC_HIVE', 'https://api.hive.blog'),
  steem: () => env('HERALD_RPC_STEEM', 'https://api.steemit.com'),
};

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_PER_DAY = () => Math.max(0, Number(env('HERALD_MAX_POSTS_PER_DAY_PER_CHAIN', '2')) || 0);

const now = (o) => (o && o.now != null ? o.now : Date.now());
const acct = (s) => String(s || '').toLowerCase().replace(/^@/, '').trim();
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ── injectable fs + store (same discipline as the other pentecaust stores) ──────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { posts: {} };
  try { const o = JSON.parse(raw); return o && o.posts ? o : { posts: {} }; } catch { return { posts: {} }; }
}
const saveStore = (fs, file, s) => (fs.write || realFs.write)(file, JSON.stringify(s));
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || DATA_FILE() });

// ── injectable fetch (verifyPost's RPC read is mocked offline) ──────────────────────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── injectable broadcaster — the ONLY path to the chain. No broadcaster ⇒ soft-fail (never signs here). ─
let _broadcast = null;
export function __setBroadcaster(fn) { _broadcast = typeof fn === 'function' ? fn : null; }

// lowercase, strip a leading '#', keep tag-safe chars, drop blanks, dedupe, then cap for the chain.
function normalizeTags(tags, chain) {
  const cap = TAG_CAP[chain] || 8;
  const out = [];
  for (const t of Array.isArray(tags) ? tags : []) {
    const clean = String(t || '').toLowerCase().replace(/^#/, '').replace(/[^a-z0-9-]/g, '').trim();
    if (clean && !out.includes(clean)) out.push(clean);
  }
  return out.slice(0, cap);
}

// The canonical backlink line — ALWAYS appended so the original post stays the attribution/SEO root.
export function canonicalBacklink(canonicalUrl) {
  const u = String(canonicalUrl || '').trim();
  return u ? `\n\n---\n_Originally published at ${u}_` : '';
}

// ── formatForChain: build a standard Graphene `comment` op shaped for the target chain ────────────────
export function formatForChain(source = {}, chain) {
  const c = String(chain || '').toLowerCase();
  if (!isChain(c)) return { ok: false, reason: 'unsupported chain' };
  const author = acct(source.author);
  const title = String(source.title || '');
  const tags = normalizeTags(source.tags, c);
  const body = String(source.bodyMarkdown || '') + canonicalBacklink(source.canonicalUrl);
  const permlink = String(source.permlink || '').toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  // parent_permlink is the post's category = the first tag (Hive/Steem/Graphene convention).
  const category = tags[0] || 'melek';
  const json_metadata = JSON.stringify({ tags, app: 'herald/1.0', format: 'markdown', canonical_url: String(source.canonicalUrl || '') });
  return {
    author, permlink, title, body, tags, json_metadata,
    op: ['comment', {
      parent_author: '', parent_permlink: category,
      author, permlink, title, body, json_metadata,
    }],
  };
}

// count this chain's successful posts within the last 24h (pacing window).
function recentCount(store, chain, t) {
  const rec = store.posts[chain];
  if (!rec || !Array.isArray(rec.history)) return 0;
  return rec.history.filter((h) => h && (t - Number(h.ts || 0)) < DAY_MS).length;
}

// ── postToChains: mirror the source onto each target chain via the injected broadcaster ──────────────
export async function postToChains(source = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const t = now(opts);
  const targets = (Array.isArray(source.targetChains) ? source.targetChains : []).map((c) => String(c || '').toLowerCase());
  const results = {};
  const cap = MAX_PER_DAY();

  for (const chain of targets) {
    if (!isChain(chain)) { results[chain] = { ok: false, reason: 'unsupported chain' }; continue; }
    if (recentCount(store, chain, t) >= cap) { results[chain] = { ok: false, skipped: 'rate-limited' }; continue; }
    const fmt = formatForChain(source, chain);
    if (!fmt || fmt.ok === false) { results[chain] = { ok: false, reason: (fmt && fmt.reason) || 'format failed' }; continue; }
    if (!_broadcast) { results[chain] = { ok: false, reason: 'no broadcaster' }; continue; }
    let out;
    try { out = await _broadcast(chain, fmt.op[1]); } catch { out = { ok: false, reason: 'broadcast error' }; }
    if (out && out.ok) {
      results[chain] = { ok: true, txid: out.txid || null, permlink: fmt.permlink };
      const rec = store.posts[chain] || (store.posts[chain] = { history: [] });
      rec.lastPostAt = t;
      rec.history.push({ ts: t, permlink: fmt.permlink, author: fmt.author, txid: out.txid || null });
      // keep the store bounded — only the last 24h matters for pacing (plus a little slack).
      rec.history = rec.history.filter((h) => h && (t - Number(h.ts || 0)) < DAY_MS * 7);
    } else {
      results[chain] = { ok: false, reason: (out && out.reason) || 'broadcast failed' };
    }
  }
  saveStore(fs, file, store);
  return { ok: true, results };
}

// ── verifyPost: read the post back off the chain RPC to confirm it went live ──────────────────────────
export async function verifyPost(chain, author, permlink, opts = {}) {
  const c = String(chain || '').toLowerCase();
  if (!isChain(c)) return { ok: false, reason: 'unsupported chain' };
  const a = acct(author);
  const pl = String(permlink || '').trim();
  if (!a || !pl) return { ok: false, reason: 'author + permlink required' };
  const rpc = (opts && opts.rpc) || RPC[c]();
  const url = `https://${SITE[c]()}/@${a}/${pl}`;
  try {
    const r = await _fetch(rpc, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'condenser_api.get_content', params: [a, pl], id: 1 }),
    });
    const j = await r.json().catch(() => ({}));
    const content = j && j.result;
    if (content && content.author) return { ok: true, live: true, url };
    return { ok: false, live: false, url };
  } catch { return { ok: false, reason: 'verify error', url }; }
}

// ── postsFor: read helper — this chain's recorded cross-posts ─────────────────────────────────────────
export function postsFor(chain, opts = {}) {
  const c = String(chain || '').toLowerCase();
  const { fs, file } = ctx(opts);
  const rec = loadStore(fs, file).posts[c];
  return rec && Array.isArray(rec.history) ? rec.history.slice() : [];
}

// ── HTTP surface ─────────────────────────────────────────────────────────────────────────────────────
// This module was a pure library imported by nothing: 182 lines that formatted posts correctly and had
// no way to be called. The handler is the missing half.
//
//   GET  /api/crossposts?chain=melek   → what this chain has already posted (pacing history)
//   POST /api/crosspost                → format + mirror one source onto its target chains
//
// ⚠️ POST is gated on HERALD_CROSSPOST_SECRET and FAILS CLOSED when unset, the same posture
// dispatcher.mjs takes on /api/dispatch: an endpoint that broadcasts to four public chains is not
// something an anonymous caller may reach. Broadcasting still requires an injected broadcaster, so
// with neither secret nor broadcaster this route can do nothing at all.
import { timingSafeEqual } from 'node:crypto';

const CROSSPOST_SECRET = () => env('HERALD_CROSSPOST_SECRET', '');
function crosspostAuthOk(req) {
  const want = CROSSPOST_SECRET();
  if (!want) return false;                       // fail closed when unconfigured
  const got = String((req && req.headers && (req.headers['x-herald-crosspost-secret'] || req.headers['x-crosspost-secret'])) || '');
  const a = Buffer.from(got); const b = Buffer.from(String(want));
  if (a.length !== b.length) return false;
  try { return timingSafeEqual(a, b); } catch { return false; }
}

function readBody(req, max = 262144) {
  if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    try {
      let d = ''; let over = false;
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch {} } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(JSON.parse(d || '{}')); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

const sendJson = (res, code, obj) => {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(obj));
};

export async function handler(req, res, opts = {}) {
  try {
    const method = ((req && req.method) || 'GET').toUpperCase();
    const [pathRaw, qs = ''] = String((req && req.url) || '/').split('?');
    const path = (pathRaw || '/').replace(/\/+$/, '') || '/';
    const q = new URLSearchParams(qs);

    if (method === 'GET' && path === '/api/crossposts') {
      const chain = String(q.get('chain') || '').toLowerCase();
      if (chain && !isChain(chain)) return sendJson(res, 422, { ok: false, reason: 'unsupported chain' });
      const chains = chain ? [chain] : CHAINS;
      const out = {};
      for (const c of chains) out[c] = postsFor(c, opts);
      return sendJson(res, 200, { ok: true, cap: MAX_PER_DAY(), posts: out });
    }

    if (method === 'GET' && path === '/api/crosspost/preview') {
      // Formatting is not a secret and previewing signs nothing — useful without the gate.
      const src = { title: q.get('title') || '', author: q.get('author') || '', permlink: q.get('permlink') || '',
        tags: String(q.get('tags') || '').split(',').filter(Boolean), canonicalUrl: q.get('url') || '', bodyMarkdown: q.get('body') || '' };
      const chain = String(q.get('chain') || 'melek').toLowerCase();
      const f = formatForChain(src, chain);
      if (!f || f.ok === false) return sendJson(res, 422, { ok: false, reason: (f && f.reason) || 'format failed' });
      return sendJson(res, 200, { ok: true, chain, tags: f.tags, permlink: f.permlink, body: f.body });
    }

    if (method === 'POST' && path === '/api/crosspost') {
      if (!crosspostAuthOk(req)) return sendJson(res, 401, { ok: false, reason: 'crosspost requires HERALD_CROSSPOST_SECRET' });
      const b = await readBody(req);
      if (!b || typeof b !== 'object') return sendJson(res, 400, { ok: false, reason: 'bad-body' });
      if (!b.author || !b.permlink || !b.title) return sendJson(res, 422, { ok: false, reason: 'author, permlink and title are required' });
      const r = await postToChains(b, opts);
      return sendJson(res, 200, r);
    }

    return sendJson(res, 404, { ok: false, reason: 'not-found' });
  } catch { return sendJson(res, 500, { ok: false, reason: 'error' }); }
}

// ── CLI: quick dry-run format preview (no broadcast — there is no signer here) ────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = { title: 'Hello MELEK', author: 'hathor', permlink: 'hello-melek', tags: ['melek', 'intro'], canonicalUrl: 'https://melek.salon/@hathor/hello-melek', bodyMarkdown: 'Body.' };
  for (const chain of CHAINS) {
    const f = formatForChain(src, chain);
    process.stdout.write(`# ${esc(chain)} — tags[${(f.tags || []).join(',')}]\n${esc(f.body)}\n\n`);
  }
}
