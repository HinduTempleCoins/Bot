// pentecaust/bridge-runner.test.mjs — offline tests for the live bridge runner.
// Injected fetch + injected brain; no network. Asserts the client hits the EXACT pentecaust/server.mjs
// endpoints/methods/fields for both team and DM channels, and that a full runner tick reads a human line
// and posts the brain's reply as the AI account. Soft-fails when fetch throws.

import { test } from 'node:test';
import assert from 'node:assert';
import {
  pentecaustChannelClient, personaBrain, createRunner, tick, __setFetch,
} from './bridge-runner.mjs';

// a fake fetch that records calls and returns a queued/keyed response
function fakeFetch(plan) {
  const calls = [];
  const fn = async (url, opts = {}) => {
    const method = (opts.method || 'GET').toUpperCase();
    let body = null;
    try { body = opts.body ? JSON.parse(opts.body) : null; } catch { body = opts.body; }
    calls.push({ url: String(url), method, body, opts });
    const r = typeof plan === 'function' ? plan(String(url), method, body) : plan;
    const payload = r == null ? {} : r;
    return { ok: true, status: 200, json: async () => payload };
  };
  fn.calls = calls;
  return fn;
}

const AI = 'hathor';            // valid MELEK account
const HUMAN = 'punkwax';        // valid MELEK account
const TEAM = 'van-kush-family';

test('team client read() GETs the team chat endpoint with account=AI and since, parses messages+cursor', async () => {
  const f = fakeFetch({ ok: true, messages: [{ seq: 7, from: HUMAN, text: 'hi' }], cursor: 7 });
  __setFetch(f);
  const c = pentecaustChannelClient({ baseUrl: 'https://pentecaust.com', aiAccount: AI, channel: { type: 'team', id: TEAM } });
  const out = await c.read({ since: 3 });
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'GET');
  assert.equal(f.calls[0].url, `https://pentecaust.com/teams/${TEAM}/chat?account=${AI}&since=3`);
  assert.deepEqual(out.messages, [{ seq: 7, from: HUMAN, text: 'hi' }]);
  assert.equal(out.cursor, 7);
  __setFetch(null);
});

test('team client send() POSTs the team chat endpoint with from=AI', async () => {
  const f = fakeFetch({ ok: true });
  __setFetch(f);
  const c = pentecaustChannelClient({ aiAccount: AI, channel: { type: 'team', id: TEAM } });
  await c.send('rolling the cam now');
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].url, `https://pentecaust.com/teams/${TEAM}/chat`);   // default base = pentecaust.com
  assert.equal(f.calls[0].body.from, AI);
  assert.equal(f.calls[0].body.text, 'rolling the cam now');
  __setFetch(null);
});

test('dm client read() GETs /dm with me=AI and with=peer and since', async () => {
  const f = fakeFetch({ ok: true, messages: [{ seq: 2, from: HUMAN, to: AI, text: 'yo' }], cursor: 2 });
  __setFetch(f);
  const c = pentecaustChannelClient({ aiAccount: AI, channel: { type: 'dm', with: HUMAN } });
  const out = await c.read({ since: 0 });
  assert.equal(f.calls[0].method, 'GET');
  assert.equal(f.calls[0].url, `https://pentecaust.com/dm?me=${AI}&with=${HUMAN}&since=0`);
  assert.deepEqual(out.messages, [{ seq: 2, from: HUMAN, to: AI, text: 'yo' }]);
  assert.equal(out.cursor, 2);
  __setFetch(null);
});

test('dm client send() POSTs /dm with from=AI and to=peer', async () => {
  const f = fakeFetch({ ok: true });
  __setFetch(f);
  const c = pentecaustChannelClient({ aiAccount: AI, channel: { type: 'dm', with: HUMAN } });
  await c.send('omw');
  assert.equal(f.calls[0].method, 'POST');
  assert.equal(f.calls[0].url, 'https://pentecaust.com/dm');
  assert.equal(f.calls[0].body.from, AI);
  assert.equal(f.calls[0].body.to, HUMAN);
  assert.equal(f.calls[0].body.text, 'omw');
  __setFetch(null);
});

test('read() soft-fails to empty (cursor held) when fetch throws — no crash', async () => {
  __setFetch(async () => { throw new Error('network down'); });
  const c = pentecaustChannelClient({ aiAccount: AI, channel: { type: 'team', id: TEAM } });
  const out = await c.read({ since: 9 });
  assert.deepEqual(out, { messages: [], cursor: 9 });
  __setFetch(null);
});

