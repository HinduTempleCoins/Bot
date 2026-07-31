// soapy-relay.mjs — the Soapy.Blog SIDE of the "web page is a remote control" relay.
//
// THE PATTERN (read before changing anything):
//   The public web page (Soapy.Blog) holds NO keys and has NO shell. It cannot run
//   anything. All it does is QUEUE a job: "please run this vetted command." A trusted
//   EXECUTOR that already has access (it runs inside the Codespace — see
//   soapy-executor.mjs) dials OUTBOUND to this relay, pulls the next queued job, runs
//   ONLY allowlisted commands, and pushes the result back. The web tier never reaches
//   into the Codespace; the Codespace reaches out. That direction is the whole security
//   story — there is no inbound hole to attack.
//
//   This file is the queue + its tiny HTTP surface:
//     enqueue / claimNext / complete / fail / getJob / listJobs  — the job store.
//     handler(req,res)                                           — four routes:
//       POST /relay/enqueue  OPERATOR auth  — the operator drops a job in.
//       GET  /relay/pull     EXECUTOR auth  — the executor claims the oldest pending job.
//       POST /relay/result   EXECUTOR auth  — the executor reports the outcome.
//       GET  /relay/jobs     OPERATOR auth  — an HTML view of the queue (esc()'d).
//
// TWO SEPARATE TRUST BOUNDARIES:
//   • OPERATOR auth  — an injected predicate (__setOperatorAuth). The operator portal decides
//     who may enqueue / view. Default DENY (no predicate set ⇒ 401). This is where you plug in
//     admin-auth.mjs's requireAdmin in production.
//   • EXECUTOR auth  — a shared bearer token in env SOAPY_RELAY_TOKEN, compared in CONSTANT TIME
//     (crypto.timingSafeEqual). ONLY the executor holds it. No token configured ⇒ refuse all.
//
// The queue is ONE JSON file, read/written through an injectable fs (like captcha-handoff.mjs),
// so the web tier and any admin process share it and the tests run fully offline with a memfs.
// Soft-fail, never throw across the public surface. No secrets are ever logged.
//
//   SOAPY_RELAY_TOKEN=… [SOAPY_RELAY_FILE=…] [PORT=8150] node integrations/soapy-relay.mjs

import http from 'node:http';
import crypto from 'node:crypto';
import nodeFs from 'node:fs';

// ── HTML escape (every interpolated value in /relay/jobs passes through this) ─────────────────────
export function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── injectable fs (default node:fs; tests inject an in-memory fake) ───────────────────────────────
let _fs = nodeFs;
export function __setFs(fs) { _fs = fs || nodeFs; }

// ── injectable clock ──────────────────────────────────────────────────────────────────────────────
let _clock = () => Date.now();
export function __setClock(fn) { _clock = typeof fn === 'function' ? fn : (() => Date.now()); }

// ── injectable OPERATOR auth predicate — default DENY ─────────────────────────────────────────────
// predicate(req) -> boolean. Production wires admin-auth.mjs requireAdmin(req).ok here.
let _operatorAuth = () => false;
export function __setOperatorAuth(fn) { _operatorAuth = typeof fn === 'function' ? fn : (() => false); }

// ── statuses ──────────────────────────────────────────────────────────────────────────────────────
export const PENDING = 'pending';
export const CLAIMED = 'claimed';
export const DONE = 'done';
export const FAILED = 'failed';

function storeFile() {
  return process.env.SOAPY_RELAY_FILE || '/tmp/soapy-relay-queue.json';
}

