/**
 * commands/audit-log.js — injectable audit wrapper around the command dispatcher.
 *
 * `wrapWithAudit(dispatch, { sink, now })` returns a drop-in replacement for
 * `dispatch(body, ctx)` (see commands/index.js) that records every invocation
 * to an injected sink before returning the underlying result unchanged.
 *
 * One audit entry per call captures:
 *   - timestamp     ISO-8601 string (from the injected `now`)
 *   - askerAccount  ctx.askerAccount, normalized to a string ('' if absent)
 *   - command       the parsed command name (null if nothing was parsed)
 *   - args          the parsed args array ([] if none / not parseable)
 *   - handled       whether dispatch handled the body
 *   - ok            the soft-fail outcome flag from dispatch (undefined → null)
 *   - error         the soft-fail error string, if any (undefined → null)
 *
 * Design rules (house style):
 *   - Injectable seams: `sink` (default in-memory ring buffer) and `now`.
 *   - Soft-fail-never-throw: a sink that throws is swallowed; dispatch result
 *     is returned regardless. The audit log is observability, never a gate.
 *   - esc()-safe: every string field is escaped on the way in, so an entry can
 *     be interpolated straight into HTML without further escaping.
 *
 * The default sink is a bounded ring buffer (so a long-running process never
 * grows unbounded). Swap it for a file/DB/HTTP sink at the call site — the
 * sink contract is just `record(entry)`.
 */

/**
 * esc — HTML-escape a value for safe interpolation. Mirrors the project esc().
 * @param {*} s
 * @returns {string}
 */
export function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * createRingSink — a bounded in-memory audit sink.
 *
 * @param {number} [capacity=500]  max entries retained; oldest dropped first.
 * @returns {{ record: (entry: object) => void, entries: () => object[], size: () => number, clear: () => void, capacity: number }}
 */
export function createRingSink(capacity = 500) {
  const cap = Number.isFinite(capacity) && capacity > 0 ? Math.floor(capacity) : 500;
  let buf = [];
  return {
    capacity: cap,
    record(entry) {
      buf.push(entry);
      if (buf.length > cap) buf = buf.slice(buf.length - cap);
    },
    entries() {
      return buf.slice();
    },
    size() {
      return buf.length;
    },
    clear() {
      buf = [];
    },
  };
}

/**
 * defaultSink — module-level shared ring buffer used when no sink is injected.
 * Callers that want isolation should pass their own `createRingSink()`.
 */
export const defaultSink = createRingSink();

/**
 * Build a single audit entry from a dispatch call. All string fields are
 * esc()-escaped so the entry is safe to drop into HTML as-is.
 *
 * @param {string} timestamp
 * @param {object} ctx
 * @param {string} body
 * @param {{handled?: boolean, command?: string, args?: string[], ok?: boolean, error?: string}} [result]
 * @returns {object}
 */
function buildEntry(timestamp, ctx, body, result = {}) {
  const askerAccount = ctx && ctx.askerAccount != null ? ctx.askerAccount : '';
  // Prefer the command/args the dispatcher actually parsed; fall back to a
  // light local parse of the body's first token so unparseable input still
  // leaves a breadcrumb.
  const command = result.command != null ? result.command : null;
  const args = Array.isArray(result.args) ? result.args : [];
  return {
    timestamp: esc(timestamp),
    askerAccount: esc(askerAccount),
    command: command == null ? null : esc(command),
    args: args.map((a) => esc(a)),
    handled: result.handled === true,
    ok: result.ok === undefined ? null : result.ok === true,
    error: result.error == null ? null : esc(result.error),
  };
}

/**
 * wrapWithAudit — wrap a dispatch function so every call is recorded.
 *
 * @param {(body: string, ctx?: object) => Promise<object>} dispatch  the dispatcher to wrap.
 * @param {object} [opts]
 * @param {{ record: (entry: object) => void }} [opts.sink]  audit sink; defaults to the shared ring buffer.
 * @param {() => (string|Date|number)} [opts.now]            clock; defaults to () => new Date().
 * @returns {(body: string, ctx?: object) => Promise<object>}  same signature as dispatch.
 */
export function wrapWithAudit(dispatch, { sink, now } = {}) {
  const theSink = sink || defaultSink;
  const clock = typeof now === 'function' ? now : () => new Date();

  return async function auditedDispatch(body, ctx = {}) {
    const result = await dispatch(body, ctx);
    // Record AFTER dispatch so we capture the real handled/ok/error outcome.
    // Never let auditing alter or block the dispatch result.
    try {
      const stamp = toIso(clock());
      const entry = buildEntry(stamp, ctx, body, result || {});
      theSink.record(entry);
    } catch {
      // Soft-fail-never-throw: a broken sink must not break command handling.
    }
    return result;
  };
}

/**
 * toIso — normalize a clock value to an ISO-8601 string. Accepts a Date, a ms
 * number, or a pre-formatted string. Never throws.
 * @param {string|Date|number} v
 * @returns {string}
 */
function toIso(v) {
  try {
    if (v instanceof Date) return v.toISOString();
    if (typeof v === 'number') return new Date(v).toISOString();
    if (typeof v === 'string') return v;
    return String(v == null ? '' : v);
  } catch {
    return '';
  }
}
