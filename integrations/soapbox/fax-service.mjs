// fax-service.mjs — THE ACTUAL FAX SERVICE.
//
// doc-services.mjs decides WHICH provider and what it costs. This one SENDS, and it is a different
// job, because fax is not HTTP. A fax does not succeed or fail when the API call returns — the API
// call only queues it. The line may be busy. The far end may answer as a voice line. The handshake
// may negotiate down to 9600 baud and time out on page four of six. Real delivery is minutes later
// and arrives asynchronously.
//
// So the shape of this module is: SUBMIT → POLL (or receive a webhook) → CAPTURE THE REPORT.
//
// ⭐ AND THE REPORT IS THE PRODUCT. The reason to fax a government office rather than email it is
// that the transmission confirmation — remote CSID, page count, duration, timestamp — is
// third-party evidence that the document arrived. A service that sends a fax and throws away the
// confirmation has delivered nothing of value here. `pollUntilFinal()` keeps it, and `receipt()`
// renders it as something that can be attached to a filing.
//
// RETRY IS NOT OPTIONAL AND IT IS NOT LINEAR. Busy is the normal outcome, not the exception —
// government fax lines are frequently single-line and in use. Carriers themselves retry, but not
// always enough. `backoffMs()` implements escalating waits because retrying a busy line in ten
// seconds just burns a page charge.
//
// No credentials stored. Injectable fetch, per house rule. Nothing reaches the network in a test.

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

const str = (s) => String(s == null ? '' : s).trim();
export const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/** Normalise to E.164-ish. Fax numbers arrive in every format a human can type. */
export function normalizeFax(n, { defaultCountry = '1' } = {}) {
  const raw = str(n);
  if (!raw) return null;
  const plus = raw.startsWith('+');
  const d = raw.replace(/\D/g, '');
  if (!d) return null;
  if (plus) return d.length >= 8 ? `+${d}` : null;
  if (d.length === 10) return `+${defaultCountry}${d}`;
  if (d.length === 11 && d.startsWith('1')) return `+${d}`;
  return d.length >= 8 ? `+${d}` : null;
}

// Terminal states. Anything else means keep polling.
export const FINAL_STATES = Object.freeze(['delivered', 'failed', 'canceled']);
export const isFinal = (s) => FINAL_STATES.includes(str(s).toLowerCase());

/**
 * Escalating backoff. Busy lines clear on the order of minutes, not seconds.
 * 1m, 5m, 15m, 45m, then hourly — capped.
 */
export function backoffMs(attempt) {
  const ladder = [60e3, 300e3, 900e3, 2700e3];
  const i = Math.max(0, Math.floor(attempt));
  return i < ladder.length ? ladder[i] : 3600e3;
}

// ── provider adapters ─────────────────────────────────────────────────────────────────
// Each returns a plain { url, method, headers, body } so the transport is one shared fetch and
// the per-provider knowledge stays declarative and testable.

