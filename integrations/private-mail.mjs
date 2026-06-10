// private-mail.mjs — MELEK private messaging / mail (task #279).
//
// WHY THIS EXISTS
//   accounts on the condenser (alpha.melek.salon) need a way to talk PRIVATELY — first so the
//   bots (Cheetah / Hathor) can open a one-to-one follow-up thread off a moderation flag
//   ("report → private conversation with the user"), then for staff↔staff, and eventually for all
//   users. This module is the transport + access layer. It is off-chain-testable: every crypto and
//   network seam is injectable so `node --test` runs fully offline.
//
// HOW PRIVACY WORKS (Graphene-native, no custom op)
//   A private message is a standard `custom_json` op with id 'melek_pm'. The BODY is ENCRYPTED to the
//   recipient's MEMO public key using the same ECIES scheme Steem/HIVE/BLURT memos use: the sender
//   encrypts with their memo PRIVATE key + the recipient's memo PUBLIC key; ONLY the recipient (who
//   holds the matching memo private key) can decrypt. dhive ships this as Memo.encode/Memo.decode —
//   we use it when available, otherwise a clear `__setCrypto(...)` seam lets tests inject a
//   deterministic stub. The on-chain payload NEVER contains plaintext. Subject + body are both inside
//   the ciphertext; only routing metadata (from/to/thread/ts) is in the clear so an inbox can filter.
//
// KEY CUSTODY (BRIEF.md §7, repo HARD RULE)
//   • Encryption/decryption happen with the USER's memo keys, CLIENT-SIDE (in the condenser browser).
//   • This module, and the HTTP handler below, NEVER see, request, store, or log a private key.
//     composeMessage takes a memo WIF ONLY so the SAME code can run client-side; on the server the
//     handler relays already-formed ciphertext and never calls the encrypt path with a key.
//   • Nothing here broadcasts. composeMessage returns an op; broadcasting is the caller's job and on
//     MELEK that funnels through MELEK-Signer (zero WIF on the Bot host).
//
// TIERED ACCESS (expands staff → everyone by CONFIG, same module)
//   canMessage(senderRole, recipientRole) starts permissive only for bot↔admin and admin↔admin. A
//   single default-OFF flag (allowAllUsers) flips the system to "anyone can message anyone" — so the
//   exact same code serves the staff pilot today and the public rollout later.
//
// EXPORTS
//   PM_CUSTOM_JSON_ID                       'melek_pm'
//   composeMessage({...})                   -> { ok, op, message } (encrypted custom_json op)
//   readInbox(account, { ops, decrypt })    -> [{ from, to, ... , body }] addressed to `account`
//   threadFromFlag(flagId, { store, ... })  -> { ok, threadId, flag } private thread tied to a flag
//   canMessage(senderRole, recipientRole, { allowAllUsers }) -> boolean
//   threadId(a, b, [salt])                  -> deterministic 1:1 thread id (order-independent)
//   __setCrypto(fn) / __setClock(fn)        -> test seams

import crypto from 'node:crypto';

export const PM_CUSTOM_JSON_ID = 'melek_pm';

// Hard caps so a single message can't bloat a block / the relay.
export const MAX_SUBJECT = 256;
export const MAX_BODY = 8192;

function cap(s, n) {
  const str = String(s ?? '');
  return str.length > n ? str.slice(0, n) : str;
}

// ── clock seam (deterministic in tests) ─────────────────────────────────────
let _clock = () => new Date().toISOString();
export function __setClock(fn) { _clock = typeof fn === 'function' ? fn : (() => new Date().toISOString()); }

// ── crypto seam ──────────────────────────────────────────────────────────────
// Default crypto uses dhive's Memo (Steem-family ECIES) IF dhive is installed. We import it lazily and
// soft-fail to "no default crypto" rather than crash a test environment without the dep. Tests inject
// their own deterministic stub via __setCrypto, so they never need dhive at all.
//
// The crypto seam shape:
//   {
//     encrypt({ message, senderWif, recipientPub }) -> string ciphertext (never plaintext)
//     decrypt({ ciphertext, recipientWif })         -> string plaintext
//   }
let _cryptoOverride = null;
export function __setCrypto(c) { _cryptoOverride = c || null; }

