// smtp.mjs — the SMTP send path, for accounts that have no OAuth send API.
//
// WHY THIS EXISTS. `mailbox.mjs` says so in its own header: "Yahoo has no public OAuth 'send' API
// anymore — Yahoo sending is SMTP + an app password, a separate path (smtp.mail.yahoo.com). This
// module implements the Gmail OAuth-send path; SMTP is a follow-up." This is that follow-up.
//
// ⭐ ONE MESSAGE PER RECIPIENT, NEVER A BCC BLAST. That is not politeness. The operator's own
// existing sends from this account are individually addressed roughly 30 seconds apart, and that
// cadence is why a consumer mailbox has survived thousands of messages. A 300-way BCC from the same
// account is a different animal to every spam filter in the path, and it also leaks the whole
// recipient list to every recipient.
//
// ⚠️ RESUMABLE BY CONSTRUCTION. Every accepted message is appended to a ledger BEFORE the next is
// attempted, so a crash, a timeout, or a Ctrl-C re-sends nobody. Duplicate mail into a government
// inbox is worse than no mail.
//
// ⚠️ DRY RUN IS THE DEFAULT. `dryRun: false` must be passed explicitly. This module opens a socket to
// somebody else's mail server; that should never be what you get by forgetting an argument.
//
// No dependency: raw TLS plus the SMTP verbs. nodemailer is not in this repo and one send path does
// not justify adding it.
//
//   import { loadAccount, sendOne, sendBatch, ledger } from './smtp.mjs'

import tls from 'node:tls';
import { readFileSync, appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const env = (k, d = '') => ((typeof process !== 'undefined' && process.env && process.env[k]) || d);
const str = (v) => String(v == null ? '' : v).trim();

/**
 * Read an account file from the vault (`key=value` lines, `#` comments).
 * The password is returned for use and is never included in any result object this module produces.
 */
export function loadAccount(file) {
  const raw = readFileSync(file, 'utf8');
  const cfg = Object.fromEntries(raw.split('\n')
    .filter((l) => l.includes('=') && !l.trimStart().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }));
  if (!cfg.user || !cfg.pass) throw new Error(`${file}: needs user= and pass=`);
  return {
    host: cfg.host || 'smtp.mail.yahoo.com',
    port: Number(cfg.port || 465),
    user: cfg.user,
    pass: cfg.pass,
  };
}

const b64 = (s) => Buffer.from(String(s), 'utf8').toString('base64');

/**
 * An RFC-5322 message. Individually addressed, no BCC, and carrying List-Unsubscribe so a recipient
 * has a one-click way out that does not depend on reading the footer.
 */
