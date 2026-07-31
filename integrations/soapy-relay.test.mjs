import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  enqueue, claimNext, complete, fail, getJob, listJobs,
  checkExecutorAuth, handler, renderJobsHtml, esc,
  __setFs, __setClock, __setOperatorAuth,
  PENDING, CLAIMED, DONE, FAILED,
} from './soapy-relay.mjs';

const FILE = '/mem/soapy-queue.json';

// ── in-memory fs so tests never touch disk ────────────────────────────────────────────────────────
function memFs(initial = {}) {
  const files = { ...initial };
  return {
    files,
    readFileSync(p) { if (!(p in files)) throw new Error('ENOENT'); return files[p]; },
    writeFileSync(p, data) { files[p] = String(data); },
    existsSync(p) { return p in files || p === '/mem'; },
    mkdirSync() { /* noop for memfs */ },
  };
}

function fresh() {
  __setFs(memFs());
  __setClock(() => 1000);
  __setOperatorAuth(() => false);
}

// ── req/res fakes ─────────────────────────────────────────────────────────────────────────────────
function mkReq({ method = 'GET', url = '/', auth, body } = {}) {
  const handlers = {};
  const headers = {};
  if (auth) headers.authorization = auth;
  const req = {
    method, url, headers,
    on(ev, cb) { handlers[ev] = cb; return req; },
    destroy() {},
    _fire() { if (body !== undefined) handlers.data?.(typeof body === 'string' ? body : JSON.stringify(body)); handlers.end?.(); },
  };
  return req;
}
function mkRes() {
  return {
    code: 0, body: '', headers: null,
    writeHead(c, h) { this.code = c; this.headers = h; }, end(b) { this.body = b || ''; },
  };
}
async function run(reqOpts, opts) {
  const req = mkReq(reqOpts); const res = mkRes();
  const p = handler(req, res, opts);
  req._fire();
  await p;
  let json = null; try { json = JSON.parse(res.body); } catch { /* html or empty */ }
  return { code: res.code, body: res.body, json };
}

const TOKEN = 'exec-token-abcdefghij';

test('enqueue → claimNext → complete roundtrip; ids are derived (not random)', () => {
  fresh();
  const a = enqueue({ cmd: 'git status', args: null }, { file: FILE, now: 1000 });
  assert.equal(a.ok, true);
  assert.equal(a.status, PENDING);
  assert.equal(a.id, 'job-1000-0'); // derived from now + store length, deterministic

  const b = enqueue({ cmd: 'uptime' }, { file: FILE, now: 2000 });
  assert.equal(b.id, 'job-2000-1');

  const claimed = claimNext({ file: FILE, now: 3000 });
  assert.equal(claimed.id, a.id); // oldest pending first
  assert.equal(claimed.status, CLAIMED);
  assert.equal(claimed.claimedAt, 3000);

  const done = complete(a.id, 'clean', { file: FILE, now: 4000 });
  assert.equal(done.ok, true);
  assert.equal(getJob(a.id, { file: FILE }).status, DONE);
  assert.equal(getJob(a.id, { file: FILE }).result, 'clean');

  // second claim returns the still-pending b
  const claimed2 = claimNext({ file: FILE, now: 5000 });
  assert.equal(claimed2.id, b.id);
  assert.equal(claimNext({ file: FILE }), null); // nothing pending now
});

test('fail marks a job failed with a reason', () => {
  fresh();
  const j = enqueue({ cmd: 'df -h' }, { file: FILE, now: 1000 });
  const r = fail(j.id, 'command not allowed', { file: FILE, now: 2000 });
  assert.equal(r.ok, true);
  assert.equal(getJob(j.id, { file: FILE }).status, FAILED);
  assert.equal(getJob(j.id, { file: FILE }).reason, 'command not allowed');
  assert.deepEqual(fail('nope', 'x', { file: FILE }), { ok: false, error: 'unknown' });
});

test('checkExecutorAuth is constant-time and refuses when no token configured', () => {
  assert.equal(checkExecutorAuth('Bearer ' + TOKEN, TOKEN), true);
  assert.equal(checkExecutorAuth(TOKEN, TOKEN), true);
  assert.equal(checkExecutorAuth('Bearer wrong', TOKEN), false);
  assert.equal(checkExecutorAuth('Bearer ' + TOKEN, ''), false); // no token ⇒ refuse
  assert.equal(checkExecutorAuth(undefined, TOKEN), false);
});

