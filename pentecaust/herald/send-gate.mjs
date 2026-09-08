// send-gate — compliance.mjs, put on the path that actually sends.
//
// WHAT WAS WRONG. `compliance.checkSend()` is the pre-send gate: TCPA, suppression, the CAN-SPAM
// required elements, and the deliverability STOP that says a domain is burning. It has one caller in
// this repo — `campaign-sender.mjs`'s `processQueue()` — behind `if (compliance)`, an opt-in that
// nothing passes. `campaign-sender.mjs` is the Resend path, and the Resend path has no subscribers
// and no runner.
//
// The path that sends is `pentecaust/server.mjs` → `POST /crm/campaigns/:id/leads/:lead/send` →
// `sendViaMailbox()` → the Gmail API, from the operator's own mailbox. Everything the gate knows was
// on the other road.
//
// THE HOLE THAT MATTERS MOST. The live route's only suppression check is
// `if (lead.stage === 'unsubscribed')` — on THAT lead row, in THAT campaign. The same person, sitting
// in a second campaign under the same address, has a second row at stage 'new' and is mailed again.
// An opt-out that one CSV import can undo is not an opt-out, and the complaint it earns is the one
// that ends a sending domain. `suppressionFrom()` reads every campaign, so an address that opted out
// anywhere is suppressed everywhere.
//
// FAIL CLOSED. With no postal address configured the gate BLOCKS. That is not an inconvenience to
// route around: a commercial message without a physical postal address violates CAN-SPAM
// 15 U.S.C. §7704(a)(5)(A)(iii), and the first message without one is already the violation. If this
// gate stops the first campaign, the gate is working — configure the address.
//
// Nothing here sends. No transport, no fetch. It answers a question and returns reasons.
//
//   import { gateSend, suppressionFrom, SUPPRESSED_STAGES } from './send-gate.mjs'

import { checkSend, deliverabilityHealth } from './compliance.mjs';
import { ledgerFor, recordSend } from './send-ledger.mjs';

export { ledgerFor, recordSend };

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();
const env = (k, d = '') => ((typeof process !== 'undefined' && process.env && process.env[k]) || d);

/**
 * Stages that mean this person is done hearing from us. `unsubscribed` is the terminal stage in
 * `crm/model.STAGES`; the other two are what a bounce/complaint webhook writes.
 */
export const SUPPRESSED_STAGES = Object.freeze(new Set(['unsubscribed', 'bounced', 'complained']));

/**
 * Every address that has opted out, bounced or complained, ACROSS EVERY CAMPAIGN.
 *
 * Pass the whole campaign list, not the one being sent from. A per-campaign suppression list is a
 * suppression list that a second import defeats.
 */
export function suppressionFrom(campaigns = [], extra = []) {
  const out = new Set((Array.isArray(extra) ? extra : []).map(low).filter(Boolean));
  for (const c of (Array.isArray(campaigns) ? campaigns : [])) {
    for (const l of ((c && c.leads) || [])) {
      const e = low(l && l.email);
      if (e && SUPPRESSED_STAGES.has(low(l.stage))) out.add(e);
    }
  }
  return out;
}

/**
 * The opt-out mechanism this path actually ships.
 *
 * There is no unsubscribe web endpoint on the Gmail route, and inventing one in a header that goes
 * nowhere would be worse than none. §7704(a)(3) wants a WORKING mechanism; a reply-to address is one,
 * RFC 2369 advertises it, and `connect/mailbox.mjs` already writes the header. So the gate checks for
 * the mechanism that exists rather than for a URL that does not.
 */
export const unsubscribeMailto = (from) => (str(from) ? `mailto:${str(from)}?subject=unsubscribe` : '');

/**
 * The pre-send gate for the live route.
 *
 * Returns `{ ok, blockers[], headers, footer, health }`. `ok:false` means do not send, and `blockers`
 * says why in words a human can act on.
 *
 * NOTE ON THE FOOTER. On the Gmail path `connect/mailbox.mjs` appends its own footer and writes its
 * own List-Unsubscribe headers, so the server route uses only `ok`/`blockers` and must NOT append
 * this one as well — two footers is worse than one. `footer`/`headers` are returned for a caller on
 * a transport that has neither (an ESP path), and for tests to assert the required elements were
 * computed at all.
 */
