// transport — which road a gated Herald send actually leaves by.
//
// WHAT WAS WRONG. `POST /crm/campaigns/:id/leads/:lead/send` is the only path in this repo that sends,
// and it is hard-wired to `sendViaMailbox()` → the Gmail API. Everything upstream of the transport is
// right — the compliance gate, the cross-campaign suppression list, the warmup ledger, the merge-field
// backstop — and all of it feeds a road the campaign cannot finish on:
//
//   1. `gmail.send` is a Google RESTRICTED scope. An unverified app sits in Testing mode, where refresh
//      tokens expire after SEVEN DAYS. The warmup ramp needs ~2.5 weeks to clear 218 holders (day-1 cap
//      10, 10-day cumulative 164). The token dies on day 7, every time. This is not a config value.
//   2. Gmail does not POST webhooks. Bounces arrive as messages in the mailbox and nothing reads them,
//      so `deliverabilityHealth()` sees 0 sent / 0 bounced forever and its STOP can never fire. The
//      gate's most important check is inert on this road.
//
// The ESP road has neither problem: an API key does not expire on a timer, and Resend/Postmark POST
// real bounce and complaint webhooks — which `bounce-webhook.mjs` now parses and which move a lead to
// the `bounced`/`complained` stages that `suppressionFrom()` already treats as terminal.
//
// WHAT THIS DOES NOT DO. It does not loosen the identity-domain rule. `isForbiddenFrom()` is imported
// from mailbox.mjs rather than restated, so there is exactly ONE list of domains cold outreach may
// never send from, and the ESP road is held to it too. Having an ESP key for melek.salon is not
// permission to cold-send from melek.salon — a verified domain and a domain you may burn are different
// questions, and the answer to the second one is still no. The ESP path REQUIRES a dedicated sending
// domain in HERALD_SEND_FROM and refuses to start without one.
//
// The CAN-SPAM elements are imported, not reimplemented: `postalAddress()`, `complianceFooter()` and
// `unsubscribeHeaders()` all come from mailbox.mjs. A second copy of a legal requirement is a second
// copy that drifts.
//
//   import { chooseTransport, sendVia } from './transport.mjs'

import {
  getMailbox, sendViaMailbox, isForbiddenFrom,
  postalAddress, complianceFooter, unsubscribeHeaders,
} from '../connect/mailbox.mjs';

const env = (k, d = '') => ((typeof process !== 'undefined' && process.env && process.env[k]) || d);
const str = (v) => String(v == null ? '' : v).trim();

export const TRANSPORTS = Object.freeze(['gmail', 'esp']);

// Injectable fetch — the ESP call is mocked offline like every other network seam in this repo.
let _fetch = (...a) => (globalThis.fetch ? globalThis.fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => globalThis.fetch(...a)); }

export const espFrom = (o = {}) => str(o.from != null ? o.from : env('HERALD_SEND_FROM', ''));
const espKeys = (o = {}) => ({
  resend: str(o.resendKey != null ? o.resendKey : env('RESEND_API_KEY', '')),
  postmark: str(o.postmarkToken != null ? o.postmarkToken : env('POSTMARK_SERVER_TOKEN', '')),
  named: str(o.provider != null ? o.provider : env('HERALD_ESP', '')).toLowerCase(),
});

/**
 * Which road is available for this account, and why. Pure — no network, no send.
 * Returns { transport, from, reason, blockers[] }. `transport` is null when neither road is usable.
 */
export function chooseTransport(account, opts = {}) {
  const want = str(opts.transport != null ? opts.transport : env('HERALD_TRANSPORT', '')).toLowerCase();
  const blockers = [];

  // ── the ESP road ──────────────────────────────────────────────────────────────────────────────────
  const from = espFrom(opts);
  const keys = espKeys(opts);
  const hasKey = !!(keys.resend || keys.postmark);
  let espOk = false;
  if (!hasKey) blockers.push('esp: no RESEND_API_KEY or POSTMARK_SERVER_TOKEN');
  else if (!from) blockers.push('esp: HERALD_SEND_FROM is unset — the ESP road needs a dedicated sending address');
  else if (!from.includes('@')) blockers.push(`esp: HERALD_SEND_FROM is not an address (${from})`);
  else if (isForbiddenFrom(from)) {
    // The whole point of the rule. A verified domain is not a domain you may burn.
    blockers.push(`esp: refusing to cold-send from the identity domain ${from.split('@')[1]} — `
      + 'use a dedicated sending domain, not the one your site and your real mail live on');
  } else espOk = true;

  // ── the Gmail road ────────────────────────────────────────────────────────────────────────────────
  const mb = getMailbox(account, opts);
  const gmailOk = !!(mb && mb.email && !isForbiddenFrom(mb.email));
  if (!mb) blockers.push('gmail: no mailbox connected');
  else if (!gmailOk) blockers.push('gmail: connected mailbox is on an identity domain');

  if (want === 'esp') {
    return espOk
      ? { transport: 'esp', from, reason: 'HERALD_TRANSPORT=esp', blockers: [] }
      : { transport: null, from: '', reason: 'HERALD_TRANSPORT=esp but the ESP road is not usable', blockers };
  }
  if (want === 'gmail') {
    return gmailOk
      ? { transport: 'gmail', from: mb.email, reason: 'HERALD_TRANSPORT=gmail', blockers: [] }
      : { transport: null, from: '', reason: 'HERALD_TRANSPORT=gmail but no usable mailbox', blockers };
  }
  // Auto. The ESP is preferred because it is the only road the campaign can actually finish on;
  // Gmail stays as the fallback so an operator with a mailbox and no ESP is not stranded.
  if (espOk) return { transport: 'esp', from, reason: 'ESP configured — the road a 2.5-week ramp survives', blockers: [] };
  if (gmailOk) {
    return {
      transport: 'gmail', from: mb.email, blockers,
      reason: 'falling back to Gmail — note the 7-day refresh-token expiry on an unverified app, and that bounces are invisible on this road',
    };
  }
  return { transport: null, from: '', reason: 'no usable transport', blockers };
}