test('GET /relay/pull with a wrong bearer → 401', async () => {
  fresh();
  enqueue({ cmd: 'git status' }, { file: FILE, now: 1000 });
  const r = await run({ method: 'GET', url: '/relay/pull', auth: 'Bearer nope' }, { token: TOKEN, file: FILE });
  assert.equal(r.code, 401);
  assert.equal(r.json.ok, false);
});

test('GET /relay/pull with NO bearer → 401', async () => {
  fresh();
  enqueue({ cmd: 'git status' }, { file: FILE, now: 1000 });
  const r = await run({ method: 'GET', url: '/relay/pull' }, { token: TOKEN, file: FILE });
  assert.equal(r.code, 401);
});

test('GET /relay/pull with the right token returns the job (200) then 204 when drained', async () => {
  fresh();
  enqueue({ cmd: 'git status', args: ['--porcelain'] }, { file: FILE, now: 1000 });
  const r = await run({ method: 'GET', url: '/relay/pull', auth: 'Bearer ' + TOKEN }, { token: TOKEN, file: FILE });
  assert.equal(r.code, 200);
  assert.equal(r.json.cmd, 'git status');
  assert.equal(r.json.status, CLAIMED);

  const empty = await run({ method: 'GET', url: '/relay/pull', auth: 'Bearer ' + TOKEN }, { token: TOKEN, file: FILE });
  assert.equal(empty.code, 204);
  assert.equal(empty.body, '');
});

test('POST /relay/enqueue WITHOUT operator auth → 401; WITH → 200', async () => {
  fresh(); // operator auth denies by default
  const denied = await run({ method: 'POST', url: '/relay/enqueue', body: { cmd: 'uptime' } }, { token: TOKEN, file: FILE });
  assert.equal(denied.code, 401);
  assert.equal(listJobs({ file: FILE }).length, 0); // nothing enqueued

  __setOperatorAuth(() => true);
  const ok = await run({ method: 'POST', url: '/relay/enqueue', body: { cmd: 'uptime' } }, { token: TOKEN, file: FILE, now: 1000 });
  assert.equal(ok.code, 200);
  assert.equal(ok.json.status, PENDING);
  assert.equal(listJobs({ file: FILE }).length, 1);
});

test('POST /relay/result completes/fails; executor auth required', async () => {
  fresh();
  const j = enqueue({ cmd: 'git status' }, { file: FILE, now: 1000 });

  const unauth = await run({ method: 'POST', url: '/relay/result', body: { id: j.id, ok: true, result: 'x' } }, { token: TOKEN, file: FILE });
  assert.equal(unauth.code, 401);

  const ok = await run({ method: 'POST', url: '/relay/result', auth: 'Bearer ' + TOKEN, body: { id: j.id, ok: true, result: 'clean' } }, { token: TOKEN, file: FILE });
  assert.equal(ok.code, 200);
  assert.equal(getJob(j.id, { file: FILE }).status, DONE);

  const j2 = enqueue({ cmd: 'rm -rf /' }, { file: FILE, now: 2000 });
  const bad = await run({ method: 'POST', url: '/relay/result', auth: 'Bearer ' + TOKEN, body: { id: j2.id, ok: false, reason: 'command not allowed' } }, { token: TOKEN, file: FILE });
  assert.equal(bad.code, 200);
  assert.equal(getJob(j2.id, { file: FILE }).status, FAILED);
  assert.equal(getJob(j2.id, { file: FILE }).reason, 'command not allowed');
});

test('GET /relay/jobs needs operator auth and returns esc()-safe HTML', async () => {
  fresh();
  __setOperatorAuth(() => true);
  enqueue({ cmd: 'git status', args: '<script>alert(1)</script>' }, { file: FILE, now: 1000 });
  const r = await run({ method: 'GET', url: '/relay/jobs' }, { file: FILE });
  assert.equal(r.code, 200);
  assert.match(r.body, /Soapy relay queue/);
  assert.doesNotMatch(r.body, /<script>alert/); // interpolation is escaped
  assert.match(r.body, /&lt;script&gt;/);

  __setOperatorAuth(() => false);
  const denied = await run({ method: 'GET', url: '/relay/jobs' }, { file: FILE });
  assert.equal(denied.code, 401);
});

test('unknown route → 404; renderJobsHtml/esc are pure and soft', () => {
  assert.equal(esc('<a>&"\''), '&lt;a&gt;&amp;&quot;&#39;');
  assert.match(renderJobsHtml([]), /queue \(0\)/);
  assert.match(renderJobsHtml(null), /queue \(0\)/); // soft-fail on bad input
});
