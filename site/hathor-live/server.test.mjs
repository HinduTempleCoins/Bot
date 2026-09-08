// server.test.mjs — hathor.live chat surface. Brain injected; offline, never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, esc, __setConverse, __setVideo, __setAgency } from './server.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = b || ''; } }, o };
}
// a fake request with an optional JSON body streamed via on('data')/on('end')
function req(path, method = 'GET', bodyObj) {
  const handlers = {};
  const r = { url: path, method, on: (ev, fn) => { handlers[ev] = fn; return r; }, destroy: () => {} };
  // drive the body after the handler subscribes
  queueMicrotask(() => {
    if (bodyObj !== undefined && handlers.data) handlers.data(JSON.stringify(bodyObj));
    if (handlers.end) handlers.end();
  });
  return r;
}

test('GET / serves the chat page', async () => {
  const { res, o } = cap();
  await handler(req('/'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /Hathor/);
  assert.match(o.body, /\/api\/chat/);   // the client posts here
});

test('POST /api/chat goes to the ONE brain (/perceive) first — same Hathor, with the visitor as the person', async () => {
  let seen = null;
  __setAgency(async (text, { from }) => { seen = { text, from }; return { reply: 'one self: ' + text, sources: [] }; });
  __setConverse(async () => { throw new Error('converse must NOT be reached when the brain answers'); });
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'who are you?' }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(seen.text, 'who are you?');
  assert.match(seen.from, /^web:/);                 // a per-visitor identity is passed for her memory
  assert.match(j.reply, /one self/);
  __setAgency(null); __setConverse(null);
});

test('POST /api/chat falls back to the local converse when the brain is unreachable', async () => {
  let seen = null;
  __setAgency(async () => null);                     // brain offline
  __setConverse(async (msg) => { seen = msg; return { reply: 'I am here, ' + msg, sources: [{ title: 'Rule 1', link: 'https://x/rule1' }], grounded: true }; });
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'what is rule 1?' }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(seen, 'what is rule 1?');
  assert.match(j.reply, /I am here/);
  assert.equal(j.sources[0].title, 'Rule 1');
  assert.equal(j.grounded, true);
  __setAgency(null); __setConverse(null);
});

test('POST /api/chat with empty message → 400 friendly', async () => {
  __setConverse(async () => ({ reply: 'should not be called', sources: [] }));
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: '   ' }), res);
  assert.equal(o.code, 400);
  assert.match(JSON.parse(o.body).reply, /Ask me/i);
  __setConverse(null);
});

test('POST /api/chat soft-handles a brain that throws (never 500s the user)', async () => {
  __setAgency(async () => null);
  __setConverse(async () => { throw new Error('llm down'); });
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'hello' }), res);
  assert.equal(o.code, 200);
  assert.match(JSON.parse(o.body).reply, /another way|do not have|resting/i);
  __setAgency(null); __setConverse(null);
});

test('POST /api/chat with neither brain available degrades gracefully', async () => {
  __setAgency(async () => null);
  __setConverse(async () => null);
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'hi' }), res);
  assert.equal(o.code, 200);
  assert.ok(JSON.parse(o.body).reply.length > 0);
  __setAgency(null); __setConverse(null);
});