// ── the ESP send ────────────────────────────────────────────────────────────────────────────────────
// Same refusals as the Gmail road, in the same order, for the same reasons.
async function sendViaESP(msg, opts = {}) {
  const from = espFrom(opts);
  const to = str(msg.to);
  if (!to || !to.includes('@')) return { ok: false, reason: 'recipient required' };
  if (isForbiddenFrom(from)) return { ok: false, reason: 'refusing to send from an identity domain' };

  const addr = postalAddress(opts);
  if (!addr) {
    return {
      ok: false, reason: 'no postal address configured — set HERALD_POSTAL_ADDRESS. A commercial '
        + 'message without a physical postal address violates CAN-SPAM 15 U.S.C. 7704(a)(5)(A)(iii), '
        + 'and the first message without one is already the violation',
    };
  }
  const unrendered = String(msg.body || '').match(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/);
  if (unrendered) return { ok: false, reason: `body still contains ${unrendered[0]} — refusing to mail a placeholder` };

  const body = `${String(msg.body || '')}${complianceFooter(from, opts)}`;
  // unsubscribeHeaders() returns wire-format lines because Gmail wants raw MIME; the ESPs want a map.
  const headers = {};
  for (const line of unsubscribeHeaders(from)) {
    const i = line.indexOf(':');
    if (i > 0) headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  const keys = espKeys(opts);
  const useResend = keys.named === 'resend' || (!keys.named && keys.resend);
  const usePostmark = keys.named === 'postmark' || (!keys.named && !keys.resend && keys.postmark);

  try {
    if (useResend && keys.resend) {
      const r = await _fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { authorization: `Bearer ${keys.resend}`, 'content-type': 'application/json' },
        body: JSON.stringify({ from, to, subject: msg.subject || '', text: body, headers }),
      });
      const status = (r && r.status) || 0;
      const j = await (r && r.json ? r.json().catch(() => ({})) : Promise.resolve({}));
      if (status >= 400) return { ok: false, reason: `resend send failed (${status})` };
      return { ok: true, id: (j && j.id) || null, from, to };
    }
    if (usePostmark && keys.postmark) {
      const r = await _fetch('https://api.postmarkapp.com/email', {
        method: 'POST',
        headers: { 'X-Postmark-Server-Token': keys.postmark, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          From: from, To: to, Subject: msg.subject || '', TextBody: body,
          Headers: Object.entries(headers).map(([Name, Value]) => ({ Name, Value })),
        }),
      });
      const status = (r && r.status) || 0;
      const j = await (r && r.json ? r.json().catch(() => ({})) : Promise.resolve({}));
      if (status >= 400) return { ok: false, reason: `postmark send failed (${status})` };
      return { ok: true, id: (j && j.MessageID) || null, from, to };
    }
    return { ok: false, reason: 'no ESP configured' };
  } catch { return { ok: false, reason: 'esp send error' }; }
}

/**
 * Send by whichever road is available. Uniform result: { ok, id?, from?, to?, transport, reason? }.
 * NEVER throws — a transport failure is a refusal with a reason, exactly like the gate above it.
 */
export async function sendVia(account, msg = {}, opts = {}) {
  const choice = chooseTransport(account, opts);
  if (!choice.transport) {
    return { ok: false, transport: null, reason: choice.reason, blockers: choice.blockers };
  }
  const r = choice.transport === 'esp'
    ? await sendViaESP(msg, opts)
    : await sendViaMailbox(account, msg, opts);
  return { ...r, transport: choice.transport };
}

export default { TRANSPORTS, chooseTransport, sendVia, espFrom, __setFetch };
