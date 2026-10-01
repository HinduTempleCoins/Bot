// sandalphon.test.mjs — OFFLINE: the Hathor Sandalphon song studio builds, carries the honest tags, church + ancient
// instruments, the song board, the engine export; Pentecaust serves it with a nav button.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandalphonPage, GENRES, INSTRUMENTS } from './sandalphon.mjs';

test('page: song sheet with sections and syllables, sound with church + ancient instruments, board, export', () => {
  const h = sandalphonPage();
  assert.ok(h.includes('Hathor Sandalphon') && h.includes('powered by Hathor'));
  for (const t of ['100% Human', 'AI-Assisted Planning', 'AI-Generated']) assert.ok(h.includes(t));
  assert.ok(INSTRUMENTS.ancient.includes('lyre (kinnor)') && INSTRUMENTS.church.includes('hammond organ'));
  assert.equal(GENRES[0], 'hymn'); assert.ok(GENRES.indexOf('gospel rock (1970s)') > GENRES.indexOf('southern gospel'));
  for (const s of ['Song board', 'Idea', 'Released', 'syllables', 'Prepare for the song engine']) assert.ok(h.includes(s), s);
  assert.ok(!/\$\{/.test(h), 'no unrendered template expressions');
});

test('Pentecaust serves /sandalphon and links both studios', async () => {
  const { handler } = await import('./server.mjs');
  const call = (url) => new Promise((resolve) => {
    const res = { statusCode: 0, headers: {}, body: '', writeHead(c, h) { this.statusCode = c; Object.assign(this.headers, h || {}); }, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = String(b || ''); resolve(this); } };
    handler({ method: 'GET', url, headers: { host: 'pentecaust.com' }, on() {}, socket: {} }, res);
  });
  const s = await call('/sandalphon');
  assert.equal(s.statusCode, 200); assert.ok(s.body.includes('Song sheet'));
  const home = await call('/');
  assert.ok(home.body.includes("location.href='/sandalphon'") && home.body.includes("location.href='/metatron'"));
});
