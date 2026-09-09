// batch-runner — the thing that stood between a finished list and a first send: nothing in this repo
// sends more than one message per button click.
//
// WHAT THIS IS. Given a campaign, it produces the ordered batch for one day: who is written to, in
// what order, with the exact rendered message, and — for everybody left out — the reason. It runs
// compliance.mjs's warmup ramp and checkSend() gate, which have existed and been tested for months
// and have never once been called by a live path.
//
// WHAT IT WILL NOT DO. Plan is the default and send is opt-in twice over: `send: true` AND an
// injected `sender`. There is no built-in transport, no fetch, no import of a mailbox. Called the
// ordinary way it returns a plan and touches nothing, which is what makes it safe to run against the
// real campaign while deciding whether to run it for real.
//
// THE CAP IS A CEILING, NOT A TARGET. warmupCap(day) says 10 on day one. 852 messages from a mailbox
// that has never cold-sent is a spam signal by itself, and it is not recoverable in a week.

import { warmupCap, checkSend, deliverabilityHealth } from './compliance.mjs';

const str = (v) => String(v == null ? '' : v).trim();
const low = (v) => str(v).toLowerCase();
const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

/** Stages that mean "already handled" — none of them belongs in a first-touch batch. */
export const NOT_A_FIRST_TOUCH = Object.freeze(new Set(['contacted', 'replied', 'meeting', 'won', 'lost', 'unsubscribed']));

/**
 * Order the day's batch.
 *
 * Highest-value first, because a run cut short — a token expiry, a rate limit, a change of mind — must
 * have spent its messages on the leads worth the most, not on whoever sorted first alphabetically.
 */
export function rank(leads = []) {
  return leads.slice().sort((a, b) => (num(b.reach) - num(a.reach))
    || (num(b.score) - num(a.score))
    || low(a.email).localeCompare(low(b.email)));
}

/**
 * Plan one day of sending.
 *
 * Returns `{ ok, cap, batch, skipped, health }`. `batch` entries carry the rendered subject and body
 * so a human can read the actual messages before anything is sent — which is the point.
 */

/**
 * Why an address cannot be delivered to, or null if it looks deliverable.
 *
 * Deliberately CONSERVATIVE: this rejects only what is structurally impossible or unambiguously
 * machine-generated. It is not a spam filter and it is not a guess about whether a person reads the
 * inbox — a false positive here silently drops a real recipient, which is worse than a bounce.
 */
