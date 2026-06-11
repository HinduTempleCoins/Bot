// audit-log.mjs — Backlog d01048058f: in-memory, append-only audit log for deterministic
// !commands / bot actions. This is the "audit logs for all commands" requirement in its
// smallest honest form: a ring buffer that lives in process memory only.
//
// HARD INVARIANTS:
//   - ZERO disk, ZERO network: pure in-memory data structure, no fs/import of IO.
//   - ZERO secrets persisted: any field whose key matches `redactKeys` is replaced with
//     '[redacted]' BEFORE it is stored — key material never lands in the buffer, even if a
//     caller hands it to us by mistake.
//   - SOFT-FAIL, NEVER THROW: bad input is coerced or skipped, calls always return safely.
//   - DETERMINISTIC: no internal clock. `at` is supplied by the caller; if absent it is null.
//
// Distinct from integrations/md-audit.mjs and integrations/audit-report.mjs, which lint
// markdown / SEO. This audits *command invocations*.
//
//   import { createAuditLog, esc } from './integrations/audit-log.mjs';
//   const log = createAuditLog();
//   log.record({ actor: 'alice', command: '!signup', args: { email: 'a@b.c' }, at: 1700000000 });
//   log.entries({ command: '!signup' });   // newest-first
//   log.summary();                          // { total, byCommand, byActor }
//   log.renderTable({ html: true });        // safe table, esc() on every cell

// ── HTML escaping (exported top-level) ────────────────────────────────────────
const _ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => _ESC[c]);
}

const DEFAULT_REDACT = ['key', 'wif', 'password', 'pin', 'token', 'secret'];
const MAX_ARG_LEN = 500; // truncate over-long arg strings to keep the buffer bounded

function _toStr(v) {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  try { return String(v); } catch { return ''; }
}

// Deep-clone + redact a value. `redactSet` is a Set of lowercased key names.
function _cloneRedact(value, redactSet, depth = 0) {
  if (depth > 6) return '[truncated]'; // guard against cyclic / pathological input
  if (value == null) return value;
  const t = typeof value;
  if (t === 'string') return value.length > MAX_ARG_LEN ? value.slice(0, MAX_ARG_LEN) + '…' : value;
  if (t === 'number' || t === 'boolean') return value;
  if (t === 'bigint') return value.toString();
  if (t === 'function' || t === 'symbol') return undefined;
  if (Array.isArray(value)) {
    const out = [];
    for (const item of value) out.push(_cloneRedact(item, redactSet, depth + 1));
    return out;
  }
  if (t === 'object') {
    const out = {};
    for (const k of Object.keys(value)) {
      const lk = String(k).toLowerCase();
      // redact if the key name CONTAINS any redact token (so apiKey, user_token, etc. match)
      let hit = false;
      for (const token of redactSet) { if (lk.includes(token)) { hit = true; break; } }
      if (hit) { out[k] = '[redacted]'; continue; }
      try {
        out[k] = _cloneRedact(value[k], redactSet, depth + 1);
      } catch { out[k] = undefined; }
    }
    return out;
  }
  return undefined;
}

export function createAuditLog(opts = {}) {
  const o = (opts && typeof opts === 'object') ? opts : {};
  let capacity = Number(o.capacity);
  if (!Number.isFinite(capacity) || capacity < 1) capacity = 500;
  capacity = Math.floor(capacity);

  const redactList = Array.isArray(o.redactKeys) ? o.redactKeys : DEFAULT_REDACT;
  const redactSet = new Set(
    redactList.map((k) => _toStr(k).toLowerCase().trim()).filter((k) => k.length > 0),
  );

  /** @type {Array<object>} ring buffer, oldest-first by insertion */
  const buf = [];

  function record(entry) {
    const e = (entry && typeof entry === 'object') ? entry : {};
    const actor = _toStr(e.actor) || 'anonymous';
    const command = _toStr(e.command);
    // `at` is caller-supplied; keep number or string as-is, else null (no internal clock).
    let at = e.at;
    if (typeof at !== 'number' && typeof at !== 'string') at = null;
    if (typeof at === 'number' && !Number.isFinite(at)) at = null;

    const stored = {
      actor,
      command,
      args: _cloneRedact(e.args, redactSet),
      result: _cloneRedact(e.result, redactSet),
      at,
    };

    buf.push(stored);
    while (buf.length > capacity) buf.shift(); // drop oldest past capacity
    return stored;
  }

  function entries(filter = {}) {
    const f = (filter && typeof filter === 'object') ? filter : {};
    const fActor = f.actor != null ? _toStr(f.actor) : null;
    const fCommand = f.command != null ? _toStr(f.command) : null;
    let limit = Number(f.limit);
    if (!Number.isFinite(limit) || limit < 0) limit = Infinity;

    const out = [];
    // newest-first
    for (let i = buf.length - 1; i >= 0; i--) {
      const row = buf[i];
      if (fActor != null && row.actor !== fActor) continue;
      if (fCommand != null && row.command !== fCommand) continue;
      out.push(row);
      if (out.length >= limit) break;
    }
    return out;
  }

  function count() { return buf.length; }

  function summary() {
    const byCommand = {};
    const byActor = {};
    for (const row of buf) {
      const c = row.command || '(none)';
      const a = row.actor || 'anonymous';
      byCommand[c] = (byCommand[c] || 0) + 1;
      byActor[a] = (byActor[a] || 0) + 1;
    }
    return { total: buf.length, byCommand, byActor };
  }

  function _cell(v) {
    if (v == null) return '';
    if (typeof v === 'object') {
      try { return JSON.stringify(v); } catch { return '[unserializable]'; }
    }
    return _toStr(v);
  }

  function renderTable(render = {}) {
    const r = (render && typeof render === 'object') ? render : {};
    const html = !!r.html;
    const rows = Array.isArray(r.rows) ? r.rows : entries();
    const cols = ['at', 'actor', 'command', 'args', 'result'];

    if (html) {
      const head = cols.map((c) => `<th>${esc(c)}</th>`).join('');
      const body = rows.map((row) => {
        const tds = cols.map((c) => `<td>${esc(_cell(row[c]))}</td>`).join('');
        return `<tr>${tds}</tr>`;
      }).join('');
      return `<table><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
    }

    // markdown
    const header = `| ${cols.join(' | ')} |`;
    const divider = `| ${cols.map(() => '---').join(' | ')} |`;
    const lines = rows.map((row) => {
      // escape pipes so the table stays well-formed; esc() for any HTML interpolation downstream
      const cells = cols.map((c) => esc(_cell(row[c])).replace(/\|/g, '\\|').replace(/\n/g, ' '));
      return `| ${cells.join(' | ')} |`;
    });
    return [header, divider, ...lines].join('\n');
  }

  return { record, entries, count, summary, renderTable };
}
