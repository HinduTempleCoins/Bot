// private-mail-server.mjs — the inbox relay HTTP surface for MELEK private mail (task #279).
//
// WHAT THIS IS
//   A minimal, framework-less HTTP relay for melek_pm private messages. The condenser front-end talks
//   to it for two things and NOTHING else:
//     GET  /pm/inbox?account=X   -> the SEALED ciphertext messages addressed to X (relay-side filter)
//     POST /pm/send  {op|message} -> accepts an already-ENCRYPTED message and queues/relays it
//
// ZERO-PLAINTEXT-ON-SERVER (the load-bearing rule — read this)
//   The server NEVER encrypts, decrypts, or sees a private key. ALL crypto is CLIENT-SIDE:
//     • /pm/send accepts a message whose body is ALREADY ciphertext (the `ct` field). The handler
//       REJECTS any payload that carries plaintext (a `subject`/`body`/`plaintext` field) — that would
//       mean the client tried to make us encrypt, which we refuse by construction.
//     • /pm/inbox returns the sealed records as-is; decryption happens in the recipient's browser with
//       their memo key. The server cannot read any message it relays.
//   This mirrors signup/server.mjs custody: zero keys, zero broadcast. Broadcasting the op to MELEK is
//   a separate concern (MELEK-Signer); this surface just stores-and-serves the ciphertext envelope so a
//   recipient who is offline can still pick the message up. The store is injectable for offline tests.
//
// HOUSE STYLE
//   ESM .mjs; handler(req,res) exported for tests; CORS locked to the condenser origin; soft-fail; CLI
//   guarded behind an argv check; injectable store + clock + rate-limiter; esc() on any echoed string.
//
//   PORT=8113 BASE_URL=https://pm.melek.salon node integrations/private-mail-server.mjs

import { createServer } from 'node:http';

import { PM_CUSTOM_JSON_ID, readInbox, canMessage } from './private-mail.mjs';
import { Limiter, clientIp } from './rate-limit.mjs';

const PORT = +(process.env.PORT || 8113);
const HOST = process.env.HOST || '127.0.0.1';
const BASE_URL = (process.env.BASE_URL || 'https://pm.melek.salon').replace(/\/$/, '');

// The single allowed browser origin: the condenser.
export const ALLOWED_ORIGIN = (process.env.PM_ALLOWED_ORIGIN || 'https://alpha.melek.salon').replace(/\/$/, '');

// allowAllUsers flag: OFF by default (staff pilot). Flip via env for the public rollout.
const ALLOW_ALL_USERS = String(process.env.PM_ALLOW_ALL_USERS || '').trim() === '1';

// HTML-escape any string we ever echo back (defense-in-depth; responses are JSON, but keep the rule).
export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── injectable store ───────────────────────────────────────────────────────────
// The relay store holds SEALED envelopes only (each is the parsed melek_pm json with its `ct`). It is
// a tiny in-memory ring by default; production can inject a durable one. NEVER holds plaintext/keys.
export function createMemoryStore({ max = 5000 } = {}) {
  const items = [];
  return {
    add(msg) {
      items.push(msg);
      if (items.length > max) items.splice(0, items.length - max);
      return true;
    },
    all() { return items.slice(); },
    clear() { items.length = 0; },
  };
}

let _store = createMemoryStore();
export function __setStore(s) { _store = s || createMemoryStore(); }

// ── injectable role resolver ───────────────────────────────────────────────────
// Maps an account name → role ('bot' | 'admin' | 'user') for the tiered guard. Default: known bots are
// 'bot', everything else 'user'; production injects a real resolver (e.g. from the admin allow-list).
let _roleOf = (account) => (['hathor', 'cheetah'].includes(String(account || '').toLowerCase()) ? 'bot' : 'user');
export function __setRoleResolver(fn) { _roleOf = typeof fn === 'function' ? fn : _roleOf; }

// ── abuse cap on /pm/send ──────────────────────────────────────────────────────
let _sendLimiter = new Limiter({
  scope: 'pm-send',
  ipMax: parseInt(process.env.PM_RL_IP_MAX || '60', 10),
  fpMax: parseInt(process.env.PM_RL_FP_MAX || '30', 10),
  windowSec: parseInt(process.env.PM_RL_WINDOW_SEC || '3600', 10),
});
export function __setSendLimiter(l) { _sendLimiter = l || _sendLimiter; }

// ── CORS / response helpers (mirror signup/server.mjs) ─────────────────────────
function corsHeaders(origin) {
  if (origin && origin.replace(/\/$/, '') === ALLOWED_ORIGIN) {
    return {
      'access-control-allow-origin': ALLOWED_ORIGIN,
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      vary: 'Origin',
    };
  }
  return { vary: 'Origin' };
}

function sendJson(res, code, body, origin) {
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    ...corsHeaders(origin),
  });
  res.end(JSON.stringify(body));
}

function readBody(req, limit = 32768) {
  return new Promise((resolve) => {
    let buf = '';
    let aborted = false;
    req.on('data', (c) => {
      buf += c;
      if (buf.length > limit) { aborted = true; req.destroy(); }
    });
    req.on('end', () => resolve(aborted ? null : buf));
    req.on('error', () => resolve(null));
  });
}

const NAME_RE = /^[a-z][a-z0-9.-]{1,15}$/;
function validAccount(a) { return typeof a === 'string' && NAME_RE.test(a); }