let _dhiveMemoPromise; // memoized
async function dhiveMemo() {
  if (_dhiveMemoPromise === undefined) {
    _dhiveMemoPromise = import('@hiveio/dhive')
      .then((d) => ({ Memo: d.Memo, PrivateKey: d.PrivateKey }))
      .catch(() => null);
  }
  return _dhiveMemoPromise;
}

// Resolve the active crypto: explicit override wins; else a thin wrapper over dhive Memo.
async function getCrypto() {
  if (_cryptoOverride) return _cryptoOverride;
  const m = await dhiveMemo();
  if (!m || !m.Memo) return null; // no dhive AND no override → caller must inject one
  return {
    encrypt({ message, senderWif, recipientPub }) {
      // dhive: Memo.encode(privateKey, publicKey, memo) — memo MUST start with '#' to be encrypted.
      const priv = m.PrivateKey.fromString(senderWif);
      const plain = message.startsWith('#') ? message : `#${message}`;
      return m.Memo.encode(priv, recipientPub, plain);
    },
    decrypt({ ciphertext, recipientWif }) {
      const priv = m.PrivateKey.fromString(recipientWif);
      const out = m.Memo.decode(priv, ciphertext); // returns the '#'-prefixed plaintext
      return typeof out === 'string' && out.startsWith('#') ? out.slice(1) : out;
    },
  };
}

// ── thread id ─────────────────────────────────────────────────────────────────
/**
 * Deterministic 1:1 thread id. Order-independent (a→b and b→a share a thread) so a reply lands in the
 * same conversation. Optional salt scopes a thread (e.g. tie it to a flag id).
 */
export function threadId(a, b, salt = '') {
  const pair = [String(a || ''), String(b || '')].sort().join('|');
  const h = crypto.createHash('sha256').update(`${pair}|${salt}`).digest('hex').slice(0, 24);
  return `pm_${h}`;
}

// ── compose ───────────────────────────────────────────────────────────────────
/**
 * Build an ENCRYPTED private-message custom_json op. The body (and the subject) are encrypted to the
 * recipient's memo public key; the on-chain json carries only routing metadata in the clear.
 *
 * @param {object} a
 * @param {string} a.from              sender account
 * @param {string} a.to               recipient account
 * @param {string} a.subject          plaintext subject (encrypted into the payload)
 * @param {string} a.body             plaintext body    (encrypted into the payload)
 * @param {string} a.recipientMemoPub recipient's memo PUBLIC key (e.g. "TST6M…")
 * @param {string} a.senderMemoWif    sender's memo PRIVATE key — CLIENT-SIDE ONLY, never on the server
 * @param {string} [a.thread]         explicit thread id; defaults to the deterministic 1:1 thread
 * @param {object} [a.crypto]         per-call crypto seam override
 * @returns {Promise<{ ok: boolean, op?: Array, message?: object, reason?: string }>}
 */