test('health + robots + 404', async () => {
  let { res, o } = cap(); await handler(req('/health'), res);
  assert.equal(o.code, 200); assert.match(o.type, /json/);
  ({ res, o } = cap()); await handler(req('/robots.txt'), res);
  assert.equal(o.code, 200); assert.match(o.body, /Disallow: \/api\//);
  ({ res, o } = cap()); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});

test('GET /studio serves the AI video studio page', async () => {
  const { res, o } = cap();
  await handler(req('/studio'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /Hathor Studio/);
  assert.match(o.body, /\/api\/video-plan/);   // the studio posts here
});

test('POST /api/video-plan routes to the director and returns a plan', async () => {
  let seen = null;
  __setVideo(async (opts) => { seen = opts; return { ok: true, title: 'T', hook: 'H', cta: 'C', scenes: [{ n: 1 }], music: { mood: 'm' }, renderManifest: {}, durationSec: 20, aspect: '9:16', kind: 'ad' }; });
  const { res, o } = cap();
  await handler(req('/api/video-plan', 'POST', { brief: 'an ad for MELEK Move', kind: 'ad', format: 'ad' }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(seen.brief, 'an ad for MELEK Move');
  assert.equal(j.ok, true);
  assert.equal(j.title, 'T');
  __setVideo(null);
});

test('POST /api/video-plan with empty brief → 400 friendly', async () => {
  const { res, o } = cap();
  await handler(req('/api/video-plan', 'POST', { brief: '  ' }), res);
  assert.equal(o.code, 400);
  assert.match(JSON.parse(o.body).reason, /Describe your video/i);
});

test('POST /api/video-plan soft-handles a director that throws', async () => {
  __setVideo(async () => { throw new Error('boom'); });
  const { res, o } = cap();
  await handler(req('/api/video-plan', 'POST', { brief: 'x' }), res);
  assert.equal(o.code, 200);
  assert.equal(JSON.parse(o.body).ok, false);
  __setVideo(null);
});

test('esc neutralizes HTML', () => {
  assert.equal(esc('<x>&"'), '&lt;x&gt;&amp;&quot;');
});

// ── /chamber — wired 2026-09-08 ───────────────────────────────────────────────────────────────────
// chamber.mjs was written 2026-09-06, tested, and imported by nothing. These tests exist so it stays
// reachable, and so the gate it enforces is verified through the ROUTE rather than only in isolation.

test('GET /chamber with no session lists the sessions as doors', async () => {
  const { res, o } = cap();
  await handler(req('/chamber'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /The Chamber/);
  assert.match(o.body, /\/chamber\?s=/);
});

test('GET /api/chamber returns a plan with the tier ladder', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=chamber-alpha'), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, true);
  assert.deepEqual(j.tiers, ['immersive', 'cardboard', 'flat3d', 'plain']);
  assert.ok(j.plan.tier);
  assert.ok(j.plan.disclaimer, 'a plan always carries its disclaimer');
});

test('an unknown session is a 404 and names the real ones', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=not-a-session'), res);
  assert.equal(o.code, 404);
  const j = JSON.parse(o.body);
  assert.equal(j.ok, false);
  assert.ok(Array.isArray(j.sessions) && j.sessions.length);
});

test('NO capabilities means plain — the server never assumes a headset is there', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=chamber-alpha'), res);
  assert.equal(JSON.parse(o.body).plan.tier, 'plain');
});

test('capabilities are read from the request, and xr reaches the immersive tier', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=chamber-alpha&caps=xr&consent=immersive'), res);
  assert.equal(JSON.parse(o.body).plan.tier, 'immersive');
});

test('screen consent does NOT carry into a headset — the gate holds through the route', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=chamber-alpha&caps=xr&consent=screen'), res);
  const p = JSON.parse(o.body).plan;
  assert.equal(p.allowed, false);
  assert.equal(p.method, 'auditory', 'the auditory path is offered instead of nothing');
  assert.match(p.reason, /strapped to your face/);
});

test('no consent at all closes the visual path', async () => {
  const { res, o } = cap();
  await handler(req('/api/chamber?s=chamber-alpha&caps=xr'), res);
  assert.equal(JSON.parse(o.body).plan.allowed, false);
});

test('GET /chamber?s= renders the scene for that tier', async () => {
  const { res, o } = cap();
  await handler(req('/chamber?s=chamber-alpha&caps=xr&consent=immersive'), res);
  assert.equal(o.code, 200);
  assert.match(o.type, /text\/html/);
  assert.match(o.body, /chamber/i);
});

test('the session id is escaped into the door list', async () => {
  const { res, o } = cap();
  await handler(req('/chamber'), res);
  assert.ok(!o.body.includes('<script>alert'), 'no unescaped markup from session data');
});

// ── Temple Exams: the spine ───────────────────────────────────────────────────────────────────────

test('GET /exams serves the battery index with its limits and its refusals', async () => {
  const { res, o } = cap();
  await handler(req('/exams'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /Temple Exams/);
  assert.match(o.body, /Nothing here pays anything/);
  assert.match(o.body, /Nothing here goes on the chain/);
  assert.match(o.body, /No web page can test for tetrachromacy/);
});

test('GET /api/exams reports perception as unpayable and carries the completion counts', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams'), res);
  assert.equal(o.code, 200);
  const d = JSON.parse(o.body);
  assert.equal(d.payable, false);
  assert.equal(d.onChain, false);
  assert.ok(d.completions && typeof d.completions === 'object');
});

test('POST /api/exams/forget refuses anything that is not a participant key', async () => {
  const { res, o } = cap();
  await handler(req('/api/exams/forget', 'POST', { key: 'nope' }), res);
  assert.equal(o.code, 400);
  assert.match(o.body, /Nothing was deleted/);
});
