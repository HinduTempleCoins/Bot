// icloud-mail.mjs — send mail through iCloud.
//
// Apple publishes NO REST API for iCloud Mail. The only supported path is SMTP:
//   host smtp.mail.me.com · port 587 · STARTTLS · username = the Apple ID (or an iCloud
//   alias / custom-domain address on iCloud+) · password = an APP-SPECIFIC PASSWORD
//   generated at appleid.apple.com. An Apple ID password will not work, and app-specific
//   passwords require two-factor authentication to be on.
//
// Env (never hard-code, never log):
//   ICLOUD_USER       the Apple ID the account authenticates as
//   ICLOUD_APP_PASS   the app-specific password (xxxx-xxxx-xxxx-xxxx)
//   ICLOUD_FROM       the From: address — must be the Apple ID or one of its verified
//                     iCloud aliases / iCloud+ custom-domain addresses, or Apple rejects it
//
// Every send is appended to a ledger so we never rely on reading an inbox back.
//
//   import { sendIcloud, icloudReady, __setTransport } from './icloud-mail.mjs'
//   node integrations/icloud-mail.mjs --to=someone@example.com --subject="Hi" --text="Body"

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const env = (k, d) => (typeof process !== 'undefined' && process.env && process.env[k]) || d;

export const ICLOUD_HOST = 'smtp.mail.me.com';
export const ICLOUD_PORT = 587;
export const LEDGER = () => env('MAIL_LEDGER', '/var/lib/melek-mail/SENT_LEDGER.csv');

/** True when the three required settings are present. Never reveals them. */
export function icloudReady() {
  return Boolean(env('ICLOUD_USER') && env('ICLOUD_APP_PASS') && env('ICLOUD_FROM'));
}

// injectable transport so the tests never open a socket
let _transport = null;
export function __setTransport(t) { _transport = t || null; }

async function transport() {
  if (_transport) return _transport;
  const nodemailer = (await import('nodemailer')).default;
  return nodemailer.createTransport({
    host: ICLOUD_HOST,
    port: ICLOUD_PORT,
    secure: false,          // STARTTLS is negotiated on 587
    requireTLS: true,
    auth: { user: env('ICLOUD_USER'), pass: env('ICLOUD_APP_PASS') },
  });
}

const esc = (s) => String(s == null ? '' : s).replace(/[\r\n,]/g, ' ').slice(0, 200);

/** Append-only record of every send. One ledger, never forage an inbox. */
export function logSend({ to, subject, result, id = '' }, file = LEDGER()) {
  try { mkdirSync(dirname(file), { recursive: true }); } catch { /* exists */ }
  try {
    appendFileSync(file, `${new Date().toISOString()},icloud,${esc(to)},${esc(subject)},${esc(result)},${esc(id)}\n`);
  } catch { /* a ledger failure must never lose the send */ }
}

/**
 * Send one message. Soft-fails to {ok:false, error} — never throws.
 * Returns {ok, id?, error?}. The app-specific password is never logged or returned.
 */
export async function sendIcloud({ to, subject, text, html, replyTo } = {}) {
  if (!to || !subject || !(text || html)) return { ok: false, error: 'to, subject and a body are required' };
  if (!icloudReady()) return { ok: false, error: 'ICLOUD_USER / ICLOUD_APP_PASS / ICLOUD_FROM not set' };
  try {
    const t = await transport();
    const info = await t.sendMail({
      from: env('ICLOUD_FROM'), to, subject, text, html,
      ...(replyTo ? { replyTo } : {}),
    });
    const id = (info && info.messageId) || '';
    logSend({ to, subject, result: 'ok', id });
    return { ok: true, id };
  } catch (e) {
    const error = String((e && e.message) || e).slice(0, 200);
    logSend({ to, subject, result: 'fail:' + error });
    return { ok: false, error };
  }
}

// ── CLI ────────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('icloud-mail.mjs')) {
  const arg = (n) => { const a = process.argv.find((x) => x.startsWith(`--${n}=`)); return a ? a.slice(n.length + 3) : undefined; };
  if (!icloudReady()) {
    console.log('iCloud mail is NOT configured. Needed, in the environment:');
    console.log('  ICLOUD_USER      your Apple ID');
    console.log('  ICLOUD_APP_PASS  an app-specific password from appleid.apple.com (2FA must be on)');
    console.log('  ICLOUD_FROM      the From: address — the Apple ID, or a verified iCloud alias / iCloud+ domain');
    console.log(`\nSMTP is the only route Apple offers: ${ICLOUD_HOST}:${ICLOUD_PORT} STARTTLS. There is no iCloud Mail REST API.`);
    process.exit(1);
  }
  const to = arg('to'), subject = arg('subject'), text = arg('text');
  if (!to || !subject || !text) { console.log('usage: node integrations/icloud-mail.mjs --to=… --subject=… --text=…'); process.exit(1); }
  const r = await sendIcloud({ to, subject, text });
  console.log(r.ok ? `sent — ${r.id}` : `failed — ${r.error}`);
  process.exit(r.ok ? 0 : 1);
}
