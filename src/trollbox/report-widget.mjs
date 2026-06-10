// report-widget.mjs — the condenser's "Report / Flag" control (Task #300, front-end half).
//
// The repo-controlled UI piece that the condenser mounts on a post / comment / account to let a
// reader flag it. It is framework-free (plain DOM), so the condenser can drop it next to a post's
// action bar, and it POSTs to the REAL moderation endpoint (signup/server.mjs POST /api/report),
// which writes to the append-only moderation store. No alert(), no console.log, no dead handler.
//
// HONEST UX (POLICY.md §1/§7): the control says what a report actually is — "this goes to a human for
// review", NOT "this removes the content". A report is not a delete/punish button.
//
// CUSTODY: zero keys. It only sends { target, kind, reason, reporter } to the report endpoint. The
// reporter id is optional (the logged-in condenser account, if any) and is NOT auth — it's used for
// dedup + rate-limit only.
//
// Exports:
//   esc(s)                          HTML-escape (same shape as the rest of the repo)
//   REPORT_KINDS                    the categories the menu offers (mirrors moderation-flags.mjs)
//   submitReport({target,kind,...}) -> Promise<{ok, ...}>   POSTs to the endpoint (injectable fetch)
//   reportFormHtml({target})        -> string   the form markup (escaped)
//   mountReportWidget(root, opts)   browser wiring (guarded; importing has no side effects)
//   __setFetch(fn) / __setBase(url) test injection

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
));

// Mirror the server's REPORT_KINDS so the menu and the store agree. (Kept inline rather than imported
// so this stays a pure browser module with no node-only deps.)
export const REPORT_KINDS = ['spam', 'abuse', 'scam', 'impersonation', 'illegal', 'other'];
const KIND_LABEL = {
  spam: 'Spam', abuse: 'Abuse / harassment', scam: 'Scam / fraud',
  impersonation: 'Impersonation', illegal: 'Illegal content', other: 'Other',
};

// The report endpoint base. Defaults to same-origin (''), so a relative '/api/report' works on the
// condenser; override for a cross-origin signup host.
let _base = '';
export function __setBase(url) { _base = (url || '').replace(/\/$/, ''); }

let _fetch = (...a) => globalThis.fetch(...a);
export function __setFetch(fn) { _fetch = fn || ((...a) => globalThis.fetch(...a)); }

/**
 * POST a report to the real endpoint. Soft-fails to a shaped object (never throws) so the UI can show
 * a friendly message regardless. Returns the server JSON ({ ok, id, status, deduped, message } or
 * { ok:false, reason }).
 */
export async function submitReport({ target, kind = 'other', reason = '', reporter = '' } = {}) {
  if (!target) return { ok: false, reason: 'missing-target' };
  try {
    const r = await _fetch(`${_base}/api/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ target, kind, reason, reporter }),
    });
    const j = await r.json().catch(() => null);
    if (!j) return { ok: false, reason: 'bad-response' };
    return j;
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

/** The report form markup. `target` is shown read-only so the reporter sees what they're flagging. */
export function reportFormHtml({ target } = {}) {
  const opts = REPORT_KINDS.map((k) => `<option value="${esc(k)}">${esc(KIND_LABEL[k] || k)}</option>`).join('');
  return [
    `<form class="report-form" data-target="${esc(target)}">`,
    `<p class="report-what">Reporting: <code>${esc(target)}</code></p>`,
    `<label>Why? <select class="report-kind" name="kind">${opts}</select></label>`,
    `<label>Details (optional) <textarea class="report-reason" name="reason" maxlength="2000" rows="2"></textarea></label>`,
    `<p class="report-note muted small">This goes to a moderator for review — it does not remove the post. False or mass reporting is itself against the rules.</p>`,
    `<p><button type="submit" class="report-submit">Send report</button> `,
    `<button type="button" class="report-cancel">Cancel</button></p>`,
    `<div class="report-result" role="status"></div>`,
    `</form>`,
  ].join('\n');
}

/**
 * Wire a report widget. `root` holds (or becomes) the form; opts:
 *   - target   REQUIRED: what's being reported (e.g. '@author/permlink')
 *   - reporter optional logged-in account name
 *   - onClose  optional callback when Cancel is pressed / a report succeeds
 *   - doc      injectable document (tests)
 * Returns true if wired, false if it couldn't (missing root/target).
 */
export function mountReportWidget(root, { target, reporter = '', onClose, doc } = {}) {
  const d = doc || (typeof document !== 'undefined' ? document : null);
  if (!root || !d || !target) return false;
  root.innerHTML = reportFormHtml({ target });
  const form = root.querySelector('.report-form');
  const result = root.querySelector('.report-result');
  const submitBtn = root.querySelector('.report-submit');
  const cancelBtn = root.querySelector('.report-cancel');

  if (cancelBtn) cancelBtn.addEventListener('click', () => { if (typeof onClose === 'function') onClose(); });

  if (form) {
    form.addEventListener('submit', async (e) => {
      if (e && typeof e.preventDefault === 'function') e.preventDefault();
      if (submitBtn) submitBtn.disabled = true;
      if (result) result.textContent = 'Sending…';
      const kind = (root.querySelector('.report-kind') || {}).value || 'other';
      const reason = (root.querySelector('.report-reason') || {}).value || '';
      const res = await submitReport({ target, kind, reason, reporter });
      if (res && res.ok) {
        if (result) {
          result.textContent = res.deduped
            ? 'You already reported this — thanks, it is in the moderator queue.'
            : (res.message || 'Thanks — this has been sent for review.');
        }
        if (typeof onClose === 'function') setTimeout(() => onClose(), 1500);
      } else {
        if (submitBtn) submitBtn.disabled = false;
        const why = res && res.reason === 'rate-limited'
          ? 'You are reporting a little fast — give it a moment.'
          : 'Could not send the report right now — please try again shortly.';
        if (result) result.textContent = why;
      }
    });
  }
  return true;
}

// No CLI: this is a browser module. Guarded import has no side effects (nothing runs at module load).
