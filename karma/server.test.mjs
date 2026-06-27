// server.test.mjs — karma display API. OFFLINE: activity fetch injected via __setFetchActivity. Never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, karmaFor } from './server.mjs';
import { __setFetchActivity } from './karma.mjs';

function cap() {
  const o = { code: 0, type: '', cors: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; o.cors = (h && h['access-control-allow-origin']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
const req = (url) => ({ url, method: 'GET' });

// a busy, generous, tenured account → high karma; a fresh empty one → low.
__setFetchActivity(async (account) => account === 'pillar'
  ? { account, postCount: 200, commentCount: 1000, repliesToNewcomers: 80, upvotesGiven: 500, selfVotes: 10, accountAgeDays: 900, reputation: 80 }
  : { account });

test('karmaFor returns a score + tier for a real account', async () => {
  const r = await karmaFor('pillar', { now: () => 1 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.account, 'pillar');
  assert.ok(r.score > 50, 'busy generous tenured account scores high');
  assert.ok(['trusted', 'pillar'].includes(r.tier));
  assert.ok(r.components && typeof r.components.teaches === 'number');
});

test('a fresh/unknown account scores low (newcomer), never errors', async () => {
  const r = await karmaFor('newbie', { now: () => 1 });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.tier, 'newcomer');
  assert.ok(r.score >= 0 && r.score < 20);
});

test('invalid account names are rejected (no chain call)', async () => {
  assert.strictEqual((await karmaFor('')).ok, false);
  assert.strictEqual((await karmaFor('0xABC!!')).ok, false);
});

test('GET /karma/<account> serves JSON with CORS open + score', async () => {
  const { res, o } = cap(); await handler(req('/karma/pillar'), res);
  assert.strictEqual(o.code, 200);
  assert.match(o.type, /application\/json/);
  assert.strictEqual(o.cors, '*');                 // condenser (other origin) can fetch it
  const j = JSON.parse(o.body);
  assert.strictEqual(j.account, 'pillar');
  assert.ok(j.score > 50);
});

test('GET /health and unknown route', async () => {
  let { res, o } = cap(); await handler(req('/health'), res);
  assert.strictEqual(JSON.parse(o.body).service, 'karma');
  ({ res, o } = cap()); await handler(req('/nope'), res);
  assert.strictEqual(o.code, 404);
});

test('second call within TTL is served from cache (one chain compute)', async () => {
  let calls = 0;
  __setFetchActivity(async (account) => { calls++; return { account, postCount: 5 }; });
  await karmaFor('cacheme', { now: () => 1000 });
  await karmaFor('cacheme', { now: () => 1000 + 1000 }); // within 5-min TTL
  assert.strictEqual(calls, 1, 'cached — chain hit only once');
});
