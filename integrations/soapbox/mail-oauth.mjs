// mail-oauth.mjs — SEND AS THE USER, NOT AS US.
//
// The whole records-request product falls over without this, and it falls over in a specific way
// I watched happen: sixty-five requests went out through one mailbox tonight and the provider
// closed the connection after twelve. Batching with reconnects got the rest through, but that is
// a workaround for the wrong architecture.
//
// A shared sender is wrong for three separate reasons, and only one of them is deliverability:
//
//   1. ATTRIBUTION. A Public Information Act request is made BY A PERSON. Under Tex. Gov't Code
//      § 552.023 a requester's special right of access is personal to them — it is their record
//      they are entitled to. A request arriving from someone else's address is not obviously
//      theirs, and an agency that wants to stall has been handed the reason.
//   2. THE REPLY. Agencies reply to the sender. If we send, the answer comes to us, and the person
//      whose case it is has to be forwarded their own records.
//   3. THE BOUNCE. An NDR is evidence — a delivery failure from a government mail system is a
//      fact about that system. It belongs in the requester's own mailbox, timestamped, where it is
//      theirs to produce.
//
// SO: this module never holds a credential. It takes a token-getter by injection and a transport by
// injection, and it is the caller's job to have obtained consent. `send()` with no transport does
// nothing and says so — there is no default that quietly reaches the network.
//
// WHAT IT ACTUALLY KNOWS. Provider quirks that cost real time to discover: per-provider daily
// caps, the observed consecutive-send ceiling before a connection is dropped, the scope each
// provider needs, and whether refresh tokens expire. `planBatches()` turns those into a send plan
// instead of leaving the caller to find the ceiling the way I found Yahoo's.

const str = (s) => String(s == null ? '' : s).trim();

export const PROVIDERS = Object.freeze({
  gmail: {
    id: 'gmail', label: 'Gmail / Google Workspace',
    kind: 'api', endpoint: 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    scopes: ['https://www.googleapis.com/auth/gmail.send'],
    // Google publishes different caps for consumer and Workspace accounts.
    dailyCap: { consumer: 500, workspace: 2000 },
    consecutive: 50,      // conservative; the API does not drop connections the way SMTP does
    pauseMs: 1200,
    refreshExpires: false, // a Google refresh token persists unless revoked or unused ~6 months
    note: 'Consumer Gmail is capped far lower than Workspace. A records campaign of any size '
        + 'should assume the consumer number unless the account is known to be Workspace.',
  },
  microsoft: {
    id: 'microsoft', label: 'Outlook / Microsoft 365',
    kind: 'api', endpoint: 'https://graph.microsoft.com/v1.0/me/sendMail',
    scopes: ['Mail.Send'],
    dailyCap: { consumer: 300, workspace: 10000 },
    consecutive: 30, pauseMs: 1500, refreshExpires: true,
    note: 'Graph refresh tokens roll and can expire; re-consent must be handled, not assumed.',
  },
  yahoo: {
    id: 'yahoo', label: 'Yahoo Mail',
    kind: 'smtp', endpoint: 'smtp.mail.yahoo.com:465',
    scopes: ['mail-w'],
    dailyCap: { consumer: 500, workspace: 500 },
    // ⚠️ OBSERVED, not documented: the connection was closed after ~12 consecutive sends.
    consecutive: 8, pauseMs: 1500, refreshExpires: true,
    note: 'OBSERVED IN PRACTICE: the SMTP connection is dropped after roughly a dozen consecutive '
        + 'messages. Batch small and RECONNECT between batches. App passwords work but are a '
        + 'shared secret; OAuth is preferable where the account supports it.',
  },
  smtp: {
    id: 'smtp', label: 'Generic SMTP (app password)',
    kind: 'smtp', endpoint: null, scopes: [],
    dailyCap: { consumer: 200, workspace: 200 },
    consecutive: 10, pauseMs: 2000, refreshExpires: false,
    note: 'Fallback for providers without OAuth. An app password is a long-lived shared secret — '
        + 'treat it as one, and prefer OAuth wherever it exists.',
  },
});