export function addressProblem(email) {
  const e = String(email == null ? '' : email).trim().toLowerCase();
  if (!e) return 'no email';
  const at = e.lastIndexOf('@');
  const local = e.slice(0, at);
  const domain = e.slice(at + 1);
  // RFC-ish, and deliberately not the full grammar — the full grammar accepts things no MTA will.
  if (!/^[a-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[a-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/.test(local)) {
    return 'local-part is not a deliverable address';
  }
  // ⚠️ NOT a length rule. `x@gmail.com` is a perfectly deliverable address and an earlier draft of
  // this function rejected it — a false positive here silently drops a real person, which is worse
  // than the bounce it was trying to avoid. Only punctuation-only local-parts are impossible.
  if (/^[-._]+$/.test(local)) return 'degenerate local-part — this would hard-bounce';
  if (!/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(domain)) return 'domain has no valid TLD — this would hard-bounce';
  // A 24+ hex local-part is a machine identifier, not a person. Sending to one earns a complaint and
  // reaches nobody.
  if (/^[0-9a-f]{24,}$/.test(local)) return 'hash local-part — machine-generated, not a person';
  return null;
}

export function planDay({
  leads = [], render = null, warmupDay = 0, warmup = {}, suppression = null,
  postalAddress = '', unsubscribeUrl = '', senderName = '', region = 'US',
  sent = 0, bounces = 0, complaints = 0, limit = 0,
} = {}) {
  const health = deliverabilityHealth({ sent, bounces, complaints });
  const cap = Math.max(0, limit > 0 ? Math.min(limit, warmupCap(warmupDay, warmup)) : warmupCap(warmupDay, warmup));
  const batch = []; const skipped = [];
  const sup = suppression instanceof Set ? suppression
    : new Set((Array.isArray(suppression) ? suppression : []).map(low));
  const seen = new Set();

  for (const lead of rank(leads)) {
    const email = low(lead.email);
    const skip = (why) => skipped.push({ id: lead.id, email, why });
    if (!email || !email.includes('@')) { skip('no email'); continue; }
    // ⚠️ `.includes('@')` is not a validity check. The live holder list contains `-@be.annes.trinkets`
    // — degenerate local-part, no valid TLD — and it sorted into the FIRST BATCH OF TEN, because junk
    // addresses sort high. Two bad rows out of 829 is 0.24% overall and 10–20% of day one, at exactly
    // the moment a warming domain cannot absorb a bounce. Reject them here, where the day is planned,
    // rather than discovering them from a bounce webhook after the reputation damage is done.
    const undeliverable = addressProblem(email);
    if (undeliverable) { skip(undeliverable); continue; }
    if (seen.has(email)) { skip('the same address is already in this batch'); continue; }
    if (NOT_A_FIRST_TOUCH.has(low(lead.stage))) { skip(`stage is ${low(lead.stage)} — not a first touch`); continue; }

    const gate = checkSend({
      channel: 'email', region, senderName, postalAddress, unsubscribeUrl,
      recipient: email, suppression: sup, health,
    });
    if (!gate.ok) { skip(gate.blockers.join('; ')); continue; }

    let msg = { subject: '', body: '', ok: true };
    if (render) {
      try { msg = render(lead) || { ok: false, reason: 'render returned nothing' }; }
      catch (e) { msg = { ok: false, reason: str(e && e.message) || 'render threw' }; }
    }
    if (msg.ok === false) { skip(msg.reason || 'the message did not render'); continue; }

    seen.add(email);
    if (batch.length >= cap) { skip(`over the day's cap of ${cap}`); continue; }
    batch.push({
      id: lead.id, email, name: str(lead.name),
      subject: str(msg.subject), body: str(msg.body),
      headers: gate.headers, footer: gate.footer,
    });
  }

  return {
    ok: health.status !== 'stop' && batch.length > 0,
    cap, warmupDay, health,
    batch, skipped,
    counts: { eligible: batch.length, skipped: skipped.length, offered: leads.length },
    note: health.status === 'stop'
      ? `deliverability is in STOP (${health.reasons.join('; ')}) — nothing should be sent today`
      : `${batch.length} of ${leads.length} would be written to today; the cap is ${cap}`,
  };
}

/**
 * Run a planned batch. Refuses unless BOTH `send: true` and a `sender` were passed — a plan is what
 * you get otherwise, and a plan is what almost every caller wants.
 *
 * `sender(entry)` returns `{ ok, id?, reason? }`. Nothing here knows what a mailbox is.
 */
export async function runDay(plan = {}, { send = false, sender = null, onSent = null, stopAfterFailures = 3 } = {}) {
  if (!send || typeof sender !== 'function') {
    return {
      sent: 0, failed: 0, dryRun: true, results: [],
      reason: 'dry run — pass { send: true, sender } to actually send. This is the default on purpose',
    };
  }
  if (!plan.ok) return { sent: 0, failed: 0, dryRun: false, results: [], reason: plan.note || 'the plan says not to send' };
  const results = []; let sent = 0; let failed = 0; let consecutive = 0;
  for (const entry of plan.batch || []) {
    let r;
    try { r = await sender(entry); } catch (e) { r = { ok: false, reason: str(e && e.message) || 'sender threw' }; }
    const okr = !!(r && r.ok);
    results.push({ id: entry.id, email: entry.email, ok: okr, reason: okr ? '' : str(r && r.reason) });
    if (okr) { sent += 1; consecutive = 0; if (onSent) { try { await onSent(entry, r); } catch { /* bookkeeping is not the send */ } } }
    else {
      failed += 1; consecutive += 1;
      // Three refusals in a row is a configuration fault, not three unlucky addresses. Stopping costs
      // a few sends; continuing costs the sending reputation.
      if (consecutive >= stopAfterFailures) {
        return { sent, failed, dryRun: false, results, stoppedEarly: true, reason: `${consecutive} sends failed in a row — stopping rather than burning the mailbox` };
      }
    }
  }
  return { sent, failed, dryRun: false, results, reason: '' };
}

/** The whole ramp, so the operator can see the schedule before starting rather than after. */
export function rampSchedule(days = 14, warmup = {}) {
  const out = []; let total = 0;
  for (let d = 0; d < Math.max(1, num(days, 14)); d += 1) {
    const c = warmupCap(d, warmup); total += c;
    out.push({ day: d + 1, cap: c, cumulative: total });
  }
  return out;
}

export function handler(req, res) {
  res.statusCode = 200;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({
    ok: true, service: 'herald-batch-runner',
    defaults: { dryRun: true, stopAfterFailures: 3 },
    ramp: rampSchedule(14),
    note: 'plans a day of sending against the warmup ramp and the compliance gate. Sending requires '
        + 'both send:true and an injected sender; there is no transport in this module.',
  }, null, 2));
}

export default { planDay, runDay, rank, rampSchedule, NOT_A_FIRST_TOUCH, handler };

if (process.argv[1] && process.argv[1].endsWith('batch-runner.mjs')) {
  console.log(JSON.stringify({ ramp: rampSchedule(Number(process.argv[2]) || 14) }, null, 1));
}
