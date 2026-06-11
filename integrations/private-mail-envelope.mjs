// private-mail-envelope.mjs — private account-to-account mail envelopes (task #279).
//
// WHY THIS EXISTS
//   accounts on the MELEK condenser need a way to talk PRIVATELY, one-to-one, off-chain-testable. This
//   is the PURE envelope/transport layer: it builds an ENCRYPTED message envelope and hands it to a
//   broadcaster, then filters/sorts a flat list of received messages into an inbox / outbox / thread.
//   It does NOT speak the network, hold keys, or sign anything — every crypto and broadcast seam is
//   INJECTED, so `node --test` runs fully offline and the SAME code can run client-side in the browser
//   condenser (where the user's memo key actually lives).
//
//   NB: a sibling module `private-mail.mjs` already ships the HTTP relay + dhive-Memo flavour under the
//   custom_json id 'melek_pm'. THIS module is the smaller pure-functional envelope API the #279 brief
//   describes (id 'melek_mail', dependency-injected encrypt/decrypt/broadcast). They are complementary.
//
// HOW PRIVACY WORKS (Graphene-native, no custom op)
//   A private message is a standard `custom_json` op with id 'melek_mail'. The SUBJECT + BODY are
//   sealed by deps.encrypt (memo-key ECIES, INJECTED — there are NO real keys in this repo). Only the
//   recipient (who holds the matching memo private key) can deps.decrypt it. The on-chain json carries
//   only routing metadata in the clear (from / to / thread / ts / id) so an inbox can filter without
//   ever decrypting. The plaintext NEVER touches the envelope.
//
// KEY CUSTODY (BRIEF.md §7, repo HARD RULE — ZERO-WIF)
//   • This module never sees, requests, stores, or logs a private key. Encryption and broadcasting are
//     INJECTED deps. On the server the broadcast dep funnels through MELEK-Signer (zero WIF on the Bot
//     host); client-side the encrypt dep runs against the user's own memo key in their browser.
//
// ROLES (expands staff -> everyone by CONFIG, same module)
//   canMessage(senderRole, recipientRole, { allowAllUsers }) opens ONLY bot<->admin and admin<->admin
//   first (the staff pilot). A single default-OFF flag (allowAllUsers) flips to "anyone -> anyone" for
//   the public rollout. Same code, both phases.
//
// EXPORTS
//   MAIL_CUSTOM_JSON_ID                         'melek_mail'
//   ROLES                                       ['bot','admin','user']
//   threadId(a, b, [salt])                      -> deterministic order-independent 1:1 thread id
//   canMessage(senderRole, recipientRole, opts) -> boolean
//   send({from,to,subject,body}, deps)          -> { ok, op?, message?, reason? } (encrypted + broadcast)
//   open(msg, deps)                             -> { ok, subject?, body?, reason? } (decrypt one envelope)
//   inbox(account, msgs)                        -> messages addressed TO account, newest-first
//   outbox(account, msgs)                       -> messages sent BY account, newest-first
//   threadOf(msgs, id)                          -> messages in one thread, oldest-first (chronological)
//   __setClock(fn)                              -> test seam for deterministic timestamps

import crypto from 'node:crypto';

export const MAIL_CUSTOM_JSON_ID = 'melek_mail';

// Hard caps so a single message can't bloat a block / the relay.
export const MAX_SUBJECT = 256;
export const MAX_BODY = 8192;

export const ROLES = ['bot', 'admin', 'user'];

// ── tiny helpers ────────────────────────────────────────────────────────────
function cap(s, n) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n) : str;
}

function clean(s) {
  return String(s ?? '').trim().toLowerCase();
}

/** esc() any HTML before it could be rendered. Never throws. */
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── clock seam (deterministic in tests) ──────────────────────────────────────
let _clock = () => new Date().toISOString();
export function __setClock(fn) {
  _clock = typeof fn === 'function' ? fn : (() => new Date().toISOString());
}

// ── role gate ─────────────────────────────────────────────────────────────────
function normRole(r) {
  const v = clean(r);
  return ROLES.includes(v) ? v : 'user';
}

/**
 * Tiered access. Phase 1 (default): bot<->admin and admin<->admin only. Flip allowAllUsers to open it
 * to everyone. Soft: bad input degrades to the most restrictive answer (false), never throws.
 */
export function canMessage(senderRole, recipientRole, { allowAllUsers = false } = {}) {
  const a = normRole(senderRole);
  const b = normRole(recipientRole);
  if (allowAllUsers) return true;
  // staff pilot: at least one side is an admin, and the other side is staff (bot or admin).
  const staff = (r) => r === 'bot' || r === 'admin';
  if (!staff(a) || !staff(b)) return false;
  return a === 'admin' || b === 'admin';
}

