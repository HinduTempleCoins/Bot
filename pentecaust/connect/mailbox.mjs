// pentecaust/connect/mailbox.mjs — Pentecaust HERALD sending layer: a user connects THEIR OWN mailbox
// (Gmail via OAuth) and Herald sends outreach through it — exactly how Instantly/Smartlead/Lemlist work,
// and the model the operator asked for ("log them into Gmail and send from there"). Sending is ALWAYS from
// the user's own connected mailbox — NEVER from an @pentecaust.com identity/transactional address (that
// would burn the domain's reputation). This module is the deterministic sender + token store; the OAuth
// grant that fills it is wired separately.
//
// SECURITY: refresh tokens = long-lived access to a user's mailbox — a high-value target. This file-store
// is the alpha shape (offline-testable, matches the repo pattern). PRODUCTION MUST encrypt tokens at rest
// (KMS / the MELEK-Signer custody box) — see [[hathor-key-security-architecture]]. Tokens are NEVER logged.
//
// Yahoo note: Yahoo has no public OAuth "send" API anymore — Yahoo sending is SMTP + an app password, a
// separate path (smtp.mail.yahoo.com). This module implements the Gmail OAuth-send path; SMTP is a follow-up.
//
//   import { connectMailbox, getMailbox, disconnectMailbox, sendViaMailbox } from './mailbox.mjs'

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;
export const DATA_FILE = () => env('MAILBOX_DATA', join(process.cwd(), 'data', 'mailboxes.json'));

// Identity/transactional domains cold outreach must NEVER send from (the hard deliverability rule).
const FORBIDDEN_FROM = (env('HERALD_FORBIDDEN_SEND_DOMAINS', 'pentecaust.com,melek.salon,soapbox.community')
  .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
const isForbiddenFrom = (email) => {
  const at = String(email || '').toLowerCase().split('@')[1] || '';
  return FORBIDDEN_FROM.some((d) => at === d || at.endsWith('.' + d));
};

const now = (o) => (o && o.now != null ? o.now : Date.now());
const acct = (s) => String(s || '').toLowerCase().replace(/^@/, '').trim();

// ── injectable fs + store (same discipline as the other pentecaust stores) ──────────────────────────
const realFs = {
  read: (p) => { try { return readFileSync(p, 'utf8'); } catch { return null; } },
  write: (p, s) => { try { mkdirSync(dirname(p), { recursive: true }); } catch {} writeFileSync(p, s); },
};
function loadStore(fs, file) {
  const raw = (fs.read || realFs.read)(file);
  if (!raw) return { mailboxes: {} };
  try { const o = JSON.parse(raw); return o && o.mailboxes ? o : { mailboxes: {} }; } catch { return { mailboxes: {} }; }
}
const saveStore = (fs, file, s) => (fs.write || realFs.write)(file, JSON.stringify(s));
const ctx = (o = {}) => ({ fs: o.fs || realFs, file: o.file || DATA_FILE() });

// ── injectable fetch (so token-refresh + the Gmail send call are mocked offline) ────────────────────
let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

// ── connect / read / disconnect ──────────────────────────────────────────────────────────────────────
export function connectMailbox(account, conn = {}, opts = {}) {
  const a = acct(account);
  if (!a) return { ok: false, reason: 'account required' };
  const email = String(conn.email || '').toLowerCase().trim();
  if (!email || !email.includes('@')) return { ok: false, reason: 'mailbox email required' };
  // HARD RULE: never let an identity/transactional address be registered as a cold-send mailbox.
  if (isForbiddenFrom(email)) return { ok: false, reason: 'cannot send cold from an identity domain (e.g. @pentecaust.com)' };
  const provider = ['google', 'yahoo'].includes(conn.provider) ? conn.provider : 'google';
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  store.mailboxes[a] = {
    provider, email,
    accessToken: String(conn.accessToken || ''),
    refreshToken: String(conn.refreshToken || ''),
    expiresAt: Number(conn.expiresAt) || 0,
    connectedAt: now(opts),
  };
  saveStore(fs, file, store);
  return { ok: true, mailbox: publicView(store.mailboxes[a]) };
}

// Never expose tokens to callers/UI — only the safe fields.
const publicView = (m) => m && ({ provider: m.provider, email: m.email, connectedAt: m.connectedAt });

export function getMailbox(account, opts = {}) {
  const { fs, file } = ctx(opts);
  return publicView(loadStore(fs, file).mailboxes[acct(account)] || null);
}

export function disconnectMailbox(account, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  delete store.mailboxes[acct(account)];
  saveStore(fs, file, store);
  return { ok: true };
}

// ── token refresh (Google) — access tokens live ~1h; the refresh token mints new ones ────────────────
async function refreshGoogle(rec) {
  const clientId = env('GOOGLE_CLIENT_ID', ''); const clientSecret = env('GOOGLE_CLIENT_SECRET', '');
  if (!rec.refreshToken || !clientId || !clientSecret) return null;
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: rec.refreshToken, client_id: clientId, client_secret: clientSecret });
  try {
    const r = await _fetch('https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }, body: body.toString(),
    });
    const j = await r.json();
    return j && j.access_token ? { accessToken: String(j.access_token), expiresIn: Number(j.expires_in) || 3600 } : null;
  } catch { return null; }
}

// RFC-822 message → base64url (Gmail's messages.send wants a base64url-encoded raw MIME message).
function buildRaw({ from, to, subject, body }) {
  const headers = [`From: ${from}`, `To: ${to}`, `Subject: ${subject || ''}`, 'MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"'];
  const mime = headers.join('\r\n') + '\r\n\r\n' + String(body || '');
  return Buffer.from(mime, 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ── send outreach through the user's OWN connected mailbox ───────────────────────────────────────────
export async function sendViaMailbox(account, msg = {}, opts = {}) {
  const { fs, file } = ctx(opts);
  const store = loadStore(fs, file);
  const rec = store.mailboxes[acct(account)];
  if (!rec) return { ok: false, reason: 'no mailbox connected' };
  if (isForbiddenFrom(rec.email)) return { ok: false, reason: 'refusing to send from an identity domain' };   // belt + suspenders
  const to = String(msg.to || '').trim();
  if (!to || !to.includes('@')) return { ok: false, reason: 'recipient required' };
  if (rec.provider !== 'google') return { ok: false, reason: `sending via ${rec.provider} not supported yet (Gmail only)` };

  // Refresh the access token if missing/expired (60s skew), then persist the new one.
  if (!rec.accessToken || now(opts) >= (rec.expiresAt - 60000)) {
    const fresh = await refreshGoogle(rec);
    if (!fresh) return { ok: false, reason: 'could not refresh mailbox token — reconnect the mailbox' };
    rec.accessToken = fresh.accessToken;
    rec.expiresAt = now(opts) + fresh.expiresIn * 1000;
    saveStore(fs, file, store);
  }

  const raw = buildRaw({ from: rec.email, to, subject: msg.subject, body: msg.body });
  try {
    const r = await _fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
      method: 'POST', headers: { authorization: `Bearer ${rec.accessToken}`, 'content-type': 'application/json' }, body: JSON.stringify({ raw }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status && r.status >= 400) return { ok: false, reason: `gmail send failed (${r.status})` };
    return { ok: true, id: (j && j.id) || null, from: rec.email, to };
  } catch { return { ok: false, reason: 'gmail send error' }; }
}