test('read() soft-fails when fetch returns non-ok', async () => {
  __setFetch(async () => ({ ok: false, status: 500, json: async () => ({}) }));
  const c = pentecaustChannelClient({ aiAccount: AI, channel: { type: 'dm', with: HUMAN } });
  const out = await c.read({ since: 4 });
  assert.deepEqual(out, { messages: [], cursor: 4 });
  __setFetch(null);
});

test('send() soft-fails (returns null, no throw) when fetch throws', async () => {
  __setFetch(async () => { throw new Error('boom'); });
  const c = pentecaustChannelClient({ aiAccount: AI, channel: { type: 'team', id: TEAM } });
  const r = await c.send('hello');
  assert.equal(r, null);
  __setFetch(null);
});

test('baseUrl honors PENTECAUST_URL via default and explicit override', async () => {
  const f = fakeFetch({ ok: true, messages: [], cursor: 0 });
  __setFetch(f);
  const c = pentecaustChannelClient({ baseUrl: 'https://alpha.melek.salon/', aiAccount: AI, channel: { type: 'team', id: TEAM } });
  await c.read({ since: 0 });
  assert.equal(f.calls[0].url, `https://alpha.melek.salon/teams/${TEAM}/chat?account=${AI}&since=0`);  // trailing slash trimmed
  __setFetch(null);
});

test('personaBrain default returns an on-character canned reply, and stays silent on empty', async () => {
  const brain = personaBrain({ name: 'Hathor' });
  const film = await brain({ from: HUMAN, text: 'come film me at the temple' });
  assert.match(film, /documentary cam/i);
  const build = await brain({ from: HUMAN, text: 'what are you building?' });
  assert.match(build, /ziggurat/i);
  assert.equal(await brain({ from: HUMAN, text: '   ' }), null);
});

test('personaBrain with injected respond is used, and a throwing respond stays silent', async () => {
  const brain = personaBrain({ respond: async ({ text }) => `LLM:${text}` });
  assert.equal(await brain({ from: HUMAN, text: 'hi' }), 'LLM:hi');
  const boom = personaBrain({ respond: async () => { throw new Error('llm 500'); } });
  assert.equal(await boom({ from: HUMAN, text: 'hi' }), null);
});

test('full runner tick: reads a human line and POSTs the brain reply as the AI account', async () => {
  // GET returns one human message; POST is the AI reply. Record both.
  const f = fakeFetch((url, method) => {
    if (method === 'GET') return { ok: true, messages: [{ seq: 11, from: HUMAN, text: 'come film me' }], cursor: 11 };
    return { ok: true };
  });
  __setFetch(f);
  const runner = createRunner({ aiAccount: AI, channel: { type: 'team', id: TEAM } });
  const r = await tick(runner);
  assert.equal(r.read, 1);
  assert.equal(r.answered, 1);
  // exactly one GET (read) + one POST (send)
  const gets = f.calls.filter((c) => c.method === 'GET');
  const posts = f.calls.filter((c) => c.method === 'POST');
  assert.equal(gets.length, 1);
  assert.equal(posts.length, 1);
  assert.equal(gets[0].url, `https://pentecaust.com/teams/${TEAM}/chat?account=${AI}&since=0`);
  assert.equal(posts[0].url, `https://pentecaust.com/teams/${TEAM}/chat`);
  assert.equal(posts[0].body.from, AI);
  assert.match(posts[0].body.text, /documentary cam/i);
  assert.equal(r.replies[0].to, HUMAN);
  __setFetch(null);
});

test('runner does NOT reply to its own messages (loop guard), and holds cursor on re-tick', async () => {
  let phase = 'first';
  const f = fakeFetch((url, method) => {
    if (method === 'GET') {
      // first read: an AI line (own message) — must be ignored
      return phase === 'first'
        ? { ok: true, messages: [{ seq: 5, from: AI, text: 'I am here' }], cursor: 5 }
        : { ok: true, messages: [], cursor: 5 };
    }
    return { ok: true };
  });
  __setFetch(f);
  const runner = createRunner({ aiAccount: AI, channel: { type: 'dm', with: HUMAN } });
  const r1 = await tick(runner);
  assert.equal(r1.answered, 0);                         // never answers its own line
  phase = 'second';
  const r2 = await tick(runner);
  assert.equal(r2.answered, 0);
  // second GET carries the advanced cursor (since=5), so no double-processing
  const gets = f.calls.filter((c) => c.method === 'GET');
  assert.match(gets[1].url, /[?&]since=5\b/);
  __setFetch(null);
});

test('runner tick soft-fails when fetch throws (no crash)', async () => {
  __setFetch(async () => { throw new Error('down'); });
  const runner = createRunner({ aiAccount: AI, channel: { type: 'team', id: TEAM } });
  const r = await tick(runner);
  assert.deepEqual(r, { read: 0, answered: 0, replies: [] });
  __setFetch(null);
});
