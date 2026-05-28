/**
 * watcher/sinks/email.js — Resend (HTTPS) email sink.
 *
 * Enabled when RESEND_API_KEY, ALERT_EMAIL_FROM, ALERT_EMAIL_TO are all set.
 * Posts via the Resend Emails API:
 *   POST https://api.resend.com/emails
 *
 * Resend chosen because it's already named in SECURITY.md §3d as the
 * provider track for the future signup-help email path — one fewer
 * provider relationship for the operator to manage.
 *
 * Operator setup (one-time):
 *   1. Create a Resend account, verify the sending domain.
 *   2. Generate an API key, save as RESEND_API_KEY.
 *   3. Set ALERT_EMAIL_FROM (must be on the verified domain) and
 *      ALERT_EMAIL_TO (the operator's inbox).
 *
 * As with the Telegram sink: never throws, returns { ok, error } so failure
 * here doesn't break other sinks. The file sink remains the guaranteed-on
 * floor.
 *
 * Body is sent as plain text (Resend supports `text`; no HTML needed for
 * an operator-only alert).
 */

export const name = 'email';

export function enabled(config) {
  const e = config?.sinks?.email;
  return Boolean(e?.apiKey && e?.from && e?.to);
}

export async function send(event, alert, config, { fetchImpl } = {}) {
  const { apiKey, from, to } = config.sinks.email;
  const doFetch = fetchImpl || globalThis.fetch;
  if (!doFetch) {
    return { ok: false, error: 'no fetch available (Node 18+ or pass fetchImpl)' };
  }
  try {
    const res = await doFetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to: Array.isArray(to) ? to : [to],
        subject: alert.subject,
        text: alert.body,
      }),
    });
    if (!res.ok) {
      return { ok: false, error: `resend HTTP ${res.status}` };
    }
    return { ok: true, info: { status: res.status } };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}
