// steem-hathor-post.mjs — Hathor posting to Steem as @hathor-melek.
//
// WHY THIS EXISTS SEPARATELY FROM THE MELEK PATH
//   On MELEK, @hathor never touches a key: the wrapper hands the op to MELEK-Signer, which holds a
//   KMS-wrapped posting key and signs on the account's behalf. Steem is a different chain and the
//   Signer does not custody for it, so this module signs locally — which makes the key handling the
//   most important thing in the file rather than an afterthought.
//
// KEY DISCIPLINE
//   * POSTING AUTHORITY ONLY. The posting key can comment, vote and follow. It cannot move funds and
//     it cannot change account keys. Even fully compromised, the account's balance and ownership are
//     untouched. The master password that derived it is NOT on disk.
//   * The WIF is read at call time from a 0600 file under .local/ (gitignored) or from the
//     environment. It is never a parameter, never logged, never returned, and never interpolated
//     into anything renderable.
//   * DRY BY DEFAULT. Nothing broadcasts unless EXECUTE=1 is set explicitly.
//
// HOUSE STYLE: ESM, injectable client for offline tests, soft-fail-never-throw, esc() on anything
// that could reach HTML, CLI guarded by process.argv[1].
//
//   import { buildPost, post, permalinkFor, __setClient } from './steem-hathor-post.mjs'
//   EXECUTE=1 node integrations/steem-hathor-post.mjs "Title" body.md tag1,tag2

import fs from 'node:fs';
import path from 'node:path';

export const ACCOUNT = process.env.STEEM_ACCOUNT || 'hathor-melek';
const VAULT = process.env.STEEM_KEY_FILE
  || path.join(process.cwd(), '.local', 'vault', 'steemit-key.env');
export const NODES = (process.env.STEEM_RPC || 'https://api.steemit.com').split(',');

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

let _client = null;
/** Tests inject a fake client so nothing ever reaches the network. */
export function __setClient(c) { _client = c; }

/** Read the posting WIF at call time. Returns null rather than throwing when absent. */
function postingKey() {
  if (process.env.STEEM_POSTING_WIF) return process.env.STEEM_POSTING_WIF.trim();
  try {
    const line = fs.readFileSync(VAULT, 'utf8')
      .split('\n').find((l) => l.startsWith('STEEM_POSTING_WIF='));
    return line ? line.slice('STEEM_POSTING_WIF='.length).trim() || null : null;
  } catch { return null; }
}

/** A stable, chain-legal permlink: lowercase, hyphenated, date-suffixed so titles can repeat. */
export function permalinkFor(title, now = () => new Date()) {
  const base = String(title || 'post').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'post';
  const d = now().toISOString().slice(0, 10);
  return `${base}-${d}`;
}

/** Tags: lowercase, alphanumeric-and-hyphen, max 5, first is the parent category. */
export function normalizeTags(tags) {
  const list = (Array.isArray(tags) ? tags : String(tags || '').split(','))
    .map((t) => String(t).trim().toLowerCase().replace(/[^a-z0-9-]/g, ''))
    .filter(Boolean);
  return [...new Set(list)].slice(0, 5);
}

/**
 * buildPost — the comment op, without signing. PURE, so a test can assert the exact shape that
 * would be broadcast without a key being present.
 */
export function buildPost({ title, body, tags, account = ACCOUNT, now } = {}) {
  const t = String(title || '').trim();
  const b = String(body || '').trim();
  if (!t) return { ok: false, reason: 'no_title' };
  if (!b) return { ok: false, reason: 'no_body' };
  const tg = normalizeTags(tags);
  if (!tg.length) return { ok: false, reason: 'no_tags' };

  const permlink = permalinkFor(t, now);
  return {
    ok: true,
    permlink,
    op: ['comment', {
      parent_author: '',
      parent_permlink: tg[0],
      author: account,
      permlink,
      title: t.slice(0, 255),
      body: b,
      json_metadata: JSON.stringify({ tags: tg, app: 'hathor/1.0', format: 'markdown' }),
    }],
  };
}

/**
 * post — broadcast. DRY unless EXECUTE=1. Returns { ok, dry?, permlink, url?, id?, reason? } and
 * never throws: a chain refusal is a returned reason, because a posting loop must not die on one
 * bad call.
 */
export async function post({ title, body, tags, execute = process.env.EXECUTE === '1' } = {}) {
  const built = buildPost({ title, body, tags });
  if (!built.ok) return built;

  const url = `https://steemit.com/${normalizeTags(tags)[0]}/@${ACCOUNT}/${built.permlink}`;
  if (!execute) return { ok: true, dry: true, permlink: built.permlink, url };

  const wif = postingKey();
  if (!wif) return { ok: false, reason: 'no_posting_key' };

  try {
    let client = _client;
    if (!client) {
      const { Client, PrivateKey } = await import('@hiveio/dhive');
      const c = new Client(NODES, { addressPrefix: 'STM', chainId: '0000000000000000000000000000000000000000000000000000000000000000' });
      client = {
        broadcastOps: (ops, key) => c.broadcast.sendOperations(ops, PrivateKey.fromString(key)),
      };
    }
    const res = await client.broadcastOps([built.op], wif);
    return { ok: true, permlink: built.permlink, url, id: res && (res.id || res.trx_id) };
  } catch (e) {
    return { ok: false, reason: 'broadcast_failed', detail: String((e && e.message) || e).slice(0, 200) };
  }
}

export default { ACCOUNT, NODES, post, buildPost, permalinkFor, normalizeTags, __setClient, esc };

if (process.argv[1] && process.argv[1].endsWith('steem-hathor-post.mjs')) {
  const [title, bodyFile, tags] = process.argv.slice(2);
  const body = bodyFile && fs.existsSync(bodyFile) ? fs.readFileSync(bodyFile, 'utf8') : bodyFile;
  const r = await post({ title, body, tags: tags || 'melek' });
  console.log(r.ok ? (r.dry ? `DRY-RUN — would post: ${r.url}` : `POSTED ${r.url} (${r.id || 'no id'})`)
    : `FAILED: ${r.reason}${r.detail ? ' — ' + r.detail : ''}`);
}
