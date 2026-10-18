// Pinboard mounted under a path (PATH_PREFIX=/pin behind melek.salon/pin): requests are stripped, page links
// and redirects are prefixed. Separate file: PATH_PREFIX is read when the module loads.
import { test } from 'node:test';
import assert from 'node:assert';
process.env.PATH_PREFIX = '/pin';
const { handler, __setIO } = await import('./server.mjs?prefix');
__setIO({ read: () => null, write: () => {} });

function call(url) {
  return new Promise((resolve) => {
    const res = { code: 0, headers: {}, body: '', writeHead(c, h) { this.code = c; this.headers = h || {}; }, end(b) { this.body = String(b || ''); resolve(this); } };
    const req = { url, method: 'GET', headers: {}, on: () => req, destroy: () => {} };
    handler(req, res);
  });
}

test('under /pin: the wall answers at /pin and every page link carries the prefix', async () => {
  const r = await call('/pin');
  assert.equal(r.code, 200);
  assert.match(r.body, /href="\/pin\/boards"/);
  assert.match(r.body, /href="\/pin\/how"/);
  assert.match(r.body, /action="\/pin\/pin"/);
  assert.ok(!/href="\/(?!pin|\/)/.test(r.body), 'no unprefixed root links left');
  assert.equal((await call('/pin/how')).code, 200);
  assert.equal((await call('/pin/health')).code, 200);
});
