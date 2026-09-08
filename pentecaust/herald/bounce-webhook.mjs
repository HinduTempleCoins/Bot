// bounce-webhook — the shape the providers actually POST, versus the one this repo was waiting for.
//
// WHAT WAS WRONG. `campaign-sender.mjs`'s `/api/webhook` reads:
//
//     const type  = clean(body.type).toLowerCase();          // wants 'bounce' | 'complaint'
//     const email = body.email || body.recipient || '';
//
// No provider sends that. What actually arrives:
//
//   Resend     { type: "email.bounced",  data: { to: ["a@b.example"], bounce: { type: "Permanent" } } }
//              { type: "email.complained", data: { to: [...] } }
//              — `type` is namespaced, the address is an ARRAY one level down, and `body.email` is
//                undefined. So `type === 'bounce'` is false, `email` is '', and the endpoint answers
//                400 'unknown type' to every bounce Resend has ever sent it.
//
//   Postmark   { RecordType: "Bounce",        Email: "a@b.example", Type: "HardBounce" }
//              { RecordType: "SpamComplaint", Email: "a@b.example" }
//              — capitalised keys; `body.type` and `body.email` are both undefined.
//
//   SES / SNS  { Type: "Notification", Message: "<a JSON STRING>" } where the inner string parses to
//              { notificationType: "Bounce", bounce: { bouncedRecipients: [{ emailAddress: "…" }] } }
//              — the payload is JSON inside a JSON string field, which no amount of reading
//                `body.email` will ever find.
//
// So the endpoint has been failing closed on every real event, which sounds safe and is the opposite:
// a bounce that is never recorded is an address that stays in the list, and the second send to a dead
// mailbox is worth more against a sending reputation than the first.
//
// WHY IT MATTERS MORE NOW. `send-ledger.mjs` counts bounces and complaints, and `send-gate.mjs` turns
// those counts into the deliverability STOP that refuses to send from a burning domain. With nothing
// feeding them, that STOP reads 0/0 forever and can never fire. This is the feed.
//
// A NOTE ON THE GMAIL PATH. The live route sends through the operator's own Gmail, and Gmail does not
// POST a webhook — a bounce comes back as a message in the mailbox. So this endpoint is the feed for
// an ESP path and for anything that can be taught to POST here; the Gmail bounces still need reading
// out of the mailbox, and that is not built. Named rather than papered over.
//
// Nothing here sends. It parses a payload and reports events.
//
//   import { normalizeWebhook, applyEvents, createBounceWebhook } from './bounce-webhook.mjs'

import { timingSafeEqual } from 'node:crypto';

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();
const emails = (v) => (Array.isArray(v) ? v : [v]).map(low).filter((e) => e && e.includes('@'));

/** The two verdicts that suppress. Everything else is telemetry we do not act on. */
export const ACTIONABLE = Object.freeze(new Set(['bounce', 'complaint']));

/**
 * A soft bounce is not a dead address.
 *
 * Resend/SES call a full mailbox or a greylist a `Transient` bounce, and suppressing on one throws
 * away a real contact for a temporary condition. Only permanent failures suppress; transient ones
 * come back typed so a caller can count them without acting on them.
 */
const isTransient = (t) => /transient|soft|delay/i.test(str(t));

/**
 * Normalize any of the four shapes into `{ provider, events: [{ type, email, permanent, detail }] }`.
 *
 * Unknown payloads come back with no events and a named provider of 'unknown' — never a throw, and
 * never a guess at an address.
 */
export function normalizeWebhook(body = {}) {
  const b = (body && typeof body === 'object') ? body : {};
  const out = [];
  let provider = 'unknown';

  // ── SES via SNS: the real payload is a JSON STRING in `Message` ────────────────────────────────
  if (str(b.Type) === 'Notification' && typeof b.Message === 'string') {
    provider = 'ses';
    let inner = null;
    try { inner = JSON.parse(b.Message); } catch { inner = null; }
    if (inner && typeof inner === 'object') {
      const nt = low(inner.notificationType || inner.eventType);
      if (nt === 'bounce') {
        const bn = inner.bounce || {};
        const permanent = !isTransient(bn.bounceType);
        for (const r of (bn.bouncedRecipients || [])) {
          for (const e of emails(r && r.emailAddress)) out.push({ type: 'bounce', email: e, permanent, detail: str(bn.bounceSubType) });
        }
      } else if (nt === 'complaint') {
        const cp = inner.complaint || {};
        for (const r of (cp.complainedRecipients || [])) {
          for (const e of emails(r && r.emailAddress)) out.push({ type: 'complaint', email: e, permanent: true, detail: str(cp.complaintFeedbackType) });
        }
      }
    }
    return { provider, events: out };
  }

  // ── Postmark: capitalised keys, one recipient ─────────────────────────────────────────────────
  if (b.RecordType != null) {
    provider = 'postmark';
    const rt = low(b.RecordType);
    const type = rt === 'bounce' ? 'bounce' : rt === 'spamcomplaint' ? 'complaint' : '';
    if (type) {
      const permanent = type === 'complaint' || !/soft|transient/i.test(str(b.Type));
      for (const e of emails(b.Email || b.Recipient)) out.push({ type, email: e, permanent, detail: str(b.Type) });
    }
    return { provider, events: out };
  }

  // ── Resend: namespaced type, recipients as an array under `data` ──────────────────────────────
  const t = low(b.type || b.event);
  if (t.startsWith('email.')) {
    provider = 'resend';
    const d = (b.data && typeof b.data === 'object') ? b.data : {};
    const kind = t.slice('email.'.length);
    const type = kind === 'bounced' ? 'bounce' : kind === 'complained' ? 'complaint' : '';
    if (type) {
      const bn = (d.bounce && typeof d.bounce === 'object') ? d.bounce : {};
      const permanent = type === 'complaint' || !isTransient(bn.type);
      for (const e of emails(d.to || d.email || d.recipient)) {
        out.push({ type, email: e, permanent, detail: str(bn.subType || bn.type) });
      }
    }
    return { provider, events: out };
  }

  // ── The flat shape this repo was written against. Kept, because our own tools speak it. ───────
  if (t === 'bounce' || t === 'complaint') {
    provider = 'flat';
    for (const e of emails(b.email || b.recipient || b.to)) {
      out.push({ type: t, email: e, permanent: t === 'complaint' || !isTransient(b.bounceType), detail: str(b.bounceType) });
    }
  }
  return { provider, events: out };
}

