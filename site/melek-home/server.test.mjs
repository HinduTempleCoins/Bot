import { test } from 'node:test';
import assert from 'node:assert';
import { handler } from './server.mjs';

function cap() {
  const o = { code: 0, type: '', body: '' };
  return { res: { writeHead: (c, h) => { o.code = c; o.type = (h && h['content-type']) || ''; }, end: (b) => { o.body = String(b || ''); } }, o };
}
const req = (url) => ({ url, method: 'GET', headers: {} });

test('the home page renders', async () => {
  const { res, o } = cap();
  await handler(req('/'), res);
  assert.equal(o.code, 200);
  assert.match(o.body, /MELEK/);
});

test('MELEK has its own way into groups and clubs, and points at Pact for the full surface', async () => {
  const { res, o } = cap();
  await handler(req('/'), res);
  assert.match(o.body, /Groups and clubs/);
  assert.match(o.body, /pact\.pentecaust\.com/);
  assert.match(o.body, /id=pacts/);
});

test('every rendered script block parses', async () => {
  const { res, o } = cap();
  await handler(req('/'), res);
  for (const m of o.body.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
    if (m[1].trim()) assert.doesNotThrow(() => new Function(m[1]), 'inline script must parse');
  }
});
