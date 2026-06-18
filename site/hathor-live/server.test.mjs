// server.test.mjs — hathor.live chat surface. Brain injected; offline, never throws.
import { test } from 'node:test';
import assert from 'node:assert';
import { handler, esc, __setConverse } from './server.mjs';

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

test('POST /api/chat routes to the brain and returns reply + sources', async () => {
  let seen = null;
  __setConverse(async (msg) => { seen = msg; return { reply: 'I am here, ' + msg, sources: [{ title: 'Rule 1', link: 'https://x/rule1' }], grounded: true }; });
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'what is rule 1?' }), res);
  assert.equal(o.code, 200);
  const j = JSON.parse(o.body);
  assert.equal(seen, 'what is rule 1?');
  assert.match(j.reply, /I am here/);
  assert.equal(j.sources[0].title, 'Rule 1');
  assert.equal(j.grounded, true);
  __setConverse(null);
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
  __setConverse(async () => { throw new Error('llm down'); });
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'hello' }), res);
  assert.equal(o.code, 200);
  assert.match(JSON.parse(o.body).reply, /another way|do not have/i);
  __setConverse(null);
});

test('POST /api/chat with no brain available degrades gracefully', async () => {
  // force "no brain": inject null is not enough (default import), so inject a thrower-less absent path
  __setConverse(false); // resets to default; default import may exist — so instead test via a fake that returns nothing
  __setConverse(async () => null);
  const { res, o } = cap();
  await handler(req('/api/chat', 'POST', { message: 'hi' }), res);
  assert.equal(o.code, 200);
  assert.ok(JSON.parse(o.body).reply.length > 0);
  __setConverse(null);
});

test('health + robots + 404', async () => {
  let { res, o } = cap(); await handler(req('/health'), res);
  assert.equal(o.code, 200); assert.match(o.type, /json/);
  ({ res, o } = cap()); await handler(req('/robots.txt'), res);
  assert.equal(o.code, 200); assert.match(o.body, /Disallow: \/api\//);
  ({ res, o } = cap()); await handler(req('/nope'), res);
  assert.equal(o.code, 404);
});

test('esc neutralizes HTML', () => {
  assert.equal(esc('<x>&"'), '&lt;x&gt;&amp;&quot;');
});
