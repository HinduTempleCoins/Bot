// soapy-executor.mjs — the CODESPACE side of the Soapy.Blog relay: the trusted worker.
//
// THE PATTERN (the safety is the direction of the dial):
//   This worker runs INSIDE the Codespace, where the access already exists. It holds the
//   shared bearer token and dials OUTBOUND to the relay (soapy-relay.mjs): GET /relay/pull to
//   claim the next queued job, run it, POST /relay/result. Nothing reaches INTO the Codespace —
//   there is no inbound port, no webhook, no key on the web tier. The web page can only ASK; this
//   worker decides.
//
// THE ALLOWLIST IS THE SAFETY BOUNDARY:
//   A queued job names a command. This worker runs it ONLY if it matches a vetted prefix in
//   ALLOWLIST. Everything else is DENIED by default and reported back as 'command not allowed' —
//   it is never executed. Keep ALLOWLIST to read-only / diagnostic commands. This is the line
//   between "a remote control for safe status checks" and "remote code execution"; do not widen
//   it casually.
//
//   isAllowed(cmd)      — the gate. Default DENY; allow only on an allowlist-prefix match.
//   pollOnce(opts)      — pull one job, gate it, run (injected runner) or reject, post the result.
//   loop(opts)          — pollOnce on a schedule (injected sleeper, bounded iterations for tests).
//
// Injectable for OFFLINE tests: __setFetch(fn), __setRunner(fn), __setSleeper(fn). Soft-fail:
// pollOnce NEVER throws — a network/runner failure returns a status object, it does not crash the
// worker. The token comes from env SOAPY_RELAY_TOKEN, the relay base from env SOAPY_RELAY_URL.

// ── the vetted command prefixes. Read-only / diagnostic ONLY. Widen with care. ────────────────────
export const ALLOWLIST = Object.freeze([
  'git status',
  'git log',
  'systemctl status',
  'journalctl',
  'df -h',
  'uptime',
  'curl -s http',
]);