export function buildMessage({ from, fromName, to, subject, body, replyTo } = {}) {
  const text = String(body == null ? '' : body).replace(/\r?\n/g, '\r\n');
  const domain = String(from || '').split('@')[1] || 'localhost';
  const headers = [
    `From: ${fromName ? `${fromName} <${from}>` : from}`,
    `To: ${to}`,
    replyTo ? `Reply-To: ${replyTo}` : null,
    `Subject: ${subject || ''}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${Date.now().toString(36)}.${Math.random().toString(36).slice(2)}@${domain}>`,
    `List-Unsubscribe: <mailto:${from}?subject=unsubscribe>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ].filter(Boolean);
  return `${headers.join('\r\n')}\r\n\r\n${text}\r\n`;
}

/**
 * One SMTP conversation, one message. Resolves `{ ok, to, code, reason }`. NEVER throws and never
 * rejects — a transport failure is a result with a reason, like every other seam in this repo.
 */
export function sendOne(acct, msg, { timeoutMs = 45000, dryRun = true } = {}) {
  return new Promise((resolve) => {
    const to = str(msg && msg.to);
    if (!to || !to.includes('@')) return resolve({ ok: false, to, code: 0, reason: 'no recipient' });
    if (dryRun) return resolve({ ok: true, dryRun: true, to, code: 0, reason: 'dry run — nothing was sent' });

    const wire = buildMessage(msg);
    let sock;
    try {
      sock = tls.connect({ host: acct.host, port: acct.port, servername: acct.host });
    } catch (e) {
      return resolve({ ok: false, to, code: 0, reason: `connect: ${String(e.message).slice(0, 80)}` });
    }
    let buf = ''; let step = 0; let settled = false;
    const done = (r) => { if (settled) return; settled = true; try { sock.end(); } catch { /* already closed */ } resolve(r); };
    const w = (s) => { try { sock.write(`${s}\r\n`); } catch { done({ ok: false, to, code: 0, reason: 'socket closed' }); } };

    sock.setTimeout(timeoutMs, () => done({ ok: false, to, code: 0, reason: 'timeout' }));
    sock.on('error', (e) => done({ ok: false, to, code: 0, reason: String(e.message).slice(0, 90) }));
    sock.on('data', (d) => {
      buf += d.toString();
      if (!buf.endsWith('\r\n')) return;
      const lines = buf.trim().split('\r\n'); buf = '';
      const last = lines[lines.length - 1] || '';
      const code = last.slice(0, 3);
      // A multiline reply continues with `250-`; wait for the terminating `250 `.
      if (/^\d{3}-/.test(last)) return;
      const bad = (where) => done({ ok: false, to, code, reason: `${where}: ${last.slice(0, 90)}` });
      switch (step) {
        case 0: if (code !== '220') return bad('greeting'); w('EHLO melek.salon'); step = 1; return;
        case 1: if (code !== '250') return bad('ehlo'); w('AUTH LOGIN'); step = 2; return;
        case 2: if (code !== '334') return bad('auth-start'); w(b64(acct.user)); step = 3; return;
        case 3: if (code !== '334') return bad('auth-user'); w(b64(acct.pass)); step = 4; return;
        case 4: if (code !== '235') return bad('auth'); w(`MAIL FROM:<${acct.user}>`); step = 5; return;
        case 5: if (code !== '250') return bad('mail-from'); w(`RCPT TO:<${to}>`); step = 6; return;
        case 6: if (code !== '250' && code !== '251') return bad('rcpt'); w('DATA'); step = 7; return;
        case 7: if (code !== '354') return bad('data'); try { sock.write(`${wire}.\r\n`); } catch { return done({ ok: false, to, code: 0, reason: 'socket closed mid-DATA' }); } step = 8; return;
        case 8: if (code !== '250') return bad('accept'); w('QUIT'); return done({ ok: true, to, code, reason: last.slice(0, 90) });
        default:
      }
    });
  });
}

// ── the resumable ledger ────────────────────────────────────────────────────────────────────────

export const LEDGER = () => env('SMTP_SEND_LEDGER', 'data/smtp-sent.jsonl');

/** Addresses already accepted by the server, so a re-run never sends to the same person twice. */
export function ledger(file = LEDGER()) {
  const seen = new Set();
  if (!existsSync(file)) return seen;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line);
      if (r && r.ok && r.to) seen.add(String(r.to).toLowerCase());
    } catch { /* a torn line is not a reason to resend everybody */ }
  }
  return seen;
}

function record(file, row) {
  try { mkdirSync(dirname(file), { recursive: true }); } catch { /* exists */ }
  try { appendFileSync(file, `${JSON.stringify(row)}\n`); } catch { /* the send already happened */ }
}

/**
 * Send to many, one at a time, pacing between messages.
 *
 * Stops after three consecutive failures: that is a configuration or reputation fault, not three
 * unlucky addresses, and continuing costs the account.
 */
export async function sendBatch(acct, recipients, message, {
  dryRun = true, pauseMs = 30000, limit = 0, ledgerFile = LEDGER(), onProgress = null,
} = {}) {
  const list = (Array.isArray(recipients) ? recipients : []).map(str).filter(Boolean);
  const already = ledger(ledgerFile);
  const queue = list.filter((e) => !already.has(e.toLowerCase()));
  const todo = limit > 0 ? queue.slice(0, limit) : queue;
  const out = {
    attempted: 0, sent: 0, failed: 0,
    skippedAlreadySent: list.length - queue.length,
    dryRun, results: [],
  };
  for (let i = 0; i < todo.length; i += 1) {
    const to = todo[i];
    const r = await sendOne(acct, { ...message, to }, { dryRun });
    out.attempted += 1;
    if (r.ok) out.sent += 1; else out.failed += 1;
    out.results.push(r);
    if (!dryRun) record(ledgerFile, { at: new Date().toISOString(), ...r });
    if (onProgress) { try { onProgress(out, r); } catch { /* reporting is not the send */ } }
    const tail = out.results.slice(-3);
    if (tail.length === 3 && tail.every((x) => !x.ok)) {
      out.stoppedEarly = true;
      out.reason = 'three failures in a row — stopping rather than burning the account';
      break;
    }
    if (!dryRun && i < todo.length - 1) await new Promise((res) => setTimeout(res, pauseMs));
  }
  return out;
}

export default { loadAccount, buildMessage, sendOne, sendBatch, ledger, LEDGER };