export const ADAPTERS = Object.freeze({
  telnyx: {
    id: 'telnyx',
    submit: ({ to, from, mediaUrl, credentials, options = {} }) => ({
      url: 'https://api.telnyx.com/v2/faxes',
      method: 'POST',
      headers: { authorization: `Bearer ${credentials.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        connection_id: credentials.connectionId, to, from, media_url: mediaUrl,
        quality: options.quality || 'high',
        // A cover page defeats the point when the report is the evidence: fewer moving parts.
        store_media: true,
      }),
    }),
    status: ({ id, credentials }) => ({
      url: `https://api.telnyx.com/v2/faxes/${encodeURIComponent(id)}`,
      method: 'GET', headers: { authorization: `Bearer ${credentials.apiKey}` },
    }),
    parseSubmit: (j) => ({ id: j?.data?.id || null, status: j?.data?.status || 'queued' }),
    parseStatus: (j) => ({
      status: str(j?.data?.status).toLowerCase() || 'unknown',
      pages: j?.data?.page_count ?? null,
      failureReason: j?.data?.failure_reason || null,
      completedAt: j?.data?.completed_at || null,
    }),
    requires: ['apiKey', 'connectionId'],
  },

  clicksend: {
    id: 'clicksend',
    submit: ({ to, from, mediaUrl, credentials }) => ({
      url: 'https://rest.clicksend.com/v3/fax/send',
      method: 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64'),
        'content-type': 'application/json',
      },
      body: JSON.stringify({ file_url: mediaUrl, messages: [{ to, from }] }),
    }),
    status: ({ id, credentials }) => ({
      url: `https://rest.clicksend.com/v3/fax/receipts/${encodeURIComponent(id)}`,
      method: 'GET',
      headers: { authorization: 'Basic ' + Buffer.from(`${credentials.username}:${credentials.apiKey}`).toString('base64') },
    }),
    parseSubmit: (j) => ({ id: j?.data?.messages?.[0]?.message_id || null, status: 'queued' }),
    parseStatus: (j) => ({
      status: str(j?.data?.status).toLowerCase() || 'unknown',
      pages: j?.data?.pages ?? null, failureReason: j?.data?.error_text || null,
      completedAt: j?.data?.date_updated || null,
    }),
    requires: ['username', 'apiKey'],
  },

  phaxio: {
    id: 'phaxio',
    submit: ({ to, mediaUrl, credentials }) => ({
      url: 'https://api.phaxio.com/v2.1/faxes',
      method: 'POST',
      headers: {
        authorization: 'Basic ' + Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64'),
        'content-type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ to, content_url: mediaUrl }).toString(),
    }),
    status: ({ id, credentials }) => ({
      url: `https://api.phaxio.com/v2.1/faxes/${encodeURIComponent(id)}`,
      method: 'GET',
      headers: { authorization: 'Basic ' + Buffer.from(`${credentials.apiKey}:${credentials.apiSecret}`).toString('base64') },
    }),
    parseSubmit: (j) => ({ id: j?.data?.id ? String(j.data.id) : null, status: 'queued' }),
    parseStatus: (j) => ({
      status: str(j?.data?.status).toLowerCase() || 'unknown',
      pages: j?.data?.num_pages ?? null, failureReason: j?.data?.error_message || null,
      completedAt: j?.data?.completed_at || null,
    }),
    requires: ['apiKey', 'apiSecret'],
  },
});

export const adapter = (id) => ADAPTERS[str(id).toLowerCase()] || null;

/** Are the credentials for this provider complete? Names the missing field. */
export function checkCredentials(providerId, credentials = {}) {
  const a = adapter(providerId);
  if (!a) return { ok: false, reason: `unknown provider: ${str(providerId)}` };
  const missing = a.requires.filter((k) => !str(credentials[k]));
  return missing.length
    ? { ok: false, reason: `missing credential: ${missing.join(', ')}` }
    : { ok: true, reason: null };
}

/** Submit. Returns the provider's job id — NOT a delivery confirmation. */
export async function submitFax({ providerId, to, from, mediaUrl, credentials = {}, options = {} } = {}) {
  const a = adapter(providerId);
  if (!a) return { ok: false, stage: 'provider', reason: `unknown provider: ${str(providerId)}` };
  const cred = checkCredentials(providerId, credentials);
  if (!cred.ok) return { ok: false, stage: 'credentials', reason: cred.reason };
  const dest = normalizeFax(to);
  if (!dest) return { ok: false, stage: 'number', reason: `not a usable fax number: ${str(to)}` };
  if (!str(mediaUrl)) return { ok: false, stage: 'media', reason: 'mediaUrl is required' };

  const req = a.submit({ to: dest, from: normalizeFax(from) || undefined, mediaUrl, credentials, options });
  try {
    const res = await _fetch(req.url, { method: req.method, headers: req.headers, body: req.body });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch { /* keep raw */ }
    if (!res.ok) {
      return { ok: false, stage: 'submit', status: res.status, to: dest,
        reason: (j && (j.errors?.[0]?.detail || j.error)) || text.slice(0, 200),
        retryable: res.status === 429 || res.status >= 500 };
    }
    const p = a.parseSubmit(j || {});
    if (!p.id) return { ok: false, stage: 'submit', to: dest, reason: 'provider returned no job id' };
    return { ok: true, provider: a.id, id: p.id, status: p.status, to: dest, submittedAt: new Date().toISOString() };
  } catch (e) {
    const msg = String((e && e.message) || e);
    return { ok: false, stage: 'submit', to: dest, reason: msg, retryable: true };
  }
}

/** One status check. */
export async function checkStatus({ providerId, id, credentials = {} } = {}) {
  const a = adapter(providerId);
  if (!a) return { ok: false, reason: `unknown provider: ${str(providerId)}` };
  if (!str(id)) return { ok: false, reason: 'no fax id' };
  const req = a.status({ id, credentials });
  try {
    const res = await _fetch(req.url, { method: req.method, headers: req.headers });
    const text = await res.text();
    let j = null; try { j = JSON.parse(text); } catch { /* keep raw */ }
    if (!res.ok) return { ok: false, reason: `status ${res.status}`, retryable: res.status >= 500 };
    const p = a.parseStatus(j || {});
    return { ok: true, ...p, final: isFinal(p.status) };
  } catch (e) {
    return { ok: false, reason: String((e && e.message) || e), retryable: true };
  }
}

/**
 * ⭐ Poll to a terminal state and KEEP THE REPORT. `sleep` is injected so a test runs instantly and
 * so a caller can drive this from a queue rather than holding a process open for forty minutes.
 */
export async function pollUntilFinal({ providerId, id, credentials = {}, maxChecks = 12,
  sleep = async () => {}, intervalMs = 30e3 } = {}) {
  const history = [];
  for (let i = 0; i < Math.max(1, maxChecks); i += 1) {
    const s = await checkStatus({ providerId, id, credentials });
    history.push({ at: new Date().toISOString(), ...s });
    if (s.ok && s.final) {
      return { ok: true, final: true, status: s.status, pages: s.pages,
        failureReason: s.failureReason, completedAt: s.completedAt, checks: history.length, history };
    }
    if (i < maxChecks - 1) await sleep(intervalMs);
  }
  const last = history[history.length - 1] || {};
  return { ok: true, final: false, status: last.status || 'unknown',
    reason: 'did not reach a terminal state within the check budget', checks: history.length, history };
}

/**
 * Submit, then poll, then retry a BUSY line on escalating backoff.
 * Returns a full record — every attempt, with its reason. That record is the evidence.
 */
export async function sendWithRetry({ providerId, to, from, mediaUrl, credentials = {},
  maxAttempts = 4, sleep = async () => {}, pollOpts = {} } = {}) {
  const attempts = [];
  for (let n = 0; n < Math.max(1, maxAttempts); n += 1) {
    const sub = await submitFax({ providerId, to, from, mediaUrl, credentials });
    if (!sub.ok) {
      attempts.push({ attempt: n + 1, stage: sub.stage, reason: sub.reason });
      if (!sub.retryable) return { ok: false, attempts, reason: sub.reason, stage: sub.stage };
      await sleep(backoffMs(n)); continue;
    }
    const poll = await pollUntilFinal({ providerId, id: sub.id, credentials, sleep, ...pollOpts });
    attempts.push({ attempt: n + 1, id: sub.id, status: poll.status,
      pages: poll.pages, failureReason: poll.failureReason, final: poll.final });
    if (poll.final && poll.status === 'delivered') {
      return { ok: true, delivered: true, provider: providerId, id: sub.id, to: sub.to,
        pages: poll.pages, completedAt: poll.completedAt, attempts };
    }
    const busy = /busy|no.?answer|noanswer/i.test(str(poll.failureReason));
    if (!busy && poll.final) {
      return { ok: false, delivered: false, reason: poll.failureReason || poll.status, attempts };
    }
    if (n < maxAttempts - 1) await sleep(backoffMs(n));
  }
  return { ok: false, delivered: false, reason: 'exhausted attempts', attempts };
}

/** ⭐ The artifact worth keeping — renders as something attachable to a filing. */
export function receipt(result, { to, subject = '', sentBy = '' } = {}) {
  if (!result) return '';
  const L = [];
  L.push('FAX TRANSMISSION RECORD', '======================', '');
  if (sentBy) L.push(`Sent by:      ${sentBy}`);
  L.push(`To:           ${str(to || result.to)}`);
  if (subject) L.push(`Re:           ${subject}`);
  L.push(`Provider:     ${str(result.provider)}`);
  if (result.id) L.push(`Job ID:       ${str(result.id)}`);
  L.push(`Delivered:    ${result.delivered ? 'YES' : 'NO'}`);
  if (result.pages != null) L.push(`Pages:        ${result.pages}`);
  if (result.completedAt) L.push(`Completed:    ${str(result.completedAt)}`);
  if (!result.delivered && result.reason) L.push(`Failure:      ${str(result.reason)}`);
  if (result.attempts && result.attempts.length) {
    L.push('', 'ATTEMPTS');
    for (const a of result.attempts) {
      L.push(`  ${a.attempt}. ${str(a.status || a.stage)}`
        + `${a.pages != null ? ` — ${a.pages}pp` : ''}`
        + `${a.failureReason || a.reason ? ` — ${str(a.failureReason || a.reason)}` : ''}`);
    }
  }
  L.push('', 'This record was generated by the sending service. Where a transmission report is',
         'required as proof of delivery, retain the provider-side confirmation as well.');
  return L.join('\n');
}

export function handler(req, res) {
  const send = (code, obj) => {
    res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj, null, 2));
  };
  try {
    return send(200, {
      module: 'fax-service',
      shape: 'submit -> poll -> capture the report',
      why: 'a fax does not succeed when the API call returns — that only queues it. Busy lines are '
         + 'the normal outcome for government single-line fax, so retry is escalating, not linear.',
      providers: Object.values(ADAPTERS).map((a) => ({ id: a.id, requires: a.requires })),
      finalStates: FINAL_STATES,
      backoffLadderMs: [0, 1, 2, 3, 4].map(backoffMs),
      rules: ['no credentials stored', 'injectable fetch — nothing reaches the network in a test',
              'the transmission report is retained, because it is the evidence'],
    });
  } catch (e) { return send(500, { error: String((e && e.message) || e) }); }
}

if (process.argv[1] && process.argv[1].endsWith('fax-service.mjs')) {
  console.log('providers:', Object.keys(ADAPTERS).join(', '));
  console.log('backoff:', [0, 1, 2, 3, 4].map((i) => `${backoffMs(i) / 60000}m`).join(' -> '));
  console.log('normalize:', normalizeFax('(214) 653-7481'), normalizeFax('512.936.7554'));
}
