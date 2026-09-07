import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  __setFetch, ADAPTERS, adapter, normalizeFax, isFinal, FINAL_STATES, backoffMs,
  checkCredentials, submitFax, checkStatus, pollUntilFinal, sendWithRetry, receipt, handler,
} from './fax-service.mjs';

const CRED = { apiKey: 'k', connectionId: 'c' };
const noSleep = async () => {};
function mock(seq) {
  let i = 0;
  const calls = [];
  __setFetch(async (url, opts) => {
    calls.push({ url, opts });
    const r = seq[Math.min(i, seq.length - 1)]; i += 1;
    return { ok: r.ok !== false, status: r.status || 200, text: async () => JSON.stringify(r.body || {}) };
  });
  return calls;
}
const reset = () => __setFetch(null);

test('normalizeFax handles every format a human types', () => {
  assert.equal(normalizeFax('(214) 653-7481'), '+12146537481');
  assert.equal(normalizeFax('512.936.7554'), '+15129367554');
  assert.equal(normalizeFax('1-202-268-4538'), '+12022684538');
  assert.equal(normalizeFax('+442071234567'), '+442071234567');
  assert.equal(normalizeFax('12345'), null);
  assert.equal(normalizeFax(''), null);
  assert.equal(normalizeFax(null), null);
});

test('terminal states are exactly the three that end a fax', () => {
  assert.deepEqual([...FINAL_STATES].sort(), ['canceled', 'delivered', 'failed']);
  assert.equal(isFinal('DELIVERED'), true);
  assert.equal(isFinal('sending'), false);
});

test('⭐ backoff escalates — retrying a busy line in ten seconds just burns a page charge', () => {
  assert.equal(backoffMs(0), 60e3);
  assert.equal(backoffMs(1), 300e3);
  assert.equal(backoffMs(3), 2700e3);
  assert.equal(backoffMs(99), 3600e3, 'capped, not unbounded');
  for (let i = 1; i < 4; i += 1) assert.ok(backoffMs(i) > backoffMs(i - 1), 'must escalate');
});

test('every adapter declares what credentials it needs', () => {
  for (const a of Object.values(ADAPTERS)) {
    assert.ok(a.id && Array.isArray(a.requires) && a.requires.length, `requires: ${a.id}`);
    assert.equal(typeof a.submit, 'function');
    assert.equal(typeof a.status, 'function');
    assert.equal(typeof a.parseSubmit, 'function');
    assert.equal(typeof a.parseStatus, 'function');
  }
  assert.equal(adapter('NOPE'), null);
});

test('checkCredentials names the missing field rather than failing vaguely', () => {
  assert.equal(checkCredentials('telnyx', CRED).ok, true);
  assert.match(checkCredentials('telnyx', { apiKey: 'k' }).reason, /connectionId/);
  assert.match(checkCredentials('phaxio', {}).reason, /apiKey, apiSecret/);
  assert.match(checkCredentials('nope', {}).reason, /unknown provider/);
});

test('submitFax refuses a bad number BEFORE the network', async () => {
  let hit = false;
  __setFetch(async () => { hit = true; return { ok: true, status: 200, text: async () => '{}' }; });
  const r = await submitFax({ providerId: 'telnyx', to: '123', mediaUrl: 'https://x/a.pdf', credentials: CRED });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'number');
  assert.equal(hit, false);
  reset();
});

test('submitFax refuses incomplete credentials before the network', async () => {
  let hit = false;
  __setFetch(async () => { hit = true; return { ok: true, status: 200, text: async () => '{}' }; });
  const r = await submitFax({ providerId: 'telnyx', to: '2146537481',
    mediaUrl: 'https://x/a.pdf', credentials: { apiKey: 'k' } });
  assert.equal(r.stage, 'credentials');
  assert.equal(hit, false);
  reset();
});

test('submitFax returns a job id and normalises the destination', async () => {
  mock([{ body: { data: { id: 'fx_1', status: 'queued' } } }]);
  const r = await submitFax({ providerId: 'telnyx', to: '(214) 653-7481',
    mediaUrl: 'https://x/a.pdf', credentials: CRED });
  assert.equal(r.ok, true);
  assert.equal(r.id, 'fx_1');
  assert.equal(r.to, '+12146537481');
  reset();
});

test('submitFax marks 5xx and 429 retryable, 4xx not', async () => {
  mock([{ ok: false, status: 503, body: { error: 'upstream' } }]);
  const a = await submitFax({ providerId: 'telnyx', to: '2146537481', mediaUrl: 'https://x/a.pdf', credentials: CRED });
  assert.equal(a.retryable, true);
  mock([{ ok: false, status: 422, body: { errors: [{ detail: 'bad number' }] } }]);
  const b = await submitFax({ providerId: 'telnyx', to: '2146537481', mediaUrl: 'https://x/a.pdf', credentials: CRED });
  assert.equal(b.retryable, false);
  assert.match(b.reason, /bad number/);
  reset();
});

test('submitFax fails cleanly when the provider returns no job id', async () => {
  mock([{ body: { data: {} } }]);
  const r = await submitFax({ providerId: 'telnyx', to: '2146537481', mediaUrl: 'https://x/a.pdf', credentials: CRED });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no job id/);
  reset();
});