export async function composeMessage({
  from, to, subject = '', body = '', recipientMemoPub, senderMemoWif, thread, crypto: cryptoArg,
} = {}) {
  const f = String(from || '').trim().toLowerCase();
  const t = String(to || '').trim().toLowerCase();
  if (!f || !t) return { ok: false, reason: 'missing-from-or-to' };
  if (f === t) return { ok: false, reason: 'cannot-message-self' };
  if (!recipientMemoPub) return { ok: false, reason: 'missing-recipient-memo-pub' };
  if (!senderMemoWif) return { ok: false, reason: 'missing-sender-memo-wif' };

  const cleanSubject = cap(subject, MAX_SUBJECT);
  const cleanBody = cap(body, MAX_BODY);
  if (!cleanBody && !cleanSubject) return { ok: false, reason: 'empty-message' };

  const c = cryptoArg || (await getCrypto());
  if (!c || typeof c.encrypt !== 'function') {
    return { ok: false, reason: 'no-crypto' }; // no dhive AND no injected crypto
  }

  // Encrypt subject + body together as one JSON blob so a single ciphertext carries both and neither
  // leaks in the clear. The plaintext NEVER leaves this scope; only `ct` is placed on the op.
  let ct;
  try {
    const plaintext = JSON.stringify({ s: cleanSubject, b: cleanBody });
    ct = c.encrypt({ message: plaintext, senderWif: senderMemoWif, recipientPub: recipientMemoPub });
  } catch {
    return { ok: false, reason: 'encrypt-failed' }; // never surface key material in the error
  }
  if (!ct || typeof ct !== 'string') return { ok: false, reason: 'encrypt-failed' };

  const th = thread || threadId(f, t);
  const json = {
    v: 1,
    from: f,
    to: t,
    thread: th,
    ts: _clock(),
    ct,            // ciphertext ONLY — no plaintext, no key
  };

  const op = ['custom_json', {
    required_auths: [],
    required_posting_auths: [f], // posting auth is enough for a PM; the sender signs as themselves
    id: PM_CUSTOM_JSON_ID,
    json: JSON.stringify(json),
  }];

  return { ok: true, op, message: json };
}

// ── inbox ───────────────────────────────────────────────────────────────────
/**
 * Given a list of fetched melek_pm ops, return the messages addressed to `account`, newest first,
 * with each body decrypted via the injectable `decrypt` seam (offline tests pass a stub; in the
 * browser the recipient passes their memo WIF through a real decryptor).
 *
 * `ops` accepts either raw chain ops (`['custom_json', {...}]`), the inner op object, or an
 * already-parsed message json — we normalize all three. Anything unparseable is skipped (soft-fail).
 *
 * @param {string} account
 * @param {object} opts
 * @param {Array} opts.ops                  fetched melek_pm entries
 * @param {(msg)=>({ subject?, body? }|string|null)} [opts.decrypt]  decryptor; omit to leave ct sealed
 * @param {boolean} [opts.includeSealed=false] include messages we couldn't/ didn't decrypt
 * @returns {Array<{ from, to, thread, ts, subject, body, sealed? }>}
 */
export function readInbox(account, { ops = [], decrypt, includeSealed = false } = {}) {
  const me = String(account || '').trim().toLowerCase();
  if (!me) return [];

  const out = [];
  for (const raw of Array.isArray(ops) ? ops : []) {
    const msg = normalizeMessage(raw);
    if (!msg) continue;
    if (msg.to !== me) continue; // inbox = addressed to me

    let subject = '';
    let body = '';
    let sealed = true;
    if (typeof decrypt === 'function') {
      try {
        const dec = decrypt(msg); // caller supplies the recipient key inside its closure
        if (dec && typeof dec === 'object') {
          subject = cap(dec.subject ?? '', MAX_SUBJECT);
          body = cap(dec.body ?? '', MAX_BODY);
          sealed = false;
        } else if (typeof dec === 'string') {
          body = cap(dec, MAX_BODY);
          sealed = false;
        }
      } catch {
        sealed = true; // decryption failed (wrong key / corrupt) — keep it sealed, never throw
      }
    }
    if (sealed && !includeSealed) continue;

    out.push({
      from: msg.from,
      to: msg.to,
      thread: msg.thread,
      ts: msg.ts,
      subject,
      body,
      ...(sealed ? { sealed: true } : {}),
    });
  }

  // newest first
  out.sort((a, b) => String(b.ts || '').localeCompare(String(a.ts || '')));
  return out;
}

/** Normalize a chain op / inner op / parsed json into the flat message shape, or null. */
function normalizeMessage(raw) {
  if (!raw) return null;
  let inner = raw;
  // ['custom_json', { id, json }] form
  if (Array.isArray(raw) && raw[0] === 'custom_json' && raw[1]) inner = raw[1];
  // { id, json } form → parse json
  if (inner && typeof inner === 'object' && 'json' in inner) {
    if (inner.id && inner.id !== PM_CUSTOM_JSON_ID) return null;
    let j = inner.json;
    if (typeof j === 'string') { try { j = JSON.parse(j); } catch { return null; } }
    inner = j;
  }
  if (!inner || typeof inner !== 'object') return null;
  const from = String(inner.from || '').trim().toLowerCase();
  const to = String(inner.to || '').trim().toLowerCase();
  if (!from || !to) return null;
  return {
    v: inner.v ?? 1,
    from,
    to,
    thread: inner.thread || threadId(from, to),
    ts: inner.ts || '',
    ct: inner.ct || '',
  };
}

