// metatron.test.mjs — OFFLINE: the Metatron page builds, points at our Studio's JSON mode, carries the honest tags,
// and Pentecaust serves it at /metatron with a nav button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { metatronPage } from './metatron.mjs';

test('page: writing desk with the three transparency tags, scene board, graphic maker on our Studio', () => {
  const h = metatronPage('https://studio.example');
  for (const t of ['100% Human', 'AI-Assisted Planning', 'AI-Generated']) assert.ok(h.includes(t), t);
  assert.ok(h.includes('"https://studio.example"') && h.includes("/api/generate?format=json"));
  assert.ok(h.includes('Scene board') && h.includes('Backlog') && h.includes('Done'));
  assert.ok(h.includes('Herald') && h.includes('BiFrost'));
  assert.ok(h.includes('Hathor Metatron') && h.includes('powered by Hathor'));
  assert.ok(!/\$\{/.test(h), 'no unrendered template expressions');
});

test('Pentecaust serves /metatron and shows the nav button', async () => {
  const { handler } = await import('./server.mjs');
  const call = (url) => new Promise((resolve) => {
    const res = { statusCode: 0, headers: {}, body: '', writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); }, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = String(b || ''); resolve(this); } };
    handler({ method: 'GET', url, headers: { host: 'pentecaust.com' }, on() {}, socket: {} }, res);
  });
  const m = await call('/metatron');
  assert.equal(m.statusCode, 200); assert.ok(m.body.includes('Writing desk'));
  const home = await call('/');
  assert.ok(home.body.includes("location.href='/metatron'"));
});