// ── the gate: allow ONLY if cmd matches an allowlist prefix. Default DENY. ─────────────────────────
// A non-string, empty, or unmatched command is denied. Prefix match (not equality) so
// 'curl -s http' covers 'curl -s http://host/health', and 'journalctl' covers its flags.
// Shell metacharacters that could chain/escape a command if it ever reached a shell. A prefix allowlist
// alone is bypassable (`git status && curl evil`), so we HARD-REJECT any command containing these — even
// though the production runner is execFile (no shell). Defense in depth: injection can't pass this gate.
const SHELL_META = /[;&|`$(){}<>\n\r\\"']|\$\(|&&|\|\|/;
export function isAllowed(cmd, allowlist = ALLOWLIST) {
  if (typeof cmd !== 'string') return false;
  const c = cmd.trim();
  if (!c) return false;
  if (SHELL_META.test(c)) return false;                       // no chaining/subshell/redirect/quoting
  const list = Array.isArray(allowlist) ? allowlist : ALLOWLIST;
  for (const prefix of list) {
    if (typeof prefix !== 'string' || !prefix) continue;
    // allow an exact match, or the allowlisted head followed by a NON-word boundary (space, ':' , '/'…)
    // so 'curl -s http' opens 'curl -s http://x' and 'df -h' opens 'df -h /var', but 'df -h' must NOT
    // open 'df -hacked' and 'uptime' must NOT open 'uptimer'. Metachar reject above bars any chaining.
    if (c === prefix) return true;
    if (c.startsWith(prefix) && /^[^A-Za-z0-9_-]/.test(c.slice(prefix.length))) return true;
  }
  return false;
}

// ── injectable fetch (default global fetch; tests inject a fake) ───────────────────────────────────
let _fetch = (...a) => (globalThis.fetch ? globalThis.fetch(...a) : Promise.reject(new Error('no fetch')));
export function __setFetch(fn) { _fetch = typeof fn === 'function' ? fn : ((...a) => (globalThis.fetch ? globalThis.fetch(...a) : Promise.reject(new Error('no fetch')))); }

// ── injectable runner. runner(cmd, args) -> result (string/obj). NO default that shells out —
// production wires an execFile-based runner; with none, every command soft-fails as 'no-runner'. ───
let _runner = async () => { throw new Error('no-runner'); };
export function __setRunner(fn) { _runner = typeof fn === 'function' ? fn : (async () => { throw new Error('no-runner'); }); }

// ── injectable sleeper (loop pacing; tests pass an instant no-op) ─────────────────────────────────
let _sleeper = (ms) => new Promise((r) => setTimeout(r, ms));
export function __setSleeper(fn) { _sleeper = typeof fn === 'function' ? fn : ((ms) => new Promise((r) => setTimeout(r, ms))); }

function relayUrl(opts = {}) {
  return String(opts.url || process.env.SOAPY_RELAY_URL || 'http://127.0.0.1:8150').replace(/\/+$/, '');
}
function relayToken(opts = {}) {
  return opts.token || process.env.SOAPY_RELAY_TOKEN || '';
}
function authHeaders(token) {
  return { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
}

// ── post a result back to the relay. Best-effort, soft-fail. ──────────────────────────────────────
async function postResult(base, token, payload) {
  try {
    const r = await _fetch(`${base}/relay/result`, {
      method: 'POST',
      headers: authHeaders(token),
      body: JSON.stringify(payload),
    });
    return { ok: true, status: r?.status };
  } catch (e) {
    return { ok: false, error: e?.message || 'post-failed' };
  }
}

// ── pollOnce: claim ONE job, gate it, run or reject, report. NEVER throws. ────────────────────────
// Returns a small status object describing what happened this tick:
//   { ran:false, reason:'no-job' }            — queue empty (204) or unreadable.
//   { ran:false, denied:true, id }            — job pulled but not on the allowlist (reported back).
//   { ran:true, ok:true|false, id }           — job ran; result (or runner error) posted.
export async function pollOnce(opts = {}) {
  const base = relayUrl(opts);
  const token = relayToken(opts);

  // 1. pull the next job
  let res;
  try {
    res = await _fetch(`${base}/relay/pull`, { method: 'GET', headers: authHeaders(token) });
  } catch (e) {
    return { ran: false, reason: 'pull-failed', error: e?.message || 'fetch-threw' };
  }
  if (!res || res.status === 204) return { ran: false, reason: 'no-job' };
  if (res.status === 401) return { ran: false, reason: 'unauthorized' };

  let job;
  try { job = await res.json(); } catch { return { ran: false, reason: 'bad-job-json' }; }
  if (!job || !job.id) return { ran: false, reason: 'no-job' };

  // 2. the allowlist gate — DENY by default. A disallowed command is NEVER run.
  if (!isAllowed(job.cmd)) {
    await postResult(base, token, { id: job.id, ok: false, reason: 'command not allowed' });
    return { ran: false, denied: true, id: job.id };
  }

  // 3. run it via the injected runner; post the outcome. Runner failure is a failed job, not a crash.
  try {
    const result = await _runner(job.cmd, job.args);
    await postResult(base, token, { id: job.id, ok: true, result });
    return { ran: true, ok: true, id: job.id };
  } catch (e) {
    await postResult(base, token, { id: job.id, ok: false, reason: e?.message || 'runner-failed' });
    return { ran: true, ok: false, id: job.id };
  }
}

// ── loop: poll on a schedule. Bounded by opts.iterations so tests terminate; the injected sleeper
// makes the pacing instant offline. Never throws — a bad tick is swallowed and the loop continues. ─
export async function loop(opts = {}) {
  const iterations = Number.isFinite(opts.iterations) ? opts.iterations : Infinity;
  const intervalMs = Number.isFinite(opts.intervalMs) ? opts.intervalMs : 5000;
  const results = [];
  for (let i = 0; i < iterations; i++) {
    let r;
    try { r = await pollOnce(opts); } catch (e) { r = { ran: false, reason: 'poll-threw', error: e?.message }; }
    results.push(r);
    if (i < iterations - 1) { try { await _sleeper(intervalMs); } catch { /* sleeper failure is non-fatal */ } }
  }
  return results;
}

// ── CLI (guarded) — run one poll against the configured relay ─────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('soapy-executor.mjs')) {
  if (!process.env.SOAPY_RELAY_TOKEN) { console.error('FATAL: set SOAPY_RELAY_TOKEN'); process.exit(1); }
  const out = await pollOnce();
  console.log('[soapy-executor] pollOnce:', JSON.stringify(out));
  console.log('allowlist:', ALLOWLIST.join(' | '));
}