// ── thread id ───────────────────────────────────────────────────────────────────
/**
 * Deterministic 1:1 thread id. Order-independent (a->b and b->a share a thread) so a reply lands in the
 * same conversation. Optional salt scopes a thread (e.g. tie it to a flag id). Never throws.
 */
export function threadId(a, b, salt = '') {
  const pair = [clean(a), clean(b)].sort().join('|');
  const h = crypto.createHash('sha256').update(`${pair}|${String(salt ?? '')}`).digest('hex').slice(0, 24);
  return `mail_${h}`;
}

// monotonic-ish id when an envelope has no explicit id (deterministic under __setClock + content hash).
function envelopeId(from, to, thread, ts, sealed) {
  const h = crypto
    .createHash('sha256')
    .update(`${from}|${to}|${thread}|${ts}|${String(sealed ?? '')}`)
    .digest('hex')
    .slice(0, 16);
  return `m_${h}`;
}

// ── send ─────────────────────────────────────────────────────────────────────────
/**
 * Build an ENCRYPTED private-message envelope and broadcast it. Pure w.r.t. crypto + network: BOTH are
 * injected via deps. Returns the built op + the routing message on success.
 *
 * @param {object} msg
 * @param {string} msg.from     sender account
 * @param {string} msg.to       recipient account
 * @param {string} msg.subject  plaintext subject (sealed into the envelope)
 * @param {string} msg.body     plaintext body    (sealed into the envelope)
 * @param {string} [msg.thread] explicit thread id; defaults to the deterministic 1:1 thread
 * @param {object} deps
 * @param {function} deps.encrypt   ({ from, to, plaintext }) -> sealed string (REQUIRED; never plaintext)
 * @param {function} deps.broadcast (op) -> any | Promise<any>                  (REQUIRED)
 * @param {object}   [deps.roles]   { sender, recipient, allowAllUsers } -> gate the send via canMessage
 * @returns {Promise<{ ok:boolean, op?:Array, message?:object, result?:any, reason?:string }>}
 */
export async function send(msg = {}, deps = {}) {
  try {
    const from = clean(msg.from);
    const to = clean(msg.to);
    if (!from || !to) return { ok: false, reason: 'missing from/to' };
    if (from === to) return { ok: false, reason: 'cannot message self' };

    const { encrypt, broadcast, roles } = deps;
    if (typeof encrypt !== 'function') return { ok: false, reason: 'no encrypt dep' };
    if (typeof broadcast !== 'function') return { ok: false, reason: 'no broadcast dep' };

    if (roles) {
      const allowed = canMessage(roles.sender, roles.recipient, { allowAllUsers: !!roles.allowAllUsers });
      if (!allowed) return { ok: false, reason: 'role not permitted' };
    }

    const subject = cap(msg.subject, MAX_SUBJECT);
    const body = cap(msg.body, MAX_BODY);
    const thread = msg.thread ? String(msg.thread) : threadId(from, to);
    const ts = _clock();

    // Seal subject + body together. The plaintext NEVER leaves this call un-sealed.
    const plaintext = JSON.stringify({ subject, body });
    let sealed;
    try {
      sealed = await encrypt({ from, to, plaintext });
    } catch (e) {
      return { ok: false, reason: `encrypt failed: ${e && e.message ? e.message : e}` };
    }
    if (typeof sealed !== 'string' || !sealed) return { ok: false, reason: 'encrypt produced no ciphertext' };
    if (sealed.includes(plaintext)) return { ok: false, reason: 'refusing to send plaintext' };

    const id = envelopeId(from, to, thread, ts, sealed);
    // Routing metadata in the clear; the sealed envelope is the only place subject/body live.
    const json = { from, to, thread, ts, id, sealed, v: 1 };
    const op = [
      'custom_json',
      {
        id: MAIL_CUSTOM_JSON_ID,
        required_auths: [],
        required_posting_auths: [from],
        json: JSON.stringify(json),
      },
    ];

    let result;
    try {
      result = await broadcast(op);
    } catch (e) {
      return { ok: false, reason: `broadcast failed: ${e && e.message ? e.message : e}` };
    }

    return { ok: true, op, message: json, result };
  } catch (e) {
    // soft-fail-never-throw
    return { ok: false, reason: `send error: ${e && e.message ? e.message : e}` };
  }
}