// ── the JSON-file store: { jobs: [...] }. Soft-fail: a bad read is an empty queue. ────────────────
function readStore(opts = {}) {
  const file = opts.file || storeFile();
  try {
    const raw = _fs.readFileSync(file, 'utf8');
    const obj = JSON.parse(raw || '{}');
    return Array.isArray(obj.jobs) ? { jobs: obj.jobs } : { jobs: [] };
  } catch { return { jobs: [] }; }
}
function writeStore(store, opts = {}) {
  const file = opts.file || storeFile();
  try {
    const dir = String(file).replace(/\/[^/]*$/, '');
    if (dir && dir !== file && !_fs.existsSync(dir)) _fs.mkdirSync(dir, { recursive: true });
    _fs.writeFileSync(file, JSON.stringify(store, null, 2));
    return true;
  } catch { return false; }
}

// ── enqueue: the web/operator side drops a job in. id is DERIVED from store length + now
// (deterministic, NOT Math.random) so the same inputs give the same id and tests are stable. ──────
export function enqueue({ cmd, args } = {}, opts = {}) {
  const store = readStore(opts);
  const now = typeof opts.now === 'number' ? opts.now : _clock();
  const id = `job-${now}-${store.jobs.length}`;
  const job = {
    id,
    cmd: String(cmd == null ? '' : cmd),
    args: args == null ? null : args,
    status: PENDING,
    enqueuedAt: now,
    claimedAt: null,
    completedAt: null,
    result: null,
    reason: null,
  };
  store.jobs.push(job);
  writeStore(store, opts);
  return { ok: true, id, status: PENDING };
}

// ── claimNext: oldest pending job, marked claimed. null if the queue has none pending. ────────────
export function claimNext(opts = {}) {
  const store = readStore(opts);
  const now = typeof opts.now === 'number' ? opts.now : _clock();
  const job = store.jobs.find((j) => j.status === PENDING);
  if (!job) return null;
  job.status = CLAIMED;
  job.claimedAt = now;
  writeStore(store, opts);
  return job;
}

export function complete(id, result, opts = {}) {
  const store = readStore(opts);
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return { ok: false, error: 'unknown' };
  job.status = DONE;
  job.result = result == null ? null : result;
  job.completedAt = typeof opts.now === 'number' ? opts.now : _clock();
  writeStore(store, opts);
  return { ok: true, id, status: DONE };
}

export function fail(id, reason, opts = {}) {
  const store = readStore(opts);
  const job = store.jobs.find((j) => j.id === id);
  if (!job) return { ok: false, error: 'unknown' };
  job.status = FAILED;
  job.reason = reason == null ? null : String(reason);
  job.completedAt = typeof opts.now === 'number' ? opts.now : _clock();
  writeStore(store, opts);
  return { ok: true, id, status: FAILED };
}

export function getJob(id, opts = {}) {
  return readStore(opts).jobs.find((j) => j.id === id) || null;
}

export function listJobs(opts = {}) {
  return readStore(opts).jobs.slice();
}