/**
 * Act on normalized events.
 *
 * `suppress(email, type)` and `count(type)` are INJECTED — this module knows nothing about a CRM, a
 * ledger or a subscriber store. Transient bounces are counted and NOT suppressed.
 */
export function applyEvents(events = [], { suppress = null, count = null } = {}) {
  const suppressed = []; const counted = []; const ignored = [];
  for (const ev of (Array.isArray(events) ? events : [])) {
    if (!ev || !ACTIONABLE.has(ev.type) || !ev.email) { ignored.push(ev); continue; }
    if (typeof count === 'function') { try { count(ev.type, ev.email); } catch { /* telemetry is not the act */ } }
    counted.push(ev.email);
    if (!ev.permanent) { ignored.push({ ...ev, why: 'transient — a full mailbox is not a dead address' }); continue; }
    if (typeof suppress === 'function') { try { suppress(ev.email, ev.type); } catch { /* soft-fail */ } }
    suppressed.push(ev.email);
  }
  return { suppressed, counted, ignored, counts: { suppressed: suppressed.length, counted: counted.length, ignored: ignored.length } };
}

const sendJson = (res, code, obj) => {
  try {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(JSON.stringify(obj));
  } catch { /* soft-fail */ }
};

function readJsonBody(req, max = 262144) {
  if (req && req.body && typeof req.body === 'object') return Promise.resolve(req.body);
  return new Promise((resolve) => {
    let d = ''; let over = false;
    try {
      req.on('data', (c) => { d += c; if (d.length > max) { over = true; try { req.destroy(); } catch { /* */ } } });
      req.on('end', () => { if (over) return resolve(null); try { resolve(d ? JSON.parse(d) : {}); } catch { resolve(null); } });
      req.on('error', () => resolve(null));
    } catch { resolve(null); }
  });
}

/**
 * An HTTP surface. FAILS CLOSED with no secret configured — an unauthenticated caller must never be
 * able to suppress arbitrary addresses, which would be a denial-of-service against our own list.
 */
export function createBounceWebhook({ secret = null, suppress = null, count = null } = {}) {
  const sec = typeof secret === 'string' ? secret : str(process.env.HERALD_WEBHOOK_SECRET || '');
  function authed(req) {
    if (!sec) return false;
    const got = str((req && req.headers && (req.headers['x-webhook-secret'] || req.headers['x-herald-secret'])) || '');
    const a = Buffer.from(got); const b = Buffer.from(sec);
    if (a.length !== b.length) return false;
    try { return timingSafeEqual(a, b); } catch { return false; }
  }
  async function handler(req, res) {
    try {
      const method = str((req && req.method) || 'GET').toUpperCase();
      if (method !== 'POST') {
        return sendJson(res, 200, {
          ok: true, service: 'herald-bounce-webhook',
          accepts: ['resend (email.bounced / email.complained)', 'postmark (RecordType)', 'ses via sns (Message JSON string)', 'flat { type, email }'],
          configured: !!sec, failsClosed: true,
          note: 'Gmail does not POST webhooks — bounces on the live Gmail route arrive as messages in '
              + 'the mailbox and are NOT read by anything yet.',
        });
      }
      if (!authed(req)) return sendJson(res, 401, { ok: false, error: 'unauthorized' });
      const body = await readJsonBody(req);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { ok: false, error: 'bad-body' });
      const { provider, events } = normalizeWebhook(body);
      const r = applyEvents(events, { suppress, count });
      return sendJson(res, 200, { ok: true, provider, events: events.length, ...r.counts });
    } catch { return sendJson(res, 500, { ok: false, error: 'error' }); }
  }
  return { handler, normalizeWebhook, applyEvents };
}

export const handler = (req, res) => createBounceWebhook().handler(req, res);

export default { normalizeWebhook, applyEvents, createBounceWebhook, handler, ACTIONABLE };
