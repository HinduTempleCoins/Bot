// pentecaust/herald/compliance.mjs — Herald COMPLIANCE-AS-CODE + DELIVERABILITY substrate.
// The layer that makes outbound not-fail: warmup ramp + per-inbox caps + bounce/complaint auto-throttle,
// CAN-SPAM/GDPR/CASL footer + RFC-8058 one-click unsubscribe, and a HARD TCPA gate on AI-voice/SMS.
// Pure, deterministic, offline — no network, no keys. Plugs into campaign-sender.mjs before every send.
//   import { checkSend, warmupCap, deliverabilityHealth, listUnsubscribeHeaders, complianceFooter, assertVoiceConsent } from './compliance.mjs'
//
// House rules: ESM, esc() all interpolation, soft-fail (never throw), unit-testable.

export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const num = (v, d = 0) => { const n = Number(v); return Number.isFinite(n) ? n : d; };

// ── DELIVERABILITY: warmup ramp + caps ──────────────────────────────────────────────────────────────────
// Ramp a new inbox from `start`/day to `max`/day linearly over `rampDays`. dayIndex 0 = first day.
export function warmupCap(dayIndex, { start = 10, max = 50, rampDays = 28 } = {}) {
  const d = Math.max(0, Math.floor(num(dayIndex)));
  const s = Math.max(1, num(start, 10)), m = Math.max(s, num(max, 50)), R = Math.max(1, num(rampDays, 28));
  if (d >= R) return m;
  return Math.round(s + ((m - s) * d) / R);
}

/** Per-inbox daily cap: established inbox sits in the 25-65 band; a new one follows the warmup ramp. */
export function perInboxCap({ warmupDay = 0, established = false, max = 50 } = {}) {
  return established ? Math.min(65, Math.max(25, num(max, 50))) : warmupCap(warmupDay, { max });
}

// The 2025-enforced thresholds (Google/Yahoo/Microsoft): complaints < 0.3%, bounces < 2%.
export const THRESHOLDS = { bounceStop: 0.02, bounceWarn: 0.015, complaintStop: 0.003, complaintWarn: 0.001 };

/** deliverabilityHealth — grade a sending domain/inbox and say whether to keep sending, throttle, or STOP. */
export function deliverabilityHealth({ sent = 0, bounces = 0, complaints = 0 } = {}) {
  const s = Math.max(0, num(sent));
  const bounceRate = s > 0 ? num(bounces) / s : 0;
  const complaintRate = s > 0 ? num(complaints) / s : 0;
  const reasons = [];
  let status = 'ok';
  if (bounceRate >= THRESHOLDS.bounceStop) { status = 'stop'; reasons.push(`bounce ${(bounceRate * 100).toFixed(2)}% ≥ 2%`); }
  else if (bounceRate >= THRESHOLDS.bounceWarn) { status = 'throttle'; reasons.push(`bounce ${(bounceRate * 100).toFixed(2)}% approaching 2%`); }
  if (complaintRate >= THRESHOLDS.complaintStop) { status = 'stop'; reasons.push(`complaints ${(complaintRate * 100).toFixed(3)}% ≥ 0.3%`); }
  else if (complaintRate >= THRESHOLDS.complaintWarn && status === 'ok') { status = 'throttle'; reasons.push(`complaints ${(complaintRate * 100).toFixed(3)}% approaching 0.3%`); }
  return { bounceRate: Math.round(bounceRate * 1e5) / 1e5, complaintRate: Math.round(complaintRate * 1e5) / 1e5, status, reasons };
}

// ── RFC 8058 — one-click unsubscribe headers (required for bulk since 2024) ──────────────────────────────
export function listUnsubscribeHeaders(unsubscribeUrl, mailto) {
  const parts = [];
  if (unsubscribeUrl) parts.push(`<${String(unsubscribeUrl)}>`);
  if (mailto) parts.push(`<mailto:${String(mailto)}>`);
  if (!parts.length) return {};
  return { 'List-Unsubscribe': parts.join(', '), 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' };
}

// ── CAN-SPAM / GDPR / CASL footer — region-appropriate, escaped ──────────────────────────────────────────
export const REGIONS = ['US', 'EU', 'UK', 'CA'];
export function complianceFooter({ region = 'US', senderName = '', postalAddress = '', unsubscribeUrl = '', lawfulBasis = '', dataSource = '' } = {}) {
  const R = REGIONS.includes(String(region).toUpperCase()) ? String(region).toUpperCase() : 'US';
  const who = esc(senderName), addr = esc(postalAddress), unsub = esc(unsubscribeUrl);
  const lines = [];
  if (who) lines.push(`Sent by ${who}.`);
  if (addr) lines.push(addr);                                   // CAN-SPAM + CASL require a physical address
  if ((R === 'EU' || R === 'UK') && lawfulBasis) lines.push(`Lawful basis: ${esc(lawfulBasis)}${dataSource ? ` — source: ${esc(dataSource)}` : ''}.`);
  if (unsub) lines.push(`Unsubscribe: ${unsub}`);
  return lines.join('\n');
}

// ── TCPA hard gate — AI-generated/cloned voice + SMS require prior express consent (FCC 2024) ────────────
const CONSENT_REQUIRED_CHANNELS = new Set(['voice', 'ai-voice', 'call', 'sms', 'text', 'whatsapp']);
export function assertVoiceConsent({ channel = 'email', hasRecordedConsent = false } = {}) {
  const ch = String(channel).toLowerCase();
  if (CONSENT_REQUIRED_CHANNELS.has(ch) && !hasRecordedConsent) {
    return { ok: false, reason: `TCPA: ${ch} to this recipient requires prior express consent (FCC 2024 — AI voices are "artificial"); blocked.` };
  }
  return { ok: true };
}

// ── the pre-send gate — combine everything; returns {ok, blockers[]} ─────────────────────────────────────
export function checkSend({
  channel = 'email', region = 'US', senderName = '', postalAddress = '', unsubscribeUrl = '',
  hasRecordedConsent = false, recipient = '', suppression = null, health = null,
} = {}) {
  const blockers = [];
  const isEmail = String(channel).toLowerCase() === 'email';
  // 1) TCPA gate for non-email channels
  const voice = assertVoiceConsent({ channel, hasRecordedConsent });
  if (!voice.ok) blockers.push(voice.reason);
  // 2) suppression (bounced/unsubscribed/complained never re-enqueued)
  const sup = suppression && (typeof suppression.has === 'function' ? suppression : new Set(Array.isArray(suppression) ? suppression : []));
  if (sup && recipient && sup.has(String(recipient).toLowerCase())) blockers.push(`recipient suppressed (bounced/unsubscribed/complained)`);
  // 3) CAN-SPAM required elements for email
  if (isEmail) {
    if (!postalAddress) blockers.push('CAN-SPAM: a physical postal address is required in the footer');
    if (!unsubscribeUrl) blockers.push('CAN-SPAM / RFC 8058: a working one-click unsubscribe is required');
  }
  // 4) deliverability health — a 'stop' state blocks the send
  if (health) {
    const h = health.status ? health : deliverabilityHealth(health);
    if (h.status === 'stop') blockers.push(`deliverability STOP: ${h.reasons.join('; ')}`);
  }
  return {
    ok: blockers.length === 0,
    blockers,
    headers: isEmail ? listUnsubscribeHeaders(unsubscribeUrl, null) : {},
    footer: isEmail ? complianceFooter({ region, senderName, postalAddress, unsubscribeUrl }) : '',
  };
}