// Normalize a posted send payload to the sealed message json, or return a reason for rejection.
// REJECTS plaintext fields — the server must never be handed anything to encrypt.
export function normalizeSendPayload(input) {
  if (!input || typeof input !== 'object') return { error: 'bad-json' };

  // Refuse plaintext: if the client included anything that looks like an unencrypted message body, we
  // bail — encryption is the client's job and must already be done.
  for (const k of ['subject', 'body', 'plaintext', 'message_plain']) {
    if (k in input && String(input[k] || '').length) return { error: 'plaintext-refused' };
  }

  // Accept either a full op (['custom_json', {id, json}]) or a bare message json.
  let msg = null;
  if (Array.isArray(input.op) && input.op[0] === 'custom_json' && input.op[1]) {
    if (input.op[1].id && input.op[1].id !== PM_CUSTOM_JSON_ID) return { error: 'wrong-id' };
    let j = input.op[1].json;
    if (typeof j === 'string') { try { j = JSON.parse(j); } catch { return { error: 'bad-op-json' }; } }
    msg = j;
  } else if (input.message && typeof input.message === 'object') {
    msg = input.message;
  } else if (input.from && input.to && input.ct) {
    msg = input; // a bare message json was posted directly
  } else {
    return { error: 'no-message' };
  }

  const from = String(msg.from || '').trim().toLowerCase();
  const to = String(msg.to || '').trim().toLowerCase();
  const ct = msg.ct;
  if (!validAccount(from) || !validAccount(to)) return { error: 'bad-accounts' };
  if (from === to) return { error: 'cannot-message-self' };
  if (!ct || typeof ct !== 'string') return { error: 'missing-ciphertext' };

  return {
    msg: {
      v: msg.v ?? 1,
      from,
      to,
      thread: String(msg.thread || ''),
      ts: String(msg.ts || ''),
      ct,
    },
  };
}

// ── the request handler (exported for offline tests) ───────────────────────────
export async function handler(req, res) {
  const origin = req.headers ? req.headers.origin : undefined;
  let url;
  try { url = new URL(req.url, BASE_URL); }
  catch { return sendJson(res, 400, { ok: false, reason: 'bad-url' }, origin); }
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, corsHeaders(origin));
    return res.end();
  }

  if (req.method === 'GET' && path === '/health') {
    res.writeHead(200, { 'content-type': 'text/plain' });
    return res.end('ok');
  }

  // GET /pm/inbox?account=X — the sealed envelopes addressed to X. The server returns ciphertext only;
  // the recipient decrypts client-side. (readInbox with no decryptor keeps everything sealed.)
  if (req.method === 'GET' && path === '/pm/inbox') {
    const account = (url.searchParams.get('account') || '').trim().toLowerCase();
    if (!validAccount(account)) {
      return sendJson(res, 400, { ok: false, reason: 'invalid-account', account: esc(account) }, origin);
    }
    let ops = [];
    try { ops = _store.all(); } catch { ops = []; }
    const sealed = readInbox(account, { ops, includeSealed: true }); // no decrypt → all sealed
    // Re-attach the ciphertext (readInbox strips ct from its output shape) so the client can decrypt.
    const byThreadTs = new Map(ops.map((m) => [`${m.to}|${m.thread}|${m.ts}`, m.ct]));
    const messages = sealed.map((m) => ({
      from: m.from, to: m.to, thread: m.thread, ts: m.ts,
      ct: byThreadTs.get(`${m.to}|${m.thread}|${m.ts}`) || '',
      sealed: true,
    }));
    return sendJson(res, 200, { ok: true, account: esc(account), count: messages.length, messages }, origin);
  }

  // POST /pm/send — relay an ALREADY-ENCRYPTED message. The server never encrypts.
  if (req.method === 'POST' && path === '/pm/send') {
    const raw = await readBody(req);
    if (raw == null) return sendJson(res, 400, { ok: false, reason: 'bad-body' }, origin);
    let input;
    try { input = JSON.parse(raw || '{}'); }
    catch { return sendJson(res, 400, { ok: false, reason: 'bad-json' }, origin); }

    const norm = normalizeSendPayload(input);
    if (norm.error) return sendJson(res, 400, { ok: false, reason: norm.error }, origin);
    const { msg } = norm;

    // Tiered access guard (staff-only by default; allowAllUsers flips it on).
    const allowed = canMessage(_roleOf(msg.from), _roleOf(msg.to), { allowAllUsers: ALLOW_ALL_USERS });
    if (!allowed) {
      return sendJson(res, 403, { ok: false, reason: 'not-permitted-by-tier' }, origin);
    }

    // Abuse cap (per-IP + per-sender). Soft-fails open.
    const rlKey = { ip: clientIp(req), fingerprint: msg.from };
    const rl = _sendLimiter.check(rlKey);
    if (!rl.allowed) {
      return sendJson(res, 429, { ok: false, reason: 'rate-limited', retryAfter: rl.retryAfter }, origin);
    }

    let stored = false;
    try { stored = _store.add(msg); } catch { stored = false; }
    if (!stored) return sendJson(res, 500, { ok: false, reason: 'store-error' }, origin);
    _sendLimiter.record(rlKey);

    return sendJson(res, 200, {
      ok: true,
      thread: esc(msg.thread),
      to: esc(msg.to),
      note: 'relayed sealed (ciphertext-only); the recipient decrypts client-side',
    }, origin);
  }

  return sendJson(res, 404, { ok: false, reason: 'not-found' }, origin);
}

// ── CLI (guarded) ──────────────────────────────────────────────────────────────
if (process.argv[1] && /private-mail-server\.mjs$/.test(process.argv[1])) {
  createServer(handler).listen(PORT, HOST, () => {
    console.log(`private-mail relay on ${BASE_URL} (bound ${HOST}:${PORT})`);
    console.log(`  allowed origin:  ${ALLOWED_ORIGIN}`);
    console.log(`  allowAllUsers:   ${ALLOW_ALL_USERS ? 'ON' : 'OFF (staff pilot)'}`);
    console.log('  custody: ZERO keys, ZERO encryption — relays ciphertext only; client-side crypto.');
  });
}