// ── open (decrypt one envelope) ───────────────────────────────────────────────────
/**
 * Decrypt one received envelope via deps.decrypt. Returns the recovered subject/body. Soft on any
 * malformed input or decrypt failure (the recipient may not hold the key) — never throws.
 *
 * @param {object} m              a routing message (as stored in the chain json)
 * @param {object} deps
 * @param {function} deps.decrypt ({ from, to, sealed }) -> plaintext string (REQUIRED)
 * @returns {Promise<{ ok:boolean, subject?:string, body?:string, reason?:string }>}
 */
export async function open(m = {}, deps = {}) {
  try {
    const { decrypt } = deps;
    if (typeof decrypt !== 'function') return { ok: false, reason: 'no decrypt dep' };
    if (!m || typeof m.sealed !== 'string' || !m.sealed) return { ok: false, reason: 'no sealed payload' };

    let plaintext;
    try {
      plaintext = await decrypt({ from: clean(m.from), to: clean(m.to), sealed: m.sealed });
    } catch (e) {
      return { ok: false, reason: `decrypt failed: ${e && e.message ? e.message : e}` };
    }
    if (typeof plaintext !== 'string' || !plaintext) return { ok: false, reason: 'decrypt produced nothing' };

    let parsed;
    try {
      parsed = JSON.parse(plaintext);
    } catch {
      // older/foreign envelope: hand back the raw plaintext as the body.
      return { ok: true, subject: '', body: plaintext };
    }
    return { ok: true, subject: String(parsed.subject ?? ''), body: String(parsed.body ?? '') };
  } catch (e) {
    return { ok: false, reason: `open error: ${e && e.message ? e.message : e}` };
  }
}

// ── inbox / outbox / thread filtering ─────────────────────────────────────────────
function toList(msgs) {
  return Array.isArray(msgs) ? msgs.filter((m) => m && typeof m === 'object') : [];
}

// newest-first by ts (string ISO sorts correctly; fall back to id for stability).
function byNewest(a, b) {
  const ta = String(a.ts ?? '');
  const tb = String(b.ts ?? '');
  if (ta !== tb) return ta < tb ? 1 : -1;
  return String(a.id ?? '') < String(b.id ?? '') ? 1 : -1;
}

// oldest-first (chronological) for a thread view.
function byOldest(a, b) {
  return -byNewest(a, b);
}

/** Messages addressed TO `account`, newest-first. Soft on bad input. */
export function inbox(account, msgs) {
  const acct = clean(account);
  if (!acct) return [];
  return toList(msgs).filter((m) => clean(m.to) === acct).sort(byNewest);
}

/** Messages sent BY `account`, newest-first. Soft on bad input. */
export function outbox(account, msgs) {
  const acct = clean(account);
  if (!acct) return [];
  return toList(msgs).filter((m) => clean(m.from) === acct).sort(byNewest);
}

/** All messages in one thread, oldest-first (chronological conversation order). Soft on bad input. */
export function threadOf(msgs, id) {
  const t = String(id ?? '');
  if (!t) return [];
  return toList(msgs).filter((m) => String(m.thread ?? '') === t).sort(byOldest);
}

// ── CLI (guarded; tiny demo, no network, no keys) ───────────────────────────────
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  (async () => {
    // Fake injected deps: a reversible "seal" so the demo is self-contained and offline.
    const fakeEncrypt = async ({ plaintext }) => `SEALED(${Buffer.from(plaintext).toString('base64')})`;
    const fakeDecrypt = async ({ sealed }) => {
      const m = /^SEALED\((.*)\)$/.exec(sealed);
      return m ? Buffer.from(m[1], 'base64').toString('utf8') : '';
    };
    const sent = [];
    const broadcast = async (op) => {
      sent.push(JSON.parse(op[1].json));
      return { id: 'demo-tx' };
    };
    const r = await send(
      { from: 'hathor', to: 'admin1', subject: 'hello', body: 'private note' },
      { encrypt: fakeEncrypt, broadcast, roles: { sender: 'bot', recipient: 'admin' } },
    );
    console.log('send ->', r.ok, r.reason || r.message.thread);
    console.log('inbox(admin1) ->', inbox('admin1', sent).length);
    console.log('outbox(hathor) ->', outbox('hathor', sent).length);
    const opened = await open(sent[0], { decrypt: fakeDecrypt });
    console.log('open ->', opened.ok, esc(opened.subject), '/', esc(opened.body));
  })().catch((e) => console.error('cli error:', e && e.message ? e.message : e));
}