// ── EXECUTOR bearer check — constant-time against env SOAPY_RELAY_TOKEN. No token ⇒ refuse all. ───
export function checkExecutorAuth(headerValue, token = process.env.SOAPY_RELAY_TOKEN) {
  if (!token) return false;
  const got = String(headerValue || '').replace(/^Bearer\s+/i, '');
  const a = Buffer.from(got);
  const b = Buffer.from(String(token));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ── read a JSON body with a hard cap ──────────────────────────────────────────────────────────────
function readJson(req, limit = 65536) {
  return new Promise((resolve) => {
    let buf = ''; let over = false;
    req.on('data', (c) => { buf += c; if (buf.length > limit) { over = true; req.destroy(); } });
    req.on('end', () => { if (over) return resolve(null); try { resolve(JSON.parse(buf || '{}')); } catch { resolve(null); } });
    req.on('error', () => resolve(null));
  });
}

// ── HTTP handler. opts may carry { token, file, now } for tests; operator auth is the injected
// predicate, executor auth is the constant-time bearer. Never throws across this surface. ──────────
export async function handler(req, res, opts = {}) {
  const sendJson = (code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
  const sendHtml = (code, html) => { res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' }); res.end(html); };
  try {
    const method = req.method || 'GET';
    const path = (req.url || '/').split('?')[0];
    const token = opts.token || process.env.SOAPY_RELAY_TOKEN;

    // POST /relay/enqueue — OPERATOR auth
    if (method === 'POST' && path === '/relay/enqueue') {
      if (!_operatorAuth(req)) return sendJson(401, { ok: false, error: 'unauthorized' });
      const body = await readJson(req);
      if (!body || !body.cmd) return sendJson(400, { ok: false, error: 'need { cmd, args? }' });
      return sendJson(200, enqueue({ cmd: body.cmd, args: body.args }, opts));
    }

    // GET /relay/pull — EXECUTOR auth (constant-time bearer)
    if (method === 'GET' && path === '/relay/pull') {
      if (!checkExecutorAuth(req.headers?.authorization, token)) return sendJson(401, { ok: false, error: 'unauthorized' });
      const job = claimNext(opts);
      if (!job) { res.writeHead(204); res.end(); return; }
      return sendJson(200, job);
    }

    // POST /relay/result — EXECUTOR auth (same bearer)
    if (method === 'POST' && path === '/relay/result') {
      if (!checkExecutorAuth(req.headers?.authorization, token)) return sendJson(401, { ok: false, error: 'unauthorized' });
      const body = await readJson(req);
      if (!body || !body.id) return sendJson(400, { ok: false, error: 'need { id, ok, result|reason }' });
      const out = body.ok ? complete(body.id, body.result, opts) : fail(body.id, body.reason, opts);
      return sendJson(out.ok ? 200 : 404, out);
    }

    // GET /relay/jobs — OPERATOR auth → HTML view
    if (method === 'GET' && path === '/relay/jobs') {
      if (!_operatorAuth(req)) return sendHtml(401, '<p>unauthorized</p>');
      return sendHtml(200, renderJobsHtml(listJobs(opts)));
    }

    return sendJson(404, { ok: false, error: 'not found' });
  } catch {
    try { return sendJson(500, { ok: false, error: 'internal' }); } catch { /* nothing more to do */ }
  }
}

// ── HTML view of the queue — EVERY interpolated value is esc()'d ──────────────────────────────────
export function renderJobsHtml(jobs) {
  const list = Array.isArray(jobs) ? jobs : [];
  const rows = list.map((j) => `
    <tr class="status-${esc(j.status)}">
      <td>${esc(j.id)}</td>
      <td><code>${esc(j.cmd)}</code></td>
      <td>${esc(typeof j.args === 'string' ? j.args : JSON.stringify(j.args))}</td>
      <td>${esc(j.status)}</td>
      <td>${esc(j.reason || (j.result == null ? '' : (typeof j.result === 'string' ? j.result : JSON.stringify(j.result))))}</td>
    </tr>`).join('');
  return `<!doctype html><meta charset="utf-8"><title>Soapy relay — jobs</title>
<h1>Soapy relay queue (${list.length})</h1>
<table border="1" cellpadding="4">
<thead><tr><th>id</th><th>cmd</th><th>args</th><th>status</th><th>result/reason</th></tr></thead>
<tbody>${rows}</tbody></table>`;
}

// ── CLI (guarded) ─────────────────────────────────────────────────────────────────────────────────
if (process.argv[1] && process.argv[1].endsWith('soapy-relay.mjs')) {
  const PORT = Number(process.env.PORT || 8150);
  const HOST = process.env.SOAPY_RELAY_BIND || '127.0.0.1';
  if (!process.env.SOAPY_RELAY_TOKEN) console.warn('[soapy-relay] SOAPY_RELAY_TOKEN not set — /relay/pull and /relay/result will refuse all executors.');
  http.createServer((req, res) => { handler(req, res).catch(() => { try { res.writeHead(500); res.end('{"ok":false}'); } catch { /* noop */ } }); })
    .listen(PORT, HOST, () => console.log(`soapy-relay on http://${HOST}:${PORT} (queue: ${storeFile()})`));
}