export const provider = (id) => PROVIDERS[str(id).toLowerCase()] || null;

/**
 * A send plan. Turns a recipient list plus a provider into batches that respect the observed
 * ceiling, and says plainly when the list exceeds the daily cap rather than starting a run that
 * will fail partway.
 */
export function planBatches(recipients = [], providerId, { accountType = 'consumer' } = {}) {
  const p = provider(providerId);
  const list = [...new Set((recipients || []).map(str).filter(Boolean))];
  if (!p) return { ok: false, reason: `unknown provider: ${str(providerId)}`, batches: [] };

  const cap = p.dailyCap[accountType] ?? p.dailyCap.consumer;
  const batches = [];
  for (let i = 0; i < list.length; i += p.consecutive) {
    batches.push(list.slice(i, i + p.consecutive));
  }
  const overCap = list.length > cap;
  return {
    ok: true,
    provider: p.id,
    total: list.length,
    batches,
    batchSize: p.consecutive,
    pauseMs: p.pauseMs,
    reconnectBetweenBatches: p.kind === 'smtp',
    dailyCap: cap,
    overCap,
    warning: overCap
      ? `${list.length} recipients exceeds the ${accountType} daily cap of ${cap} for ${p.label} — `
        + 'split across days or the tail will silently fail'
      : null,
  };
}

/** Is a token usable? Returns a reason rather than a bare false, so the caller can tell the user. */
export function tokenStatus(token, nowMs = Date.now()) {
  if (!token || typeof token !== 'object') return { ok: false, reason: 'no token' };
  if (!str(token.accessToken)) return { ok: false, reason: 'no access token' };
  if (token.expiresAt != null) {
    const exp = Number(token.expiresAt);
    if (!Number.isFinite(exp)) return { ok: false, reason: 'unreadable expiry' };
    if (exp <= nowMs) {
      return str(token.refreshToken)
        ? { ok: false, reason: 'expired — refresh first', refreshable: true }
        : { ok: false, reason: 'expired and no refresh token — re-consent required' };
    }
  }
  const missing = (token.grantedScopes && token.requiredScopes)
    ? token.requiredScopes.filter((s) => !token.grantedScopes.includes(s)) : [];
  if (missing.length) return { ok: false, reason: `missing scope: ${missing.join(', ')}` };
  return { ok: true, reason: null };
}

/**
 * Build a message. Kept provider-neutral: the transport turns this into RFC822 or a Graph payload.
 * Deliberately refuses an empty recipient or subject — a records request with no subject line gets
 * lost in an agency mailbox, and that is a silent failure.
 */
export function buildMessage({ from, to, cc = [], subject, body, attachments = [] } = {}) {
  const errs = [];
  if (!str(from)) errs.push('from is required — the request must be attributable to the requester');
  if (!str(to)) errs.push('to is required');
  if (!str(subject)) errs.push('subject is required — an untitled request is lost in an agency inbox');
  if (!str(body)) errs.push('body is required');
  if (errs.length) return { ok: false, errors: errs };
  return {
    ok: true,
    message: {
      from: str(from), to: str(to),
      cc: (cc || []).map(str).filter(Boolean),
      subject: str(subject), body: str(body),
      attachments: (attachments || []).filter((a) => a && str(a.filename)),
    },
  };
}

/**
 * Send one message. `transport` is injected and MUST be provided — there is no network default,
 * so a test can never accidentally reach a real mailbox and a caller can never send by omission.
 * Soft-fails: returns a result, never throws.
 */
