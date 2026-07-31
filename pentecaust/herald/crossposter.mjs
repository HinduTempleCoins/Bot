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

// ── CLI: quick dry-run format preview (no broadcast — there is no signer here) ────────────────────────
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const src = { title: 'Hello MELEK', author: 'hathor', permlink: 'hello-melek', tags: ['melek', 'intro'], canonicalUrl: 'https://melek.salon/@hathor/hello-melek', bodyMarkdown: 'Body.' };
  for (const chain of CHAINS) {
    const f = formatForChain(src, chain);
    process.stdout.write(`# ${esc(chain)} — tags[${(f.tags || []).join(',')}]\n${esc(f.body)}\n\n`);
  }
}