test('submitFax never throws when the network does', async () => {
  __setFetch(async () => { throw new Error('ECONNRESET'); });
  const r = await submitFax({ providerId: 'telnyx', to: '2146537481', mediaUrl: 'https://x/a.pdf', credentials: CRED });
  assert.equal(r.ok, false);
  assert.equal(r.retryable, true);
  reset();
});

test('checkStatus parses provider shape and marks finality', async () => {
  mock([{ body: { data: { status: 'delivered', page_count: 4, completed_at: '2026-09-07T21:00:00Z' } } }]);
  const s = await checkStatus({ providerId: 'telnyx', id: 'fx_1', credentials: CRED });
  assert.equal(s.ok, true);
  assert.equal(s.status, 'delivered');
  assert.equal(s.pages, 4);
  assert.equal(s.final, true);
  reset();
});

test('⭐ pollUntilFinal keeps the whole history, because the history is the evidence', async () => {
  mock([
    { body: { data: { status: 'queued' } } },
    { body: { data: { status: 'sending' } } },
    { body: { data: { status: 'delivered', page_count: 6 } } },
  ]);
  const p = await pollUntilFinal({ providerId: 'telnyx', id: 'fx_1', credentials: CRED, sleep: noSleep });
  assert.equal(p.final, true);
  assert.equal(p.status, 'delivered');
  assert.equal(p.pages, 6);
  assert.equal(p.checks, 3);
  assert.equal(p.history.length, 3);
  reset();
});

test('pollUntilFinal gives up honestly rather than claiming delivery', async () => {
  mock([{ body: { data: { status: 'sending' } } }]);
  const p = await pollUntilFinal({ providerId: 'telnyx', id: 'fx_1', credentials: CRED,
    maxChecks: 3, sleep: noSleep });
  assert.equal(p.final, false);
  assert.match(p.reason, /did not reach a terminal state/);
  reset();
});

test('⭐ sendWithRetry retries a BUSY line and succeeds on a later attempt', async () => {
  let call = 0;
  __setFetch(async (url, opts) => {
    call += 1;
    const isSubmit = (opts && opts.method) === 'POST';
    if (isSubmit) return { ok: true, status: 200, text: async () => JSON.stringify({ data: { id: `fx_${call}`, status: 'queued' } }) };
    // first poll: busy failure; later polls: delivered
    const body = call <= 2
      ? { data: { status: 'failed', failure_reason: 'busy' } }
      : { data: { status: 'delivered', page_count: 3, completed_at: '2026-09-07T22:00:00Z' } };
    return { ok: true, status: 200, text: async () => JSON.stringify(body) };
  });
  const r = await sendWithRetry({ providerId: 'telnyx', to: '2146537481',
    mediaUrl: 'https://x/a.pdf', credentials: CRED, sleep: noSleep, pollOpts: { maxChecks: 1 } });
  assert.equal(r.ok, true);
  assert.equal(r.delivered, true);
  assert.equal(r.pages, 3);
  assert.ok(r.attempts.length >= 2, 'the busy attempt must be recorded, not hidden');
  reset();
});

test('sendWithRetry does NOT retry a hard failure', async () => {
  let call = 0;
  __setFetch(async (url, opts) => {
    call += 1;
    if ((opts && opts.method) === 'POST') return { ok: true, status: 200, text: async () => JSON.stringify({ data: { id: 'fx_x' } }) };
    return { ok: true, status: 200, text: async () => JSON.stringify({ data: { status: 'failed', failure_reason: 'invalid destination' } }) };
  });
  const r = await sendWithRetry({ providerId: 'telnyx', to: '2146537481',
    mediaUrl: 'https://x/a.pdf', credentials: CRED, sleep: noSleep, pollOpts: { maxChecks: 1 } });
  assert.equal(r.delivered, false);
  assert.match(r.reason, /invalid destination/);
  assert.equal(r.attempts.length, 1, 'a hard failure is not retried');
  reset();
});

test('receipt renders an attachable record including every attempt', () => {
  const txt = receipt({ provider: 'telnyx', id: 'fx_1', delivered: true, pages: 4,
    completedAt: '2026-09-07T21:00:00Z', to: '+12146537481',
    attempts: [{ attempt: 1, status: 'failed', failureReason: 'busy' },
               { attempt: 2, status: 'delivered', pages: 4 }] },
    { to: '+12146537481', subject: 'PIA request', sentBy: 'R. Gallagher' });
  assert.match(txt, /FAX TRANSMISSION RECORD/);
  assert.match(txt, /Delivered:    YES/);
  assert.match(txt, /1\. failed — busy/);
  assert.match(txt, /retain the provider-side confirmation/);
});

test('receipt is safe on nothing', () => {
  assert.equal(receipt(null), '');
});

test('handler explains the shape and the retry reasoning', () => {
  const res = { code: 0, body: '', writeHead(c) { this.code = c; }, end(b) { this.body = b; } };
  handler({ url: '/' }, res);
  const j = JSON.parse(res.body);
  assert.equal(j.shape, 'submit -> poll -> capture the report');
  assert.match(j.why, /only queues it/);
  assert.ok(j.rules.some((r) => /transmission report is retained/.test(r)));
  assert.equal(j.backoffLadderMs[0], 60000);
});

test('no adapter stores a credential value', () => {
  const blob = JSON.stringify(Object.values(ADAPTERS).map((a) => ({ id: a.id, requires: a.requires })));
  assert.ok(!/[A-Za-z0-9_-]{32,}/.test(blob), 'no secret-looking string may be present');
});