export async function send({ providerId, token, message, transport, nowMs = Date.now() } = {}) {
  const p = provider(providerId);
  if (!p) return { ok: false, stage: 'provider', reason: `unknown provider: ${str(providerId)}` };
  if (typeof transport !== 'function') {
    return { ok: false, stage: 'transport',
      reason: 'no transport injected — this module never sends by default' };
  }
  const ts = tokenStatus(token, nowMs);
  if (!ts.ok) return { ok: false, stage: 'token', reason: ts.reason, refreshable: !!ts.refreshable };
  if (!message || !message.to) return { ok: false, stage: 'message', reason: 'no message' };

  try {
    const res = await transport({ provider: p, token, message });
    if (res && res.ok === false) {
      return { ok: false, stage: 'send', reason: str(res.reason) || 'transport reported failure',
        retryable: !!res.retryable, to: message.to };
    }
    return { ok: true, to: message.to, id: (res && res.id) || null, provider: p.id };
  } catch (e) {
    // A dropped connection is retryable; a rejected recipient is not.
    const msg = String((e && e.message) || e);
    return { ok: false, stage: 'send', reason: msg, to: message.to,
      retryable: /closed|timeout|ECONNRESET|temporar|4\d\d/i.test(msg) };
  }
}

/**
 * Send a batch, respecting the plan. Records every outcome — a campaign log is evidence, so a
 * failure is recorded with its reason rather than dropped.
 */
export async function sendCampaign({ providerId, token, recipients = [], makeMessage,
  transport, accountType = 'consumer', sleep = null } = {}) {
  const plan = planBatches(recipients, providerId, { accountType });
  if (!plan.ok) return { ok: false, reason: plan.reason, sent: [], failed: [] };
  if (typeof makeMessage !== 'function') {
    return { ok: false, reason: 'makeMessage(recipient) is required', sent: [], failed: [] };
  }
  const wait = typeof sleep === 'function' ? sleep : async () => {};
  const sent = []; const failed = [];
  for (const batch of plan.batches) {
    for (const to of batch) {
      const built = buildMessage(makeMessage(to));
      if (!built.ok) { failed.push({ to, reason: built.errors.join('; '), stage: 'message' }); continue; }
      const r = await send({ providerId, token, message: built.message, transport });
      if (r.ok) sent.push({ to, id: r.id }); else failed.push({ to, reason: r.reason, stage: r.stage, retryable: r.retryable });
      await wait(plan.pauseMs);
    }
    if (plan.reconnectBetweenBatches) await wait(plan.pauseMs * 2);
  }
  return { ok: true, provider: plan.provider, plan: { batches: plan.batches.length, batchSize: plan.batchSize, overCap: plan.overCap, warning: plan.warning },
    sent, failed, counts: { sent: sent.length, failed: failed.length } };
}

export function handler(req, res) {
  const send_ = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj, null, 2));
  };
  try {
    return send_(200, {
      module: 'mail-oauth',
      why: 'a records request is made BY A PERSON — it must be sent from their mailbox, replies '
         + 'must reach them, and a bounce is evidence that belongs in their account',
      providers: Object.values(PROVIDERS).map((p) => ({
        id: p.id, label: p.label, kind: p.kind, scopes: p.scopes,
        consecutive: p.consecutive, dailyCap: p.dailyCap, note: p.note,
      })),
      rules: ['no credential is ever stored here',
              'no transport default — nothing sends by omission',
              'every failure is recorded with its reason'],
    });
  } catch (e) { return send_(500, { error: String((e && e.message) || e) }); }
}

if (process.argv[1] && process.argv[1].endsWith('mail-oauth.mjs')) {
  for (const p of Object.values(PROVIDERS)) {
    console.log(`${p.id.padEnd(10)} ${p.kind.padEnd(5)} batch<=${String(p.consecutive).padStart(3)}  cap ${p.dailyCap.consumer}/${p.dailyCap.workspace}`);
  }
  const plan = planBatches(Array.from({ length: 65 }, (_, i) => `m${i}@house.texas.gov`), 'yahoo');
  console.log(`\n65 recipients on yahoo -> ${plan.batches.length} batches of <=${plan.batchSize}, reconnect between: ${plan.reconnectBetweenBatches}`);
}