// ── thread from a moderation flag ─────────────────────────────────────────────
/**
 * Open (or look up) a PRIVATE thread tied to a moderation-flags entry, so "report → private
 * conversation with the user" works. We DO NOT mutate the flag's status here (that's the moderator's
 * resolve action); we just derive a stable thread id from the flag and the two parties and return the
 * routing context the UI/bot uses to start composing.
 *
 * `store` is a moderation store (createModerationStore() shape) used read-only to resolve the flag.
 * `agent` is the staff/bot side of the conversation (defaults 'hathor'). The user side is derived from
 * the flag's reporter (the person who filed it) unless `user` is given explicitly.
 *
 * @param {string} flagId
 * @param {object} opts
 * @param {{ listReports: Function }} opts.store    moderation store (read-only here)
 * @param {string} [opts.agent='hathor']
 * @param {string} [opts.user]   override the user side (else taken from the flag's reporter)
 * @returns {{ ok: boolean, threadId?: string, agent?: string, user?: string, flag?: object, reason?: string }}
 */
export function threadFromFlag(flagId, { store, agent = 'hathor', user } = {}) {
  const id = String(flagId || '').trim();
  if (!id) return { ok: false, reason: 'missing-flag-id' };
  if (!store || typeof store.listReports !== 'function') return { ok: false, reason: 'no-store' };

  let flag = null;
  try {
    flag = store.listReports().find((r) => r && r.id === id) || null;
  } catch {
    return { ok: false, reason: 'store-error' };
  }
  if (!flag) return { ok: false, reason: 'flag-not-found' };

  // The user side of the conversation: explicit override, else the reporter, else parse @account from
  // the target. A flag with no resolvable counterparty can't open a 1:1 thread.
  const userSide = String(
    user || flag.reporter || (String(flag.target || '').match(/^@?([a-z0-9.-]+)/i) || [])[1] || '',
  ).trim().toLowerCase();
  if (!userSide) return { ok: false, reason: 'no-counterparty' };

  // Salt the thread with the flag id so each flag opens its own distinct thread, even between the same
  // two parties (a second report ≠ the first conversation).
  const th = threadId(agent, userSide, `flag:${id}`);
  return { ok: true, threadId: th, agent: String(agent).toLowerCase(), user: userSide, flag };
}

// ── tiered access guard ───────────────────────────────────────────────────────
export const ROLES = ['bot', 'admin', 'user'];
function normRole(r) {
  const x = String(r || '').trim().toLowerCase();
  return ROLES.includes(x) ? x : 'user'; // unknown → least-privileged
}

/**
 * Who may message whom. The system expands from staff to everyone by CONFIG, not by code change:
 *   • bot ↔ admin   — always allowed (the Cheetah/Hathor flag-follow-up case, the first use)
 *   • admin ↔ admin  — always allowed (staff coordination)
 *   • bot ↔ bot      — always allowed (inter-bot)
 *   • anything involving a plain user — allowed ONLY when allowAllUsers is true (default OFF)
 *
 * @param {string} senderRole
 * @param {string} recipientRole
 * @param {{ allowAllUsers?: boolean }} [opts]
 * @returns {boolean}
 */
export function canMessage(senderRole, recipientRole, { allowAllUsers = false } = {}) {
  const s = normRole(senderRole);
  const r = normRole(recipientRole);
  if (allowAllUsers) return true; // public rollout: anyone ↔ anyone
  // staff pilot: only staff roles (bot/admin) on BOTH sides
  const staff = new Set(['bot', 'admin']);
  return staff.has(s) && staff.has(r);
}