export function gateSend({
  channel = 'email',
  recipient = '',
  campaigns = [],
  suppression = null,
  mailboxEmail = '',
  postalAddress = null,
  senderName = null,
  region = null,
  unsubscribeUrl = null,
  hasRecordedConsent = false,
  sent = 0, bounces = 0, complaints = 0,
  ledger = null,
} = {}) {
  const addr = str(postalAddress != null ? postalAddress : env('HERALD_POSTAL_ADDRESS'));
  const who = str(senderName != null ? senderName : env('HERALD_SENDER_NAME'));
  const reg = str(region != null ? region : env('HERALD_REGION', 'US')) || 'US';
  const unsub = str(unsubscribeUrl != null ? unsubscribeUrl : unsubscribeMailto(mailboxEmail));
  const sup = suppression instanceof Set ? suppression : suppressionFrom(campaigns, suppression || []);
  // The ledger's own bounce/complaint counts beat anything a caller passed: they are what actually
  // happened on this mailbox, and a caller passing zeroes should not be able to clear a STOP.
  const L = ledger && typeof ledger === 'object' ? ledger : null;
  const health = deliverabilityHealth({
    sent: L ? L.sent : sent,
    bounces: L ? L.bounces : bounces,
    complaints: L ? L.complaints : complaints,
  });

  const gate = checkSend({
    channel, region: reg, senderName: who, postalAddress: addr, unsubscribeUrl: unsub,
    hasRecordedConsent, recipient: low(recipient), suppression: sup, health,
  });

  // ── THE WARMUP RAMP, APPLIED ────────────────────────────────────────────────────────────────────
  // compliance.warmupCap()/perInboxCap() have existed and been tested since the module was written
  // and were called by nothing outside their own tests. A mailbox that has never cold-sent may do 10
  // on day one, climbing to 50 over four weeks; 218 leads is three weeks of ramp, not an afternoon.
  //
  // The cap does NOT stop when the day's messages are spent — it stops at the message AFTER. Blocking
  // at exactly the cap is what makes the number mean something.
  const blockers = gate.blockers.slice();
  if (L && Number(L.sentToday) >= Number(L.cap)) {
    blockers.push(
      `warmup cap reached: ${L.sentToday} of ${L.cap} sent today from this mailbox `
      + `(warmup day ${L.warmupDay}). The cap is a ceiling, not a target — the rest keep until tomorrow`,
    );
  }

  return {
    ok: blockers.length === 0,
    blockers,
    headers: gate.headers,
    footer: gate.footer,
    health,
    // What was checked, so a refusal is legible and a pass is auditable.
    checked: {
      recipient: low(recipient), suppressed: sup.size, postalAddressSet: !!addr,
      unsubscribeMechanism: unsub ? 'reply-to (RFC 2369 List-Unsubscribe: mailto)' : 'none',
      region: reg, deliverability: health.status,
      warmupDay: L ? L.warmupDay : null,
      cap: L ? L.cap : null,
      sentToday: L ? L.sentToday : null,
      remainingToday: L ? Math.max(0, Number(L.cap) - Number(L.sentToday)) : null,
    },
  };
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'herald-send-gate',
    enforces: [
      'suppression across EVERY campaign, not just the one being sent from',
      'the warmup ramp: 10/day from a cold mailbox, climbing to 50 over four weeks',
      'CAN-SPAM: a physical postal address (HERALD_POSTAL_ADDRESS) — no address, no send',
      'a working opt-out mechanism (RFC 2369 List-Unsubscribe: mailto reply-to)',
      'TCPA: voice/SMS require prior express consent',
      'deliverability STOP at 2% bounces or 0.3% complaints',
    ],
    failsClosed: true,
    note: 'compliance.checkSend(), placed on the live Gmail send route. It sends nothing itself.',
  }, null, 2));
}

export default { gateSend, suppressionFrom, unsubscribeMailto, SUPPRESSED_STAGES, handler };
